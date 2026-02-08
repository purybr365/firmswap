import type { Address, PublicClient } from "viem";
import { firmSwapAbi } from "./chain.js";

/**
 * Manages nonces for quote signing.
 *
 * Each quote needs a unique nonce to prevent replay attacks.
 * The nonce is stored in a bitmap on-chain (256 nonces per word).
 * We track the next available nonce locally and verify on-chain
 * before using it.
 */
export class NonceManager {
  private nextNonce = 0n;

  constructor(
    private client: PublicClient,
    private firmSwapAddress: Address,
    private solverAddress: Address,
  ) {}

  /** Initialize by finding the next unused nonce */
  async initialize(): Promise<void> {
    // Start from 0 and find first unused nonce
    // In production, you'd persist the last-used nonce to disk
    for (let i = 0n; i < 1000n; i++) {
      const used = await this.isNonceUsed(i);
      if (!used) {
        this.nextNonce = i;
        return;
      }
    }
    this.nextNonce = 1000n;
  }

  /** Get the next available nonce and advance the counter */
  getNextNonce(): bigint {
    const nonce = this.nextNonce;
    this.nextNonce++;
    return nonce;
  }

  /** Peek at the next nonce without consuming it */
  peekNextNonce(): bigint {
    return this.nextNonce;
  }

  /** Check if a nonce has been used on-chain */
  private async isNonceUsed(nonce: bigint): Promise<boolean> {
    try {
      const result = await this.client.readContract({
        address: this.firmSwapAddress,
        abi: firmSwapAbi,
        functionName: "isNonceUsed",
        args: [this.solverAddress, nonce],
      });
      return result as boolean;
    } catch {
      return false;
    }
  }
}
