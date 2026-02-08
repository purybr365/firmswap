import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { keccak256 } from "viem";

import { Quoter } from "./quoter.js";
import { Signer, QUOTE_TYPEHASH } from "./signer.js";
import { NonceManager } from "./nonceManager.js";
import { MockCexAdapter } from "./cex/mock.js";
import { buildSolverServer, type SolverServerOptions } from "./server.js";
import type { SolverQuoteRequest, SerializedQuote } from "./types.js";

// ═══════════════════════════════════════════════════
//  Test Constants
// ═══════════════════════════════════════════════════

const TEST_PRIVATE_KEY = generatePrivateKey();
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_CHAIN_ID = 100;
const TEST_FIRMSWAP_ADDRESS = "0x1234567890123456789012345678901234567890" as const;

const BRLA = "0xfecb3f7c54e2caae9dc6ac9060a822d47e053760" as const;
const USDC = "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83" as const;

// ═══════════════════════════════════════════════════
//  MockCexAdapter Tests
// ═══════════════════════════════════════════════════

describe("MockCexAdapter", () => {
  it("returns a static BRLA/USDC price", async () => {
    const cex = new MockCexAdapter();
    const price = await cex.getPrice("BRLA/USDC");

    expect(price.pair).toBe("BRLA/USDC");
    expect(price.bid).toBeGreaterThan(0);
    expect(price.ask).toBeGreaterThan(price.bid);
    expect(price.midPrice).toBeCloseTo((price.bid + price.ask) / 2);
  });

  it("allows setting custom prices", async () => {
    const cex = new MockCexAdapter();
    cex.setPrice("BRLA/USDC", 0.2, 0.21);

    const price = await cex.getPrice("BRLA/USDC");
    expect(price.bid).toBe(0.2);
    expect(price.ask).toBe(0.21);
  });

  it("throws for unsupported pairs", async () => {
    const cex = new MockCexAdapter();
    await expect(cex.getPrice("ETH/BTC")).rejects.toThrow("Unsupported pair");
  });
});

// ═══════════════════════════════════════════════════
//  Quoter Tests
// ═══════════════════════════════════════════════════

describe("Quoter", () => {
  let cex: MockCexAdapter;
  let quoter: Quoter;

  beforeEach(() => {
    cex = new MockCexAdapter();
    // Set a clean price: 1 BRLA = 0.20 USDC
    cex.setPrice("BRLA/USDC", 0.2, 0.2);
    quoter = new Quoter(cex, 0); // 0% spread for predictable math
  });

  it("quotes EXACT_OUTPUT: BRLA → USDC", async () => {
    // Want 200 USDC, price is 0.20 USDC/BRLA → need 1000 BRLA
    const result = await quoter.quote({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_OUTPUT",
      amount: "200000000", // 200 USDC (6 dec)
      userAddress: "0x0000000000000000000000000000000000000001",
      chainId: TEST_CHAIN_ID,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
    });

    expect(result).not.toBeNull();
    expect(result!.orderType).toBe(1); // EXACT_OUTPUT
    expect(result!.outputAmount).toBe(200_000_000n);
    // 200 USDC / 0.20 = 1000 BRLA (18 dec)
    expect(result!.inputAmount).toBe(1000_000_000_000_000_000_000n);
  });

  it("quotes EXACT_INPUT: BRLA → USDC", async () => {
    // Send 1000 BRLA, price is 0.20 USDC/BRLA → get 200 USDC
    const result = await quoter.quote({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_INPUT",
      amount: "1000000000000000000000", // 1000 BRLA (18 dec)
      userAddress: "0x0000000000000000000000000000000000000001",
      chainId: TEST_CHAIN_ID,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
    });

    expect(result).not.toBeNull();
    expect(result!.orderType).toBe(0); // EXACT_INPUT
    expect(result!.inputAmount).toBe(1000_000_000_000_000_000_000n);
    expect(result!.outputAmount).toBe(200_000_000n);
  });

  it("applies spread correctly for EXACT_OUTPUT", async () => {
    // 1% spread
    const quoterWithSpread = new Quoter(cex, 100);

    const result = await quoterWithSpread.quote({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_OUTPUT",
      amount: "200000000",
      userAddress: "0x0000000000000000000000000000000000000001",
      chainId: TEST_CHAIN_ID,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
    });

    expect(result).not.toBeNull();
    // Without spread: 1000 BRLA. With 1% spread: 1010 BRLA
    // 200 / 0.20 * 1.01 = 1010
    expect(result!.inputAmount).toBe(1_010_000_000_000_000_000_000n);
  });

  it("applies spread correctly for EXACT_INPUT", async () => {
    const quoterWithSpread = new Quoter(cex, 100);

    const result = await quoterWithSpread.quote({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_INPUT",
      amount: "1000000000000000000000",
      userAddress: "0x0000000000000000000000000000000000000001",
      chainId: TEST_CHAIN_ID,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
    });

    expect(result).not.toBeNull();
    // Without spread: 200 USDC. With 1% spread: 198 USDC
    // 1000 * 0.20 * 0.99 = 198
    expect(result!.outputAmount).toBe(198_000_000n);
  });

  it("returns null for unsupported pairs", async () => {
    const result = await quoter.quote({
      inputToken: "0x0000000000000000000000000000000000000001",
      outputToken: "0x0000000000000000000000000000000000000002",
      orderType: "EXACT_OUTPUT",
      amount: "200000000",
      userAddress: "0x0000000000000000000000000000000000000003",
      chainId: TEST_CHAIN_ID,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
    });

    expect(result).toBeNull();
  });

  it("returns null for orders exceeding max size", async () => {
    // Max is 50,000 USD by default
    const result = await quoter.quote({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_OUTPUT",
      amount: "100000000000", // 100,000 USDC (6 dec)
      userAddress: "0x0000000000000000000000000000000000000001",
      chainId: TEST_CHAIN_ID,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
    });

    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
//  Signer Tests
// ═══════════════════════════════════════════════════

describe("Signer", () => {
  let signer: Signer;

  beforeAll(() => {
    signer = new Signer(TEST_PRIVATE_KEY, TEST_CHAIN_ID, TEST_FIRMSWAP_ADDRESS);
  });

  it("returns the correct address", () => {
    expect(signer.address.toLowerCase()).toBe(
      TEST_ACCOUNT.address.toLowerCase(),
    );
  });

  it("produces a valid 65-byte signature", async () => {
    const quote: SerializedQuote = {
      solver: TEST_ACCOUNT.address,
      user: "0x0000000000000000000000000000000000000002",
      inputToken: BRLA,
      inputAmount: "1000000000000000000000",
      outputToken: USDC,
      outputAmount: "200000000",
      orderType: 1,
      outputChainId: 100,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
      nonce: "0",
    };

    const sig = await signer.signQuote(quote);

    // EIP-712 signature should be 65 bytes (0x + 130 hex chars)
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("produces different signatures for different quotes", async () => {
    const base: SerializedQuote = {
      solver: TEST_ACCOUNT.address,
      user: "0x0000000000000000000000000000000000000002",
      inputToken: BRLA,
      inputAmount: "1000000000000000000000",
      outputToken: USDC,
      outputAmount: "200000000",
      orderType: 1,
      outputChainId: 100,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
      nonce: "0",
    };

    const sig1 = await signer.signQuote(base);
    const sig2 = await signer.signQuote({ ...base, nonce: "1" });

    expect(sig1).not.toBe(sig2);
  });

  it("QUOTE_TYPEHASH matches Solidity constant", () => {
    // The typehash should be the keccak256 of the type string
    const expected = keccak256(
      new TextEncoder().encode(
        "FirmSwapQuote(" +
          "address solver," +
          "address user," +
          "address inputToken," +
          "uint256 inputAmount," +
          "address outputToken," +
          "uint256 outputAmount," +
          "uint8 orderType," +
          "uint256 outputChainId," +
          "uint32 depositDeadline," +
          "uint32 fillDeadline," +
          "uint256 nonce" +
          ")",
      ),
    );

    expect(QUOTE_TYPEHASH).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════
//  Solver HTTP Server Tests
// ═══════════════════════════════════════════════════

describe("Solver HTTP Server", () => {
  let server: ReturnType<typeof buildSolverServer>;
  let cex: MockCexAdapter;
  let nonces = 0n;

  // Simple nonce manager stub
  const nonceManager = {
    getNextNonce: () => nonces++,
    peekNextNonce: () => nonces,
    initialize: async () => {},
  } as unknown as NonceManager;

  beforeAll(async () => {
    cex = new MockCexAdapter();
    cex.setPrice("BRLA/USDC", 0.2, 0.2);

    const quoter = new Quoter(cex, 0);
    const signer = new Signer(
      TEST_PRIVATE_KEY,
      TEST_CHAIN_ID,
      TEST_FIRMSWAP_ADDRESS,
    );

    server = buildSolverServer({
      quoter,
      signer,
      nonceManager,
      solverAddress: TEST_ACCOUNT.address,
    });

    await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await server.close();
  });

  const getUrl = () => {
    const addrInfo = server.addresses()[0];
    return `http://${addrInfo.address}:${addrInfo.port}`;
  };

  it("GET /health returns solver info", async () => {
    const res = await fetch(`${getUrl()}/health`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.solver).toBe(TEST_ACCOUNT.address);
  });

  it("POST /quote returns a valid signed quote", async () => {
    const res = await fetch(`${getUrl()}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputToken: BRLA,
        outputToken: USDC,
        orderType: "EXACT_OUTPUT",
        amount: "200000000",
        userAddress: "0x0000000000000000000000000000000000000002",
        chainId: TEST_CHAIN_ID,
        depositDeadline: Math.floor(Date.now() / 1000) + 300,
        fillDeadline: Math.floor(Date.now() / 1000) + 420,
      } satisfies SolverQuoteRequest),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.quote).toBeDefined();
    expect(body.signature).toBeDefined();
    expect(body.quote.solver).toBe(TEST_ACCOUNT.address);
    expect(body.quote.outputAmount).toBe("200000000");
    expect(body.quote.inputAmount).toBe("1000000000000000000000");
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("POST /quote returns 400 for missing fields", async () => {
    const res = await fetch(`${getUrl()}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputToken: BRLA }),
    });

    expect(res.status).toBe(400);
  });

  it("POST /quote returns 503 for unsupported pairs", async () => {
    const res = await fetch(`${getUrl()}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputToken: "0x0000000000000000000000000000000000000001",
        outputToken: "0x0000000000000000000000000000000000000002",
        orderType: "EXACT_OUTPUT",
        amount: "200000000",
        userAddress: "0x0000000000000000000000000000000000000003",
        chainId: TEST_CHAIN_ID,
        depositDeadline: Math.floor(Date.now() / 1000) + 300,
        fillDeadline: Math.floor(Date.now() / 1000) + 420,
      }),
    });

    expect(res.status).toBe(503);
  });

  it("increments nonce for each quote", async () => {
    const noncesBefore = nonces;

    await fetch(`${getUrl()}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputToken: BRLA,
        outputToken: USDC,
        orderType: "EXACT_OUTPUT",
        amount: "200000000",
        userAddress: "0x0000000000000000000000000000000000000002",
        chainId: TEST_CHAIN_ID,
        depositDeadline: Math.floor(Date.now() / 1000) + 300,
        fillDeadline: Math.floor(Date.now() / 1000) + 420,
      }),
    });

    expect(nonces).toBe(noncesBefore + 1n);
  });
});
