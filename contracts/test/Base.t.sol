// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ISignatureTransfer} from "permit2/interfaces/ISignatureTransfer.sol";

import {FirmSwap} from "../src/FirmSwap.sol";
import {DepositProxy} from "../src/DepositProxy.sol";
import {QuoteLib} from "../src/libraries/QuoteLib.sol";
import {OrderLib} from "../src/libraries/OrderLib.sol";
import {IFirmSwap} from "../src/interfaces/IFirmSwap.sol";

/// @notice Simple ERC20 mock for testing
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Base test contract with common setup and helpers
abstract contract BaseTest is Test {
    FirmSwap public firmSwap;
    address public permit2;
    MockERC20 public brla;   // input token (18 decimals)
    MockERC20 public usdc;   // output token (6 decimals) — also bond token

    // Actors
    uint256 internal solverPk;
    address internal solver;
    uint256 internal userPk;
    address internal user;
    address internal anyone;

    // Default test amounts
    uint256 constant BRLA_AMOUNT = 1148e18;      // 1148 BRLA
    uint256 constant USDC_AMOUNT = 200e6;         // 200 USDC
    uint256 constant SOLVER_BOND = 10_000e6;      // 10,000 USDC bond
    uint256 constant MIN_BOND = 1_000e6;          // 1,000 USDC minimum

    function setUp() public virtual {
        // Create actors
        (solver, solverPk) = makeAddrAndKey("solver");
        (user, userPk) = makeAddrAndKey("user");
        anyone = makeAddr("anyone");

        // Deploy tokens
        brla = new MockERC20("BRLA", "BRLA", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Deploy Permit2 from compiled artifact (avoids solc version conflict)
        permit2 = deployCode("lib/permit2/out/Permit2.sol/Permit2.json");

        // Deploy FirmSwap
        firmSwap = new FirmSwap(permit2, address(usdc));

        // Fund solver: bond + output tokens
        usdc.mint(solver, SOLVER_BOND + 1_000_000e6);

        // Register solver with bond
        vm.startPrank(solver);
        usdc.approve(address(firmSwap), type(uint256).max);
        firmSwap.registerSolver(SOLVER_BOND);
        vm.stopPrank();

        // Fund user with input tokens
        brla.mint(user, 1_000_000e18);
        vm.prank(user);
        brla.approve(address(firmSwap), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════

    function _defaultQuote() internal view returns (QuoteLib.FirmSwapQuote memory) {
        return QuoteLib.FirmSwapQuote({
            solver: solver,
            user: user,
            inputToken: address(brla),
            inputAmount: BRLA_AMOUNT,
            outputToken: address(usdc),
            outputAmount: USDC_AMOUNT,
            orderType: QuoteLib.OrderType.EXACT_OUTPUT,
            outputChainId: block.chainid,
            depositDeadline: uint32(block.timestamp + 5 minutes),
            fillDeadline: uint32(block.timestamp + 7 minutes),
            nonce: 0
        });
    }

    function _signQuote(
        QuoteLib.FirmSwapQuote memory quote,
        uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 structHash = QuoteLib.hashMemory(quote);
        bytes32 digest = firmSwap.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _depositOrder(
        QuoteLib.FirmSwapQuote memory quote
    ) internal returns (bytes32 orderId, bytes memory sig) {
        sig = _signQuote(quote, solverPk);
        orderId = _computeOrderId(quote, sig);

        vm.prank(user);
        firmSwap.deposit(quote, sig);
    }

    function _computeOrderId(
        QuoteLib.FirmSwapQuote memory quote,
        bytes memory sig
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(QuoteLib.hashMemory(quote), keccak256(sig)));
    }
}
