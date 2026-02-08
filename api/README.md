# FirmSwap API

Fastify-based HTTP API that acts as a multi-chain quote aggregator. Solvers register their endpoints per chain, and when a user requests a quote, the API fans out to all registered solvers on that chain, collects responses, and returns the best quote.

## Deployment Model

The FirmSwap API is a **self-hosted aggregator** -- not a centralized service.

- **Anyone can run it.** Clone the repo, configure `SUPPORTED_CHAINS` with per-chain RPC URLs and contract addresses, and start the server.
- **Multi-chain from one instance.** A single API serves multiple chains. Each chain has its own solver registry, aggregator, and event poller, scoped by chain ID in the URL path.
- **Solver registration requires proof of address ownership.** Solvers call `POST /v1/:chainId/solvers/register` with an EIP-191 signature proving they control the claimed address. The on-chain requirement is a USDC bond on the FirmSwap contract.
- **SQLite-backed persistence.** Solver registrations survive restarts. Use `DB_PATH=:memory:` to disable persistence.
- **Multiple instances can coexist.** Each operator runs their own aggregator with their own solver set. Users (or the SDK) choose which API to connect to.
- **The smart contract is the source of truth.** The API never holds funds -- it only relays quotes and reads on-chain state.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check — returns `{ status, supportedChains, activeSolvers }` |
| GET | `/metrics` | Prometheus metrics (request durations, active solvers, quote counts) |
| POST | `/v1/:chainId/quote` | Request a swap quote (rate limit: 30/min) |
| GET | `/v1/:chainId/order/:orderId` | Get on-chain order status (rate limit: 60/min) |
| POST | `/v1/:chainId/solvers/register` | Register a solver (rate limit: 5/min) |
| DELETE | `/v1/:chainId/solvers/:address` | Unregister a solver (rate limit: 10/min) |
| GET | `/v1/:chainId/solvers` | List active solvers (rate limit: 60/min) |
| GET | `/v1/ws` | WebSocket for real-time order events (all chains) |

Unsupported `chainId` returns `404 { error: "Chain 999 not supported" }`.

## Quote Request

`POST /v1/:chainId/quote`

```json
{
  "inputToken": "0x...",
  "outputToken": "0x...",
  "orderType": "EXACT_INPUT",
  "amount": "1000000000000000000",
  "userAddress": "0x...",
  "originChainId": 100,
  "destinationChainId": 100,
  "depositMode": "CONTRACT"
}
```

## Quote Response

```json
{
  "quote": {
    "solver": "0x...",
    "user": "0x...",
    "inputToken": "0x...",
    "inputAmount": "1000000000000000000",
    "outputToken": "0x...",
    "outputAmount": "200000000",
    "orderType": 0,
    "outputChainId": 100,
    "depositDeadline": 1700000000,
    "fillDeadline": 1700000120,
    "nonce": "123456"
  },
  "solverSignature": "0x...",
  "depositAddress": "0x...",
  "alternativeQuotes": []
}
```

## Solver Registration

`POST /v1/:chainId/solvers/register`

Registration requires an EIP-191 signature proving ownership of the solver address. The timestamp must be within 5 minutes of the server's clock.

```json
{
  "address": "0xSolverAddress...",
  "endpointUrl": "https://solver.example.com",
  "name": "My Solver",
  "signature": "0x...",
  "timestamp": 1700000000000
}
```

The `signature` is produced by signing the message:
```
FirmSwap Solver Registration
Address: 0xsolveraddress...
Endpoint: https://solver.example.com
Timestamp: 1700000000000
```

Unregistration (`DELETE /v1/:chainId/solvers/:address`) also requires a signed proof with a similar message format.

## WebSocket Events

`GET /v1/ws`

- `{ type: "connected", supportedChains: [100, 10200] }` -- connection established
- `{ type: "Deposited", chainId, orderId, user, solver, inputToken, inputAmount, outputToken, outputAmount, fillDeadline, blockNumber }` -- order deposited
- `{ type: "Settled", chainId, orderId, user, solver, blockNumber }` -- order filled/settled
- `{ type: "Refunded", chainId, orderId, user, inputAmount, bondSlashed, blockNumber }` -- order refunded

## Configuration

See `.env.example` for a template.

### Multi-Chain Configuration

| Variable | Description |
|----------|-------------|
| `SUPPORTED_CHAINS` | Comma-separated chain IDs (e.g., `100,10200,8453`) |
| `RPC_URL_<chainId>` | JSON-RPC endpoint for each chain (e.g., `RPC_URL_100=https://rpc.gnosis.gateway.fm`) |
| `FIRMSWAP_ADDRESS_<chainId>` | FirmSwap contract address per chain |

If `SUPPORTED_CHAINS` is not set, falls back to single-chain mode using `CHAIN_ID`, `RPC_URL`, `FIRMSWAP_ADDRESS`.

### General Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `HOST` | 0.0.0.0 | Server bind address |
| `DB_PATH` | ./firmswap-api.db | SQLite database path (`:memory:` to disable persistence) |
| `QUOTE_TIMEOUT_MS` | 2000 | Max wait for solver quotes |
| `DEFAULT_DEPOSIT_WINDOW` | 300 | Default deposit deadline (seconds) |
| `DEFAULT_FILL_WINDOW` | 120 | Fill window after deposit deadline |
| `MIN_SOLVER_BOND` | 1000000000 | Minimum solver bond (1000 USDC) |
| `RATE_LIMIT_MAX` | 100 | Max requests per window (global default) |
| `RATE_LIMIT_WINDOW_MS` | 60000 | Rate limit window duration (ms) |
| `MAX_SOLVERS_PER_CHAIN` | 50 | Maximum registered solvers per chain |
| `MAX_QUOTE_FAN_OUT` | 10 | Maximum solvers queried per quote request |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins (e.g., `https://app.example.com`) |
| `METRICS_AUTH` | -- | Optional Basic auth for `/metrics` (format: `user:password`) |
| `NODE_ENV` | -- | Set to `production` to enforce HTTPS solver URLs and block private IPs |

## Running

```bash
cp .env.example .env   # Configure
npm install
npm run dev            # Development (auto-reload)
npm start              # Production
```

## Testing

```bash
npm test              # 20 tests
```

## License

MIT
