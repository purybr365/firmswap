// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, MockERC20} from "../Base.t.sol";
import {QuoteLib} from "../../src/libraries/QuoteLib.sol";
import {OrderLib} from "../../src/libraries/OrderLib.sol";
import {IFirmSwap} from "../../src/interfaces/IFirmSwap.sol";
import {FirmSwap} from "../../src/FirmSwap.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Handler contract that invariant fuzzer calls to exercise FirmSwap
contract FirmSwapHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    FirmSwap public firmSwap;
    MockERC20 public brla;
    MockERC20 public usdc;

    address public solver;
    uint256 public solverPk;
    address public user;

    uint256 public nextNonce;
    bytes32[] public depositedOrders;
    bytes32[] public settledOrders;
    bytes32[] public refundedOrders;

    // Ghost variables for tracking
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalSettled;
    uint256 public ghost_totalRefunded;
    uint256 public ghost_totalBondSlashed;

    constructor(
        FirmSwap _firmSwap,
        MockERC20 _brla,
        MockERC20 _usdc,
        address _solver,
        uint256 _solverPk,
        address _user
    ) {
        firmSwap = _firmSwap;
        brla = _brla;
        usdc = _usdc;
        solver = _solver;
        solverPk = _solverPk;
        user = _user;
    }

    function deposit(uint256 inputAmount, uint256 outputAmount) external {
        inputAmount = _bound(inputAmount, 1e18, 100_000e18);
        outputAmount = _bound(outputAmount, 1e6, 10_000e6);

        uint256 bondNeeded = (outputAmount * 500) / 10_000;
        if (bondNeeded > firmSwap.availableBond(solver)) return;

        QuoteLib.FirmSwapQuote memory quote = _makeQuote(inputAmount, outputAmount);
        bytes memory sig = _signQuote(quote);
        bytes32 orderId = _computeOrderId(quote, sig);

        brla.mint(user, inputAmount);

        vm.startPrank(user);
        brla.approve(address(firmSwap), inputAmount);
        firmSwap.deposit(quote, sig);
        vm.stopPrank();

        depositedOrders.push(orderId);
        ghost_totalDeposited += inputAmount;
        nextNonce++;
    }

    function fill(uint256 orderIndex) external {
        if (depositedOrders.length == 0) return;
        orderIndex = orderIndex % depositedOrders.length;
        bytes32 orderId = depositedOrders[orderIndex];

        (,,,,, uint256 outputAmount,,, IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        if (state != IFirmSwap.OrderState.DEPOSITED) return;

        // Check fill deadline
        (,,,,,,, uint32 fillDeadline,) = firmSwap.orders(orderId);
        if (block.timestamp > fillDeadline) return;

        usdc.mint(solver, outputAmount);

        vm.startPrank(solver);
        usdc.approve(address(firmSwap), outputAmount);
        firmSwap.fill(orderId);
        vm.stopPrank();

        settledOrders.push(orderId);
        ghost_totalSettled++;
    }

    function refund(uint256 orderIndex) external {
        if (depositedOrders.length == 0) return;
        orderIndex = orderIndex % depositedOrders.length;
        bytes32 orderId = depositedOrders[orderIndex];

        (,,,,,,, uint32 fillDeadline, IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        if (state != IFirmSwap.OrderState.DEPOSITED) return;
        if (block.timestamp <= fillDeadline) return;

        (,,, uint256 inputAmount,, uint256 outputAmount,,,) = firmSwap.orders(orderId);
        uint256 bondSlash = (outputAmount * 500) / 10_000;

        firmSwap.refund(orderId);

        refundedOrders.push(orderId);
        ghost_totalRefunded += inputAmount;
        ghost_totalBondSlashed += bondSlash;
    }

    function warpForward(uint256 seconds_) external {
        seconds_ = _bound(seconds_, 1, 10 minutes);
        vm.warp(block.timestamp + seconds_);
    }

    function _makeQuote(uint256 inputAmount, uint256 outputAmount)
        internal
        view
        returns (QuoteLib.FirmSwapQuote memory)
    {
        return QuoteLib.FirmSwapQuote({
            solver: solver,
            user: user,
            inputToken: address(brla),
            inputAmount: inputAmount,
            outputToken: address(usdc),
            outputAmount: outputAmount,
            orderType: QuoteLib.OrderType.EXACT_OUTPUT,
            outputChainId: block.chainid,
            depositDeadline: uint32(block.timestamp + 5 minutes),
            fillDeadline: uint32(block.timestamp + 7 minutes),
            nonce: nextNonce
        });
    }

    function _signQuote(QuoteLib.FirmSwapQuote memory quote) internal view returns (bytes memory) {
        bytes32 structHash = QuoteLib.hashMemory(quote);
        bytes32 digest = firmSwap.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(solverPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _computeOrderId(QuoteLib.FirmSwapQuote memory quote, bytes memory sig)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(QuoteLib.hashMemory(quote), keccak256(sig)));
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (x < lo) return lo;
        if (x > hi) return hi;
        return lo + (x % (hi - lo + 1));
    }

    function depositedOrdersLength() external view returns (uint256) {
        return depositedOrders.length;
    }

    function settledOrdersLength() external view returns (uint256) {
        return settledOrders.length;
    }

    function refundedOrdersLength() external view returns (uint256) {
        return refundedOrders.length;
    }
}

/// @title FirmSwap Invariant Tests
contract FirmSwapInvariantTest is BaseTest {
    FirmSwapHandler public handler;

    function setUp() public override {
        super.setUp();

        handler = new FirmSwapHandler(
            firmSwap,
            brla,
            usdc,
            solver,
            solverPk,
            user
        );

        // Target only the handler
        targetContract(address(handler));
    }

    /// @notice Invariant: Contract BRLA balance >= sum of all DEPOSITED order inputAmounts
    function invariant_contractHoldsDepositedTokens() public view {
        uint256 contractBrla = brla.balanceOf(address(firmSwap));
        uint256 depositedSum;

        for (uint256 i; i < handler.depositedOrdersLength(); i++) {
            bytes32 orderId = handler.depositedOrders(i);
            (,,, uint256 inputAmount,,,,, IFirmSwap.OrderState state) = firmSwap.orders(orderId);
            if (state == IFirmSwap.OrderState.DEPOSITED) {
                depositedSum += inputAmount;
            }
        }

        assertGe(contractBrla, depositedSum, "Contract must hold all deposited tokens");
    }

    /// @notice Invariant: reservedBond + availableBond == totalBond for each solver
    function invariant_bondAccountingConsistent() public view {
        (uint256 totalBond, uint256 reservedBond,,,) = firmSwap.solvers(solver);
        uint256 available = firmSwap.availableBond(solver);
        assertEq(totalBond - reservedBond, available, "Bond accounting must be consistent");
    }

    /// @notice Invariant: No order can transition from SETTLED or REFUNDED back
    function invariant_stateTransitionsIrreversible() public view {
        // Check settled orders stay settled
        for (uint256 i; i < handler.settledOrdersLength(); i++) {
            bytes32 orderId = handler.settledOrders(i);
            (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
            assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED), "Settled orders must stay settled");
        }

        // Check refunded orders stay refunded
        for (uint256 i; i < handler.refundedOrdersLength(); i++) {
            bytes32 orderId = handler.refundedOrders(i);
            (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
            assertEq(uint8(state), uint8(IFirmSwap.OrderState.REFUNDED), "Refunded orders must stay refunded");
        }
    }
}
