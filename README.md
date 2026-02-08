# FirmSwap Protocol

Firm-quote swap protocol with bonded solvers. Supports multiple EVM chains (Gnosis, Base, Polygon, Arbitrum, Optimism) from a single API instance.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Firm quotes** -- solvers commit to exact prices, no slippage for users
- **Time-bound quotes** -- every quote includes on-chain deposit and fill deadlines; miss the deadline, and the user gets a refund + bond compensation
- **Two deposit modes**
  - **Address Deposit:** CREATE2 deposit address, zero user transactions required
  - **Contract Deposit:** approve + deposit flow
- **ERC-7683 compatible** (IOriginSettler interface)
- **Bonded solver system** -- 5% per-order bond reservation, 7-day unstake delay, slash on default
- **Permit2 support** for gasless token approvals
- **Multi-solver aggregation** -- API collects quotes from multiple solvers and returns the best
- **Real-time WebSocket** order status updates

## Architecture

```
                          +-----------+
                          |   User    |
                          +-----+-----+
                                |
                          +-----v-----+
                          |    SDK    |
                          +-----+-----+
                                |
                          +-----v-----+        +-----------+
                          |    API    +------->| Solver 1  |
                          | aggregator|------->| Solver 2  |
                          +-----+-----+------->| Solver N  |
                                |              +-----------+
                                |
                  +-------------v--------------+
                  |    FirmSwap Contract        |
                  |----------------------------|
                  |                            |
          +-------v-------+          +---------v------+
          |    Address     |          |   Contract     |
          |    Deposit     |          |   Deposit      |
          |                |          |                |
          | 1. User sends  |          | 1. deposit()   |
          |    to CREATE2  |          | 2. fill()      |
          |    address     |          |                |
          | 2. settle()    |          |                |
          |   (1 tx, zero  |          |                |
          |    user txs)   |          |                |
          +----------------+          +----------------+
```

## Monorepo Structure

| Directory    | Description                                  |
|--------------|----------------------------------------------|
| `contracts/` | Solidity smart contracts (Foundry)            |
| `api/`       | Quote aggregator API (Fastify)                |
| `solver/`    | Reference solver implementation (Fastify)     |
| `sdk/`       | TypeScript SDK (viem)                         |

## Quick Start

### Prerequisites

- Node.js 20+
- [Foundry](https://book.getfoundry.sh/getting-started/installation)

### Build and Test

**Contracts:**

```bash
# Build Permit2 dependency first (separate solc version)
cd contracts/lib/permit2 && forge build
cd ../..

# Build and test
forge build
forge test
```

**API:**

```bash
cd api
npm install
npm test
```

**Solver:**

```bash
cd solver
npm install
npm test
```

**SDK:**

```bash
cd sdk
npm install
npm test
```

## Chiado Testnet

FirmSwap is deployed on Gnosis Chiado testnet.

| Parameter  | Value                                        |
|------------|----------------------------------------------|
| Chain      | Gnosis Chiado (chain ID 10200)               |
| RPC        | `https://rpc.chiadochain.net`                |
| FirmSwap   | `0xE08Ee2901bbfD8A7837D294D3e43338871e075a4` |
| tBRLA      | `0x8bf8beBaBb2305F32C4fc5DBbE93b8accA5C45BC` (18 decimals) |
| tUSDC      | `0xdC874bD78D67A27025e3b415A5ED698C88042FaC` (6 decimals)  |

Testnet tokens can be obtained from the [Chiado Faucet](https://faucet.chiadochain.net/).

## How It Works

1. **Request quote** -- User requests a quote via the API (or SDK).
2. **Aggregation** -- API fans out the request to all registered solvers.
3. **Best quote** -- The best quote is returned to the user, including deposit and fill deadlines, signed with the solver's EIP-712 signature.
4. **Deposit** -- User deposits input tokens:
   - **Address Deposit:** Transfer tokens to a deterministic CREATE2 address (zero on-chain transactions from the user).
   - **Contract Deposit:** Call `deposit()` on the FirmSwap contract.
5. **Fill** -- Solver delivers the output tokens to the user on-chain.
6. **Default protection** -- If the solver fails to fill before the `fillDeadline`, the user can call `refund()` and the solver's bond is slashed.

## Self-Hosting & Decentralization

FirmSwap is designed to be fully self-hosted and permissionless:

- **Anyone can run the API.** The aggregator is a Fastify server with SQLite-backed solver persistence, Prometheus metrics, and rate limiting. Spin up your own instance pointing at any RPC.
- **Multi-chain from one instance.** A single API serves multiple chains (e.g., Gnosis + Base + Polygon). Each chain has its own solver registry and aggregator, scoped by chain ID in the URL path.
- **Solvers register permissionlessly.** The only requirement is an on-chain USDC bond on the FirmSwap contract. Any solver can register with any API instance.
- **The smart contract is the source of truth.** Deposits, fills, refunds, and bond slashing all happen on-chain. The API is a convenience layer for quote aggregation -- it never holds funds.
- **No single operator required.** Multiple independent API instances can coexist, each with their own solver set. Users can point the SDK at any API URL.

See [api/README.md](api/README.md) for deployment instructions.

## Tests

| Package   | Tests | Details                                              |
|-----------|-------|------------------------------------------------------|
| Contracts | 87    | 64 unit, 12 integration, 8 fuzz, 3 invariant         |
| API       | 20    | Registry, aggregator, endpoints, rate limiting, auth, multi-chain |
| Solver    | 18    | CEX adapters, quoter, signer, HTTP server             |
| SDK       | 14    | Serialize/deserialize, types, client                  |
| **Total** | **139** |                                                     |

## License

This project is licensed under the [MIT License](LICENSE).
