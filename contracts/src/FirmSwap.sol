// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ISignatureTransfer} from "permit2/interfaces/ISignatureTransfer.sol";

import {QuoteLib} from "./libraries/QuoteLib.sol";
import {OrderLib} from "./libraries/OrderLib.sol";
import {DepositProxy} from "./DepositProxy.sol";
import {IFirmSwap} from "./interfaces/IFirmSwap.sol";
import {
    IOriginSettler,
    ResolvedCrossChainOrder,
    Output,
    FillInstruction
} from "./interfaces/IERC7683.sol";

/// @title FirmSwap
/// @notice Trustless fixed-rate swap protocol with guaranteed pricing.
/// @dev Supports two deposit modes:
///      Address Deposit: Zero user transactions via CREATE2 deposit addresses
///      Contract Deposit: One user transaction to deposit tokens
contract FirmSwap is IFirmSwap, IOriginSettler, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════

    /// @notice The Permit2 contract
    ISignatureTransfer public immutable PERMIT2;

    /// @notice The bond token (e.g., USDC)
    IERC20 public immutable BOND_TOKEN;

    /// @notice Minimum bond to register as solver
    uint256 public constant MIN_BOND = 1_000e6; // 1,000 USDC (6 decimals)

    /// @notice Minimum order size in output token units
    uint256 public constant MIN_ORDER = 1e6; // 1 USDC minimum

    /// @notice Bond reservation percentage (basis points)
    uint256 public constant BOND_RESERVATION_BPS = 500; // 5%

    /// @notice Unstake timelock
    uint40 public constant UNSTAKE_DELAY = 7 days;

    /// @notice Precomputed creation code hash for DepositProxy
    bytes32 public immutable DEPOSIT_PROXY_CREATION_CODE_HASH;

    // ═══════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════

    /// @notice Order storage: orderId → Order
    mapping(bytes32 => Order) public orders;

    /// @notice Solver info: solver address → SolverInfo
    mapping(address => SolverInfo) public solvers;

    /// @notice Nonce bitmap for replay protection: solver → wordPos → bitmap
    mapping(address => mapping(uint248 => uint256)) public nonceBitmap;

    /// @notice Excess deposit balances: user → token → amount
    /// @dev Stores excess tokens from address deposits where the user sent more than quote.inputAmount
    mapping(address => mapping(address => uint256)) public excessBalances;

    // ═══════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════

    constructor(
        address _permit2,
        address _bondToken
    ) EIP712("FirmSwap", "1") {
        PERMIT2 = ISignatureTransfer(_permit2);
        BOND_TOKEN = IERC20(_bondToken);
        DEPOSIT_PROXY_CREATION_CODE_HASH = keccak256(
            abi.encodePacked(type(DepositProxy).creationCode, abi.encode(address(this)))
        );
    }

    // ═══════════════════════════════════════════════════
    //  CONTRACT DEPOSIT
    // ═══════════════════════════════════════════════════

    /// @inheritdoc IFirmSwap
    function deposit(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external nonReentrant {
        _depositInternal(msg.sender, quote, solverSignature);
    }

    /// @inheritdoc IFirmSwap
    function depositWithPermit2(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        ISignatureTransfer.PermitTransferFrom calldata permit,
        bytes calldata permitSignature
    ) external nonReentrant {
        bytes32 orderId = _validateAndCreateOrder(quote, solverSignature);

        // Pull input tokens via Permit2
        PERMIT2.permitTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({
                to: address(this),
                requestedAmount: quote.inputAmount
            }),
            msg.sender,
            permitSignature
        );

        _emitDeposited(orderId, quote);
        _emitERC7683Open(orderId, quote);
    }

    /// @inheritdoc IFirmSwap
    function fill(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.state != OrderState.DEPOSITED) revert OrderNotDeposited();
        if (order.solver != msg.sender) revert NotSolver();
        if (block.timestamp > order.fillDeadline) revert QuoteExpired();

        // Mark settled before external calls (CEI)
        order.state = OrderState.SETTLED;

        // Release bond reservation
        _releaseBond(order.solver, order.outputAmount);

        // Pull output tokens from solver → send to user
        IERC20(order.outputToken).safeTransferFrom(msg.sender, order.user, order.outputAmount);

        // Send input tokens to solver
        IERC20(order.inputToken).safeTransfer(order.solver, order.inputAmount);

        emit Settled(orderId, order.user, order.solver);
    }

    // ═══════════════════════════════════════════════════
    //  ADDRESS DEPOSIT (CREATE2)
    // ═══════════════════════════════════════════════════

    /// @inheritdoc IFirmSwap
    function computeDepositAddress(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external view returns (address) {
        bytes32 orderId = OrderLib.computeOrderId(quote, solverSignature);
        return OrderLib.computeDepositAddress(
            address(this),
            orderId,
            DEPOSIT_PROXY_CREATION_CODE_HASH
        );
    }

    /// @inheritdoc IFirmSwap
    function settle(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external nonReentrant {
        // 1. Validate quote + signature
        _validateQuote(quote, solverSignature);

        // 2. Compute order ID and deposit address
        bytes32 orderId = OrderLib.computeOrderId(quote, solverSignature);
        if (orders[orderId].state != OrderState.NONE) revert OrderAlreadyExists();

        address depositAddr = OrderLib.computeDepositAddress(
            address(this),
            orderId,
            DEPOSIT_PROXY_CREATION_CODE_HASH
        );

        // 3. Check tokens at deposit address
        uint256 depositBalance = IERC20(quote.inputToken).balanceOf(depositAddr);
        if (depositBalance < quote.inputAmount) revert InsufficientDeposit();

        // 4. Consume nonce
        _useNonce(quote.solver, quote.nonce);

        // 5. Verify solver has sufficient bond (no state change for atomic settle)
        _checkBond(quote.solver, quote.outputAmount);

        // 6. Store order as SETTLED (CEI — set state before external calls)
        orders[orderId] = Order({
            user: quote.user,
            solver: quote.solver,
            inputToken: quote.inputToken,
            inputAmount: quote.inputAmount,
            outputToken: quote.outputToken,
            outputAmount: quote.outputAmount,
            outputChainId: quote.outputChainId,
            fillDeadline: quote.fillDeadline,
            state: OrderState.SETTLED
        });

        // 7. Deploy DepositProxy and sweep input tokens to FirmSwap
        uint256 balBefore = IERC20(quote.inputToken).balanceOf(address(this));
        DepositProxy proxy = new DepositProxy{salt: orderId}(address(this));
        proxy.sweep(quote.inputToken, address(this));
        uint256 actualReceived = IERC20(quote.inputToken).balanceOf(address(this)) - balBefore;

        // 8. Pull output tokens from solver → user
        IERC20(quote.outputToken).safeTransferFrom(msg.sender, quote.user, quote.outputAmount);

        // 9. Send only inputAmount to solver; store excess for user recovery
        uint256 toSolver = actualReceived > quote.inputAmount ? quote.inputAmount : actualReceived;
        uint256 excess = actualReceived - toSolver;
        if (excess > 0) {
            excessBalances[quote.user][quote.inputToken] += excess;
            emit ExcessDeposit(orderId, quote.user, quote.inputToken, excess);
        }
        IERC20(quote.inputToken).safeTransfer(quote.solver, toSolver);

        emit Settled(orderId, quote.user, quote.solver);
        _emitERC7683Open(orderId, quote);
    }

    /// @inheritdoc IFirmSwap
    function settleWithTolerance(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        uint256 acceptedInputAmount
    ) external nonReentrant {
        // Validate tolerance bounds
        if (acceptedInputAmount > quote.inputAmount) revert InvalidQuote();
        if (acceptedInputAmount == 0) revert InvalidQuote();

        // 1. Validate quote + signature
        _validateQuote(quote, solverSignature);

        // 2. Compute order ID and deposit address
        bytes32 orderId = OrderLib.computeOrderId(quote, solverSignature);
        if (orders[orderId].state != OrderState.NONE) revert OrderAlreadyExists();

        address depositAddr = OrderLib.computeDepositAddress(
            address(this),
            orderId,
            DEPOSIT_PROXY_CREATION_CODE_HASH
        );

        // 3. Check tokens at deposit address (use acceptedInputAmount, not quote.inputAmount)
        uint256 depositBalance = IERC20(quote.inputToken).balanceOf(depositAddr);
        if (depositBalance < acceptedInputAmount) revert InsufficientDeposit();

        // 4. Consume nonce
        _useNonce(quote.solver, quote.nonce);

        // 5. Verify solver has sufficient bond
        _checkBond(quote.solver, quote.outputAmount);

        // 6. Store order as SETTLED
        orders[orderId] = Order({
            user: quote.user,
            solver: quote.solver,
            inputToken: quote.inputToken,
            inputAmount: quote.inputAmount,
            outputToken: quote.outputToken,
            outputAmount: quote.outputAmount,
            outputChainId: quote.outputChainId,
            fillDeadline: quote.fillDeadline,
            state: OrderState.SETTLED
        });

        // 7. Deploy DepositProxy and sweep input tokens to FirmSwap
        uint256 balBefore = IERC20(quote.inputToken).balanceOf(address(this));
        DepositProxy proxy = new DepositProxy{salt: orderId}(address(this));
        proxy.sweep(quote.inputToken, address(this));
        uint256 actualReceived = IERC20(quote.inputToken).balanceOf(address(this)) - balBefore;

        // 8. Pull output tokens from solver → user (full quoted amount, firm price guarantee)
        IERC20(quote.outputToken).safeTransferFrom(msg.sender, quote.user, quote.outputAmount);

        // 9. Send only acceptedInputAmount to solver; excess stored for user
        uint256 toSolver = actualReceived > acceptedInputAmount ? acceptedInputAmount : actualReceived;
        uint256 excess = actualReceived - toSolver;
        if (excess > 0) {
            excessBalances[quote.user][quote.inputToken] += excess;
            emit ExcessDeposit(orderId, quote.user, quote.inputToken, excess);
        }
        IERC20(quote.inputToken).safeTransfer(quote.solver, toSolver);

        emit Settled(orderId, quote.user, quote.solver);
        _emitERC7683Open(orderId, quote);
    }

    // ═══════════════════════════════════════════════════
    //  REFUND
    // ═══════════════════════════════════════════════════

    /// @inheritdoc IFirmSwap
    function refund(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.state != OrderState.DEPOSITED) revert OrderNotDeposited();
        if (block.timestamp <= order.fillDeadline) revert OrderNotExpired();

        // Slash bond
        uint256 bondSlash = _slashBond(order.solver, order.outputAmount);

        // Mark refunded (CEI)
        order.state = OrderState.REFUNDED;

        // Return input tokens to user
        IERC20(order.inputToken).safeTransfer(order.user, order.inputAmount);

        // Send slashed bond to user as compensation
        if (bondSlash > 0) {
            BOND_TOKEN.safeTransfer(order.user, bondSlash);
        }

        emit Refunded(orderId, order.user, order.inputAmount, bondSlash);
    }

    /// @inheritdoc IFirmSwap
    function refundAddressDeposit(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external nonReentrant {
        // Validate the quote is legitimate (skip deposit deadline — we're past it)
        _validateQuoteForRefund(quote, solverSignature);

        bytes32 orderId = OrderLib.computeOrderId(quote, solverSignature);

        // Must not have already been settled/refunded
        if (orders[orderId].state != OrderState.NONE) revert OrderAlreadyExists();

        // Must be past fill deadline
        if (block.timestamp <= quote.fillDeadline) revert OrderNotExpired();

        address depositAddr = OrderLib.computeDepositAddress(
            address(this),
            orderId,
            DEPOSIT_PROXY_CREATION_CODE_HASH
        );

        // Check there are tokens to refund
        uint256 depositBalance = IERC20(quote.inputToken).balanceOf(depositAddr);
        if (depositBalance == 0) revert InsufficientDeposit();

        // Consume nonce to prevent replay
        _useNonce(quote.solver, quote.nonce);

        // Only slash bond if user deposited the full quoted amount.
        // Partial deposits do not penalize the solver (prevents griefing).
        bool fullDeposit = depositBalance >= quote.inputAmount;
        uint256 bondSlash = fullDeposit ? _slashBond(quote.solver, quote.outputAmount) : 0;

        // Store as refunded
        orders[orderId] = Order({
            user: quote.user,
            solver: quote.solver,
            inputToken: quote.inputToken,
            inputAmount: quote.inputAmount,
            outputToken: quote.outputToken,
            outputAmount: quote.outputAmount,
            outputChainId: quote.outputChainId,
            fillDeadline: quote.fillDeadline,
            state: OrderState.REFUNDED
        });

        // Deploy proxy and sweep tokens to contract
        uint256 balBefore = IERC20(quote.inputToken).balanceOf(address(this));
        DepositProxy proxy = new DepositProxy{salt: orderId}(address(this));
        proxy.sweep(quote.inputToken, address(this));
        uint256 actualReceived = IERC20(quote.inputToken).balanceOf(address(this)) - balBefore;

        // Send swept tokens to user (actual amount received, safe for fee-on-transfer)
        IERC20(quote.inputToken).safeTransfer(quote.user, actualReceived);

        // Send slashed bond to user
        if (bondSlash > 0) {
            BOND_TOKEN.safeTransfer(quote.user, bondSlash);
        }

        emit Refunded(orderId, quote.user, actualReceived, bondSlash);
    }

    // ═══════════════════════════════════════════════════
    //  RECOVERY
    // ═══════════════════════════════════════════════════

    /// @inheritdoc IFirmSwap
    function recoverFromProxy(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        address token
    ) external nonReentrant {
        bytes32 orderId = OrderLib.computeOrderId(quote, solverSignature);

        // Only SETTLED or REFUNDED — proxy must be deployed
        OrderState state = orders[orderId].state;
        if (state != OrderState.SETTLED && state != OrderState.REFUNDED) revert OrderNotFound();

        address depositAddr = OrderLib.computeDepositAddress(
            address(this),
            orderId,
            DEPOSIT_PROXY_CREATION_CODE_HASH
        );

        // Sweep any token from the deployed proxy to the user
        DepositProxy(depositAddr).sweep(token, quote.user);

        emit TokensRecovered(orderId, token, quote.user);
    }

    /// @inheritdoc IFirmSwap
    function deployAndRecover(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        address token
    ) external nonReentrant {
        // Prevent using this function for the quoted input token — use refundAddressDeposit instead.
        // Without this check a solver can bypass bond slashing on defaulted orders.
        if (token == quote.inputToken) revert InvalidQuote();

        // Validate quote signature (skip deposit deadline — we're past it)
        _validateQuoteForRefund(quote, solverSignature);

        bytes32 orderId = OrderLib.computeOrderId(quote, solverSignature);

        // Order must NOT already exist (if it does, use recoverFromProxy instead)
        if (orders[orderId].state != OrderState.NONE) revert OrderAlreadyExists();

        // Must be past fill deadline (give the normal flow time to complete first)
        if (block.timestamp <= quote.fillDeadline) revert OrderNotExpired();

        // Consume nonce (this quote is now used — prevents settle/refund later)
        _useNonce(quote.solver, quote.nonce);

        // Store order as REFUNDED (enables recoverFromProxy for future stuck tokens)
        orders[orderId] = Order({
            user: quote.user,
            solver: quote.solver,
            inputToken: quote.inputToken,
            inputAmount: quote.inputAmount,
            outputToken: quote.outputToken,
            outputAmount: quote.outputAmount,
            outputChainId: quote.outputChainId,
            fillDeadline: quote.fillDeadline,
            state: OrderState.REFUNDED
        });

        // Deploy proxy and sweep the requested token to the user
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        DepositProxy proxy = new DepositProxy{salt: orderId}(address(this));
        proxy.sweep(token, address(this));
        uint256 actualReceived = IERC20(token).balanceOf(address(this)) - balBefore;

        if (actualReceived > 0) {
            IERC20(token).safeTransfer(quote.user, actualReceived);
        }

        // NO bond slash — solver did nothing wrong (user sent wrong token)
        emit TokensRecovered(orderId, token, quote.user);
    }

    /// @inheritdoc IFirmSwap
    function withdrawExcess(address token) external nonReentrant {
        uint256 amount = excessBalances[msg.sender][token];
        if (amount == 0) revert NoExcessBalance();
        excessBalances[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit ExcessWithdrawn(msg.sender, token, amount);
    }

    // ═══════════════════════════════════════════════════
    //  SOLVER MANAGEMENT
    // ═══════════════════════════════════════════════════

    /// @inheritdoc IFirmSwap
    function registerSolver(uint256 bondAmount) external {
        if (solvers[msg.sender].registered) revert SolverAlreadyRegistered();
        if (bondAmount < MIN_BOND) revert BelowMinimumBond();

        solvers[msg.sender] = SolverInfo({
            totalBond: bondAmount,
            reservedBond: 0,
            unstakeAmount: 0,
            unstakeTimestamp: 0,
            registered: true
        });

        BOND_TOKEN.safeTransferFrom(msg.sender, address(this), bondAmount);

        emit SolverRegistered(msg.sender, bondAmount);
    }

    /// @inheritdoc IFirmSwap
    function addBond(uint256 amount) external {
        SolverInfo storage solver = solvers[msg.sender];
        if (!solver.registered) revert SolverNotRegistered();

        solver.totalBond += amount;

        BOND_TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        emit BondAdded(msg.sender, amount);
    }

    /// @inheritdoc IFirmSwap
    function requestUnstake(uint256 amount) external {
        SolverInfo storage solver = solvers[msg.sender];
        if (!solver.registered) revert SolverNotRegistered();
        if (solver.unstakeAmount > 0) revert PendingUnstakeExists();
        if (solver.totalBond - solver.reservedBond < amount) revert InsufficientBond();
        if (solver.totalBond - amount < MIN_BOND) revert BelowMinimumBond();

        solver.unstakeAmount = amount;
        solver.unstakeTimestamp = uint40(block.timestamp) + UNSTAKE_DELAY;

        emit UnstakeRequested(msg.sender, amount, solver.unstakeTimestamp);
    }

    /// @notice Cancel a pending unstake request.
    function cancelUnstake() external {
        SolverInfo storage solver = solvers[msg.sender];
        if (solver.unstakeAmount == 0) revert NoPendingUnstake();
        solver.unstakeAmount = 0;
        solver.unstakeTimestamp = 0;
        emit UnstakeCancelled(msg.sender);
    }

    /// @inheritdoc IFirmSwap
    function executeUnstake() external {
        SolverInfo storage solver = solvers[msg.sender];
        if (solver.unstakeAmount == 0) revert NoPendingUnstake();
        if (block.timestamp < solver.unstakeTimestamp) revert UnstakeNotReady();

        uint256 amount = solver.unstakeAmount;
        solver.totalBond -= amount;
        solver.unstakeAmount = 0;
        solver.unstakeTimestamp = 0;

        BOND_TOKEN.safeTransfer(msg.sender, amount);

        emit UnstakeExecuted(msg.sender, amount);
    }

    /// @inheritdoc IFirmSwap
    function cancelNonce(uint256 nonce) external {
        _useNonce(msg.sender, nonce);
        emit NonceCancelled(msg.sender, nonce);
    }

    /// @inheritdoc IFirmSwap
    function cancelNonces(uint248 wordPos, uint256 mask) external {
        nonceBitmap[msg.sender][wordPos] |= mask;
    }

    // ═══════════════════════════════════════════════════
    //  ERC-7683 COMPATIBILITY
    // ═══════════════════════════════════════════════════

    /// @inheritdoc IOriginSettler
    function openFor(
        bytes calldata order,
        bytes calldata signature,
        bytes calldata /* originFillerData */
    ) external nonReentrant {
        // Decode from bytes and delegate to internal deposit logic.
        // The caller should use deposit() directly for gas efficiency;
        // openFor() exists only for ERC-7683 standard compatibility.
        (QuoteLib.FirmSwapQuote memory quote) = abi.decode(order, (QuoteLib.FirmSwapQuote));
        _depositInternalMemory(msg.sender, quote, signature);
    }

    /// @inheritdoc IOriginSettler
    function resolveFor(
        bytes calldata order,
        bytes calldata /* originFillerData */
    ) external view returns (ResolvedCrossChainOrder memory resolved) {
        QuoteLib.FirmSwapQuote memory quote = abi.decode(order, (QuoteLib.FirmSwapQuote));
        bytes32 orderId = QuoteLib.hashMemory(quote);

        resolved.user = quote.user;
        resolved.originChainId = block.chainid;
        resolved.openDeadline = quote.depositDeadline;
        resolved.fillDeadline = quote.fillDeadline;
        resolved.orderId = orderId;

        resolved.maxSpent = new Output[](1);
        resolved.maxSpent[0] = Output({
            token: bytes32(uint256(uint160(quote.inputToken))),
            amount: quote.inputAmount,
            recipient: bytes32(uint256(uint160(quote.solver))),
            chainId: block.chainid
        });

        resolved.minReceived = new Output[](1);
        resolved.minReceived[0] = Output({
            token: bytes32(uint256(uint160(quote.outputToken))),
            amount: quote.outputAmount,
            recipient: bytes32(uint256(uint160(quote.user))),
            chainId: quote.outputChainId
        });

        resolved.fillInstructions = new FillInstruction[](1);
        resolved.fillInstructions[0] = FillInstruction({
            destinationChainId: uint64(quote.outputChainId),
            destinationSettler: bytes32(uint256(uint160(address(this)))),
            originData: order
        });
    }

    // ═══════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════

    /// @notice Get the available (unreserved) bond for a solver
    function availableBond(address solver) external view returns (uint256) {
        SolverInfo storage info = solvers[solver];
        return info.totalBond - info.reservedBond;
    }

    /// @notice Compute the EIP-712 digest for a struct hash (useful for off-chain signing)
    function hashTypedDataV4(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    /// @notice Check if a nonce has been used
    function isNonceUsed(address solver, uint256 nonce) external view returns (bool) {
        uint248 wordPos = uint248(nonce >> 8);
        uint8 bitPos = uint8(nonce);
        return (nonceBitmap[solver][wordPos] & (1 << bitPos)) != 0;
    }

    // ═══════════════════════════════════════════════════
    //  INTERNAL: QUOTE VALIDATION
    // ═══════════════════════════════════════════════════

    function _depositInternal(
        address depositor,
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) internal {
        bytes32 orderId = _validateAndCreateOrder(quote, solverSignature);

        // Pull input tokens from depositor (balance-difference for fee-on-transfer safety)
        uint256 balBefore = IERC20(quote.inputToken).balanceOf(address(this));
        IERC20(quote.inputToken).safeTransferFrom(depositor, address(this), quote.inputAmount);
        uint256 actualReceived = IERC20(quote.inputToken).balanceOf(address(this)) - balBefore;

        // Store actual received amount so refund() and fill() don't revert
        orders[orderId].inputAmount = actualReceived;

        _emitDeposited(orderId, quote);
        _emitERC7683Open(orderId, quote);
    }

    /// @dev Memory variant for openFor() which decodes from bytes (produces memory structs)
    function _depositInternalMemory(
        address depositor,
        QuoteLib.FirmSwapQuote memory quote,
        bytes calldata solverSignature
    ) internal {
        _validateQuoteMemory(quote, solverSignature);

        bytes32 orderId = keccak256(abi.encode(QuoteLib.hashMemory(quote), keccak256(solverSignature)));
        if (orders[orderId].state != OrderState.NONE) revert OrderAlreadyExists();

        _useNonce(quote.solver, quote.nonce);
        _reserveBond(quote.solver, quote.outputAmount);

        orders[orderId] = Order({
            user: quote.user,
            solver: quote.solver,
            inputToken: quote.inputToken,
            inputAmount: quote.inputAmount,
            outputToken: quote.outputToken,
            outputAmount: quote.outputAmount,
            outputChainId: quote.outputChainId,
            fillDeadline: quote.fillDeadline,
            state: OrderState.DEPOSITED
        });

        // Balance-difference for fee-on-transfer safety
        uint256 balBefore = IERC20(quote.inputToken).balanceOf(address(this));
        IERC20(quote.inputToken).safeTransferFrom(depositor, address(this), quote.inputAmount);
        uint256 actualReceived = IERC20(quote.inputToken).balanceOf(address(this)) - balBefore;
        orders[orderId].inputAmount = actualReceived;

        emit Deposited(orderId, quote.user, quote.solver, quote.inputToken, actualReceived, quote.outputToken, quote.outputAmount, quote.fillDeadline);
    }

    function _validateQuoteMemory(
        QuoteLib.FirmSwapQuote memory quote,
        bytes calldata solverSignature
    ) internal view {
        if (quote.inputAmount == 0 || quote.outputAmount == 0) revert InvalidQuote();
        if (quote.outputAmount < MIN_ORDER) revert BelowMinimumOrder();
        if (quote.fillDeadline <= quote.depositDeadline) revert FillDeadlineBeforeDeposit();
        if (quote.outputChainId != block.chainid) revert WrongChain();
        if (!solvers[quote.solver].registered) revert SolverNotRegistered();
        if (block.timestamp > quote.depositDeadline) revert QuoteExpired();

        uint248 wordPos = uint248(quote.nonce >> 8);
        uint8 bitPos = uint8(quote.nonce);
        if ((nonceBitmap[quote.solver][wordPos] & (1 << bitPos)) != 0) revert NonceAlreadyUsed();

        bytes32 structHash = QuoteLib.hashMemory(quote);
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, solverSignature);
        if (signer != quote.solver) revert InvalidSignature();
    }

    function _validateAndCreateOrder(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) internal returns (bytes32 orderId) {
        _validateQuote(quote, solverSignature);

        orderId = OrderLib.computeOrderId(quote, solverSignature);
        if (orders[orderId].state != OrderState.NONE) revert OrderAlreadyExists();

        // Consume nonce
        _useNonce(quote.solver, quote.nonce);

        // Reserve solver's bond
        _reserveBond(quote.solver, quote.outputAmount);

        // Caller must be the user (or acting on behalf via Permit2)
        // For standard deposit, msg.sender pulls tokens, so they must be the user
        // or have approval. The quote.user is who receives the output.

        // Store order
        orders[orderId] = Order({
            user: quote.user,
            solver: quote.solver,
            inputToken: quote.inputToken,
            inputAmount: quote.inputAmount,
            outputToken: quote.outputToken,
            outputAmount: quote.outputAmount,
            outputChainId: quote.outputChainId,
            fillDeadline: quote.fillDeadline,
            state: OrderState.DEPOSITED
        });
    }

    function _validateQuote(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) internal view {
        _validateQuoteCore(quote, solverSignature);
        if (block.timestamp > quote.depositDeadline) revert QuoteExpired();
    }

    /// @dev Validates quote without checking deposit deadline.
    ///      Used by refundAddressDeposit (address deposit refund) which runs after the deadline.
    function _validateQuoteForRefund(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) internal view {
        _validateQuoteCore(quote, solverSignature);
    }

    function _validateQuoteCore(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) private view {
        // Check basic validity
        if (quote.user == address(0)) revert InvalidQuote();
        if (quote.inputAmount == 0 || quote.outputAmount == 0) revert InvalidQuote();
        if (quote.outputAmount < MIN_ORDER) revert BelowMinimumOrder();
        if (quote.fillDeadline <= quote.depositDeadline) revert FillDeadlineBeforeDeposit();

        // Same-chain check (cross-chain is Phase 2)
        if (quote.outputChainId != block.chainid) revert WrongChain();

        // Verify solver is registered
        if (!solvers[quote.solver].registered) revert SolverNotRegistered();

        // Verify nonce not used
        uint248 wordPos = uint248(quote.nonce >> 8);
        uint8 bitPos = uint8(quote.nonce);
        if ((nonceBitmap[quote.solver][wordPos] & (1 << bitPos)) != 0) {
            revert NonceAlreadyUsed();
        }

        // Verify solver signature (EIP-712)
        bytes32 structHash = QuoteLib.hash(quote);
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, solverSignature);
        if (signer != quote.solver) revert InvalidSignature();
    }

    // ═══════════════════════════════════════════════════
    //  INTERNAL: NONCE MANAGEMENT
    // ═══════════════════════════════════════════════════

    function _useNonce(address solver, uint256 nonce) internal {
        uint248 wordPos = uint248(nonce >> 8);
        uint8 bitPos = uint8(nonce);
        uint256 bit = 1 << bitPos;
        uint256 word = nonceBitmap[solver][wordPos];
        if (word & bit != 0) revert NonceAlreadyUsed();
        nonceBitmap[solver][wordPos] = word | bit;
    }

    // ═══════════════════════════════════════════════════
    //  INTERNAL: BOND MANAGEMENT
    // ═══════════════════════════════════════════════════

    /// @dev View-style bond check for atomic settle (no state change needed)
    function _checkBond(address solver, uint256 outputAmount) internal view {
        uint256 reservation = (outputAmount * BOND_RESERVATION_BPS) / 10_000;
        SolverInfo storage info = solvers[solver];
        if (info.totalBond - info.reservedBond < reservation) revert InsufficientBond();
    }

    function _reserveBond(address solver, uint256 outputAmount) internal {
        uint256 reservation = (outputAmount * BOND_RESERVATION_BPS) / 10_000;
        SolverInfo storage info = solvers[solver];
        if (info.totalBond - info.reservedBond < reservation) revert InsufficientBond();
        info.reservedBond += reservation;
    }

    function _releaseBond(address solver, uint256 outputAmount) internal {
        uint256 reservation = (outputAmount * BOND_RESERVATION_BPS) / 10_000;
        solvers[solver].reservedBond -= reservation;
    }

    function _slashBond(address solver, uint256 outputAmount) internal returns (uint256 slashed) {
        uint256 reservation = (outputAmount * BOND_RESERVATION_BPS) / 10_000;
        SolverInfo storage info = solvers[solver];
        // Slash the reserved amount (or whatever is available)
        slashed = reservation > info.totalBond ? info.totalBond : reservation;
        info.totalBond -= slashed;
        // Release the reservation
        if (info.reservedBond >= reservation) {
            info.reservedBond -= reservation;
        } else {
            info.reservedBond = 0;
        }
    }

    // ═══════════════════════════════════════════════════
    //  INTERNAL: EVENT HELPERS
    // ═══════════════════════════════════════════════════

    function _emitDeposited(bytes32 orderId, QuoteLib.FirmSwapQuote calldata quote) internal {
        emit Deposited(
            orderId,
            quote.user,
            quote.solver,
            quote.inputToken,
            quote.inputAmount,
            quote.outputToken,
            quote.outputAmount,
            quote.fillDeadline
        );
    }

    function _emitERC7683Open(bytes32 orderId, QuoteLib.FirmSwapQuote calldata quote) internal {
        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(quote.inputToken))),
            amount: quote.inputAmount,
            recipient: bytes32(uint256(uint160(quote.solver))),
            chainId: block.chainid
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(uint256(uint160(quote.outputToken))),
            amount: quote.outputAmount,
            recipient: bytes32(uint256(uint160(quote.user))),
            chainId: quote.outputChainId
        });

        FillInstruction[] memory fills = new FillInstruction[](1);
        fills[0] = FillInstruction({
            destinationChainId: uint64(quote.outputChainId),
            destinationSettler: bytes32(uint256(uint160(address(this)))),
            originData: abi.encode(quote)
        });

        emit Open(
            orderId,
            ResolvedCrossChainOrder({
                user: quote.user,
                originChainId: block.chainid,
                openDeadline: quote.depositDeadline,
                fillDeadline: quote.fillDeadline,
                orderId: orderId,
                maxSpent: maxSpent,
                minReceived: minReceived,
                fillInstructions: fills
            })
        );
    }
}
