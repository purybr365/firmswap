import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import { Quoter } from "./quoter.js";
import { Signer } from "./signer.js";
import { NonceManager } from "./nonceManager.js";
import type { ICexAdapter } from "./cex/interface.js";
import type { SolverQuoteRequest, SolverQuoteResponse, SerializedQuote } from "./types.js";
import type { Address, PublicClient } from "viem";

export interface SolverServerOptions {
  quoter: Quoter;
  signer: Signer;
  nonceManager: NonceManager;
  solverAddress: Address;
}

/**
 * Build the solver's HTTP server.
 *
 * Exposes a POST /quote endpoint that the FirmSwap API aggregator calls
 * to request a quote from this solver.
 */
export function buildSolverServer(options: SolverServerOptions): FastifyInstance {
  const { quoter, signer, nonceManager, solverAddress } = options;
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    status: "ok",
    solver: solverAddress,
    chainId: config.chainId,
  }));

  app.post("/quote", async (request, reply) => {
    const req = request.body as SolverQuoteRequest;

    // Validate required fields
    if (!req.inputToken || !req.outputToken || !req.amount || !req.userAddress) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    try {
      // Get pricing from quote engine
      const quoteResult = await quoter.quote(req);
      if (!quoteResult) {
        return reply
          .status(503)
          .send({ error: "Cannot quote this pair/amount" });
      }

      // Get next available nonce
      const nonce = nonceManager.getNextNonce();

      // Build the serialized quote
      const quote: SerializedQuote = {
        solver: solverAddress,
        user: req.userAddress,
        inputToken: req.inputToken,
        inputAmount: quoteResult.inputAmount.toString(),
        outputToken: req.outputToken,
        outputAmount: quoteResult.outputAmount.toString(),
        orderType: quoteResult.orderType,
        outputChainId: req.chainId,
        depositDeadline: req.depositDeadline,
        fillDeadline: req.fillDeadline,
        nonce: nonce.toString(),
      };

      // Sign the quote
      const signature = await signer.signQuote(quote);

      const response: SolverQuoteResponse = {
        quote,
        signature,
      };

      return response;
    } catch (err) {
      request.log.error(err, "Quote generation failed");
      return reply.status(500).send({ error: "Internal error" });
    }
  });

  return app;
}
