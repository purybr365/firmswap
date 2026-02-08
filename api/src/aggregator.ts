import { config } from "./config.js";
import type { ChainContext } from "./chain.js";
import { firmSwapAbi } from "./chain.js";
import type { SolverRegistry } from "./solverRegistry.js";
import type {
  QuoteRequest,
  QuoteResponse,
  SolverQuoteRequest,
  SolverQuoteResponse,
  SerializedQuote,
  AlternativeQuote,
  OrderType,
} from "./types.js";
import type { Address } from "viem";
import { verifyQuoteSignature } from "./eip712.js";
import { validateSolverUrlAtRequestTime } from "./urlValidator.js";

/**
 * Quote Aggregator
 *
 * 1. Receives a quote request from a user/integrator
 * 2. Broadcasts to all registered solvers in parallel
 * 3. Collects responses (with timeout)
 * 4. Ranks by best price
 * 5. Returns the best quote + alternatives
 */
/** Signature verification function type (injectable for testing). */
export type VerifySignatureFn = (
  quote: SerializedQuote,
  signature: string,
  firmSwapAddress: Address,
  chainId: number,
) => Promise<boolean>;

export class Aggregator {
  private verifySignature: VerifySignatureFn;

  constructor(
    private registry: SolverRegistry,
    private chainCtx: ChainContext,
    private logger?: { warn: (obj: object, msg: string) => void },
    verifySignatureFn?: VerifySignatureFn,
  ) {
    this.verifySignature = verifySignatureFn ?? verifyQuoteSignature;
  }

  async getQuote(request: QuoteRequest): Promise<QuoteResponse | null> {
    let solvers = this.registry.getActiveSolvers();
    if (solvers.length === 0) return null;

    // Cap fan-out to prevent DoS amplification
    if (solvers.length > config.maxQuoteFanOut) {
      solvers = solvers.slice(0, config.maxQuoteFanOut);
    }

    const now = Math.floor(Date.now() / 1000);
    const depositDeadline = now + (request.depositWindow ?? config.defaultDepositWindow);
    const fillDeadline = depositDeadline + config.defaultFillWindow;

    // Build the request to send to each solver
    const solverRequest: SolverQuoteRequest = {
      inputToken: request.inputToken,
      outputToken: request.outputToken,
      orderType: request.orderType,
      amount: request.amount,
      userAddress: request.userAddress,
      chainId: request.originChainId,
      depositDeadline,
      fillDeadline,
    };

    // Broadcast to all solvers in parallel with timeout
    const responses = await Promise.allSettled(
      solvers.map((solver) =>
        this.fetchSolverQuote(solver.endpointUrl, solverRequest),
      ),
    );

    // Collect successful responses, validate against original request, log failures
    const quotes: SolverQuoteResponse[] = [];
    for (let i = 0; i < responses.length; i++) {
      const result = responses[i];
      if (result.status === "fulfilled" && result.value) {
        const q = result.value.quote;
        // Validate solver response matches the original request
        const userMatch = q.user.toLowerCase() === request.userAddress.toLowerCase();
        const inputMatch = q.inputToken.toLowerCase() === request.inputToken.toLowerCase();
        const outputMatch = q.outputToken.toLowerCase() === request.outputToken.toLowerCase();
        const deadlineValid = q.depositDeadline > now;
        const amountValid = BigInt(q.outputAmount) > 0n && BigInt(q.inputAmount) > 0n;
        if (!userMatch || !inputMatch || !outputMatch || !deadlineValid || !amountValid) {
          this.logger?.warn(
            { solver: solvers[i].address, userMatch, inputMatch, outputMatch, deadlineValid, amountValid },
            "Solver returned quote that does not match request — discarded",
          );
          continue;
        }
        quotes.push(result.value);
      } else if (result.status === "rejected") {
        this.logger?.warn(
          { solver: solvers[i].address, error: String(result.reason) },
          "Solver quote failed",
        );
      }
    }

    if (quotes.length === 0) return null;

    // Verify EIP-712 signatures — always required
    const verified: SolverQuoteResponse[] = [];
    if (!this.chainCtx.firmSwapAddress) {
      this.logger?.warn(
        {},
        "firmSwapAddress not configured — cannot verify signatures, rejecting all quotes",
      );
      return null;
    }

    const sigChecks = await Promise.allSettled(
      quotes.map((q) =>
        this.verifySignature(
          q.quote,
          q.signature,
          this.chainCtx.firmSwapAddress!,
          this.chainCtx.chainId,
        ),
      ),
    );
    for (let i = 0; i < quotes.length; i++) {
      const check = sigChecks[i];
      if (check.status === "fulfilled" && check.value) {
        verified.push(quotes[i]);
      } else {
        this.logger?.warn(
          { solver: quotes[i].quote.solver, reason: check.status === "rejected" ? String(check.reason) : "invalid signature" },
          "Solver quote signature validation failed",
        );
      }
    }

    if (verified.length === 0) return null;

    // Rank by best price
    const ranked = this.rankQuotes(verified, request.orderType);

    const best = ranked[0];
    const alternatives = ranked.slice(1);

    // Compute deposit address for ADDRESS mode
    let depositAddress: string | undefined;
    if (request.depositMode === "ADDRESS" && this.chainCtx.firmSwapAddress) {
      depositAddress = await this.computeDepositAddress(
        best.quote,
        best.signature,
      );
    }

    // Build alternative quotes WITHOUT signatures (prevents quote farming / MEV exploitation)
    const alternativeQuotes: AlternativeQuote[] = [];
    for (const alt of alternatives) {
      alternativeQuotes.push({
        quote: alt.quote,
        solverSignature: "", // stripped — only best quote includes its signature
        depositAddress: undefined,
      });
    }

    return {
      quote: best.quote,
      solverSignature: best.signature,
      depositAddress,
      alternativeQuotes,
    };
  }

  /**
   * Rank quotes by best price for the user.
   *
   * EXACT_INPUT: User provides fixed input → rank by highest outputAmount (more is better)
   * EXACT_OUTPUT: User wants fixed output → rank by lowest inputAmount (less is better)
   */
  private rankQuotes(
    quotes: SolverQuoteResponse[],
    orderType: QuoteRequest["orderType"],
  ): SolverQuoteResponse[] {
    return [...quotes].sort((a, b) => {
      if (orderType === "EXACT_INPUT") {
        // Higher output is better
        return BigInt(b.quote.outputAmount) > BigInt(a.quote.outputAmount) ? 1 : -1;
      } else {
        // Lower input is better
        return BigInt(a.quote.inputAmount) > BigInt(b.quote.inputAmount) ? 1 : -1;
      }
    });
  }

  private async fetchSolverQuote(
    endpointUrl: string,
    request: SolverQuoteRequest,
  ): Promise<SolverQuoteResponse> {
    // Re-validate DNS at request time to prevent DNS rebinding attacks
    const dnsCheck = await validateSolverUrlAtRequestTime(endpointUrl, config.allowPrivateIps);
    if (!dnsCheck.ok) {
      throw new Error(`DNS rebinding blocked: ${dnsCheck.error}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.quoteTimeoutMs);

    try {
      const res = await fetch(`${endpointUrl}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Solver returned ${res.status}`);
      }

      return (await res.json()) as SolverQuoteResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async computeDepositAddress(
    quote: SerializedQuote,
    signature: string,
  ): Promise<string | undefined> {
    if (!this.chainCtx.firmSwapAddress) return undefined;

    try {
      const result = await this.chainCtx.publicClient.readContract({
        address: this.chainCtx.firmSwapAddress,
        abi: firmSwapAbi,
        functionName: "computeDepositAddress",
        args: [
          {
            solver: quote.solver as Address,
            user: quote.user as Address,
            inputToken: quote.inputToken as Address,
            inputAmount: BigInt(quote.inputAmount),
            outputToken: quote.outputToken as Address,
            outputAmount: BigInt(quote.outputAmount),
            orderType: quote.orderType,
            outputChainId: BigInt(quote.outputChainId),
            depositDeadline: quote.depositDeadline,
            fillDeadline: quote.fillDeadline,
            nonce: BigInt(quote.nonce),
          },
          signature as `0x${string}`,
        ],
      });
      return result as string;
    } catch {
      return undefined;
    }
  }
}
