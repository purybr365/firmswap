# FirmSwap SDK

TypeScript SDK for interacting with the FirmSwap Protocol. Built on [viem](https://viem.sh), provides a high-level client for requesting quotes, depositing tokens, and monitoring orders.

## Installation

```bash
npm install @firmswap/sdk viem
```

## Quick Start

```typescript
import { FirmSwapClient, DepositMode } from "@firmswap/sdk";

const client = new FirmSwapClient({
  apiUrl: "http://localhost:3000",
  chainId: 100,
  rpcUrl: "https://rpc.gnosis.gateway.fm",
  firmSwapAddress: "0x...",
});

// Get a quote
const quoteResponse = await client.getQuote({
  inputToken: "0xBRLA...",
  outputToken: "0xUSDC...",
  orderType: "EXACT_INPUT",
  amount: "1000000000000000000", // 1 BRLA
  userAddress: "0xUser...",
  originChainId: 100,
  destinationChainId: 100,
  depositMode: "CONTRACT",
});
```

## Usage Examples

### Contract Deposit

Approve the token and deposit in a single flow:

```typescript
const txHash = await client.deposit(walletClient, quoteResponse);
await publicClient.waitForTransactionReceipt({ hash: txHash });
```

### Address Deposit

Transfer tokens to a deterministic address (no on-chain approval needed):

```typescript
const quoteResponse = await client.getQuote({
  ...params,
  depositMode: "ADDRESS",
});

// Get the deterministic deposit address
const depositAddr = await client.getDepositAddress(quoteResponse);

// Transfer tokens directly (using any method -- wallet, exchange withdrawal, etc.)
```

### Permit2 Deposit

Gasless approval via Permit2:

```typescript
import { depositWithPermit2, ensurePermit2Approval } from "@firmswap/sdk";

// One-time: approve Permit2 for the token
await ensurePermit2Approval(walletClient, publicClient, tokenAddress);

// Deposit using Permit2 (no separate approve tx needed)
const txHash = await depositWithPermit2({
  walletClient,
  publicClient,
  firmSwapAddress: "0x...",
  quote: deserializeQuote(quoteResponse.quote),
  solverSignature: quoteResponse.solverSignature,
});
```

### Smart Account / ERC-4337

For smart accounts that support batching, use `buildDepositCalls()` to combine approve + deposit into a single atomic UserOperation:

```typescript
// Build encoded calls (approve + deposit) without executing
const calls = await client.buildDepositCalls(quoteResponse, userAddress);

// Pass to your smart account bundler / executeBatch
await smartAccount.executeBatch(calls);
```

The `depositWithPermit2()` function also works with smart accounts that implement EIP-1271 signature validation -- no EOA restriction.

### Check Order Status

```typescript
const status = await client.getOrderStatus("0xOrderId...");
// or via API (no RPC needed):
const status = await client.getOrderStatusViaApi("0xOrderId...");
```

### Safety Checks

The SDK includes built-in safety checks to protect users from fund loss:

- **`deposit()`** verifies that `quote.user` matches the connected wallet address before submitting any transaction. This prevents a malicious or mismatched quote from causing tokens to be deposited on behalf of a different user.
- **`getDepositAddress()`** verifies the API-provided deposit address against the on-chain `computeDepositAddress()` result when an RPC connection is available. This prevents a compromised API from redirecting funds to an attacker-controlled address.
- **HTTPS warning**: The SDK logs a warning if instantiated with an HTTP (non-HTTPS) API URL in a production environment.

## Deadlines

Every quote includes `depositDeadline` and `fillDeadline` (Unix timestamps). The user must deposit before the deposit deadline; the solver must fill before the fill deadline. If the solver defaults, the user calls `refund()` to get their tokens back plus bond compensation.

To customize the deposit window:

```typescript
const quoteResponse = await client.getQuote({
  // ...other params
  depositWindow: 120, // 2-minute deposit deadline (default: 300s)
});
```

Check the deadlines on a quote:

```typescript
import { deserializeQuote } from "@firmswap/sdk";
const quote = deserializeQuote(quoteResponse.quote);
// quote.depositDeadline — Unix timestamp
// quote.fillDeadline    — Unix timestamp
```

## Exported API

| Export | Type | Description |
|--------|------|-------------|
| `FirmSwapClient` | Class | High-level SDK client |
| `FirmSwapContract` | Class | Low-level contract reader |
| `FirmSwapError` | Class | Typed error with status code |
| `createFirmSwapPublicClient` | Function | Create viem PublicClient |
| `deserializeQuote` | Function | JSON quote to on-chain format |
| `serializeQuote` | Function | On-chain quote to JSON format |
| `depositWithPermit2` | Function | Deposit with Permit2 |
| `ensurePermit2Approval` | Function | Approve Permit2 for a token |
| `PERMIT2_ADDRESS` | Constant | Canonical Permit2 address |
| `firmSwapAbi` | Constant | FirmSwap contract ABI |
| `erc20Abi` | Constant | ERC-20 ABI |
| `OrderType` | Enum | EXACT_INPUT, EXACT_OUTPUT |
| `OrderState` | Enum | NONE, DEPOSITED, SETTLED, REFUNDED |
| `DepositMode` | Enum | CONTRACT, ADDRESS |

## Types

- `FirmSwapConfig` -- SDK configuration (apiUrl, chainId (required), rpcUrl, firmSwapAddress, timeoutMs)
- `FirmSwapQuote` -- On-chain quote struct (bigint amounts)
- `SerializedQuote` -- JSON-serializable quote (string amounts)
- `QuoteRequest` -- API quote request
- `QuoteResponse` -- API quote response
- `AlternativeQuote` -- Non-winning solver quote
- `OrderStatus` -- On-chain order state

## Testing

```bash
npm test              # 14 tests
```

## License

MIT
