import type { ICexAdapter } from "./cex/interface.js";
import type { SolverQuoteRequest } from "./types.js";
import { config } from "./config.js";

export interface QuoteResult {
  inputAmount: bigint;
  outputAmount: bigint;
  orderType: number; // 0 = EXACT_INPUT, 1 = EXACT_OUTPUT
}

/**
 * Quote engine that prices orders using CEX price feeds + configurable spread.
 *
 * For BRLA/USDC pair:
 * - EXACT_OUTPUT: User wants X USDC → solver quotes Y BRLA needed
 * - EXACT_INPUT: User sends Y BRLA → solver quotes X USDC they'll receive
 */
export class Quoter {
  constructor(
    private cex: ICexAdapter,
    private spreadBps: number = config.spreadBps,
  ) {}

  /**
   * Generate a quote for the given request.
   * Returns null if the pair is unsupported or the order is too large.
   */
  async quote(request: SolverQuoteRequest): Promise<QuoteResult | null> {
    const pair = this.resolvePair(request.inputToken, request.outputToken);
    if (!pair) return null;

    // Guard against extreme amounts that would overflow or produce nonsensical results.
    // Float arithmetic is used for pricing; precision loss is acceptable within spread.
    // Reject amounts > 2^128 as unreasonable (no real token has this supply).
    if (BigInt(request.amount) > 2n ** 128n) {
      return null;
    }

    const price = await this.cex.getPrice(pair.pair);

    const inputDecimals = pair.inputDecimals;
    const outputDecimals = pair.outputDecimals;

    if (request.orderType === "EXACT_OUTPUT") {
      // User wants `amount` of output token. How much input do they need?
      const outputAmount = BigInt(request.amount);

      // Convert output to float, divide by price, apply spread (solver charges more)
      const outputFloat =
        Number(outputAmount) / 10 ** outputDecimals;

      // Solver sells output token → uses ask price (user buys at ask)
      // Price = how much 1 input token is worth in output token
      // If pair is "BRLA/USDC", price = USDC per BRLA
      // inputNeeded = outputWanted / pricePerInputUnit
      const spreadMultiplier = 1 + this.spreadBps / 10_000;
      let inputFloat: number;

      if (pair.inverted) {
        // pair is "BRLA/USDC" and user's input is USDC, output is BRLA
        // price = USDC per BRLA → inputNeeded = outputWanted * price * spread
        inputFloat = outputFloat * price.ask * spreadMultiplier;
      } else {
        // pair is "BRLA/USDC" and user's input is BRLA, output is USDC
        // price = USDC per BRLA → inputNeeded = outputWanted / bid / (1 - spread)
        inputFloat = outputFloat / price.bid * spreadMultiplier;
      }

      // Check order size limit
      const usdValue = pair.inverted
        ? outputFloat * price.midPrice
        : outputFloat;
      if (usdValue > config.maxOrderSizeUsd) return null;

      const inputAmount = BigInt(
        Math.ceil(inputFloat * 10 ** inputDecimals),
      );

      return {
        inputAmount,
        outputAmount,
        orderType: 1, // EXACT_OUTPUT
      };
    } else {
      // EXACT_INPUT: User provides `amount` of input. How much output?
      const inputAmount = BigInt(request.amount);

      const inputFloat =
        Number(inputAmount) / 10 ** inputDecimals;

      // Solver buys input token → uses bid price
      const spreadMultiplier = 1 - this.spreadBps / 10_000;
      let outputFloat: number;

      if (pair.inverted) {
        // pair is "BRLA/USDC" and user's input is USDC, output is BRLA
        // price = USDC per BRLA → outputAmount = inputAmount / price * (1 - spread)
        outputFloat = (inputFloat / price.bid) * spreadMultiplier;
      } else {
        // pair is "BRLA/USDC" and user's input is BRLA, output is USDC
        // price = USDC per BRLA → outputAmount = inputAmount * bid * (1 - spread)
        outputFloat = inputFloat * price.bid * spreadMultiplier;
      }

      // Check order size limit
      const usdValue = pair.inverted
        ? inputFloat
        : outputFloat;
      if (usdValue > config.maxOrderSizeUsd) return null;

      const outputAmount = BigInt(
        Math.floor(outputFloat * 10 ** outputDecimals),
      );

      // Minimum order check (1 USDC = 1e6)
      if (outputAmount < 1_000_000n) return null;

      return {
        inputAmount,
        outputAmount,
        orderType: 0, // EXACT_INPUT
      };
    }
  }

  /**
   * Resolve a token pair from input/output addresses.
   * Returns the CEX pair name and whether it's inverted.
   */
  private resolvePair(
    inputToken: string,
    outputToken: string,
  ): { pair: string; inverted: boolean; inputDecimals: number; outputDecimals: number } | null {
    const input = inputToken.toLowerCase();
    const output = outputToken.toLowerCase();
    const brla = config.brlaAddress.toLowerCase();
    const usdc = config.usdcAddress.toLowerCase();

    if (input === brla && output === usdc) {
      return {
        pair: "BRLA/USDC",
        inverted: false,
        inputDecimals: config.brlaDecimals,
        outputDecimals: config.usdcDecimals,
      };
    }

    if (input === usdc && output === brla) {
      return {
        pair: "BRLA/USDC",
        inverted: true,
        inputDecimals: config.usdcDecimals,
        outputDecimals: config.brlaDecimals,
      };
    }

    return null;
  }
}
