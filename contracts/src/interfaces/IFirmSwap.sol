// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QuoteLib} from "../libraries/QuoteLib.sol";
import {ISignatureTransfer} from "permit2/interfaces/ISignatureTransfer.sol";

/// @title IFirmSwap
/// @notice Interface for the FirmSwap protocol — a firm-quote swap system with bonded solvers.
/// @dev Supports two deposit modes:
///   - Address Deposit: User transfers tokens to a deterministic CREATE2 address, then anyone calls settle().
///   - Contract Deposit: User calls deposit() or depositWithPermit2(), then solver calls fill().
interface IFirmSwap {
    // ═══════════════════════════════════════════════════
    //  ENUMS
    // ═══════════════════════════════════════════════════

    /// @notice Lifecycle states for an order.
    enum OrderState {
        /// @dev Order does not exist (default zero value).
        NONE,
        /// @dev User has deposited input tokens; awaiting solver fill.
        DEPOSITED,
        /// @dev Solver has delivered output tokens; order is complete.
        SETTLED,
        /// @dev Order was refunded to the user after solver default.
        REFUNDED
    }

    // ═══════════════════════════════════════════════════
    //  STRUCTS
    // ═══════════════════════════════════════════════════

    /// @notice On-chain representation of a swap order.
    struct Order {
        /// @dev Address of the user who deposited input tokens.
        address user;
        /// @dev Address of the solver committed to filling the order.
        address solver;
        /// @dev ERC-20 token deposited by the user.
        address inputToken;
        /// @dev Amount of input tokens deposited.
        uint256 inputAmount;
        /// @dev ERC-20 token the solver must deliver.
        address outputToken;
        /// @dev Amount of output tokens the solver must deliver.
        uint256 outputAmount;
        /// @dev Chain ID where output tokens are delivered (same chain for v1).
        uint256 outputChainId;
        /// @dev Unix timestamp after which the order can be refunded if not filled.
        uint32 fillDeadline;
        /// @dev Current state of the order.
        OrderState state;
    }

    /// @notice On-chain state for a registered solver.
    struct SolverInfo {
        /// @dev Total USDC bond deposited by the solver.
        uint256 totalBond;
        /// @dev Bond currently reserved for active orders (5% per order).
        uint256 reservedBond;
        /// @dev Amount of bond pending withdrawal via unstake.
        uint256 unstakeAmount;
        /// @dev Unix timestamp when unstake becomes executable (7-day delay).
        uint40 unstakeTimestamp;
        /// @dev Whether the solver is registered and active.
        bool registered;
    }

    // ═══════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════

    /// @notice Emitted when a user deposits input tokens for a swap order.
    /// @param orderId Unique identifier for the order (keccak256 of quote params).
    /// @param user Address of the depositing user.
    /// @param solver Address of the solver committed to filling.
    /// @param inputToken ERC-20 token deposited.
    /// @param inputAmount Amount of input tokens deposited.
    /// @param outputToken ERC-20 token the solver must deliver.
    /// @param outputAmount Amount of output tokens the solver must deliver.
    /// @param fillDeadline Unix timestamp after which the order can be refunded.
    event Deposited(
        bytes32 indexed orderId,
        address indexed user,
        address indexed solver,
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 outputAmount,
        uint32 fillDeadline
    );

    /// @notice Emitted when a solver fills an order (Contract Deposit) or an order is settled (Address Deposit).
    /// @param orderId Unique identifier for the order.
    /// @param user Address of the user who receives output tokens.
    /// @param solver Address of the solver who filled the order.
    event Settled(
        bytes32 indexed orderId,
        address indexed user,
        address indexed solver
    );

    /// @notice Emitted when an order is refunded due to solver default.
    /// @param orderId Unique identifier for the refunded order.
    /// @param user Address of the user receiving the refund.
    /// @param inputAmount Amount of input tokens refunded to the user.
    /// @param bondSlashed Amount of solver bond slashed as penalty.
    event Refunded(
        bytes32 indexed orderId,
        address indexed user,
        uint256 inputAmount,
        uint256 bondSlashed
    );

    /// @notice Emitted when tokens are recovered from a deployed DepositProxy.
    /// @param orderId The order ID associated with the deposit address.
    /// @param token The ERC-20 token that was recovered.
    /// @param recipient The address that received the recovered tokens.
    event TokensRecovered(
        bytes32 indexed orderId,
        address indexed token,
        address indexed recipient
    );

    /// @notice Emitted when a new solver registers with an initial bond.
    /// @param solver Address of the newly registered solver.
    /// @param bondAmount Initial USDC bond deposited.
    event SolverRegistered(address indexed solver, uint256 bondAmount);

    /// @notice Emitted when a solver adds additional bond.
    /// @param solver Address of the solver.
    /// @param amount Amount of bond added.
    event BondAdded(address indexed solver, uint256 amount);

    /// @notice Emitted when a solver requests to unstake bond (starts 7-day delay).
    /// @param solver Address of the solver.
    /// @param amount Amount requested for unstake.
    /// @param unlockTime Unix timestamp when the unstake can be executed.
    event UnstakeRequested(address indexed solver, uint256 amount, uint40 unlockTime);

    /// @notice Emitted when a solver executes a pending unstake after the delay period.
    /// @param solver Address of the solver.
    /// @param amount Amount of bond withdrawn.
    event UnstakeExecuted(address indexed solver, uint256 amount);

    /// @notice Emitted when a solver cancels a pending unstake request.
    /// @param solver Address of the solver.
    event UnstakeCancelled(address indexed solver);

    /// @notice Emitted when a solver cancels a nonce to invalidate an outstanding quote.
    /// @param solver Address of the solver.
    /// @param nonce The cancelled nonce value.
    event NonceCancelled(address indexed solver, uint256 nonce);

    /// @notice Emitted when excess tokens from an address deposit are stored for the user.
    /// @param orderId The order ID associated with the deposit.
    /// @param user The user who can withdraw the excess.
    /// @param token The ERC-20 token with excess.
    /// @param amount The excess amount stored.
    event ExcessDeposit(
        bytes32 indexed orderId,
        address indexed user,
        address token,
        uint256 amount
    );

    /// @notice Emitted when a user withdraws excess deposit tokens.
    /// @param user The user who withdrew.
    /// @param token The ERC-20 token withdrawn.
    /// @param amount The amount withdrawn.
    event ExcessWithdrawn(address indexed user, address indexed token, uint256 amount);

    // ═══════════════════════════════════════════════════
    //  ERRORS
    // ═══════════════════════════════════════════════════

    /// @notice The solver's EIP-712 signature on the quote is invalid.
    error InvalidSignature();

    /// @notice The quote's deposit deadline has passed.
    error QuoteExpired();

    /// @notice The solver's nonce has already been used or cancelled.
    error NonceAlreadyUsed();

    /// @notice An order with this ID already exists (duplicate deposit).
    error OrderAlreadyExists();

    /// @notice No order exists with the given ID.
    error OrderNotFound();

    /// @notice The order is not in DEPOSITED state (required for fill/refund).
    error OrderNotDeposited();

    /// @notice The fill deadline has not passed yet (required for refund).
    error OrderNotExpired();

    /// @notice The deposited amount is less than the quote's input amount.
    error InsufficientDeposit();

    /// @notice The solver does not have enough unreserved bond for this order.
    error InsufficientBond();

    /// @notice The solver address is not registered.
    error SolverNotRegistered();

    /// @notice The solver is already registered (cannot register twice).
    error SolverAlreadyRegistered();

    /// @notice Caller is not the solver assigned to this order.
    error NotSolver();

    /// @notice The 7-day unstake delay has not elapsed yet.
    error UnstakeNotReady();

    /// @notice No pending unstake request exists for this solver.
    error NoPendingUnstake();

    /// @notice The remaining bond would fall below the minimum required amount.
    error BelowMinimumBond();

    /// @notice The order amount is below the protocol minimum.
    error BelowMinimumOrder();

    /// @notice The quote parameters are malformed or invalid.
    error InvalidQuote();

    /// @notice The quote's output chain ID does not match this chain.
    error WrongChain();

    /// @notice The fill deadline is before or equal to the deposit deadline.
    error FillDeadlineBeforeDeposit();

    /// @notice A pending unstake request already exists. Cancel it first.
    error PendingUnstakeExists();

    /// @notice No excess balance available to withdraw.
    error NoExcessBalance();

    // ═══════════════════════════════════════════════════
    //  CONTRACT DEPOSIT
    // ═══════════════════════════════════════════════════

    /// @notice Deposit input tokens to create a swap order (Contract Deposit).
    /// @dev User must have approved the contract for `quote.inputAmount` of `quote.inputToken`.
    ///      The solver's signature is verified against the EIP-712 quote hash.
    /// @param quote The solver-signed quote containing swap parameters.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    function deposit(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external;

    /// @notice Deposit input tokens using Permit2 for gasless approval (Contract Deposit).
    /// @dev Combines token approval and deposit in a single transaction via Uniswap Permit2.
    /// @param quote The solver-signed quote containing swap parameters.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    /// @param permit The Permit2 transfer parameters (token, amount, nonce, deadline).
    /// @param permitSignature The user's signature authorizing the Permit2 transfer.
    function depositWithPermit2(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        ISignatureTransfer.PermitTransferFrom calldata permit,
        bytes calldata permitSignature
    ) external;

    /// @notice Fill a deposited order by delivering output tokens to the user (Contract Deposit).
    /// @dev Only callable by the assigned solver. Transfers output tokens from solver to user
    ///      and releases the solver's reserved bond.
    /// @param orderId The unique identifier of the order to fill.
    function fill(bytes32 orderId) external;

    // ═══════════════════════════════════════════════════
    //  ADDRESS DEPOSIT
    // ═══════════════════════════════════════════════════

    /// @notice Compute the deterministic CREATE2 deposit address for an address deposit order.
    /// @dev The user transfers input tokens to this address. When settle() is called,
    ///      a DepositProxy is deployed at this address to sweep funds into the contract.
    /// @param quote The solver-signed quote containing swap parameters.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    /// @return The deterministic deposit address.
    function computeDepositAddress(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external view returns (address);

    /// @notice Settle an address deposit order.
    /// @dev Deploys a DepositProxy via CREATE2 to sweep input tokens, creates the order,
    ///      and immediately fills it. Callable by anyone once tokens are at the deposit address.
    ///      Only `quote.inputAmount` is sent to the solver; any excess is stored for user withdrawal.
    /// @param quote The solver-signed quote containing swap parameters.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    function settle(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external;

    /// @notice Settle an address deposit order with solver-specified tolerance for rounding.
    /// @dev The solver accepts `acceptedInputAmount` instead of `quote.inputAmount`,
    ///      accommodating minor rounding differences. The user still receives the full
    ///      quoted `outputAmount` — the firm price guarantee is preserved.
    /// @param quote The solver-signed quote containing swap parameters.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    /// @param acceptedInputAmount The minimum input the solver is willing to accept (must be <= quote.inputAmount).
    function settleWithTolerance(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        uint256 acceptedInputAmount
    ) external;

    // ═══════════════════════════════════════════════════
    //  REFUND
    // ═══════════════════════════════════════════════════

    /// @notice Refund a Contract Deposit order that was not filled before the deadline.
    /// @dev Callable by anyone after fillDeadline. Returns input tokens to the user
    ///      and slashes 5% of the solver's bond as penalty.
    /// @param orderId The unique identifier of the order to refund.
    function refund(bytes32 orderId) external;

    /// @notice Refund an Address Deposit order where tokens were deposited but not settled.
    /// @dev Deploys the DepositProxy to sweep tokens, then refunds them to the user.
    ///      Callable by anyone after the fill deadline.
    /// @param quote The original quote used to compute the deposit address.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    function refundAddressDeposit(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) external;

    // ═══════════════════════════════════════════════════
    //  RECOVERY
    // ═══════════════════════════════════════════════════

    /// @notice Recover tokens from an already-deployed DepositProxy.
    /// @dev Handles edge cases: tokens sent after settlement, wrong token sent to deposit address.
    ///      Funds are always returned to quote.user. Callable by anyone.
    ///      The order must be in SETTLED or REFUNDED state (proxy must be deployed).
    /// @param quote The original quote used to compute the deposit address.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    /// @param token The ERC-20 token to recover (can differ from quote.inputToken).
    function recoverFromProxy(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        address token
    ) external;

    /// @notice Deploy the DepositProxy and recover tokens when no settle/refund occurred.
    /// @dev Use when only the wrong token was sent to a deposit address and the inputToken
    ///      was never deposited. Deploys the proxy, consumes the nonce, stores the order as
    ///      REFUNDED, and sweeps the specified token to the user. No bond is slashed.
    ///      After calling this, `recoverFromProxy()` can be used for additional stuck tokens.
    /// @param quote The original quote used to compute the deposit address.
    /// @param solverSignature The solver's EIP-712 signature over the quote.
    /// @param token The ERC-20 token to recover (typically not quote.inputToken).
    function deployAndRecover(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature,
        address token
    ) external;

    /// @notice Withdraw excess deposit tokens stored from address deposit settlements.
    /// @dev When a user deposits more than `quote.inputAmount` at a deposit address,
    ///      the excess is stored in the contract. This function allows the user to reclaim it.
    /// @param token The ERC-20 token to withdraw excess balance for.
    function withdrawExcess(address token) external;

    // ═══════════════════════════════════════════════════
    //  SOLVER MANAGEMENT
    // ═══════════════════════════════════════════════════

    /// @notice Register as a solver by depositing an initial USDC bond.
    /// @dev Caller must have approved the contract for `bondAmount` of the bond token (USDC).
    /// @param bondAmount Amount of USDC to deposit as initial bond.
    function registerSolver(uint256 bondAmount) external;

    /// @notice Add additional bond to an existing solver registration.
    /// @dev Caller must be a registered solver with prior approval for the bond token.
    /// @param amount Amount of USDC to add to the solver's bond.
    function addBond(uint256 amount) external;

    /// @notice Request to unstake bond (starts the 7-day delay period).
    /// @dev The amount must leave enough unreserved bond for active orders.
    ///      Reverts with PendingUnstakeExists if a pending request already exists.
    /// @param amount Amount of bond to request for unstake.
    function requestUnstake(uint256 amount) external;

    /// @notice Cancel a pending unstake request.
    /// @dev Caller must have a pending unstake request. Reverts with NoPendingUnstake if none exists.
    function cancelUnstake() external;

    /// @notice Execute a pending unstake after the 7-day delay has elapsed.
    /// @dev Transfers the unstake amount back to the solver.
    function executeUnstake() external;

    /// @notice Cancel a single nonce to invalidate an outstanding quote.
    /// @dev Once cancelled, any quote using this nonce will be rejected by the contract.
    /// @param nonce The nonce to cancel.
    function cancelNonce(uint256 nonce) external;

    /// @notice Cancel multiple nonces in a single transaction using a bitmap.
    /// @dev Each set bit in `mask` cancels nonce `wordPos * 256 + bitIndex`.
    /// @param wordPos The word position in the nonce bitmap.
    /// @param mask Bitmask of nonces to cancel within the word.
    function cancelNonces(uint248 wordPos, uint256 mask) external;
}
