// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FirmSwap} from "../src/FirmSwap.sol";
import {QuoteLib} from "../src/libraries/QuoteLib.sol";
import {OrderLib} from "../src/libraries/OrderLib.sol";
import {IFirmSwap} from "../src/interfaces/IFirmSwap.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title E2ETest
/// @notice End-to-end test script for live testnet deployment
/// @dev Usage:
///   FIRMSWAP=0x... BRLA=0x... USDC=0x... PRIVATE_KEY=0x... \
///   forge script script/E2ETest.s.sol \
///     --rpc-url https://rpc.chiadochain.net --broadcast
contract E2ETest is Script {
    FirmSwap firmSwap;
    IERC20 brla;
    IERC20 usdc;
    address account;
    uint256 pk;

    function run() external {
        firmSwap = FirmSwap(vm.envAddress("FIRMSWAP"));
        brla = IERC20(vm.envAddress("BRLA"));
        usdc = IERC20(vm.envAddress("USDC"));
        pk = vm.envUint("PRIVATE_KEY");
        account = vm.addr(pk);

        console2.log("=== E2E Test ===");
        console2.log("Chain:", block.chainid);
        console2.log("Account:", account);
        console2.log("tBRLA balance:", brla.balanceOf(account));
        console2.log("tUSDC balance:", usdc.balanceOf(account));

        (uint256 totalBond,,,, bool registered) = firmSwap.solvers(account);
        require(registered, "Solver not registered!");
        console2.log("Solver bond:", totalBond);

        vm.startBroadcast(pk);

        _testModeB();
        _testModeA();
        _testNonceCancellation();

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== ALL E2E TESTS PASSED ===");
        console2.log("Final tBRLA:", brla.balanceOf(account));
        console2.log("Final tUSDC:", usdc.balanceOf(account));
    }

    function _testModeB() internal {
        console2.log("");
        console2.log("=== TEST 1: Contract Deposit (deposit + fill) ===");

        QuoteLib.FirmSwapQuote memory q = QuoteLib.FirmSwapQuote({
            solver: account,
            user: account,
            inputToken: address(brla),
            inputAmount: 1000e18,
            outputToken: address(usdc),
            outputAmount: 200e6,
            orderType: QuoteLib.OrderType.EXACT_OUTPUT,
            outputChainId: block.chainid,
            depositDeadline: uint32(block.timestamp + 300),
            fillDeadline: uint32(block.timestamp + 420),
            nonce: 0
        });

        bytes memory sig = _signQuote(q);
        bytes32 orderId = OrderLib.computeOrderIdMemory(q, sig);

        // Deposit
        firmSwap.deposit(q, sig);
        _assertState(orderId, IFirmSwap.OrderState.DEPOSITED);
        console2.log("Deposited! Order:", vm.toString(orderId));

        // Fill
        firmSwap.fill(orderId);
        _assertState(orderId, IFirmSwap.OrderState.SETTLED);
        console2.log("TEST 1 PASSED");
    }

    function _testModeA() internal {
        console2.log("");
        console2.log("=== TEST 2: Address Deposit (address deposit + settle) ===");

        QuoteLib.FirmSwapQuote memory q = QuoteLib.FirmSwapQuote({
            solver: account,
            user: account,
            inputToken: address(brla),
            inputAmount: 500e18,
            outputToken: address(usdc),
            outputAmount: 100e6,
            orderType: QuoteLib.OrderType.EXACT_OUTPUT,
            outputChainId: block.chainid,
            depositDeadline: uint32(block.timestamp + 300),
            fillDeadline: uint32(block.timestamp + 420),
            nonce: 1
        });

        bytes memory sig = _signQuote(q);

        // Compute deposit address and send tokens there
        address depositAddr = firmSwap.computeDepositAddress(q, sig);
        console2.log("Deposit addr:", depositAddr);

        brla.transfer(depositAddr, 500e18);
        console2.log("Balance at addr:", brla.balanceOf(depositAddr));

        // Settle
        firmSwap.settle(q, sig);

        bytes32 orderId = keccak256(abi.encode(QuoteLib.hashMemory(q), keccak256(sig)));
        _assertState(orderId, IFirmSwap.OrderState.SETTLED);
        console2.log("TEST 2 PASSED");
    }

    function _testNonceCancellation() internal {
        console2.log("");
        console2.log("=== TEST 3: Nonce cancellation ===");

        uint256 testNonce = 999;
        require(!firmSwap.isNonceUsed(account, testNonce), "Nonce already used");

        firmSwap.cancelNonce(testNonce);

        require(firmSwap.isNonceUsed(account, testNonce), "Nonce not cancelled");
        console2.log("TEST 3 PASSED");
    }

    function _signQuote(QuoteLib.FirmSwapQuote memory q) internal view returns (bytes memory) {
        bytes32 digest = firmSwap.hashTypedDataV4(QuoteLib.hashMemory(q));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _assertState(bytes32 orderId, IFirmSwap.OrderState expected) internal view {
        (,,,,,,,, IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        require(state == expected, "Unexpected order state");
    }
}
