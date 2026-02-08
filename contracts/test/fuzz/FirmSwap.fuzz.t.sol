// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, MockERC20} from "../Base.t.sol";
import {QuoteLib} from "../../src/libraries/QuoteLib.sol";
import {IFirmSwap} from "../../src/interfaces/IFirmSwap.sol";

/// @title FirmSwap Fuzz Tests
/// @notice Property-based tests with random inputs
contract FirmSwapFuzzTest is BaseTest {
    /// @notice Fuzz: deposit with random amounts succeeds when within valid ranges
    function testFuzz_deposit_validAmounts(
        uint256 inputAmount,
        uint256 outputAmount,
        uint8 nonceRaw
    ) public {
        // Bound to valid ranges
        inputAmount = bound(inputAmount, 1, 1_000_000e18);
        outputAmount = bound(outputAmount, 1e6, 1_000_000e6); // >= MIN_ORDER
        uint256 nonce = uint256(nonceRaw); // small nonce range

        // Check bond sufficiency: 5% of outputAmount must be <= available bond
        uint256 bondNeeded = (outputAmount * 500) / 10_000;
        if (bondNeeded > SOLVER_BOND) return; // skip — would exceed bond

        // Fund user
        brla.mint(user, inputAmount);

        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.inputAmount = inputAmount;
        quote.outputAmount = outputAmount;
        quote.nonce = nonce;

        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(user);
        firmSwap.deposit(quote, sig);

        // Verify deposit
        bytes32 orderId = _computeOrderId(quote, sig);
        (,,, uint256 storedInput,, uint256 storedOutput,,, IFirmSwap.OrderState state) =
            firmSwap.orders(orderId);
        assertEq(storedInput, inputAmount);
        assertEq(storedOutput, outputAmount);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.DEPOSITED));
    }

    /// @notice Fuzz: fill after deposit always delivers correct amounts
    function testFuzz_fill_correctAmounts(
        uint256 inputAmount,
        uint256 outputAmount
    ) public {
        inputAmount = bound(inputAmount, 1, 1_000_000e18);
        outputAmount = bound(outputAmount, 1e6, 100_000e6);

        uint256 bondNeeded = (outputAmount * 500) / 10_000;
        if (bondNeeded > SOLVER_BOND) return;

        brla.mint(user, inputAmount);
        usdc.mint(solver, outputAmount);

        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.inputAmount = inputAmount;
        quote.outputAmount = outputAmount;

        (bytes32 orderId, ) = _depositOrder(quote);

        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBrlaBefore = brla.balanceOf(solver);

        vm.prank(solver);
        firmSwap.fill(orderId);

        assertEq(usdc.balanceOf(user) - userUsdcBefore, outputAmount, "User got exact output");
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, inputAmount, "Solver got exact input");
    }

    /// @notice Fuzz: settle (Address Deposit) with random amounts
    function testFuzz_settle_modeA(
        uint256 inputAmount,
        uint256 outputAmount,
        uint8 nonceRaw
    ) public {
        inputAmount = bound(inputAmount, 1, 1_000_000e18);
        outputAmount = bound(outputAmount, 1e6, 100_000e6);
        uint256 nonce = uint256(nonceRaw);

        uint256 bondNeeded = (outputAmount * 500) / 10_000;
        if (bondNeeded > SOLVER_BOND) return;

        usdc.mint(solver, outputAmount);

        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.inputAmount = inputAmount;
        quote.outputAmount = outputAmount;
        quote.nonce = nonce;

        bytes memory sig = _signQuote(quote, solverPk);
        address depositAddr = firmSwap.computeDepositAddress(quote, sig);

        // Mint tokens to deposit address
        brla.mint(depositAddr, inputAmount);

        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBrlaBefore = brla.balanceOf(solver);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        assertEq(usdc.balanceOf(user) - userUsdcBefore, outputAmount);
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, inputAmount);
    }

    /// @notice Fuzz: refund always returns input tokens to user
    function testFuzz_refund_returnsTokens(
        uint256 inputAmount,
        uint256 outputAmount
    ) public {
        inputAmount = bound(inputAmount, 1, 1_000_000e18);
        outputAmount = bound(outputAmount, 1e6, 100_000e6);

        uint256 bondNeeded = (outputAmount * 500) / 10_000;
        if (bondNeeded > SOLVER_BOND) return;

        brla.mint(user, inputAmount);

        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.inputAmount = inputAmount;
        quote.outputAmount = outputAmount;

        (bytes32 orderId, ) = _depositOrder(quote);

        vm.warp(quote.fillDeadline + 1);

        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(anyone);
        firmSwap.refund(orderId);

        assertEq(brla.balanceOf(user) - userBrlaBefore, inputAmount, "User gets full input back");
    }

    /// @notice Fuzz: bond reservation and release are consistent
    function testFuzz_bondAccounting(uint256 outputAmount) public {
        outputAmount = bound(outputAmount, 1e6, 100_000e6);

        uint256 bondNeeded = (outputAmount * 500) / 10_000;
        if (bondNeeded > SOLVER_BOND) return;

        uint256 availBefore = firmSwap.availableBond(solver);

        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.outputAmount = outputAmount;
        (bytes32 orderId, ) = _depositOrder(quote);

        uint256 availAfter = firmSwap.availableBond(solver);
        assertEq(availBefore - availAfter, bondNeeded, "Bond reserved correctly");

        vm.prank(solver);
        firmSwap.fill(orderId);

        assertEq(firmSwap.availableBond(solver), availBefore, "Bond released after fill");
    }

    /// @notice Fuzz: nonce bitmap works for any nonce value
    function testFuzz_nonceBitmap(uint256 nonce) public {
        // Bound to reasonable range to avoid excessive gas
        nonce = bound(nonce, 0, 100_000);

        assertFalse(firmSwap.isNonceUsed(solver, nonce));

        vm.prank(solver);
        firmSwap.cancelNonce(nonce);

        assertTrue(firmSwap.isNonceUsed(solver, nonce));
    }

    /// @notice Fuzz: order type doesn't affect settlement mechanics
    function testFuzz_orderType_bothWork(uint8 orderTypeRaw) public {
        QuoteLib.OrderType orderType = orderTypeRaw % 2 == 0
            ? QuoteLib.OrderType.EXACT_INPUT
            : QuoteLib.OrderType.EXACT_OUTPUT;

        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.orderType = orderType;

        (bytes32 orderId, ) = _depositOrder(quote);

        vm.prank(solver);
        firmSwap.fill(orderId);

        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED));
    }

    /// @notice Fuzz: deposit deadline can be any future time
    function testFuzz_deadlines(uint32 depositOffset, uint32 fillOffset) public {
        depositOffset = uint32(bound(depositOffset, 60, 1 hours));
        fillOffset = uint32(bound(fillOffset, 1, 1 hours));

        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.depositDeadline = uint32(block.timestamp) + depositOffset;
        quote.fillDeadline = quote.depositDeadline + fillOffset;

        (bytes32 orderId, ) = _depositOrder(quote);

        vm.prank(solver);
        firmSwap.fill(orderId);

        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED));
    }
}
