import {
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
  encodeFunctionData,
} from "viem";
import { firmSwapAbi } from "./chain.js";
import type { OrderEvent } from "./types.js";

/**
 * Auto-filler that settles orders when deposits are detected.
 *
 * Contract Deposit: Calls fill(orderId)
 * Address Deposit: Calls settle(quote, signature) — requires quote data
 *
 * This filler handles Contract Deposit only. Address Deposit settlement requires
 * the original quote + signature, which the solver must track from when it issued the quote.
 */
export class Filler {
  private pendingFills: Map<string, OrderEvent> = new Map();
  /** Simple mutex: chains fill operations to prevent concurrent tx submissions */
  private fillQueue: Promise<void> = Promise.resolve();

  constructor(
    private walletClient: WalletClient,
    private publicClient: PublicClient,
    private firmSwapAddress: Address,
    private solverAddress: Address,
  ) {}

  /**
   * Handle a new Deposited event.
   * If this order is for our solver, queue it for filling.
   */
  async onDeposited(event: OrderEvent): Promise<void> {
    // Only fill orders assigned to us
    if (event.solver.toLowerCase() !== this.solverAddress.toLowerCase()) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > event.fillDeadline) {
      console.log(
        `[Filler] Order ${event.orderId} already expired, skipping`,
      );
      return;
    }

    console.log(
      `[Filler] New order detected: ${event.orderId}`,
      `| ${event.inputAmount} input → ${event.outputAmount} output`,
      `| deadline: ${event.fillDeadline}`,
    );

    this.pendingFills.set(event.orderId, event);

    // Queue the fill to prevent concurrent tx submissions
    this.fillQueue = this.fillQueue.then(() => this.fill(event)).catch(() => {});
  }

  /**
   * Fill a Contract Deposit order by calling fill(orderId).
   *
   * Before filling, the solver must have approved the FirmSwap contract
   * to spend the output token (e.g., USDC).
   */
  private async fill(event: OrderEvent): Promise<void> {
    try {
      console.log(`[Filler] Filling order ${event.orderId}...`);

      // Check current output token balance
      const balance = await this.publicClient.readContract({
        address: event.outputToken,
        abi: [
          {
            name: "balanceOf",
            type: "function",
            stateMutability: "view",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "balanceOf",
        args: [this.solverAddress],
      }) as bigint;

      if (balance < event.outputAmount) {
        console.error(
          `[Filler] Insufficient balance for order ${event.orderId}:`,
          `need ${event.outputAmount}, have ${balance}`,
        );
        return;
      }

      // Check allowance
      const allowance = await this.publicClient.readContract({
        address: event.outputToken,
        abi: [
          {
            name: "allowance",
            type: "function",
            stateMutability: "view",
            inputs: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
            ],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "allowance",
        args: [this.solverAddress, this.firmSwapAddress],
      }) as bigint;

      if (allowance < event.outputAmount) {
        console.log(
          `[Filler] Approving FirmSwap to spend output token...`,
        );

        const approveTx = await this.walletClient.writeContract({
          address: event.outputToken,
          abi: [
            {
              name: "approve",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "spender", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              outputs: [{ name: "", type: "bool" }],
            },
          ],
          functionName: "approve",
          args: [this.firmSwapAddress, event.outputAmount * 10n], // approve extra
          chain: this.walletClient.chain!,
          account: this.walletClient.account!,
        });

        await this.publicClient.waitForTransactionReceipt({
          hash: approveTx,
        });
      }

      // Call fill(orderId)
      const fillTx = await this.walletClient.writeContract({
        address: this.firmSwapAddress,
        abi: firmSwapAbi,
        functionName: "fill",
        args: [event.orderId],
        chain: this.walletClient.chain!,
        account: this.walletClient.account!,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: fillTx,
      });

      console.log(
        `[Filler] Order ${event.orderId} filled in tx ${receipt.transactionHash}`,
        `(gas: ${receipt.gasUsed})`,
      );

      this.pendingFills.delete(event.orderId);
    } catch (err) {
      console.error(`[Filler] Failed to fill order ${event.orderId}:`, err);
    }
  }

  /** Get count of pending fills */
  get pendingCount(): number {
    return this.pendingFills.size;
  }
}
