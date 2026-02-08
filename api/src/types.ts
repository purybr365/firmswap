// ═══════════════════════════════════════════════════
//  Shared types matching the Solidity contracts
// ═══════════════════════════════════════════════════

/** Whether the fixed side of the swap is input or output. */
export enum OrderType {
  /** The input amount is fixed; output amount is calculated by the solver. */
  EXACT_INPUT = 0,
  /** The output amount is fixed; input amount is calculated by the solver. */
  EXACT_OUTPUT = 1,
}

/** How the user deposits tokens into the protocol. */
export enum DepositMode {
  /** Contract Deposit: User calls deposit() or depositWithPermit2() on the contract. */
  CONTRACT = "CONTRACT",
  /** Address Deposit: User transfers tokens to a deterministic CREATE2 address. */
  ADDRESS = "ADDRESS",
}

/** On-chain quote struct with bigint amounts for contract interaction. */
export interface FirmSwapQuote {
  /** Address of the solver committed to filling this order. */
  solver: `0x${string}`;
  /** Address of the user requesting the swap. */
  user: `0x${string}`;
  /** ERC-20 token the user deposits. */
  inputToken: `0x${string}`;
  /** Amount of input tokens (in token's smallest unit). */
  inputAmount: bigint;
  /** ERC-20 token the solver delivers. */
  outputToken: `0x${string}`;
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

// ═══════════════════════════════════════════════════
//  API Request/Response types
// ═══════════════════════════════════════════════════

/** Request body for POST /v1/quote. */
export interface QuoteRequest {
  /** ERC-20 address of the token the user is selling. */
  inputToken: string;
  /** ERC-20 address of the token the user is buying. */
  outputToken: string;
  /** Whether the fixed side is input or output. */
  orderType: "EXACT_INPUT" | "EXACT_OUTPUT";
  /** Amount of the fixed-side token (in smallest unit, as a decimal string). */
  amount: string; // the fixed side
  /** Address of the user requesting the swap. */
  userAddress: string;
  /** Chain ID of the input token. */
  originChainId: number;
  /** Chain ID where the output token should be delivered. */
  destinationChainId: number;
  /** Seconds until deposit deadline (default: 300). */
  depositWindow?: number; // seconds, default 300
  /** How the user will deposit tokens. */
  depositMode: "CONTRACT" | "ADDRESS";
}

/** Response from POST /v1/quote — the best quote from all solvers. */
export interface QuoteResponse {
  /** The winning (best-price) quote. */
  quote: SerializedQuote;
  /** Solver's EIP-712 signature over the quote. */
  solverSignature: string;
  /** Deterministic deposit address (only present for ADDRESS mode). */
  depositAddress?: string; // only for ADDRESS mode
  /** Other valid quotes from competing solvers (sorted by price). */
  alternativeQuotes: AlternativeQuote[];
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

/** A non-winning quote from a competing solver. */
export interface AlternativeQuote {
  /** The alternative solver's quote. */
  quote: SerializedQuote;
  /** The alternative solver's EIP-712 signature. */
  solverSignature: string;
  /** Deterministic deposit address (only for ADDRESS mode). */
  depositAddress?: string;
}

/** Response from GET /v1/order/:orderId — on-chain order state. */
export interface OrderStatusResponse {
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
//  Solver types
// ═══════════════════════════════════════════════════

/** A solver registered with the API aggregator. */
export interface RegisteredSolver {
  /** Solver's Ethereum address. */
  address: `0x${string}`;
  /** URL of the solver's /quote endpoint. */
  endpointUrl: string;
  /** Human-readable solver name. */
  name: string;
  /** Unix timestamp when the solver was registered. */
  registeredAt: number;
  /** Whether the solver is currently active. */
  active: boolean;
}

/** The request the API sends to a solver's /quote endpoint. */
export interface SolverQuoteRequest {
  /** Input token address. */
  inputToken: string;
  /** Output token address. */
  outputToken: string;
  /** Whether the fixed side is input or output. */
  orderType: "EXACT_INPUT" | "EXACT_OUTPUT";
  /** Amount of the fixed-side token (decimal string). */
  amount: string;
  /** User address. */
  userAddress: string;
  /** Chain ID. */
  chainId: number;
  /** Unix timestamp — deposit deadline set by the API. */
  depositDeadline: number;
  /** Unix timestamp — fill deadline set by the API. */
  fillDeadline: number;
}

/** The response a solver returns from its /quote endpoint. */
export interface SolverQuoteResponse {
  /** Signed quote with computed amounts. */
  quote: SerializedQuote;
  /** Solver's EIP-712 signature over the quote. */
  signature: string;
}
