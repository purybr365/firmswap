import type { PublicClient, Address, Log } from "viem";
import type { OrderEvent } from "./types.js";
import { firmSwapAbi } from "./chain.js";

export type OrderEventHandler = (event: OrderEvent) => void | Promise<void>;

/**
 * On-chain event monitor.
 *
 * Polls for Deposited events on the FirmSwap contract
 * and notifies the filler when new orders are detected.
 */
export class Monitor {
  private lastBlock = 0n;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onDeposited: OrderEventHandler | null = null;
  private onSettled: ((orderId: `0x${string}`, blockNumber: bigint) => void) | null = null;

  constructor(
    private client: PublicClient,
    private firmSwapAddress: Address,
    private pollIntervalMs: number,
  ) {}

  /** Register handler for new Deposited events */
  onDepositedEvent(handler: OrderEventHandler): void {
    this.onDeposited = handler;
  }

  /** Register handler for Settled events (to update internal state) */
  onSettledEvent(handler: (orderId: `0x${string}`, blockNumber: bigint) => void): void {
    this.onSettled = handler;
  }

  async start(): Promise<void> {
    // Get current block to start from
    const block = await this.client.getBlockNumber();
    this.lastBlock = block;

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[Monitor] Poll error:", err);
      });
    }, this.pollIntervalMs);

    console.log(`[Monitor] Started polling from block ${this.lastBlock}`);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log("[Monitor] Stopped");
  }

  private async poll(): Promise<void> {
    const currentBlock = await this.client.getBlockNumber();
    if (currentBlock <= this.lastBlock) return;

    const fromBlock = this.lastBlock + 1n;
    const toBlock = currentBlock;

    // Fetch Deposited events
    if (this.onDeposited) {
      const depositedLogs = await this.client.getLogs({
        address: this.firmSwapAddress,
        event: {
          type: "event",
          name: "Deposited",
          inputs: [
            { name: "orderId", type: "bytes32", indexed: true },
            { name: "user", type: "address", indexed: true },
            { name: "solver", type: "address", indexed: true },
            { name: "inputToken", type: "address" },
            { name: "inputAmount", type: "uint256" },
            { name: "outputToken", type: "address" },
            { name: "outputAmount", type: "uint256" },
            { name: "fillDeadline", type: "uint32" },
          ],
        },
        fromBlock,
        toBlock,
      });

      for (const log of depositedLogs) {
        const event: OrderEvent = {
          orderId: log.args.orderId!,
          user: log.args.user!,
          solver: log.args.solver!,
          inputToken: log.args.inputToken!,
          inputAmount: log.args.inputAmount!,
          outputToken: log.args.outputToken!,
          outputAmount: log.args.outputAmount!,
          fillDeadline: Number(log.args.fillDeadline!),
          blockNumber: log.blockNumber!,
          transactionHash: log.transactionHash!,
        };

        await this.onDeposited(event);
      }
    }

    // Fetch Settled events
    if (this.onSettled) {
      const settledLogs = await this.client.getLogs({
        address: this.firmSwapAddress,
        event: {
          type: "event",
          name: "Settled",
          inputs: [
            { name: "orderId", type: "bytes32", indexed: true },
            { name: "user", type: "address", indexed: true },
            { name: "solver", type: "address", indexed: true },
          ],
        },
        fromBlock,
        toBlock,
      });

      for (const log of settledLogs) {
        this.onSettled(log.args.orderId!, log.blockNumber!);
      }
    }

    this.lastBlock = toBlock;
  }
}
