import type { PriceData } from "../types.js";

/**
 * Abstract interface for CEX price feeds.
 *
 * Implementations should provide real-time price data
 * for token pairs used by the solver.
 */
export interface ICexAdapter {
  /** Human-readable name of the exchange */
  readonly name: string;

  /** Get current price for a trading pair (e.g., "BRLA/USDC") */
  getPrice(pair: string): Promise<PriceData>;

  /** Get all supported trading pairs */
  getSupportedPairs(): string[];

  /** Start streaming price updates (optional) */
  start?(): Promise<void>;

  /** Stop streaming and clean up */
  stop?(): Promise<void>;
}
