// ═══════════════════════════════════════════════════
//  Solver types
// ═══════════════════════════════════════════════════

/** Incoming quote request from the FirmSwap API aggregator. */
export interface SolverQuoteRequest {
  /** ERC-20 address of the token the user is selling. */
  inputToken: string;
  /** ERC-20 address of the token the user is buying. */
  outputToken: string;
  /** Whether the fixed side is input or output. */
  orderType: "EXACT_INPUT" | "EXACT_OUTPUT";
  /** Amount of the fixed-side token (decimal string in smallest unit). */
  amount: string;
  /** Address of the user requesting the swap. */
  userAddress: string;
  /** Chain ID of the swap. */
  chainId: number;
  /** Unix timestamp — deposit deadline set by the API. */
  depositDeadline: number;
  /** Unix timestamp — fill deadline set by the API. */
  fillDeadline: number;
}

/** JSON-serializable quote (string amounts for HTTP transport). */
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

/** Response returned by the solver's /quote endpoint. */
export interface SolverQuoteResponse {
  /** Signed quote with computed amounts. */
  quote: SerializedQuote;
  /** Solver's EIP-712 signature over the quote. */
  signature: string;
}

/** Price data from a CEX adapter. */
export interface PriceData {
  /** Trading pair symbol (e.g., "BRLA/USDC"). */
  pair: string;
  /** Best buy price on the order book. */
  bid: number; // best buy price
  /** Best sell price on the order book. */
  ask: number; // best sell price
  /** Mid-point between bid and ask. */
  midPrice: number;
  /** Unix timestamp when the price was fetched. */
  timestamp: number;
}

/** Parsed on-chain Deposited event data. */
export interface OrderEvent {
  /** Unique order identifier (bytes32 hex). */
  orderId: `0x${string}`;
  /** User who deposited input tokens. */
  user: `0x${string}`;
  /** Solver assigned to fill the order. */
  solver: `0x${string}`;
  /** Input token address. */
  inputToken: `0x${string}`;
  /** Amount of input tokens deposited. */
  inputAmount: bigint;
  /** Output token address. */
  outputToken: `0x${string}`;
  /** Amount of output tokens to deliver. */
  outputAmount: bigint;
  /** Unix timestamp after which the order can be refunded. */
  fillDeadline: number;
  /** Block number where the Deposited event was emitted. */
  blockNumber: bigint;
  /** Transaction hash of the deposit. */
  transactionHash: `0x${string}`;
}

/** Internal solver state for tracking an active order. */
export interface TrackedOrder {
  /** Unique order identifier (bytes32 hex). */
  orderId: string;
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
  /** Current state of the tracked order. */
  state: "DEPOSITED" | "SETTLED" | "REFUNDED" | "ADDRESS_PENDING";
  /** How the order was deposited. */
  depositMode: "CONTRACT" | "ADDRESS";
  /** Unix timestamp when the order was first tracked. */
  createdAt: number;
  /** Unix timestamp when the order was filled (undefined if not yet filled). */
  filledAt?: number;
}
