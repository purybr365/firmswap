import type { ICexAdapter } from "./interface.js";
import type { PriceData } from "../types.js";

/**
 * Binance CEX adapter.
 *
 * In production, this would connect to Binance's REST/WebSocket API
 * for real-time orderbook data. This reference implementation uses
 * a simple REST poll approach.
 */
export class BinanceAdapter implements ICexAdapter {
  readonly name = "Binance";

  private readonly pairMap: Record<string, string> = {
    "BRLA/USDC": "BRLAUSDC",
    "BRLA/USDT": "BRLAUSDT",
  };

  private cachedPrices: Map<string, PriceData> = new Map();
  private cacheMaxAgeMs = 5_000;

  getSupportedPairs(): string[] {
    return Object.keys(this.pairMap);
  }

  async getPrice(pair: string): Promise<PriceData> {
    const cached = this.cachedPrices.get(pair);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAgeMs) {
      return cached;
    }

    const symbol = this.pairMap[pair];
    if (!symbol) {
      throw new Error(`Unsupported pair: ${pair}`);
    }

    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`,
    );
    if (!res.ok) {
      throw new Error(`Binance API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      bidPrice: string;
      askPrice: string;
    };

    const bid = parseFloat(data.bidPrice);
    const ask = parseFloat(data.askPrice);

    const priceData: PriceData = {
      pair,
      bid,
      ask,
      midPrice: (bid + ask) / 2,
      timestamp: Date.now(),
    };

    this.cachedPrices.set(pair, priceData);
    return priceData;
  }
}
