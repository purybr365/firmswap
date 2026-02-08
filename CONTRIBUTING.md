# Contributing to FirmSwap Protocol

Thank you for your interest in contributing to FirmSwap Protocol! This guide will help you get set up and familiar with the project's conventions.

## Development Setup

```bash
git clone https://github.com/purybr365/firmswap.git
cd firmswap

# Install Foundry (if needed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Contracts
cd contracts
cd lib/permit2 && forge build && cd ../..
forge build
forge test

# API
cd ../api
npm install
npm test

# Solver
cd ../solver
npm install
npm test

# SDK
cd ../sdk
npm install
npm test
```

## Code Style

- **Solidity**: Use `forge fmt` (Foundry's default formatter).
- **TypeScript**: ESM modules, strict mode, NodeNext module resolution.
- All TypeScript packages use **vitest** for testing.

## Testing Guidelines

- All PRs must pass existing tests.
- New features should include tests.
- **Contracts**: Unit tests in `test/`, fuzz tests with `testFuzz_` prefix, invariant tests in `test/invariant/`.
- **TypeScript**: vitest with mock-based testing (no live RPC in unit tests).

## PR Process

1. Fork the repository.
2. Create a feature branch from `main`.
3. Make your changes with tests.
4. Ensure all tests pass locally.
5. Submit a PR with a clear description.

## Commit Messages

Use conventional style:

- `feat:` -- new feature
- `fix:` -- bug fix
- `docs:` -- documentation only
- `test:` -- adding or updating tests
- `refactor:` -- code change that neither fixes a bug nor adds a feature
- `chore:` -- maintenance tasks, dependency updates, CI changes

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
