import type { Address, Hex } from "viem";

// ═══════════════════════════════════════════════════
//  Enums matching Solidity contracts
// ═══════════════════════════════════════════════════

/** Whether the fixed side of the swap is input or output. */
export enum OrderType {
  /** The input amount is fixed; output amount is calculated by the solver. */
  EXACT_INPUT = 0,
  /** The output amount is fixed; input amount is calculated by the solver. */
  EXACT_OUTPUT = 1,
}

/** On-chain order lifecycle states. */
export enum OrderState {
  /** Order does not exist (default zero value). */
  NONE = 0,
  /** User has deposited input tokens; awaiting solver fill. */
  DEPOSITED = 1,
  /** Solver has delivered output tokens; order is complete. */
  SETTLED = 2,
  /** Order was refunded to the user after solver default. */
  REFUNDED = 3,
}

/** How the user deposits tokens into the protocol. */
export enum DepositMode {
  /** Contract Deposit: User calls deposit() or depositWithPermit2() on the contract. */
  CONTRACT = "CONTRACT",
  /** Address Deposit: User transfers tokens to a deterministic CREATE2 address. */
  ADDRESS = "ADDRESS",
}

// ═══════════════════════════════════════════════════
//  Quote types
// ═══════════════════════════════════════════════════

/** On-chain quote struct (bigint amounts for contract interaction). */
export interface FirmSwapQuote {
  /** Address of the solver committed to filling this order. */
  solver: Address;
  /** Address of the user requesting the swap. */
  user: Address;
  /** ERC-20 token the user deposits. */
  inputToken: Address;
  /** Amount of input tokens (in token's smallest unit). */
  inputAmount: bigint;
  /** ERC-20 token the solver delivers. */
  outputToken: Address;
  /** Amount of output tokens the solver must deliver. */
  outputAmount: bigint;
  /** Whether this is an EXACT_INPUT or EXACT_OUTPUT order. */
  orderType: OrderType;
  /** Chain ID where output tokens are delivered. */
  outputChainId: bigint;
  /** Unix timestamp after which the quote expires and deposit is rejected. */
  depositDeadline: number;
  /** Unix timestamp after which the order can be refunded if not filled. */
  fillDeadline: number;
  /** Unique nonce to prevent quote replay. */
  nonce: bigint;
}

/** JSON-serializable quote (string amounts for API transport). */
export interface SerializedQuote {
  /** Solver address. */
  solver: string;
  /** User address. */
  user: string;
  /** Input token address. */
  inputToken: string;
  /** Input amount as a decimal string. */
  inputAmount: string;
  /** Output token address. */
  outputToken: string;
  /** Output amount as a decimal string. */
  outputAmount: string;
  /** Order type: 0 = EXACT_INPUT, 1 = EXACT_OUTPUT. */
  orderType: number;
  /** Destination chain ID. */
  outputChainId: number;
  /** Unix timestamp — deposit deadline. */
  depositDeadline: number;
  /** Unix timestamp — fill deadline. */
  fillDeadline: number;
  /** Unique nonce as a decimal string. */
  nonce: string;
}

// ═══════════════════════════════════════════════════
//  API types
// ═══════════════════════════════════════════════════

/** Request body for the quote API endpoint. */
export interface QuoteRequest {
  /** ERC-20 address of the token the user is selling. */
  inputToken: string;
  /** ERC-20 address of the token the user is buying. */
  outputToken: string;
  /** Whether the fixed side is input or output. */
  orderType: "EXACT_INPUT" | "EXACT_OUTPUT";
  /** Amount of the fixed-side token (in smallest unit, as a decimal string). */
  amount: string;
  /** Address of the user requesting the swap. */
  userAddress: string;
  /** Chain ID of the input token. */
  originChainId: number;
  /** Chain ID where the output token should be delivered. */
  destinationChainId: number;
  /** Seconds until deposit deadline (default: 300). */
  depositWindow?: number;
  /** How the user will deposit tokens. */
  depositMode: DepositMode;
}

/** Response from the quote API — the best quote from all solvers. */
export interface QuoteResponse {
  /** The winning (best-price) quote. */
  quote: SerializedQuote;
  /** Solver's EIP-712 signature over the quote. */
  solverSignature: string;
  /** Deterministic deposit address (only present for ADDRESS mode). */
  depositAddress?: string;
  /** Other valid quotes from competing solvers (sorted by price). */
  alternativeQuotes: AlternativeQuote[];
}

/** A non-winning quote from a competing solver. */
export interface AlternativeQuote {
  /** The alternative solver's quote. */
  quote: SerializedQuote;
  /** The alternative solver's EIP-712 signature. */
  solverSignature: string;
  /** Deterministic deposit address (only for ADDRESS mode). */
  depositAddress?: string;
}

/** On-chain order status read from the FirmSwap contract. */
export interface OrderStatus {
  /** Unique order identifier (bytes32 hex). */
  orderId: string;
  /** Current lifecycle state of the order. */
  state: "NONE" | "DEPOSITED" | "SETTLED" | "REFUNDED";
  /** User who deposited input tokens. */
  user: string;
  /** Solver assigned to fill the order. */
  solver: string;
  /** Input token address. */
  inputToken: string;
  /** Input amount as a decimal string. */
  inputAmount: string;
  /** Output token address. */
  outputToken: string;
  /** Output amount as a decimal string. */
  outputAmount: string;
  /** Unix timestamp after which the order can be refunded. */
  fillDeadline: number;
}

// ═══════════════════════════════════════════════════
//  SDK configuration
// ═══════════════════════════════════════════════════

/** Configuration options for the FirmSwapClient. */
export interface FirmSwapConfig {
  /** FirmSwap API base URL (e.g., "http://localhost:3000"). */
  apiUrl: string;
  /** Chain ID — determines the API path prefix (e.g., /v1/100/quote). */
  chainId: number;
  /** RPC URL for on-chain reads (required for deposit/status operations). */
  rpcUrl?: string;
  /** FirmSwap contract address (required for on-chain operations). */
  firmSwapAddress?: Address;
  /** Request timeout in milliseconds (default: 10000). */
  timeoutMs?: number;
}
