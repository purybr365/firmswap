import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import { createDatabase } from "./db.js";
import { SolverRegistry } from "./solverRegistry.js";
import { Aggregator } from "./aggregator.js";
import { buildServer } from "./server.js";
import type { ChainContext } from "./chain.js";
import type { ChainConfig } from "./config.js";
import type { QuoteRequest, SolverQuoteResponse } from "./types.js";
import { createPublicClient, http, createWalletClient, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosis } from "viem/chains";
import { buildRegistrationMessage, buildUnregistrationMessage } from "./auth.js";

// Test wallet for solver authentication
const TEST_SOLVER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const testSolverAccount = privateKeyToAccount(TEST_SOLVER_PK);
const TEST_SOLVER_ADDRESS = testSolverAccount.address;

async function signRegistration(
  account: PrivateKeyAccount,
  endpointUrl: string,
  timestamp: number,
): Promise<string> {
  const message = buildRegistrationMessage(account.address, endpointUrl, timestamp);
  return account.signMessage({ message });
}

async function signUnregistration(
  account: PrivateKeyAccount,
  timestamp: number,
): Promise<string> {
  const message = buildUnregistrationMessage(account.address, timestamp);
  return account.signMessage({ message });
}

// ═══════════════════════════════════════════════════
//  Test Chain Context (no real RPC calls needed)
// ═══════════════════════════════════════════════════

const TEST_CHAIN_ID = 100;

const DUMMY_FIRMSWAP_ADDRESS = "0x0000000000000000000000000000000000000099" as `0x${string}`;

/** ChainContext without firmSwapAddress — for SolverRegistry unit tests (no on-chain calls). */
const testChainCtx: ChainContext = {
  chainId: TEST_CHAIN_ID,
  publicClient: createPublicClient({ chain: gnosis, transport: http("http://localhost:0") }),
  firmSwapAddress: undefined,
};

/** ChainContext with a dummy firmSwapAddress — for Aggregator tests (signature verification). */
const aggregatorChainCtx: ChainContext = {
  ...testChainCtx,
  firmSwapAddress: DUMMY_FIRMSWAP_ADDRESS,
};

const testChainConfig: ChainConfig = {
  chainId: TEST_CHAIN_ID,
  rpcUrl: "http://localhost:0",
  firmSwapAddress: undefined, // No real on-chain features in tests
};

/** Mock signature verifier that always returns true (for unit tests). */
const alwaysValidSigVerifier = async () => true;

// ═══════════════════════════════════════════════════
//  Mock Solver Server
// ═══════════════════════════════════════════════════

async function createMockSolver(
  responseFactory: () => SolverQuoteResponse | null,
): Promise<{ url: string; close: () => Promise<void> }> {
  const solver = Fastify();

  solver.post("/quote", async (request, reply) => {
    const response = responseFactory();
    if (!response) {
      return reply.status(500).send({ error: "no quote" });
    }
    return response;
  });

  await solver.listen({ port: 0, host: "127.0.0.1" });
  const addrInfo = solver.addresses()[0];

  return {
    url: `http://${addrInfo.address}:${addrInfo.port}`,
    close: () => solver.close(),
  };
}

function createTestDb() {
  return createDatabase(":memory:");
}

// ═══════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════

describe("SolverRegistry", () => {
  it("registers and retrieves a solver", async () => {
    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    const result = await registry.register(
      "0x1234567890123456789012345678901234567890",
      "http://localhost:9999",
      "TestSolver",
    );

    expect(result.ok).toBe(true);

    const solvers = registry.getActiveSolvers();
    expect(solvers).toHaveLength(1);
    expect(solvers[0].name).toBe("TestSolver");
    db.close();
  });

  it("unregisters a solver", async () => {
    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    await registry.register(
      "0x1234567890123456789012345678901234567890",
      "http://localhost:9999",
      "TestSolver",
    );

    const removed = registry.unregister("0x1234567890123456789012345678901234567890");
    expect(removed).toBe(true);
    expect(registry.getActiveSolvers()).toHaveLength(0);
    db.close();
  });

  it("deactivates and reactivates a solver", async () => {
    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    const addr = "0x1234567890123456789012345678901234567890" as `0x${string}`;
    await registry.register(addr, "http://localhost:9999", "TestSolver");

    registry.setSolverActive(addr, false);
    expect(registry.getActiveSolvers()).toHaveLength(0);

    registry.setSolverActive(addr, true);
    expect(registry.getActiveSolvers()).toHaveLength(1);
    db.close();
  });

  it("persists solvers across database reopens", async () => {
    const dbPath = join(tmpdir(), `firmswap-test-${randomUUID()}.db`);
    try {
      // First session: register a solver
      const db1 = createDatabase(dbPath);
      const registry1 = new SolverRegistry(db1, testChainCtx, 0n);
      await registry1.register(
        "0x1234567890123456789012345678901234567890",
        "http://localhost:9999",
        "PersistentSolver",
      );
      expect(registry1.getActiveSolvers()).toHaveLength(1);
      db1.close();

      // Second session: solver should still be there
      const db2 = createDatabase(dbPath);
      const registry2 = new SolverRegistry(db2, testChainCtx, 0n);
      const solvers = registry2.getActiveSolvers();
      expect(solvers).toHaveLength(1);
      expect(solvers[0].name).toBe("PersistentSolver");
      expect(solvers[0].endpointUrl).toBe("http://localhost:9999");
      db2.close();
    } finally {
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
    }
  });

  it("updates existing solver on re-registration", async () => {
    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    const addr = "0x1234567890123456789012345678901234567890" as `0x${string}`;

    await registry.register(addr, "http://old-url:9999", "OldName");
    await registry.register(addr, "http://new-url:8888", "NewName");

    const solvers = registry.getActiveSolvers();
    expect(solvers).toHaveLength(1);
    expect(solvers[0].endpointUrl).toBe("http://new-url:8888");
    expect(solvers[0].name).toBe("NewName");
    db.close();
  });

  it("scopes solvers by chain_id", async () => {
    const db = createTestDb();
    const ctx100: ChainContext = { ...testChainCtx, chainId: 100 };
    const ctx10200: ChainContext = { ...testChainCtx, chainId: 10200 };
    const registry100 = new SolverRegistry(db, ctx100, 0n);
    const registry10200 = new SolverRegistry(db, ctx10200, 0n);
    const addr = "0x1234567890123456789012345678901234567890" as `0x${string}`;

    await registry100.register(addr, "http://gnosis:9999", "GnosisSolver");
    await registry10200.register(addr, "http://chiado:9999", "ChiadoSolver");

    // Each registry should only see its own chain's solver
    const solvers100 = registry100.getActiveSolvers();
    expect(solvers100).toHaveLength(1);
    expect(solvers100[0].endpointUrl).toBe("http://gnosis:9999");

    const solvers10200 = registry10200.getActiveSolvers();
    expect(solvers10200).toHaveLength(1);
    expect(solvers10200[0].endpointUrl).toBe("http://chiado:9999");

    db.close();
  });
});

describe("Aggregator", () => {
  let mockSolver1: Awaited<ReturnType<typeof createMockSolver>>;
  let mockSolver2: Awaited<ReturnType<typeof createMockSolver>>;

  const makeQuoteResponse = (
    outputAmount: string,
    inputAmount: string,
    solver: string,
  ): SolverQuoteResponse => ({
    quote: {
      solver,
      user: "0x0000000000000000000000000000000000000002",
      inputToken: "0x0000000000000000000000000000000000000003",
      inputAmount,
      outputToken: "0x0000000000000000000000000000000000000004",
      outputAmount,
      orderType: 1,
      outputChainId: 100,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
      nonce: "1",
    },
    signature: "0xdeadbeef",
  });

  afterAll(async () => {
    if (mockSolver1) await mockSolver1.close();
    if (mockSolver2) await mockSolver2.close();
  });

  it("returns null when no solvers registered", async () => {
    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    const aggregator = new Aggregator(registry, aggregatorChainCtx, undefined, alwaysValidSigVerifier);

    const result = await aggregator.getQuote({
      inputToken: "0x0000000000000000000000000000000000000003",
      outputToken: "0x0000000000000000000000000000000000000004",
      orderType: "EXACT_OUTPUT",
      amount: "200000000",
      userAddress: "0x0000000000000000000000000000000000000002",
      originChainId: 100,
      destinationChainId: 100,
      depositMode: "CONTRACT",
    });

    expect(result).toBeNull();
    db.close();
  });

  it("returns the best quote from multiple solvers (EXACT_OUTPUT: lowest input wins)", async () => {
    // Solver 1: charges 1200 input
    mockSolver1 = await createMockSolver(() =>
      makeQuoteResponse("200000000", "1200000000000000000000", "0xaaaa000000000000000000000000000000000001"),
    );

    // Solver 2: charges 1100 input (better)
    mockSolver2 = await createMockSolver(() =>
      makeQuoteResponse("200000000", "1100000000000000000000", "0xbbbb000000000000000000000000000000000002"),
    );

    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    await registry.register("0xaaaa000000000000000000000000000000000001", mockSolver1.url, "Solver1");
    await registry.register("0xbbbb000000000000000000000000000000000002", mockSolver2.url, "Solver2");

    const aggregator = new Aggregator(registry, aggregatorChainCtx, undefined, alwaysValidSigVerifier);

    const result = await aggregator.getQuote({
      inputToken: "0x0000000000000000000000000000000000000003",
      outputToken: "0x0000000000000000000000000000000000000004",
      orderType: "EXACT_OUTPUT",
      amount: "200000000",
      userAddress: "0x0000000000000000000000000000000000000002",
      originChainId: 100,
      destinationChainId: 100,
      depositMode: "CONTRACT",
    });

    expect(result).not.toBeNull();
    // Best quote should be solver 2 (lower input amount)
    expect(result!.quote.inputAmount).toBe("1100000000000000000000");
    expect(result!.alternativeQuotes).toHaveLength(1);
    expect(result!.alternativeQuotes[0].quote.inputAmount).toBe("1200000000000000000000");
    db.close();
  });

  it("returns the best quote for EXACT_INPUT (highest output wins)", async () => {
    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    await registry.register("0xaaaa000000000000000000000000000000000001", mockSolver1.url, "Solver1");
    await registry.register("0xbbbb000000000000000000000000000000000002", mockSolver2.url, "Solver2");

    const aggregator = new Aggregator(registry, aggregatorChainCtx, undefined, alwaysValidSigVerifier);

    // For EXACT_INPUT, both return 200000000 output — so either can be best
    const result = await aggregator.getQuote({
      inputToken: "0x0000000000000000000000000000000000000003",
      outputToken: "0x0000000000000000000000000000000000000004",
      orderType: "EXACT_INPUT",
      amount: "1000000000000000000000",
      userAddress: "0x0000000000000000000000000000000000000002",
      originChainId: 100,
      destinationChainId: 100,
      depositMode: "CONTRACT",
    });

    expect(result).not.toBeNull();
    expect(result!.quote.outputAmount).toBe("200000000");
    db.close();
  });

  it("handles solver failures gracefully", async () => {
    const failingSolver = await createMockSolver(() => null);

    const db = createTestDb();
    const registry = new SolverRegistry(db, testChainCtx, 0n);
    await registry.register("0xcccc000000000000000000000000000000000003", failingSolver.url, "FailSolver");
    await registry.register("0xaaaa000000000000000000000000000000000001", mockSolver1.url, "Solver1");

    const aggregator = new Aggregator(registry, aggregatorChainCtx, undefined, alwaysValidSigVerifier);

    const result = await aggregator.getQuote({
      inputToken: "0x0000000000000000000000000000000000000003",
      outputToken: "0x0000000000000000000000000000000000000004",
      orderType: "EXACT_OUTPUT",
      amount: "200000000",
      userAddress: "0x0000000000000000000000000000000000000002",
      originChainId: 100,
      destinationChainId: 100,
      depositMode: "CONTRACT",
    });

    // Should still return a quote from the working solver
    expect(result).not.toBeNull();
    expect(result!.alternativeQuotes).toHaveLength(0); // only 1 success, no alternatives

    await failingSolver.close();
    db.close();
  });
});

describe("API endpoints (via buildServer)", () => {
  let app: FastifyInstance;
  let mockSolver: Awaited<ReturnType<typeof createMockSolver>>;

  beforeAll(async () => {
    mockSolver = await createMockSolver(() => ({
      quote: {
        solver: TEST_SOLVER_ADDRESS,
        user: "0x0000000000000000000000000000000000000002",
        inputToken: "0x0000000000000000000000000000000000000003",
        inputAmount: "1148000000000000000000",
        outputToken: "0x0000000000000000000000000000000000000004",
        outputAmount: "200000000",
        orderType: 1,
        outputChainId: 100,
        depositDeadline: Math.floor(Date.now() / 1000) + 300,
        fillDeadline: Math.floor(Date.now() / 1000) + 420,
        nonce: "0",
      },
      signature: "0xabcdef",
    }));

    // Use buildServer with in-memory DB, high rate limit, and test chain config
    app = await buildServer({
      dbPath: ":memory:",
      rateLimitMax: 10000,
      chains: [testChainConfig],
      verifySignatureFn: alwaysValidSigVerifier,
    });

    // Register mock solver via API with signature auth
    const regTimestamp = Date.now();
    const regSignature = await signRegistration(testSolverAccount, mockSolver.url, regTimestamp);
    await app.inject({
      method: "POST",
      url: `/v1/${TEST_CHAIN_ID}/solvers/register`,
      payload: {
        address: TEST_SOLVER_ADDRESS,
        endpointUrl: mockSolver.url,
        name: "MockSolver",
        signature: regSignature,
        timestamp: regTimestamp,
      },
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    await mockSolver.close();
  });

  const getUrl = () => {
    const addrInfo = app.addresses()[0];
    return `http://${addrInfo.address}:${addrInfo.port}`;
  };

  it("GET /health returns multi-chain info", async () => {
    const res = await fetch(`${getUrl()}/health`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.supportedChains).toEqual([TEST_CHAIN_ID]);
    expect(body.uptime).toBeTypeOf("number");
    expect(body.timestamp).toBeTypeOf("number");
    expect(body.activeSolvers).toBeTypeOf("object");
    expect(body.activeSolvers[String(TEST_CHAIN_ID)]).toBeTypeOf("number");
    expect(body.version).toBeTypeOf("string");
  });

  it("POST /v1/:chainId/quote returns 503 when firmSwapAddress not configured", async () => {
    // Without firmSwapAddress, the aggregator correctly rejects all quotes
    // (signature verification requires the contract address)
    const res = await fetch(`${getUrl()}/v1/${TEST_CHAIN_ID}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputToken: "0x0000000000000000000000000000000000000003",
        outputToken: "0x0000000000000000000000000000000000000004",
        orderType: "EXACT_OUTPUT",
        amount: "200000000",
        userAddress: "0x0000000000000000000000000000000000000002",
        originChainId: 100,
        destinationChainId: 100,
        depositMode: "CONTRACT",
      }),
    });

    expect(res.status).toBe(503);
  });

  it("POST /v1/:chainId/quote returns 400 for missing fields", async () => {
    const res = await fetch(`${getUrl()}/v1/${TEST_CHAIN_ID}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputToken: "0x123" }),
    });

    expect(res.status).toBe(400);
  });

  it("GET /v1/:chainId/solvers returns registered solvers", async () => {
    const res = await fetch(`${getUrl()}/v1/${TEST_CHAIN_ID}/solvers`);
    const body = (await res.json()) as any[];
    expect(res.status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].name).toBe("MockSolver");
  });

  it("POST /v1/:chainId/solvers/register registers a new solver", async () => {
    const newSolverPk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
    const newSolverAccount = privateKeyToAccount(newSolverPk);
    const timestamp = Date.now();
    const endpointUrl = "http://localhost:12345";
    const signature = await signRegistration(newSolverAccount, endpointUrl, timestamp);

    const res = await fetch(`${getUrl()}/v1/${TEST_CHAIN_ID}/solvers/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: newSolverAccount.address,
        endpointUrl,
        name: "NewSolver",
        signature,
        timestamp,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("registered");
  });

  it("POST /v1/:chainId/solvers/register rejects without signature", async () => {
    const res = await fetch(`${getUrl()}/v1/${TEST_CHAIN_ID}/solvers/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: "0xbbbb000000000000000000000000000000000002",
        endpointUrl: "http://localhost:12345",
        name: "NewSolver",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("GET /metrics returns Prometheus format", async () => {
    const res = await fetch(`${getUrl()}/metrics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("http_request_duration_seconds");
    expect(text).toContain("firmswap_active_solvers");
    expect(text).toContain("firmswap_quotes_requested_total");
  });

  it("returns 404 for unsupported chain", async () => {
    const res = await fetch(`${getUrl()}/v1/999/solvers`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toContain("999");
  });
});

describe("Rate limiting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Clear the global prom-client registry to avoid "already registered" errors
    // when creating a second buildServer instance in the same process.
    const { register } = await import("prom-client");
    register.clear();

    // Server with very low rate limit for testing
    app = await buildServer({
      dbPath: ":memory:",
      rateLimitMax: 2,
      chains: [testChainConfig],
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
  });

  const getUrl = () => {
    const addrInfo = app.addresses()[0];
    return `http://${addrInfo.address}:${addrInfo.port}`;
  };

  it("returns 429 after exceeding rate limit", async () => {
    // Per-route config overrides global, so we send enough requests to
    // exceed the per-route limit for /v1/:chainId/solvers/register (max=5).
    // Use signed registrations with unique wallets.
    const testPks = [
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
      "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
      "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    ] as const;

    const results = [];
    for (let i = 0; i < 6; i++) {
      const acc = privateKeyToAccount(testPks[i]);
      const endpointUrl = `http://localhost:${12345 + i}`;
      const timestamp = Date.now();
      const signature = await signRegistration(acc, endpointUrl, timestamp);
      results.push(await fetch(`${getUrl()}/v1/${TEST_CHAIN_ID}/solvers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: acc.address,
          endpointUrl,
          name: `Solver${i}`,
          signature,
          timestamp,
        }),
      }));
    }

    // First 5 should succeed, 6th should be rate-limited
    for (let i = 0; i < 5; i++) {
      expect(results[i].status).toBe(200);
    }
    expect(results[5].status).toBe(429);
  });

  it("exempts /health from rate limiting", async () => {
    // Health should always work regardless of rate limit
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await fetch(`${getUrl()}/health`));
    }

    // All should succeed
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });
});
