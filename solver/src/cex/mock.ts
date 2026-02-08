import type { ICexAdapter } from "./interface.js";
import type { PriceData } from "../types.js";

/**
 * Mock CEX adapter for testing and development.
 * Returns configurable static prices.
 */
export class MockCexAdapter implements ICexAdapter {
  readonly name = "MockCEX";

  private prices: Map<string, { bid: number; ask: number }> = new Map([
    // 1 BRLA ≈ 0.1739 USDC (BRL/USD ~5.75)
    ["BRLA/USDC", { bid: 0.1738, ask: 0.174 }],
  ]);

  getSupportedPairs(): string[] {
    return [...this.prices.keys()];
  }

  setPrice(pair: string, bid: number, ask: number): void {
    this.prices.set(pair, { bid, ask });
  }

  async getPrice(pair: string): Promise<PriceData> {
    const price = this.prices.get(pair);
    if (!price) {
      throw new Error(`Unsupported pair: ${pair}`);
    }

    return {
      pair,
      bid: price.bid,
      ask: price.ask,
      midPrice: (price.bid + price.ask) / 2,
      timestamp: Date.now(),
    };
  }
}
