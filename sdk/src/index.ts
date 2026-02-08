// ═══════════════════════════════════════════════════
//  @firmswap/sdk — TypeScript SDK for FirmSwap Protocol
// ═══════════════════════════════════════════════════

// Core client
export { FirmSwapClient, FirmSwapError, deserializeQuote, serializeQuote } from "./client.js";

// Contract wrappers
export { FirmSwapContract, createFirmSwapPublicClient } from "./contracts.js";

// Permit2 helpers
export {
  depositWithPermit2,
  ensurePermit2Approval,
  PERMIT2_ADDRESS,
  type Permit2DepositParams,
} from "./permit2.js";

// Types
export {
  OrderType,
  OrderState,
  DepositMode,
  type FirmSwapQuote,
  type SerializedQuote,
  type QuoteRequest,
  type QuoteResponse,
  type AlternativeQuote,
  type OrderStatus,
  type FirmSwapConfig,
} from "./types.js";

// ABIs
export { firmSwapAbi, erc20Abi } from "./abi/index.js";
