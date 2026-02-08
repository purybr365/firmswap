// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, MockERC20} from "../Base.t.sol";
import {QuoteLib} from "../../src/libraries/QuoteLib.sol";
import {OrderLib} from "../../src/libraries/OrderLib.sol";
import {IFirmSwap} from "../../src/interfaces/IFirmSwap.sol";
import {FirmSwap} from "../../src/FirmSwap.sol";

contract FirmSwapUnitTest is BaseTest {
    // ═══════════════════════════════════════════════════
    //  SOLVER REGISTRATION
    // ═══════════════════════════════════════════════════

    function test_registerSolver() public {
        address newSolver = makeAddr("newSolver");
        usdc.mint(newSolver, MIN_BOND);

        vm.startPrank(newSolver);
        usdc.approve(address(firmSwap), MIN_BOND);
        firmSwap.registerSolver(MIN_BOND);
        vm.stopPrank();

        (uint256 totalBond,,,, bool registered) = firmSwap.solvers(newSolver);
        assertEq(totalBond, MIN_BOND);
        assertTrue(registered);
    }

    function test_registerSolver_revert_alreadyRegistered() public {
        vm.prank(solver);
        vm.expectRevert(IFirmSwap.SolverAlreadyRegistered.selector);
        firmSwap.registerSolver(MIN_BOND);
    }

    function test_registerSolver_revert_belowMinBond() public {
        address newSolver = makeAddr("newSolver");
        usdc.mint(newSolver, MIN_BOND - 1);

        vm.startPrank(newSolver);
        usdc.approve(address(firmSwap), MIN_BOND - 1);
        vm.expectRevert(IFirmSwap.BelowMinimumBond.selector);
        firmSwap.registerSolver(MIN_BOND - 1);
        vm.stopPrank();
    }

    function test_addBond() public {
        uint256 extra = 5_000e6;
        usdc.mint(solver, extra);

        vm.prank(solver);
        firmSwap.addBond(extra);

        (uint256 totalBond,,,,) = firmSwap.solvers(solver);
        assertEq(totalBond, SOLVER_BOND + extra);
    }

    function test_addBond_revert_notRegistered() public {
        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(IFirmSwap.SolverNotRegistered.selector);
        firmSwap.addBond(100);
    }

    function test_requestUnstake() public {
        uint256 unstakeAmt = 5_000e6;
        vm.prank(solver);
        firmSwap.requestUnstake(unstakeAmt);

        (,, uint256 unstakeAmount, uint40 unstakeTimestamp,) = firmSwap.solvers(solver);
        assertEq(unstakeAmount, unstakeAmt);
        assertEq(unstakeTimestamp, uint40(block.timestamp) + 7 days);
    }

    function test_requestUnstake_revert_belowMinBond() public {
        // Solver has 10,000. Min is 1,000. Unstaking 9,001 would leave 999.
        vm.prank(solver);
        vm.expectRevert(IFirmSwap.BelowMinimumBond.selector);
        firmSwap.requestUnstake(SOLVER_BOND - MIN_BOND + 1);
    }

    function test_executeUnstake() public {
        uint256 unstakeAmt = 5_000e6;
        vm.prank(solver);
        firmSwap.requestUnstake(unstakeAmt);

        // Warp past timelock
        vm.warp(block.timestamp + 7 days);

        uint256 balBefore = usdc.balanceOf(solver);
        vm.prank(solver);
        firmSwap.executeUnstake();

        assertEq(usdc.balanceOf(solver) - balBefore, unstakeAmt);
        (uint256 totalBond,, uint256 unstakeAmount,,) = firmSwap.solvers(solver);
        assertEq(totalBond, SOLVER_BOND - unstakeAmt);
        assertEq(unstakeAmount, 0);
    }

    function test_executeUnstake_revert_notReady() public {
        vm.prank(solver);
        firmSwap.requestUnstake(5_000e6);

        vm.prank(solver);
        vm.expectRevert(IFirmSwap.UnstakeNotReady.selector);
        firmSwap.executeUnstake();
    }

    function test_executeUnstake_revert_noPending() public {
        vm.prank(solver);
        vm.expectRevert(IFirmSwap.NoPendingUnstake.selector);
        firmSwap.executeUnstake();
    }

    // ═══════════════════════════════════════════════════
    //  NONCE MANAGEMENT
    // ═══════════════════════════════════════════════════

    function test_cancelNonce() public {
        vm.prank(solver);
        firmSwap.cancelNonce(42);
        assertTrue(firmSwap.isNonceUsed(solver, 42));
    }

    function test_cancelNonces_bitmap() public {
        // Cancel nonces 0, 1, 7 in word 0
        uint256 mask = (1 << 0) | (1 << 1) | (1 << 7);
        vm.prank(solver);
        firmSwap.cancelNonces(0, mask);

        assertTrue(firmSwap.isNonceUsed(solver, 0));
        assertTrue(firmSwap.isNonceUsed(solver, 1));
        assertFalse(firmSwap.isNonceUsed(solver, 2));
        assertTrue(firmSwap.isNonceUsed(solver, 7));
    }

    // ═══════════════════════════════════════════════════
    //  CONTRACT DEPOSIT: DEPOSIT
    // ═══════════════════════════════════════════════════

    function test_deposit() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        (
            address u,
            address s,
            address inputTok,
            uint256 inputAmt,
            address outputTok,
            uint256 outputAmt,
            uint256 outChain,
            uint32 fillDead,
            IFirmSwap.OrderState state
        ) = firmSwap.orders(orderId);

        assertEq(u, user);
        assertEq(s, solver);
        assertEq(inputTok, address(brla));
        assertEq(inputAmt, BRLA_AMOUNT);
        assertEq(outputTok, address(usdc));
        assertEq(outputAmt, USDC_AMOUNT);
        assertEq(outChain, block.chainid);
        assertEq(fillDead, quote.fillDeadline);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.DEPOSITED));

        // BRLA moved from user to contract
        assertEq(brla.balanceOf(address(firmSwap)), BRLA_AMOUNT);

        // Nonce consumed
        assertTrue(firmSwap.isNonceUsed(solver, 0));
    }

    function test_deposit_revert_expiredQuote() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.depositDeadline = uint32(block.timestamp - 1);
        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.QuoteExpired.selector);
        firmSwap.deposit(quote, sig);
    }

    function test_deposit_revert_invalidSignature() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        // Sign with wrong key
        bytes memory sig = _signQuote(quote, userPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.InvalidSignature.selector);
        firmSwap.deposit(quote, sig);
    }

    function test_deposit_revert_nonceReused() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        _depositOrder(quote);

        // Try same nonce again with different params
        QuoteLib.FirmSwapQuote memory quote2 = _defaultQuote();
        quote2.inputAmount = 2000e18;
        bytes memory sig2 = _signQuote(quote2, solverPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.NonceAlreadyUsed.selector);
        firmSwap.deposit(quote2, sig2);
    }

    function test_deposit_revert_wrongChain() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.outputChainId = 999;
        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.WrongChain.selector);
        firmSwap.deposit(quote, sig);
    }

    function test_deposit_revert_invalidQuote_zeroAmounts() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.inputAmount = 0;
        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.InvalidQuote.selector);
        firmSwap.deposit(quote, sig);
    }

    function test_deposit_revert_belowMinOrder() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.outputAmount = 0.5e6; // 0.5 USDC < 1 USDC minimum
        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.BelowMinimumOrder.selector);
        firmSwap.deposit(quote, sig);
    }

    function test_deposit_revert_fillDeadlineBeforeDeposit() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.fillDeadline = quote.depositDeadline; // equal, not strictly after
        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.FillDeadlineBeforeDeposit.selector);
        firmSwap.deposit(quote, sig);
    }

    function test_deposit_revert_solverNotRegistered() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (, uint256 fakePk) = makeAddrAndKey("fakeSolver");
        quote.solver = vm.addr(fakePk);
        bytes memory sig = _signQuote(quote, fakePk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.SolverNotRegistered.selector);
        firmSwap.deposit(quote, sig);
    }

    // ═══════════════════════════════════════════════════
    //  CONTRACT DEPOSIT: FILL
    // ═══════════════════════════════════════════════════

    function test_fill() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBrlaBefore = brla.balanceOf(solver);

        vm.prank(solver);
        firmSwap.fill(orderId);

        // User got USDC
        assertEq(usdc.balanceOf(user) - userUsdcBefore, USDC_AMOUNT);
        // Solver got BRLA
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, BRLA_AMOUNT);
        // Order is settled
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED));
    }

    function test_fill_revert_notSolver() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.NotSolver.selector);
        firmSwap.fill(orderId);
    }

    function test_fill_revert_expired() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        vm.warp(quote.fillDeadline + 1);

        vm.prank(solver);
        vm.expectRevert(IFirmSwap.QuoteExpired.selector);
        firmSwap.fill(orderId);
    }

    function test_fill_revert_notDeposited() public {
        vm.prank(solver);
        vm.expectRevert(IFirmSwap.OrderNotDeposited.selector);
        firmSwap.fill(bytes32(0));
    }

    function test_fill_revert_doubleFill() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        vm.prank(solver);
        firmSwap.fill(orderId);

        vm.prank(solver);
        vm.expectRevert(IFirmSwap.OrderNotDeposited.selector);
        firmSwap.fill(orderId);
    }

    // ═══════════════════════════════════════════════════
    //  REFUND (CONTRACT DEPOSIT)
    // ═══════════════════════════════════════════════════

    function test_refund() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        // Warp past fill deadline
        vm.warp(quote.fillDeadline + 1);

        uint256 userBrlaBefore = brla.balanceOf(user);
        uint256 userUsdcBefore = usdc.balanceOf(user);

        // Anyone can trigger refund
        vm.prank(anyone);
        firmSwap.refund(orderId);

        // User gets BRLA back
        assertEq(brla.balanceOf(user) - userBrlaBefore, BRLA_AMOUNT);

        // User gets bond compensation (5% of 200 USDC = 10 USDC)
        uint256 expectedBondSlash = (USDC_AMOUNT * 500) / 10_000;
        assertEq(usdc.balanceOf(user) - userUsdcBefore, expectedBondSlash);

        // Order is refunded
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.REFUNDED));

        // Solver bond reduced
        (uint256 totalBond,,,,) = firmSwap.solvers(solver);
        assertEq(totalBond, SOLVER_BOND - expectedBondSlash);
    }

    function test_refund_revert_notExpired() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.OrderNotExpired.selector);
        firmSwap.refund(orderId);
    }

    function test_refund_revert_notDeposited() public {
        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.OrderNotDeposited.selector);
        firmSwap.refund(bytes32(0));
    }

    // ═══════════════════════════════════════════════════
    //  ADDRESS DEPOSIT: COMPUTE DEPOSIT ADDRESS
    // ═══════════════════════════════════════════════════

    function test_computeDepositAddress_deterministic() public view {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address addr1 = firmSwap.computeDepositAddress(quote, sig);
        address addr2 = firmSwap.computeDepositAddress(quote, sig);
        assertEq(addr1, addr2);
        assertTrue(addr1 != address(0));
    }

    function test_computeDepositAddress_unique_per_quote() public view {
        QuoteLib.FirmSwapQuote memory quote1 = _defaultQuote();
        quote1.nonce = 1;
        bytes memory sig1 = _signQuote(quote1, solverPk);

        QuoteLib.FirmSwapQuote memory quote2 = _defaultQuote();
        quote2.nonce = 2;
        bytes memory sig2 = _signQuote(quote2, solverPk);

        address addr1 = firmSwap.computeDepositAddress(quote1, sig1);
        address addr2 = firmSwap.computeDepositAddress(quote2, sig2);
        assertTrue(addr1 != addr2);
    }

    // ═══════════════════════════════════════════════════
    //  ADDRESS DEPOSIT: SETTLE
    // ═══════════════════════════════════════════════════

    function test_settle() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        // Compute deposit address and mint tokens there
        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBrlaBefore = brla.balanceOf(solver);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // User got USDC
        assertEq(usdc.balanceOf(user) - userUsdcBefore, USDC_AMOUNT);
        // Solver got BRLA
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, BRLA_AMOUNT);

        // Order is settled
        bytes32 orderId = _computeOrderId(quote, sig);
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED));
    }

    function test_settle_revert_insufficientDeposit() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        // Don't mint any tokens to the deposit address
        vm.prank(solver);
        vm.expectRevert(IFirmSwap.InsufficientDeposit.selector);
        firmSwap.settle(quote, sig);
    }

    function test_settle_revert_expired() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.warp(quote.depositDeadline + 1);

        vm.prank(solver);
        vm.expectRevert(IFirmSwap.QuoteExpired.selector);
        firmSwap.settle(quote, sig);
    }

    // ═══════════════════════════════════════════════════
    //  ADDRESS DEPOSIT: REFUND
    // ═══════════════════════════════════════════════════

    function test_refundAddressDeposit() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        // Warp past fill deadline
        vm.warp(quote.fillDeadline + 1);

        uint256 userBrlaBefore = brla.balanceOf(user);
        uint256 userUsdcBefore = usdc.balanceOf(user);

        vm.prank(anyone);
        firmSwap.refundAddressDeposit(quote, sig);

        // User gets BRLA back
        assertEq(brla.balanceOf(user) - userBrlaBefore, BRLA_AMOUNT);

        // User gets bond compensation
        uint256 expectedBondSlash = (USDC_AMOUNT * 500) / 10_000;
        assertEq(usdc.balanceOf(user) - userUsdcBefore, expectedBondSlash);

        // Order is refunded
        bytes32 orderId = _computeOrderId(quote, sig);
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.REFUNDED));
    }

    function test_refundAddressDeposit_revert_notExpired() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.OrderNotExpired.selector);
        firmSwap.refundAddressDeposit(quote, sig);
    }

    function test_refundAddressDeposit_revert_noDeposit() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        vm.warp(quote.fillDeadline + 1);

        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.InsufficientDeposit.selector);
        firmSwap.refundAddressDeposit(quote, sig);
    }

    // ═══════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════

    function test_availableBond() public view {
        assertEq(firmSwap.availableBond(solver), SOLVER_BOND);
    }

    function test_availableBond_afterDeposit() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        _depositOrder(quote);

        uint256 reserved = (USDC_AMOUNT * 500) / 10_000;
        assertEq(firmSwap.availableBond(solver), SOLVER_BOND - reserved);
    }

    function test_availableBond_releasedAfterFill() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        (bytes32 orderId, ) = _depositOrder(quote);

        vm.prank(solver);
        firmSwap.fill(orderId);

        assertEq(firmSwap.availableBond(solver), SOLVER_BOND);
    }

    // ═══════════════════════════════════════════════════
    //  BOND INSUFFICIENCY
    // ═══════════════════════════════════════════════════

    function test_deposit_revert_insufficientBond() public {
        // Create many orders to exhaust bond
        // Bond = 10,000. Each order reserves 5% of 200 = 10 USDC
        // So 1000 orders would reserve 10,000 USDC
        // Let's deposit enough to exhaust it
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.outputAmount = 200_000e6; // 200,000 USDC → 5% = 10,000 reservation = full bond
        quote.nonce = 100;
        bytes memory sig = _signQuote(quote, solverPk);

        brla.mint(user, 10_000_000e18);

        vm.prank(user);
        firmSwap.deposit(quote, sig);

        // Now try another small order — should fail
        QuoteLib.FirmSwapQuote memory quote2 = _defaultQuote();
        quote2.nonce = 101;
        bytes memory sig2 = _signQuote(quote2, solverPk);

        vm.prank(user);
        vm.expectRevert(IFirmSwap.InsufficientBond.selector);
        firmSwap.deposit(quote2, sig2);
    }

    // ═══════════════════════════════════════════════════
    //  RECOVERY: recoverFromProxy
    // ═══════════════════════════════════════════════════

    function test_recoverFromProxy_inputToken_afterSettle() public {
        // Setup: settle an address deposit order
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);
        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Edge case: someone sends more BRLA to the (now-deployed) proxy
        brla.mint(depositAddr, 50e18);
        assertEq(brla.balanceOf(depositAddr), 50e18);

        // Recover those tokens — anyone can call
        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(anyone);
        firmSwap.recoverFromProxy(quote, sig, address(brla));

        // User received the stuck tokens
        assertEq(brla.balanceOf(user) - userBrlaBefore, 50e18);
        // Proxy is now empty
        assertEq(brla.balanceOf(depositAddr), 0);
    }

    function test_recoverFromProxy_wrongToken() public {
        // Setup: settle an address deposit order
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);
        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Edge case: someone sends wrong token (a random ERC20) to the deposit address
        MockERC20 randomToken = new MockERC20("Random", "RND", 18);
        randomToken.mint(depositAddr, 100e18);

        // Recover the wrong token — goes to quote.user
        vm.prank(anyone);
        firmSwap.recoverFromProxy(quote, sig, address(randomToken));

        assertEq(randomToken.balanceOf(user), 100e18);
        assertEq(randomToken.balanceOf(depositAddr), 0);
    }

    function test_recoverFromProxy_afterRefund() public {
        // Setup: refund a direct mint order
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);
        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.warp(quote.fillDeadline + 1);
        vm.prank(anyone);
        firmSwap.refundAddressDeposit(quote, sig);

        // Send tokens after refund
        brla.mint(depositAddr, 25e18);

        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(anyone);
        firmSwap.recoverFromProxy(quote, sig, address(brla));

        assertEq(brla.balanceOf(user) - userBrlaBefore, 25e18);
    }

    function test_recoverFromProxy_revert_orderNotFound() public {
        // Quote that was never used (no order exists)
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 999;
        bytes memory sig = _signQuote(quote, solverPk);

        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.OrderNotFound.selector);
        firmSwap.recoverFromProxy(quote, sig, address(brla));
    }

    function test_recoverFromProxy_noTokens_doesNotRevert() public {
        // Setup: settle (proxy deployed, but nothing stuck)
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);
        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Proxy has 0 balance — sweep should succeed silently (no-op)
        assertEq(brla.balanceOf(depositAddr), 0);

        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(anyone);
        firmSwap.recoverFromProxy(quote, sig, address(brla));

        // No tokens moved
        assertEq(brla.balanceOf(user), userBrlaBefore);
    }

    // ═══════════════════════════════════════════════════
    //  PARTIAL DEPOSIT: GRIEFING PROTECTION
    // ═══════════════════════════════════════════════════

    function test_refundAddressDeposit_partialDeposit_noSlash() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        // Deposit less than quoted amount
        brla.mint(depositAddr, BRLA_AMOUNT / 2);

        vm.warp(quote.fillDeadline + 1);

        (uint256 solverBondBefore,,,,) = firmSwap.solvers(solver);
        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 userBrlaBefore = brla.balanceOf(user);

        vm.prank(anyone);
        firmSwap.refundAddressDeposit(quote, sig);

        // User gets their partial deposit back
        assertEq(brla.balanceOf(user) - userBrlaBefore, BRLA_AMOUNT / 2);

        // Solver bond NOT slashed (partial deposit)
        (uint256 solverBondAfter,,,,) = firmSwap.solvers(solver);
        assertEq(solverBondAfter, solverBondBefore, "Solver bond should not be slashed for partial deposit");

        // No bond compensation to user
        assertEq(usdc.balanceOf(user), userUsdcBefore, "User should not receive bond compensation");
    }

    function test_refundAddressDeposit_1wei_griefing_noSlash() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        // Attacker deposits 1 wei — griefing attempt
        brla.mint(depositAddr, 1);

        vm.warp(quote.fillDeadline + 1);

        (uint256 solverBondBefore,,,,) = firmSwap.solvers(solver);

        vm.prank(anyone);
        firmSwap.refundAddressDeposit(quote, sig);

        // Solver bond NOT slashed
        (uint256 solverBondAfter,,,,) = firmSwap.solvers(solver);
        assertEq(solverBondAfter, solverBondBefore, "1 wei griefing should not slash solver bond");
    }

    function test_refundAddressDeposit_fullDeposit_stillSlashes() public {
        // Verify that full deposits still result in slashing (existing behavior preserved)
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 10;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.warp(quote.fillDeadline + 1);

        (uint256 solverBondBefore,,,,) = firmSwap.solvers(solver);

        vm.prank(anyone);
        firmSwap.refundAddressDeposit(quote, sig);

        uint256 expectedSlash = (USDC_AMOUNT * 500) / 10_000;
        (uint256 solverBondAfter,,,,) = firmSwap.solvers(solver);
        assertEq(solverBondBefore - solverBondAfter, expectedSlash, "Full deposit should still slash solver");
    }

    function test_refundAddressDeposit_excessDeposit_stillSlashes() public {
        // Extra tokens deposited (more than quoted) — still slashes
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 11;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT + 100e18);

        vm.warp(quote.fillDeadline + 1);

        (uint256 solverBondBefore,,,,) = firmSwap.solvers(solver);

        vm.prank(anyone);
        firmSwap.refundAddressDeposit(quote, sig);

        uint256 expectedSlash = (USDC_AMOUNT * 500) / 10_000;
        (uint256 solverBondAfter,,,,) = firmSwap.solvers(solver);
        assertEq(solverBondBefore - solverBondAfter, expectedSlash, "Excess deposit should still slash solver");
    }

    // ═══════════════════════════════════════════════════
    //  EXCESS DEPOSIT PROTECTION
    // ═══════════════════════════════════════════════════

    function test_settle_excessDeposit_goesToExcessBalance() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 20;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        // Deposit 200 extra BRLA
        brla.mint(depositAddr, BRLA_AMOUNT + 200e18);

        uint256 solverBrlaBefore = brla.balanceOf(solver);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Solver gets ONLY inputAmount
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, BRLA_AMOUNT, "Solver should only receive inputAmount");
        // Excess stored for user
        assertEq(firmSwap.excessBalances(user, address(brla)), 200e18, "Excess should be stored for user");
    }

    function test_settle_exactDeposit_noExcess() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 21;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT); // exact amount

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // No excess stored
        assertEq(firmSwap.excessBalances(user, address(brla)), 0, "No excess should be stored for exact deposit");
    }

    function test_withdrawExcess() public {
        // First create excess via settle
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 22;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT + 500e18);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // Now user withdraws excess
        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(user);
        firmSwap.withdrawExcess(address(brla));

        assertEq(brla.balanceOf(user) - userBrlaBefore, 500e18, "User should receive excess tokens");
        assertEq(firmSwap.excessBalances(user, address(brla)), 0, "Excess balance should be zero after withdrawal");
    }

    function test_withdrawExcess_revert_noBalance() public {
        vm.prank(user);
        vm.expectRevert(IFirmSwap.NoExcessBalance.selector);
        firmSwap.withdrawExcess(address(brla));
    }

    // ═══════════════════════════════════════════════════
    //  SETTLE WITH TOLERANCE
    // ═══════════════════════════════════════════════════

    function test_settleWithTolerance_acceptsLess() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 30;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        // Deposit slightly less than quoted (rounding scenario)
        uint256 slightlyLess = BRLA_AMOUNT - 0.01e18; // 0.01 BRLA short
        brla.mint(depositAddr, slightlyLess);

        uint256 userUsdcBefore = usdc.balanceOf(user);
        uint256 solverBrlaBefore = brla.balanceOf(solver);

        // Solver accepts less
        vm.prank(solver);
        firmSwap.settleWithTolerance(quote, sig, slightlyLess);

        // User still gets full outputAmount (firm price guarantee)
        assertEq(usdc.balanceOf(user) - userUsdcBefore, USDC_AMOUNT, "User should get full output");
        // Solver gets the accepted amount
        assertEq(brla.balanceOf(solver) - solverBrlaBefore, slightlyLess, "Solver should get acceptedInputAmount");
    }

    function test_settleWithTolerance_revert_moreThanQuoted() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 31;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(solver);
        vm.expectRevert(IFirmSwap.InvalidQuote.selector);
        firmSwap.settleWithTolerance(quote, sig, BRLA_AMOUNT + 1);
    }

    function test_settleWithTolerance_revert_zero() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 32;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(solver);
        vm.expectRevert(IFirmSwap.InvalidQuote.selector);
        firmSwap.settleWithTolerance(quote, sig, 0);
    }

    function test_settleWithTolerance_exactAmount_works() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 33;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        uint256 userUsdcBefore = usdc.balanceOf(user);

        // Using exact inputAmount as tolerance (same as settle())
        vm.prank(solver);
        firmSwap.settleWithTolerance(quote, sig, BRLA_AMOUNT);

        assertEq(usdc.balanceOf(user) - userUsdcBefore, USDC_AMOUNT);

        bytes32 orderId = _computeOrderId(quote, sig);
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.SETTLED));
    }

    // ═══════════════════════════════════════════════════
    //  DEPLOY AND RECOVER
    // ═══════════════════════════════════════════════════

    function test_deployAndRecover_wrongToken() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 40;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);

        // Someone sends wrong token to deposit address
        MockERC20 wrongToken = new MockERC20("Wrong", "WRG", 18);
        wrongToken.mint(depositAddr, 100e18);

        // Warp past fillDeadline
        vm.warp(quote.fillDeadline + 1);

        uint256 userWrongBefore = wrongToken.balanceOf(user);

        vm.prank(anyone);
        firmSwap.deployAndRecover(quote, sig, address(wrongToken));

        // User received the wrong tokens
        assertEq(wrongToken.balanceOf(user) - userWrongBefore, 100e18, "User should receive recovered tokens");
        assertEq(wrongToken.balanceOf(depositAddr), 0, "Deposit address should be empty");
    }

    function test_deployAndRecover_consumesNonce() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 41;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        MockERC20 wrongToken = new MockERC20("Wrong", "WRG", 18);
        wrongToken.mint(depositAddr, 100e18);

        vm.warp(quote.fillDeadline + 1);

        vm.prank(anyone);
        firmSwap.deployAndRecover(quote, sig, address(wrongToken));

        // Nonce consumed — cannot settle anymore
        assertTrue(firmSwap.isNonceUsed(solver, 41), "Nonce should be consumed");

        // Order stored as REFUNDED
        bytes32 orderId = _computeOrderId(quote, sig);
        (,,,,,,,,IFirmSwap.OrderState state) = firmSwap.orders(orderId);
        assertEq(uint8(state), uint8(IFirmSwap.OrderState.REFUNDED));
    }

    function test_deployAndRecover_revert_beforeDeadline() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 42;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        MockERC20 wrongToken = new MockERC20("Wrong", "WRG", 18);
        wrongToken.mint(depositAddr, 100e18);

        // Don't warp — still within deadline
        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.OrderNotExpired.selector);
        firmSwap.deployAndRecover(quote, sig, address(wrongToken));
    }

    function test_deployAndRecover_revert_orderExists() public {
        // First, settle an order normally
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 43;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        brla.mint(depositAddr, BRLA_AMOUNT);

        vm.prank(solver);
        firmSwap.settle(quote, sig);

        // deployAndRecover with inputToken reverts with InvalidQuote (bond slash bypass prevention)
        vm.warp(quote.fillDeadline + 1);
        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.InvalidQuote.selector);
        firmSwap.deployAndRecover(quote, sig, address(brla));

        // With a different token — reverts with NonceAlreadyUsed (nonce was consumed by settle)
        MockERC20 wrongToken = new MockERC20("Wrong", "WRG", 18);
        vm.prank(anyone);
        vm.expectRevert(IFirmSwap.NonceAlreadyUsed.selector);
        firmSwap.deployAndRecover(quote, sig, address(wrongToken));
    }

    function test_deployAndRecover_enablesRecoverFromProxy() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 44;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);

        // Send wrong token AND some input token
        MockERC20 wrongToken = new MockERC20("Wrong", "WRG", 18);
        wrongToken.mint(depositAddr, 50e18);
        brla.mint(depositAddr, 10e18); // some input token too

        vm.warp(quote.fillDeadline + 1);

        // deployAndRecover for wrong token
        vm.prank(anyone);
        firmSwap.deployAndRecover(quote, sig, address(wrongToken));

        // Now recoverFromProxy should work for the remaining brla
        uint256 userBrlaBefore = brla.balanceOf(user);
        vm.prank(anyone);
        firmSwap.recoverFromProxy(quote, sig, address(brla));

        assertEq(brla.balanceOf(user) - userBrlaBefore, 10e18, "recoverFromProxy should work after deployAndRecover");
    }

    function test_deployAndRecover_noBondSlash() public {
        QuoteLib.FirmSwapQuote memory quote = _defaultQuote();
        quote.nonce = 45;
        bytes memory sig = _signQuote(quote, solverPk);

        address depositAddr = firmSwap.computeDepositAddress(quote, sig);
        MockERC20 wrongToken = new MockERC20("Wrong", "WRG", 18);
        wrongToken.mint(depositAddr, 100e18);

        (uint256 solverBondBefore,,,,) = firmSwap.solvers(solver);

        vm.warp(quote.fillDeadline + 1);

        vm.prank(anyone);
        firmSwap.deployAndRecover(quote, sig, address(wrongToken));

        // Solver bond unchanged — no penalty for wrong token
        (uint256 solverBondAfter,,,,) = firmSwap.solvers(solver);
        assertEq(solverBondAfter, solverBondBefore, "Solver bond should not be slashed");
    }
}
