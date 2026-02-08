# FirmSwap Reference Solver

Reference implementation of a FirmSwap solver. Provides firm quotes based on CEX prices, signs them with EIP-712, monitors on-chain deposits, and automatically fills orders.

## Architecture

```
┌─────────────────────────────────────────────┐
│                 Solver                       │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │  Quoter  │  │  Signer  │  │   Nonce   │ │
│  │          │→ │ (EIP-712)│→ │  Manager  │ │
│  └──────────┘  └──────────┘  └───────────┘ │
│       ↑                           ↓         │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │   CEX    │  │ Monitor  │  │  Filler   │ │
│  │ Adapter  │  │ (events) │→ │ (on-chain)│ │
│  └──────────┘  └──────────┘  └───────────┘ │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │        HTTP Server (Fastify)         │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Components

- **Quoter** -- Calculates output amounts using CEX mid-price + configurable spread.
- **Signer** -- Signs quotes using EIP-712 typed data (matching the FirmSwap contract domain).
- **NonceManager** -- Generates unique nonces for each quote (prevents replay).
- **Monitor** -- Polls for on-chain `Deposited` events.
- **Filler** -- Automatically fills deposited orders by calling `fill()` on-chain. Uses a sequential fill queue to prevent concurrent transaction submissions.
- **HTTP Server** -- Exposes `/quote` endpoint for the API aggregator.

## CEX Adapter System

The solver uses a pluggable CEX adapter interface (`ICexAdapter`):

- `BinanceAdapter` -- Real Binance API integration (requires API keys).
- `MockCexAdapter` -- Returns configurable mock prices (default, for testing).

Set `BINANCE_API_KEY` and `BINANCE_API_SECRET` to use real prices.

## Deadlines

Every quote the solver signs includes two on-chain deadlines:

- **`depositDeadline`**: The user must deposit before this timestamp (set by the API, default 5 minutes from now).
- **`fillDeadline`**: The solver must call `fill()` before this timestamp (set by the API, default 2 minutes after the deposit deadline).

Both deadlines are part of the EIP-712 signed struct. The solver's liability window is bounded: if the user does not deposit before `depositDeadline`, the quote expires at no cost. If the user deposits but the solver fails to fill before `fillDeadline`, the solver's bond is slashed.

## Configuration

See `.env.example` for a full template.

| Variable | Default | Description |
|---|---|---|
| `SOLVER_PRIVATE_KEY` | -- | Private key for signing quotes and filling orders |
| `CHAIN_ID` | `100` | Chain ID |
| `RPC_URL` | `https://rpc.gnosis.gateway.fm` | JSON-RPC endpoint |
| `FIRMSWAP_ADDRESS` | -- | FirmSwap contract address |
| `PORT` | `3001` | HTTP server port |
| `API_URL` | `http://localhost:3000` | API URL for self-registration |
| `SOLVER_NAME` | `"My FirmSwap Solver"` | Display name |
| `SPREAD_BPS` | `50` | Spread over mid-price (basis points, 50 = 0.5%) |
| `MAX_ORDER_SIZE_USD` | `50000` | Maximum order size |
| `POLL_INTERVAL_MS` | `3000` | Event polling interval |
| `AUTO_FILL` | `true` | Auto-fill deposited orders |
| `BINANCE_API_KEY` | -- | Optional Binance API key |
| `BINANCE_API_SECRET` | -- | Optional Binance API secret |

## Running

```bash
cp .env.example .env   # Configure (SOLVER_PRIVATE_KEY required)
npm install
npm run dev            # Development (auto-reload)
npm start              # Production
```

## Testing

```bash
npm test              # 18 tests
```

## License

MIT
