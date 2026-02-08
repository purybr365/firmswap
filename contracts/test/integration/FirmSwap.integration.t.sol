// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, MockERC20} from "../Base.t.sol";
import {QuoteLib} from "../../src/libraries/QuoteLib.sol";
import {IFirmSwap} from "../../src/interfaces/IFirmSwap.sol";

/// @title FirmSwap Integration Tests
/// @notice End-to-end flows for Address Deposit and Contract Deposit
contract FirmSwapIntegrationTest is BaseTest {
    // ═══════════════════════════════════════════════════
    //  CONTRACT DEPOSIT: Full Flow
    // ═══════════════════════════════════════════════════

    /// @notice Picnic use case: User deposits BRLA, solver fills with USDC
    function test_modeB_fullFlow_exactOutput() public {
        // Step 1: User requests quote for exactly 200 USDC output
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        // quote.orderType is already EXACT_OUTPUT

        // Step 2: Solver signs the quote off-chain
        bytes memory sig = _signQuote(quote, solverPk);

        // Step 3: User deposits BRLA
        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(user);
        firmSwap.deposit(quote, sig);
        assertEq(userBrlaBefore - brla.balanceOf(user), BRLA_AMOUNT);

        // Step 4: Solver detects Deposited event and fills
        bytes32 orderId = _computeOrderId(quote, sig);
        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBrlaBefore = brla.balanceOf(solver);

        vm.prank(solver);
        firmSwap.fill(orderId);

        // Step 5: Verify final balances
        assertEq(usdc.balanceOf(user) - userUsdcBefore, USDC_AMOUNT, "User should receive USDC");
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, BRLA_AMOUNT, "Solver should receive BRLA");

        // Step 6: Verify order state
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED));

        // Bond is fully released
        assertEq(firmSwap.availableBond(solver), SOLVER_BOND);
    }

    /// @notice EXACT_INPUT: User specifies they have 1000 BRLA, solver quotes how much USDC
    function test_modeB_fullFlow_exactInput() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.orderType = QuoteLib.OrderType.EXACT_INPUT;
        quote.inputAmount = 1000e18;   // User has 1000 BRLA
        quote.outputAmount = 174e6;     // Solver quotes 174 USDC

        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(user);
        firmSwap.deposit(quote, sig);

        bytes32 orderId = _computeOrderId(quote, sig);
        vm.prank(solver);
        firmSwap.fill(orderId);

        assertEq(usdc.balanceOf(user), 174e6, "User should receive quoted USDC amount");
        assertEq(brla.balanceOf(solver), 1000e18, "Solver should receive quoted BRLA amount");
    }

    /// @notice Contract Deposit refund: Solver doesn't fill, user gets refunded + bond compensation
    function test_modeB_refundFlow() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        // Solver fails to fill within deadline
        vm.warp(quote.fillDeadline + 1);

        uint256 userBrlaBefore = brla.balanceOf(user);
        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBondBefore;
        (solverBondBefore,,,,) = firmSwap.solvers(solver);

        // Anyone can trigger refund
        vm.prank(anyone);
        firmSwap.refund(orderId);

        // User gets input tokens back
        assertEq(brla.balanceOf(user) - userBrlaBefore, BRLA_AMOUNT);

        // User gets bond compensation (5% of output amount)
        uint256 expectedSlash = (USDC_AMOUNT * 500) / 10_000; // 10 USDC
        assertEq(usdc.balanceOf(user) - userUsdcBefore, expectedSlash);

        // Solver bond reduced
        (uint256 solverBondAfter,,,,) = firmSwap.solvers(solver);
        assertEq(solverBondBefore - solverBondAfter, expectedSlash);
    }

    // ═══════════════════════════════════════════════════
    //  ADDRESS DEPOSIT: Full Flow
    // ═══════════════════════════════════════════════════

    /// @notice Picnic use case (Address Deposit): BRLA minted to CREATE2 address, solver settles in 1 tx
    function test_modeA_fullFlow_directMint() public {
        // Step 1: Quote is created
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        // Step 2: Compute deterministic deposit address
        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        assertTrue(depositAddr != address(0));

        // Step 3: Picnic tells BRLA to mint directly to deposit address
        //         (In production: off-chain API call. Here: address deposit)
        brla.mint(depositAddr, BRLA_AMOUNT);
        assertEq(brla.balanceOf(depositAddr), BRLA_AMOUNT);

        // Step 4: Solver detects balance at deposit address and calls settle()
        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBrlaBefore = brla.balanceOf(solver);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Step 5: Verify — all happened in 1 transaction
        assertEq(usdc.balanceOf(user) - userUsdcBefore, USDC_AMOUNT, "User received USDC");
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, BRLA_AMOUNT, "Solver received BRLA");
        assertEq(brla.balanceOf(depositAddr), 0, "Deposit address swept clean");

        bytes32 orderId = _computeOrderId(quote, sig);
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED));
    }

    /// @notice Address Deposit: Extra tokens deposited. Solver gets only inputAmount, excess stored for user.
    function test_modeA_extraDeposit() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        // Mint more than required
        brla.mint(depositAddr, BRLA_AMOUNT + 100e18);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Solver receives ONLY inputAmount (not the excess)
        assertEq(brla.balanceOf(solver), BRLA_AMOUNT);
        // Excess is stored for user recovery
        assertEq(firmSwap.excessBalances(user, address(brla)), 100e18);
        // FirmSwap holds the excess
        assertEq(brla.balanceOf(address(firmSwap)), 100e18);
    }

    /// @notice Address Deposit refund: Solver doesn't settle, tokens refunded to user
    function test_modeA_refundFlow() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        // Solver fails to settle within deadline
        vm.warp(quote.fillDeadline + 1);

        uint256 userBrlaBefore = brla.balanceOf(user);
        uint256 userUsdcBefore = usdc.balanceOf(user);

        vm.prank(anyone);
        firmSwap.refundAddressDeposit(quote, sig);

        // User gets BRLA back
        assertEq(brla.balanceOf(user) - userBrlaBefore, BRLA_AMOUNT);
        assertEq(brla.balanceOf(depositAddr), 0, "Deposit address swept");

        // User gets bond compensation
        uint256 expectedSlash = (USDC_AMOUNT * 500) / 10_000;
        assertEq(usdc.balanceOf(user) - userUsdcBefore, expectedSlash);
    }

    // ═══════════════════════════════════════════════════
    //  MULTI-ORDER SCENARIOS
    // ═══════════════════════════════════════════════════

    /// @notice Multiple concurrent orders from same solver
    function test_multipleOrders_concurrent() public {
        uint256 numOrders = 5;
        bytes32[] memory orderIds = new bytes32[](numOrders);

        for (uint256 i; i < numOrders; i++) {
            QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
            quote.nonce = i;
            bytes memory sig = _signQuote(quote, solverPk);
            orderIds[i] = _computeOrderId(quote, sig);

            vm.prank(user);
            firmSwap.deposit(quote, sig);
        }

        // Verify bond reservation: 5 orders × 5% of 200 USDC = 50 USDC reserved
        uint256 totalReserved = numOrders * ((USDC_AMOUNT * 500) / 10_000);
        assertEq(firmSwap.availableBond(solver), SOLVER_BOND - totalReserved);

        // Fill all orders
        for (uint256 i; i < numOrders; i++) {
            vm.prank(solver);
            firmSwap.fill(orderIds[i]);
        }

        // All bond released
        assertEq(firmSwap.availableBond(solver), SOLVER_BOND);
        assertEq(usdc.balanceOf(user), USDC_AMOUNT * numOrders);
    }

    /// @notice Mix of settled and refunded orders
    function test_multipleOrders_mixedOutcomes() public {
        // Order 1: Will be filled
        QuoteLib.FirmSwapQuote memory quote1 = _defaultQuote();
        quote1.nonce = 10;
        (bytes32 orderId1, ) = _depositOrder(quote1);

        // Order 2: Will expire and be refunded
        QuoteLib.FirmSwapQuote memory quote2 = _defaultQuote();
        quote2.nonce = 11;
        (bytes32 orderId2, ) = _depositOrder(quote2);

        // Fill order 1
        vm.prank(solver);
        firmSwap.fill(orderId1);

        // Let order 2 expire
        vm.warp(quote2.fillDeadline + 1);
        vm.prank(anyone);
        firmSwap.refund(orderId2);

        // Verify states
        (,,,,,,,,IFirmSwap.OrderState state1) = firmSwap.orders(orderId1);
        (,,,,,,,,IFirmSwap.OrderState state2) = firmSwap.orders(orderId2);
        assertEq(uint8(state1), uint8(IFirmSwap.OrderState.SETTLED));
        assertEq(uint8(state2), uint8(IFirmSwap.OrderState.REFUNDED));
    }

    // ═══════════════════════════════════════════════════
    //  SOLVER LIFECYCLE
    // ═══════════════════════════════════════════════════

    /// @notice Full solver lifecycle: register → fill orders → unstake
    function test_solverLifecycle() public {
        // New solver registers
        address newSolver;
        uint256 newSolverPk;
        (newSolver, newSolverPk) = makeAddrAndKey("newSolver");
        usdc.mint(newSolver, 50_000e6);

        vm.startPrank(newSolver);
        usdc.approve(address(firmSwap), type(uint256).max);
        firmSwap.registerSolver(5_000e6);
        vm.stopPrank();

        // Create and fill an order
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.solver = newSolver;
        quote.nonce = 42;
        bytes memory sig = _signQuote(quote, newSolverPk);

        vm.prank(user);
        firmSwap.deposit(quote, sig);

        bytes32 orderId = _computeOrderId(quote, sig);
        vm.prank(newSolver);
        firmSwap.fill(orderId);

        // Request unstake
        vm.prank(newSolver);
        firmSwap.requestUnstake(4_000e6);

        // Can't unstake immediately
        vm.prank(newSolver);
        vm.expectRevert(IFirmSwap.UnstakeNotReady.selector);
        firmSwap.executeUnstake();

        // Wait for timelock
        vm.warp(block.timestamp + 7 days);

        uint256 balBefore = usdc.balanceOf(newSolver);
        vm.prank(newSolver);
        firmSwap.executeUnstake();
        assertEq(usdc.balanceOf(newSolver) - balBefore, 4_000e6);
    }

    // ═══════════════════════════════════════════════════
    //  ADDRESS DEPOSIT + CONTRACT DEPOSIT INTEROP
    // ═══════════════════════════════════════════════════

    /// @notice One solver handling both Address Deposit and Contract Deposit orders simultaneously
    function test_modeA_and_modeB_concurrent() public {
        // Contract Deposit order
        QuoteLib.FirmSwapQuote memory quoteB = _defaultQuote();
        quoteB.nonce = 0;
        (bytes32 orderIdB, ) = _depositOrder(quoteB);

        // Address Deposit order
        QuoteLib.FirmSwapQuote memory quoteA = _defaultQuote();
        quoteA.nonce = 1;
        bytes memory sigA = _signQuote(quoteA, solverPk);
        address depositAddr = firmSwap.computeDepositAddress(quoteA, sigA);
        brla.mint(depositAddr, BRLA_AMOUNT);

        // Solver fills Contract Deposit first
        vm.prank(solver);
        firmSwap.fill(orderIdB);

        // Then settles Address Deposit
        vm.prank(solver);
        firmSwap.settle(quoteA, sigA);

        // User received 2× USDC (200 × 2 = 400 USDC)
        assertEq(usdc.balanceOf(user), USDC_AMOUNT * 2);
    }

    // ═══════════════════════════════════════════════════
    //  RECOVERY INTEGRATION
    // ═══════════════════════════════════════════════════

    /// @notice Full lifecycle: settle → tokens stuck → recover
    function test_modeA_recoverAfterSettle() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 50;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Simulate: user accidentally sends more tokens to same address
        brla.mint(depositAddr, 200e18);

        // Third party notices and recovers them
        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(anyone);
        firmSwap.recoverFromProxy(quote, sig, address(brla));

        assertEq(brla.balanceOf(user) - userBrlaBefore, 200e18);
        assertEq(brla.balanceOf(depositAddr), 0);
    }

    /// @notice Griefing prevention: tiny deposit → refund without slash → solver still operational
    function test_modeA_griefingPrevention_solverUnaffected() public {
        // Create quotes with known deadlines and grief them with 1 wei deposits
        QuoteLib.FirmSwapQuote memory q0 = _defaultQuote();
        q0.nonce = 60;
        QuoteLib.FirmSwapQuote memory q1 = _defaultQuote();
        q1.nonce = 61;
        QuoteLib.FirmSwapQuote memory q2 = _defaultQuote();
        q2.nonce = 62;

        bytes memory sig0 = _signQuote(q0, solverPk);
        bytes memory sig1 = _signQuote(q1, solverPk);
        bytes memory sig2 = _signQuote(q2, solverPk);

        brla.mint(firmSwap.computeDepositAddress(q0, sig0), 1);
        brla.mint(firmSwap.computeDepositAddress(q1, sig1), 1);
        brla.mint(firmSwap.computeDepositAddress(q2, sig2), 1);

        // Warp past all fill deadlines (default fillDeadline = block.timestamp + 7 minutes)
        vm.warp(q0.fillDeadline + 1);

        (uint256 solverBondBefore,,,,) = firmSwap.solvers(solver);

        // Refund all 3 griefed orders
        vm.prank(anyone);
        firmSwap.refundAddressDeposit(q0, sig0);
        vm.prank(anyone);
        firmSwap.refundAddressDeposit(q1, sig1);
        vm.prank(anyone);
        firmSwap.refundAddressDeposit(q2, sig2);

        // Solver bond unchanged
        (uint256 solverBondAfter,,,,) = firmSwap.solvers(solver);
        assertEq(solverBondAfter, solverBondBefore, "Solver bond should survive griefing attempts");

        // Solver can still fill legitimate orders (new quote with fresh deadlines)
        QuoteLib.FirmSwapQuote memory realQuote = QuoteLib.FirmSwapQuote({
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
            nonce: 100
        });
        bytes memory realSig = _signQuote(realQuote, solverPk);
        address realAddr = firmSwap.computeDepositAddress(realQuote, realSig);
        brla.mint(realAddr, BRLA_AMOUNT);

        uint256 userUsdcBefore = usdc.balanceOf(user);
        vm.prank(solver);
        firmSwap.settle(realQuote, realSig);

        // User received the USDC
        assertEq(usdc.balanceOf(user) - userUsdcBefore, USDC_AMOUNT);
    }
}
