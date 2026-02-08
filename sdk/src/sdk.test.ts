import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import {
  FirmSwapClient,
  FirmSwapError,
  deserializeQuote,
  serializeQuote,
  OrderType,
  OrderState,
  DepositMode,
  PERMIT2_ADDRESS,
  type FirmSwapQuote,
  type SerializedQuote,
  type QuoteResponse,
} from "./index.js";

// ═══════════════════════════════════════════════════
//  Serialize / Deserialize Tests
// ═══════════════════════════════════════════════════

describe("serializeQuote / deserializeQuote", () => {
  const onChainQuote: FirmSwapQuote = {
    solver: "0xaaaa000000000000000000000000000000000001",
    user: "0xbbbb000000000000000000000000000000000002",
    inputToken: "0xcccc000000000000000000000000000000000003",
    inputAmount: 1_000_000_000_000_000_000_000n, // 1000 (18 dec)
    outputToken: "0xdddd000000000000000000000000000000000004",
    outputAmount: 200_000_000n, // 200 (6 dec)
    orderType: OrderType.EXACT_OUTPUT,
    outputChainId: 100n,
    depositDeadline: 1700000000,
    fillDeadline: 1700000120,
    nonce: 42n,
  };

  it("round-trips serialize → deserialize", () => {
    const serialized = serializeQuote(onChainQuote);
    const deserialized = deserializeQuote(serialized);

    expect(deserialized.solver).toBe(onChainQuote.solver);
    expect(deserialized.user).toBe(onChainQuote.user);
    expect(deserialized.inputToken).toBe(onChainQuote.inputToken);
    expect(deserialized.inputAmount).toBe(onChainQuote.inputAmount);
    expect(deserialized.outputToken).toBe(onChainQuote.outputToken);
    expect(deserialized.outputAmount).toBe(onChainQuote.outputAmount);
    expect(deserialized.orderType).toBe(onChainQuote.orderType);
    expect(deserialized.outputChainId).toBe(onChainQuote.outputChainId);
    expect(deserialized.depositDeadline).toBe(onChainQuote.depositDeadline);
    expect(deserialized.fillDeadline).toBe(onChainQuote.fillDeadline);
    expect(deserialized.nonce).toBe(onChainQuote.nonce);
  });

  it("serializes amounts as strings", () => {
    const serialized = serializeQuote(onChainQuote);

    expect(typeof serialized.inputAmount).toBe("string");
    expect(typeof serialized.outputAmount).toBe("string");
    expect(typeof serialized.nonce).toBe("string");
    expect(serialized.inputAmount).toBe("1000000000000000000000");
    expect(serialized.outputAmount).toBe("200000000");
    expect(serialized.nonce).toBe("42");
  });

  it("serializes chainId as number", () => {
    const serialized = serializeQuote(onChainQuote);
    expect(typeof serialized.outputChainId).toBe("number");
    expect(serialized.outputChainId).toBe(100);
  });
});

// ═══════════════════════════════════════════════════
//  Type Exports
// ═══════════════════════════════════════════════════

describe("Type exports", () => {
  it("exports OrderType enum", () => {
    expect(OrderType.EXACT_INPUT).toBe(0);
    expect(OrderType.EXACT_OUTPUT).toBe(1);
  });

  it("exports OrderState enum", () => {
    expect(OrderState.NONE).toBe(0);
    expect(OrderState.DEPOSITED).toBe(1);
    expect(OrderState.SETTLED).toBe(2);
    expect(OrderState.REFUNDED).toBe(3);
  });

  it("exports DepositMode enum", () => {
    expect(DepositMode.CONTRACT).toBe("CONTRACT");
    expect(DepositMode.ADDRESS).toBe("ADDRESS");
  });

  it("exports PERMIT2_ADDRESS", () => {
    expect(PERMIT2_ADDRESS).toBe(
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    );
  });
});

// ═══════════════════════════════════════════════════
//  FirmSwapClient Tests (with mock API)
// ═══════════════════════════════════════════════════

describe("FirmSwapClient", () => {
  let mockApi: FastifyInstance;
  let apiUrl: string;
  const TEST_CHAIN_ID = 100;

  const mockQuoteResponse: QuoteResponse = {
    quote: {
      solver: "0xaaaa000000000000000000000000000000000001",
      user: "0xbbbb000000000000000000000000000000000002",
      inputToken: "0xcccc000000000000000000000000000000000003",
      inputAmount: "1148000000000000000000",
      outputToken: "0xdddd000000000000000000000000000000000004",
      outputAmount: "200000000",
      orderType: 1,
      outputChainId: 100,
      depositDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 420,
      nonce: "0",
    },
    solverSignature: "0x" + "ab".repeat(65),
    depositAddress: "0xdead000000000000000000000000000000000099",
    alternativeQuotes: [],
  };

  beforeAll(async () => {
    mockApi = Fastify();

    mockApi.get("/health", async () => ({
      status: "ok",
      supportedChains: [TEST_CHAIN_ID],
    }));

    mockApi.post(`/v1/${TEST_CHAIN_ID}/quote`, async (request, reply) => {
      const body = request.body as any;
      if (!body.inputToken || !body.outputToken || !body.amount) {
        return reply.status(400).send({ error: "Missing fields" });
      }
      return mockQuoteResponse;
    });

    mockApi.get(`/v1/${TEST_CHAIN_ID}/order/:orderId`, async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      return {
        orderId,
        state: "DEPOSITED",
        user: "0xbbbb000000000000000000000000000000000002",
        solver: "0xaaaa000000000000000000000000000000000001",
        inputToken: "0xcccc000000000000000000000000000000000003",
        inputAmount: "1148000000000000000000",
        outputToken: "0xdddd000000000000000000000000000000000004",
        outputAmount: "200000000",
        fillDeadline: Math.floor(Date.now() / 1000) + 420,
      };
    });

    mockApi.get(`/v1/${TEST_CHAIN_ID}/solvers`, async () => [
      { address: "0xaaaa000000000000000000000000000000000001", name: "TestSolver" },
    ]);

    await mockApi.listen({ port: 0, host: "127.0.0.1" });
    const addrInfo = mockApi.addresses()[0];
    apiUrl = `http://${addrInfo.address}:${addrInfo.port}`;
  });

  afterAll(async () => {
    await mockApi.close();
  });

  it("health() returns API status", async () => {
    const client = new FirmSwapClient({ apiUrl, chainId: TEST_CHAIN_ID });
    const health = await client.health();

    expect(health.status).toBe("ok");
    expect(health.supportedChains).toEqual([TEST_CHAIN_ID]);
  });

  it("getQuote() returns a quote from the API", async () => {
    const client = new FirmSwapClient({ apiUrl, chainId: TEST_CHAIN_ID });

    const quote = await client.getQuote({
      inputToken: "0xcccc000000000000000000000000000000000003",
      outputToken: "0xdddd000000000000000000000000000000000004",
      orderType: "EXACT_OUTPUT",
      amount: "200000000",
      userAddress: "0xbbbb000000000000000000000000000000000002",
      originChainId: 100,
      destinationChainId: 100,
      depositMode: DepositMode.ADDRESS,
    });

    expect(quote.quote.outputAmount).toBe("200000000");
    expect(quote.quote.inputAmount).toBe("1148000000000000000000");
    expect(quote.solverSignature).toBeDefined();
    expect(quote.depositAddress).toBe(
      "0xdead000000000000000000000000000000000099",
    );
  });

  it("getQuote() throws FirmSwapError on bad request", async () => {
    const client = new FirmSwapClient({ apiUrl, chainId: TEST_CHAIN_ID });

    await expect(
      client.getQuote({
        inputToken: "",
        outputToken: "",
        orderType: "EXACT_OUTPUT",
        amount: "",
        userAddress: "",
        originChainId: 100,
        destinationChainId: 100,
        depositMode: DepositMode.CONTRACT,
      }),
    ).rejects.toThrow(FirmSwapError);
  });

  it("getOrderStatusViaApi() returns order data", async () => {
    const client = new FirmSwapClient({ apiUrl, chainId: TEST_CHAIN_ID });
    const orderId = "0x" + "aa".repeat(32);

    const status = await client.getOrderStatusViaApi(orderId);

    expect(status.state).toBe("DEPOSITED");
    expect(status.outputAmount).toBe("200000000");
  });

  it("listSolvers() returns active solvers", async () => {
    const client = new FirmSwapClient({ apiUrl, chainId: TEST_CHAIN_ID });
    const solvers = await client.listSolvers();

    expect(solvers).toHaveLength(1);
    expect(solvers[0].name).toBe("TestSolver");
  });

  it("getDepositAddress() returns address from response", async () => {
    const client = new FirmSwapClient({ apiUrl, chainId: TEST_CHAIN_ID });

    const addr = await client.getDepositAddress(mockQuoteResponse);
    expect(addr).toBe("0xdead000000000000000000000000000000000099");
  });

  it("throws when on-chain operations used without config", async () => {
    const client = new FirmSwapClient({ apiUrl, chainId: TEST_CHAIN_ID });

    await expect(
      client.getOrderStatus("0x" + "aa".repeat(32) as `0x${string}`),
    ).rejects.toThrow("On-chain operations require");
  });
});
