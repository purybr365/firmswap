import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import fastifyMetrics from "fastify-metrics";
// CJS interop: under NodeNext, fastify-metrics resolves as namespace with .default
const metricsPlugin = (fastifyMetrics as any).default ?? fastifyMetrics;
import type { Address } from "viem";

import { config, type ChainConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { createChainContext, createChainContextMap, firmSwapAbi, type ChainContext } from "./chain.js";
import { SolverRegistry } from "./solverRegistry.js";
import { Aggregator, type VerifySignatureFn } from "./aggregator.js";
import type { QuoteRequest, QuoteResponse, OrderStatusResponse } from "./types.js";
import { verifySolverAuth, buildRegistrationMessage, buildUnregistrationMessage } from "./auth.js";
import { isValidAddress, isValidAmount, isValidOrderId, isValidUrl } from "./validation.js";
import { validateSolverUrl } from "./urlValidator.js";

interface ChainServices {
  registry: SolverRegistry;
  aggregator: Aggregator;
  ctx: ChainContext;
}

export interface BuildServerOptions {
  /** SQLite path override (":memory:" for tests). Defaults to config.dbPath. */
  dbPath?: string;
  /** Override global rate limit max (set high in tests). */
  rateLimitMax?: number;
  /** Override chain configs (for tests). */
  chains?: ChainConfig[];
  /** Override signature verification function (for tests). */
  verifySignatureFn?: VerifySignatureFn;
}

export async function buildServer(opts?: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // ═══════════════════════════════════════════════════
  //  Plugins
  // ═══════════════════════════════════════════════════

  await app.register(cors, { origin: config.corsOrigins });
  await app.register(websocket);

  await app.register(rateLimit, {
    max: opts?.rateLimitMax ?? config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    allowList: (req) => {
      return req.url === "/health" || req.url === "/metrics";
    },
  });

  await app.register(metricsPlugin, {
    defaultMetrics: { enabled: true },
    routeMetrics: { enabled: true },
    endpoint: "/metrics",
  });

  // Optional Basic auth for /metrics
  if (config.metricsAuth) {
    const [authUser, authPass] = config.metricsAuth.split(":");
    const expectedHeader = `Basic ${Buffer.from(`${authUser}:${authPass}`).toString("base64")}`;

    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/metrics") {
        const authHeader = request.headers.authorization;
        if (authHeader !== expectedHeader) {
          return reply.status(401).header("WWW-Authenticate", "Basic").send({ error: "Unauthorized" });
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════
  //  Application metrics
  // ═══════════════════════════════════════════════════

  const client = (app as any).metrics.client;

  const activeSolversGauge = new client.Gauge({
    name: "firmswap_active_solvers",
    help: "Number of currently active solvers",
    labelNames: ["chain_id"],
  });

  const quotesRequestedCounter = new client.Counter({
    name: "firmswap_quotes_requested_total",
    help: "Total number of quote requests",
    labelNames: ["chain_id"],
  });

  const quotesFailedCounter = new client.Counter({
    name: "firmswap_quotes_failed_total",
    help: "Total number of failed quote requests (no solver available)",
    labelNames: ["chain_id"],
  });

  const wsClientsGauge = new client.Gauge({
    name: "firmswap_ws_clients",
    help: "Number of connected WebSocket clients",
  });

  // ═══════════════════════════════════════════════════
  //  Database & Per-Chain Services
  // ═══════════════════════════════════════════════════

  const chains = opts?.chains ?? config.chains;
  const chainContextMap = createChainContextMap(chains);

  const db = createDatabase(opts?.dbPath);
  const chainServices = new Map<number, ChainServices>();

  for (const [chainId, ctx] of chainContextMap) {
    const registry = new SolverRegistry(db, ctx, config.minSolverBond, config.maxSolversPerChain);
    const aggregator = new Aggregator(registry, ctx, app.log, opts?.verifySignatureFn);
    chainServices.set(chainId, { registry, aggregator, ctx });

    // Update solver gauge on startup
    activeSolversGauge.set({ chain_id: String(chainId) }, registry.getActiveSolvers().length);
  }

  const supportedChainIds = [...chainServices.keys()];

  function getChainServices(chainId: number): ChainServices | null {
    return chainServices.get(chainId) ?? null;
  }

  app.addHook("onClose", () => {
    db.close();
  });

  // ═══════════════════════════════════════════════════
  //  Health
  // ═══════════════════════════════════════════════════

  app.get("/health", async () => {
    const activeSolvers: Record<string, number> = {};
    for (const [chainId, svc] of chainServices) {
      activeSolvers[String(chainId)] = svc.registry.getActiveSolvers().length;
    }

    return {
      status: "ok",
      supportedChains: supportedChainIds,
      uptime: process.uptime(),
      timestamp: Date.now(),
      activeSolvers,
      version: process.env.npm_package_version || "0.1.0",
    };
  });

  // ═══════════════════════════════════════════════════
  //  Chain validation decorator
  // ═══════════════════════════════════════════════════

  app.decorateRequest("chainServices", null);

  app.addHook("preHandler", async (request, reply) => {
    const chainIdParam = (request.params as any)?.chainId;
    if (chainIdParam !== undefined) {
      const chainId = parseInt(chainIdParam);
      const svc = getChainServices(chainId);
      if (!svc) {
        return reply.status(404).send({ error: `Chain ${chainIdParam} not supported` });
      }
      (request as any).chainServices = svc;
    }
  });

  // ═══════════════════════════════════════════════════
  //  Quote
  // ═══════════════════════════════════════════════════

  app.post<{ Body: QuoteRequest; Params: { chainId: string } }>("/v1/:chainId/quote", {
    config: { rateLimit: { max: 30, timeWindow: config.rateLimitWindowMs } },
  }, async (request, reply) => {
    const svc = (request as any).chainServices as ChainServices;
    quotesRequestedCounter.inc({ chain_id: (request.params as any).chainId });
    const body = request.body;

    // Validate required fields
    if (!body.inputToken || !body.outputToken || !body.amount || !body.userAddress) {
      return reply.status(400).send({ error: "Missing required fields" });
    }
    if (!isValidAddress(body.inputToken) || !isValidAddress(body.outputToken) || !isValidAddress(body.userAddress)) {
      return reply.status(400).send({ error: "Invalid address format" });
    }
    if (!isValidAmount(body.amount)) {
      return reply.status(400).send({ error: "Invalid amount" });
    }
    if (body.orderType !== "EXACT_INPUT" && body.orderType !== "EXACT_OUTPUT") {
      return reply.status(400).send({ error: "Invalid orderType" });
    }
    if (body.depositMode !== "CONTRACT" && body.depositMode !== "ADDRESS") {
      return reply.status(400).send({ error: "Invalid depositMode" });
    }
    // Validate originChainId matches the route chainId
    const routeChainId = parseInt(request.params.chainId);
    if (body.originChainId && body.originChainId !== routeChainId) {
      return reply.status(400).send({ error: `originChainId ${body.originChainId} does not match route chain ${routeChainId}` });
    }

    const result = await svc.aggregator.getQuote(body);

    if (!result) {
      quotesFailedCounter.inc({ chain_id: (request.params as any).chainId });
      return reply.status(503).send({ error: "No solvers available or all quotes failed" });
    }

    return result;
  });

  // ═══════════════════════════════════════════════════
  //  Order Status
  // ═══════════════════════════════════════════════════

  app.get<{ Params: { chainId: string; orderId: string } }>("/v1/:chainId/order/:orderId", {
    config: { rateLimit: { max: 60, timeWindow: config.rateLimitWindowMs } },
  }, async (request, reply) => {
    const svc = (request as any).chainServices as ChainServices;
    const { orderId } = request.params;

    if (!isValidOrderId(orderId)) {
      return reply.status(400).send({ error: "Invalid orderId format" });
    }

    if (!svc.ctx.firmSwapAddress) {
      return reply.status(503).send({ error: "FirmSwap address not configured" });
    }

    try {
      const result = await svc.ctx.publicClient.readContract({
        address: svc.ctx.firmSwapAddress,
        abi: firmSwapAbi,
        functionName: "orders",
        args: [orderId as `0x${string}`],
      });

      const [user, solver, inputToken, inputAmount, outputToken, outputAmount, outputChainId, fillDeadline, state] =
        result as [string, string, string, bigint, string, bigint, bigint, number, number];

      const stateNames = ["NONE", "DEPOSITED", "SETTLED", "REFUNDED"] as const;

      const response: OrderStatusResponse = {
        orderId,
        state: stateNames[state] ?? "NONE",
        user,
        solver,
        inputToken,
        inputAmount: inputAmount.toString(),
        outputToken,
        outputAmount: outputAmount.toString(),
        fillDeadline,
      };

      return response;
    } catch (err) {
      return reply.status(500).send({ error: "Failed to read order from chain" });
    }
  });

  // ═══════════════════════════════════════════════════
  //  Solver Registry
  // ═══════════════════════════════════════════════════

  app.post<{
    Body: { address: string; endpointUrl: string; name: string; signature: string; timestamp: number };
    Params: { chainId: string };
  }>("/v1/:chainId/solvers/register", {
    config: { rateLimit: { max: 5, timeWindow: config.rateLimitWindowMs } },
  }, async (request, reply) => {
    const svc = (request as any).chainServices as ChainServices;
    const { address, endpointUrl, name, signature, timestamp } = request.body;

    if (!address || !endpointUrl || !name || !signature || !timestamp) {
      return reply.status(400).send({ error: "Missing required fields (address, endpointUrl, name, signature, timestamp)" });
    }
    if (!isValidAddress(address)) {
      return reply.status(400).send({ error: "Invalid address format" });
    }
    if (!isValidUrl(endpointUrl)) {
      return reply.status(400).send({ error: "Invalid endpoint URL" });
    }

    // Verify signature proves ownership of the address
    const message = buildRegistrationMessage(address, endpointUrl, timestamp);
    const authResult = await verifySolverAuth(address, message, signature, timestamp);
    if (!authResult.ok) {
      return reply.status(401).send({ error: authResult.error });
    }

    // SSRF protection: validate the endpoint URL
    const urlCheck = await validateSolverUrl(endpointUrl, config.allowHttpSolverUrls, config.allowPrivateIps);
    if (!urlCheck.ok) {
      return reply.status(400).send({ error: `Invalid endpoint URL: ${urlCheck.error}` });
    }

    const result = await svc.registry.register(address as Address, endpointUrl, name);

    if (!result.ok) {
      return reply.status(400).send({ error: result.error });
    }

    activeSolversGauge.set(
      { chain_id: (request.params as any).chainId },
      svc.registry.getActiveSolvers().length,
    );
    return { status: "registered", address };
  });

  app.delete<{
    Body: { signature: string; timestamp: number };
    Params: { chainId: string; address: string };
  }>("/v1/:chainId/solvers/:address", {
    config: { rateLimit: { max: 10, timeWindow: config.rateLimitWindowMs } },
  }, async (request, reply) => {
    const svc = (request as any).chainServices as ChainServices;
    const { address } = request.params;

    const body = request.body ?? {} as any;
    if (!body.signature || !body.timestamp) {
      return reply.status(401).send({ error: "Signature and timestamp required" });
    }

    // Verify signature proves ownership
    const message = buildUnregistrationMessage(address, body.timestamp);
    const authResult = await verifySolverAuth(address, message, body.signature, body.timestamp);
    if (!authResult.ok) {
      return reply.status(401).send({ error: authResult.error });
    }

    const removed = svc.registry.unregister(address as Address);
    if (!removed) {
      return reply.status(404).send({ error: "Solver not found" });
    }
    activeSolversGauge.set(
      { chain_id: (request.params as any).chainId },
      svc.registry.getActiveSolvers().length,
    );
    return { status: "removed" };
  });

  app.get<{ Params: { chainId: string } }>("/v1/:chainId/solvers", {
    config: { rateLimit: { max: 60, timeWindow: config.rateLimitWindowMs } },
  }, async (request) => {
    const svc = (request as any).chainServices as ChainServices;
    return svc.registry.getActiveSolvers().map((s) => ({
      address: s.address,
      name: s.name,
      registeredAt: s.registeredAt,
    }));
  });

  // ═══════════════════════════════════════════════════
  //  WebSocket: Real-time order updates
  // ═══════════════════════════════════════════════════

  const MAX_WS_CLIENTS = 1000;
  const WS_PING_INTERVAL_MS = 30_000;
  const wsClients = new Set<import("ws").WebSocket>();
  const wsAlive = new WeakMap<import("ws").WebSocket, boolean>();

  app.get("/v1/ws", { websocket: true }, (socket) => {
    if (wsClients.size >= MAX_WS_CLIENTS) {
      socket.close(1013, "Too many connections");
      return;
    }

    wsClients.add(socket);
    wsAlive.set(socket, true);
    wsClientsGauge.set(wsClients.size);

    socket.on("pong", () => {
      wsAlive.set(socket, true);
    });

    socket.on("close", () => {
      wsClients.delete(socket);
      wsClientsGauge.set(wsClients.size);
    });

    socket.send(JSON.stringify({ type: "connected", supportedChains: supportedChainIds }));
  });

  // Heartbeat: ping every 30s, terminate unresponsive clients
  const wsPingInterval = setInterval(() => {
    for (const client of wsClients) {
      if (!wsAlive.get(client)) {
        client.terminate();
        wsClients.delete(client);
        wsClientsGauge.set(wsClients.size);
        continue;
      }
      wsAlive.set(client, false);
      client.ping();
    }
  }, WS_PING_INTERVAL_MS);

  // Poll for contract events per chain and broadcast to WS clients
  const pollIntervals: NodeJS.Timeout[] = [];

  for (const [chainId, svc] of chainServices) {
    if (!svc.ctx.firmSwapAddress) continue;

    let lastBlock = 0n;

    const pollEvents = async () => {
      try {
        const currentBlock = await svc.ctx.publicClient.getBlockNumber();
        if (lastBlock === 0n) {
          lastBlock = currentBlock;
          return;
        }
        if (currentBlock <= lastBlock) return;

        const fromBlock = lastBlock + 1n;
        const toBlock = currentBlock;
        lastBlock = currentBlock;

        // Fetch Deposited events
        const depositedLogs = await svc.ctx.publicClient.getLogs({
          address: svc.ctx.firmSwapAddress!,
          event: {
            type: "event",
            name: "Deposited",
            inputs: [
              { type: "bytes32", name: "orderId", indexed: true },
              { type: "address", name: "user", indexed: true },
              { type: "address", name: "solver", indexed: true },
              { type: "address", name: "inputToken" },
              { type: "uint256", name: "inputAmount" },
              { type: "address", name: "outputToken" },
              { type: "uint256", name: "outputAmount" },
              { type: "uint32", name: "fillDeadline" },
            ],
          },
          fromBlock,
          toBlock,
        });

        for (const log of depositedLogs) {
          const msg = JSON.stringify({
            type: "Deposited",
            chainId,
            orderId: log.args.orderId,
            user: log.args.user,
            solver: log.args.solver,
            inputToken: log.args.inputToken,
            inputAmount: log.args.inputAmount?.toString(),
            outputToken: log.args.outputToken,
            outputAmount: log.args.outputAmount?.toString(),
            fillDeadline: log.args.fillDeadline,
            blockNumber: Number(log.blockNumber),
          });
          for (const client of wsClients) {
            client.send(msg);
          }
        }

        // Fetch Settled events
        const settledLogs = await svc.ctx.publicClient.getLogs({
          address: svc.ctx.firmSwapAddress!,
          event: {
            type: "event",
            name: "Settled",
            inputs: [
              { type: "bytes32", name: "orderId", indexed: true },
              { type: "address", name: "user", indexed: true },
              { type: "address", name: "solver", indexed: true },
            ],
          },
          fromBlock,
          toBlock,
        });

        for (const log of settledLogs) {
          const msg = JSON.stringify({
            type: "Settled",
            chainId,
            orderId: log.args.orderId,
            user: log.args.user,
            solver: log.args.solver,
            blockNumber: Number(log.blockNumber),
          });
          for (const client of wsClients) {
            client.send(msg);
          }
        }

        // Fetch Refunded events
        const refundedLogs = await svc.ctx.publicClient.getLogs({
          address: svc.ctx.firmSwapAddress!,
          event: {
            type: "event",
            name: "Refunded",
            inputs: [
              { type: "bytes32", name: "orderId", indexed: true },
              { type: "address", name: "user", indexed: true },
              { type: "uint256", name: "inputAmount" },
              { type: "uint256", name: "bondSlashed" },
            ],
          },
          fromBlock,
          toBlock,
        });

        for (const log of refundedLogs) {
          const msg = JSON.stringify({
            type: "Refunded",
            chainId,
            orderId: log.args.orderId,
            user: log.args.user,
            inputAmount: log.args.inputAmount?.toString(),
            bondSlashed: log.args.bondSlashed?.toString(),
            blockNumber: Number(log.blockNumber),
          });
          for (const client of wsClients) {
            client.send(msg);
          }
        }
      } catch (err) {
        app.log.error(err, `Event polling error (chain ${chainId})`);
      }
    };

    // Poll every 5 seconds
    const interval = setInterval(pollEvents, 5000);
    pollIntervals.push(interval);
  }

  app.addHook("onClose", () => {
    clearInterval(wsPingInterval);
    for (const interval of pollIntervals) {
      clearInterval(interval);
    }
  });

  return app;
}
