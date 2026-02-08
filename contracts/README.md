# FirmSwap Contracts

Smart contracts package for FirmSwap Protocol -- a firm-quote swap protocol on Gnosis Chain.

## Contract Architecture

| Contract | Description |
|---|---|
| `FirmSwap.sol` (~630 lines) | Core protocol contract implementing IOriginSettler (ERC-7683) |
| `DepositProxy.sol` | Minimal CREATE2 sweep proxy for address deposits |
| `libraries/QuoteLib.sol` | EIP-712 quote hashing and validation |
| `libraries/OrderLib.sol` | Order ID computation |
| `interfaces/IFirmSwap.sol` | Full interface with events, errors, structs |
| `interfaces/IERC7683.sol` | Cross-chain intent settlement standard interface |

## How It Works

### Address Deposit

Solver provides a quote. `computeDepositAddress()` returns a deterministic CREATE2 address. User transfers tokens to that address. Anyone calls `settle()`. DepositProxy sweeps funds into the contract and settles the order. Zero user transactions with the contract.

### Contract Deposit

User calls `deposit()` (or `depositWithPermit2()`) with the solver-signed quote. Solver calls `fill()` to deliver output tokens.

### Refund Paths

`refund()` for Contract Deposit orders past fill deadline. `refundAddressDeposit()` for Address Deposit orders past fill deadline. Both slash 5% of the solver's bond.

### Bond System

Solvers call `registerSolver()` with a USDC bond. 5% is reserved per active order. 7-day unstake delay via `requestUnstake()` then `executeUnstake()`. Pending unstake requests can be cancelled via `cancelUnstake()`. Bond is slashed on refund.

## Dependencies

- OpenZeppelin Contracts v5 (EIP-712, ECDSA, ReentrancyGuard)
- Uniswap Permit2
- Forge Std (testing)

## Build

```bash
# Build Permit2 first (separate solc version)
cd lib/permit2 && forge build && cd ../..

# Build FirmSwap
forge build
```

## Test

```bash
forge test                          # Default (1000 fuzz runs)
FOUNDRY_PROFILE=ci forge test       # CI profile (10,000 fuzz runs)
forge test -vvv                     # Verbose output
```

### Test Stats

87 tests total:

- 64 unit tests (deposit, fill, refund, solver management, nonce cancellation, excess deposits, tolerance, recovery)
- 12 integration tests (full Address Deposit + Contract Deposit flows, multi-solver, excess handling)
- 8 fuzz tests (random amounts, deadlines, multiple orders)
- 3 invariant tests (bond accounting, order state transitions, nonce uniqueness)

## Configuration

`foundry.toml` settings:

- Solidity 0.8.24, Cancun EVM
- Optimizer: 10,000 runs
- CI profile: 10,000 fuzz runs, 1,024 invariant runs at depth 128

## Deployment

```bash
forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url $RPC_URL
```

## License

MIT
