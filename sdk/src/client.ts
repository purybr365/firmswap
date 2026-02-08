import { type Address, type Hex, type WalletClient, type PublicClient, encodeFunctionData } from "viem";
import { firmSwapAbi } from "./abi/index.js";
import { erc20Abi } from "./abi/index.js";
import { FirmSwapContract, createFirmSwapPublicClient } from "./contracts.js";
import {
  type FirmSwapConfig,
  type QuoteRequest,
  type QuoteResponse,
  type OrderStatus,
  type FirmSwapQuote,
  type SerializedQuote,
  DepositMode,
  OrderState,
} from "./types.js";

/**
 * High-level FirmSwap SDK client.
 *
 * Provides a simple API for:
 * - Getting quotes from the FirmSwap API
 * - Depositing tokens (Contract Deposit)
 * - Checking order status
 * - Computing deposit addresses (Address Deposit)
 */
export class FirmSwapClient {
  private apiUrl: string;
  private chainId: number;
  private timeoutMs: number;
  private contract: FirmSwapContract | null = null;
  private publicClient: PublicClient | null = null;

  constructor(private config: FirmSwapConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.chainId = config.chainId;
    this.timeoutMs = config.timeoutMs ?? 10_000;

    // Warn about insecure HTTP in production
    if (
      config.apiUrl.startsWith("http://") &&
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "production"
    ) {
      console.warn(
        "[FirmSwap SDK] WARNING: Using HTTP API URL in production. HTTPS is strongly recommended to prevent MITM attacks.",
      );
    }

    if (config.rpcUrl && config.firmSwapAddress) {
      this.publicClient = createFirmSwapPublicClient(
        config.rpcUrl,
        config.chainId,
      );
      this.contract = new FirmSwapContract(
        this.publicClient,
        config.firmSwapAddress,
      );
    }
  }

  // ═══════════════════════════════════════════════════
  //  Quote Operations (API)
  // ═══════════════════════════════════════════════════

  /**
   * Get a quote from the FirmSwap API aggregator.
   *
   * @example
   * ```ts
   * const quote = await client.getQuote({
   *   inputToken: "0xBRLA...",
   *   outputToken: "0xUSDC...",
   *   orderType: "EXACT_OUTPUT",
   *   amount: "200000000",        // 200 USDC (6 decimals)
   *   userAddress: "0xUser...",
   *   originChainId: 100,
   *   destinationChainId: 100,
   *   depositMode: DepositMode.ADDRESS,
   * });
   * ```
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const res = await this.fetch(`/v1/${this.chainId}/quote`, {
      method: "POST",
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new FirmSwapError(
        `Quote failed: ${(err as any).error || res.statusText}`,
        res.status,
      );
    }

    return (await res.json()) as QuoteResponse;
  }

  // ═══════════════════════════════════════════════════
  //  Order Operations (On-chain)
  // ═══════════════════════════════════════════════════

  /**
   * Deposit tokens into the FirmSwap contract (Contract Deposit).
   *
   * This approves the token transfer and calls deposit() in a single flow.
   * Returns the transaction hash.
   *
   * Works with any viem WalletClient (EOA or smart account). For smart accounts
   * that support batching (ERC-4337), prefer {@link buildDepositCalls} instead
   * to combine approve + deposit into a single UserOperation.
   *
   * @example
   * ```ts
   * const txHash = await client.deposit(walletClient, quoteResponse);
   * ```
   */
  async deposit(
    walletClient: WalletClient,
    quoteResponse: QuoteResponse,
  ): Promise<Hex> {
    this.requireContract();

    const quote = deserializeQuote(quoteResponse.quote);
    const firmSwapAddress = this.config.firmSwapAddress!;
    const account = walletClient.account!;

    // Safety check: verify quote.user matches the wallet address
    if (quote.user.toLowerCase() !== account.address.toLowerCase()) {
      throw new FirmSwapError(
        `Quote user (${quote.user}) does not match wallet address (${account.address}). Aborting deposit to prevent fund loss.`,
        0,
      );
    }

    // Check and set allowance
    const allowance = await this.contract!.getTokenAllowance(
      quote.inputToken,
      account.address,
      firmSwapAddress,
    );

    if (allowance < quote.inputAmount) {
      const approveTx = await walletClient.writeContract({
        address: quote.inputToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [firmSwapAddress, quote.inputAmount],
        chain: walletClient.chain!,
        account,
      });

      await this.publicClient!.waitForTransactionReceipt({ hash: approveTx });
    }

    // Call deposit()
    const tx = await walletClient.writeContract({
      address: firmSwapAddress,
      abi: firmSwapAbi,
      functionName: "deposit",
      args: [
        {
          solver: quote.solver,
          user: quote.user,
          inputToken: quote.inputToken,
          inputAmount: quote.inputAmount,
          outputToken: quote.outputToken,
          outputAmount: quote.outputAmount,
          orderType: quote.orderType,
          outputChainId: quote.outputChainId,
          depositDeadline: quote.depositDeadline,
          fillDeadline: quote.fillDeadline,
          nonce: quote.nonce,
        },
        quoteResponse.solverSignature as Hex,
      ],
      chain: walletClient.chain!,
      account,
    });

    return tx;
  }

  /**
   * Build the calls needed for a Contract Deposit, without executing them.
   *
   * Returns an array of `{ to, data, value }` objects that can be passed to a
   * smart account's `executeBatch()`, an ERC-4337 bundler, or any multicall
   * contract. This allows combining approve + deposit into a single atomic
   * transaction (UserOperation).
   *
   * For EOA wallets, use {@link deposit} instead which executes directly.
   *
   * @example
   * ```ts
   * const calls = await client.buildDepositCalls(quoteResponse);
   * // Pass to smart account bundler:
   * await smartAccount.executeBatch(calls);
   * ```
   */
  async buildDepositCalls(
    quoteResponse: QuoteResponse,
    userAddress?: Address,
  ): Promise<Array<{ to: Address; data: Hex; value: bigint }>> {
    this.requireContract();

    const quote = deserializeQuote(quoteResponse.quote);
    const firmSwapAddress = this.config.firmSwapAddress!;
    const calls: Array<{ to: Address; data: Hex; value: bigint }> = [];

    // Check current allowance (if userAddress provided)
    if (userAddress) {
      const allowance = await this.contract!.getTokenAllowance(
        quote.inputToken,
        userAddress,
        firmSwapAddress,
      );

      if (allowance < quote.inputAmount) {
        calls.push({
          to: quote.inputToken,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [firmSwapAddress, quote.inputAmount],
          }),
          value: 0n,
        });
      }
    } else {
      // No userAddress — always include approve call
      calls.push({
        to: quote.inputToken,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [firmSwapAddress, quote.inputAmount],
        }),
        value: 0n,
      });
    }

    // Encode deposit() call
    calls.push({
      to: firmSwapAddress,
      data: encodeFunctionData({
        abi: firmSwapAbi,
        functionName: "deposit",
        args: [
          {
            solver: quote.solver,
            user: quote.user,
            inputToken: quote.inputToken,
            inputAmount: quote.inputAmount,
            outputToken: quote.outputToken,
            outputAmount: quote.outputAmount,
            orderType: quote.orderType,
            outputChainId: quote.outputChainId,
            depositDeadline: quote.depositDeadline,
            fillDeadline: quote.fillDeadline,
            nonce: quote.nonce,
          },
          quoteResponse.solverSignature as Hex,
        ],
      }),
      value: 0n,
    });

    return calls;
  }

  /**
   * Get the on-chain status of an order.
   */
  async getOrderStatus(orderId: Hex): Promise<OrderStatus> {
    this.requireContract();

    const order = await this.contract!.getOrder(orderId);

    const stateNames = ["NONE", "DEPOSITED", "SETTLED", "REFUNDED"] as const;

    return {
      orderId,
      state: stateNames[order.state] ?? "NONE",
      user: order.user,
      solver: order.solver,
      inputToken: order.inputToken,
      inputAmount: order.inputAmount.toString(),
      outputToken: order.outputToken,
      outputAmount: order.outputAmount.toString(),
      fillDeadline: order.fillDeadline,
    };
  }

  /**
   * Get the on-chain status of an order via the API.
   * Does not require an RPC connection.
   */
  async getOrderStatusViaApi(orderId: string): Promise<OrderStatus> {
    const res = await this.fetch(`/v1/${this.chainId}/order/${orderId}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new FirmSwapError(
        `Order lookup failed: ${(err as any).error || res.statusText}`,
        res.status,
      );
    }

    return (await res.json()) as OrderStatus;
  }

  /**
   * Compute the deterministic deposit address for an Address Deposit order.
   * Requires on-chain contract access.
   */
  async computeDepositAddress(
    quoteResponse: QuoteResponse,
  ): Promise<Address> {
    this.requireContract();

    const quote = deserializeQuote(quoteResponse.quote);
    return this.contract!.computeDepositAddress(
      quote,
      quoteResponse.solverSignature as Hex,
    );
  }

  /**
   * Get the deposit address from a quote response.
   * Always verifies on-chain when RPC is available to prevent API tampering.
   */
  async getDepositAddress(quoteResponse: QuoteResponse): Promise<Address> {
    if (this.contract) {
      // Always verify on-chain when possible
      const onChainAddr = await this.computeDepositAddress(quoteResponse);
      if (
        quoteResponse.depositAddress &&
        quoteResponse.depositAddress.toLowerCase() !== onChainAddr.toLowerCase()
      ) {
        throw new FirmSwapError(
          "API-provided deposit address does not match on-chain computation. Possible API tampering.",
          0,
        );
      }
      return onChainAddr;
    }
    // Fallback to API-provided when no RPC (less safe)
    if (quoteResponse.depositAddress) {
      return quoteResponse.depositAddress as Address;
    }
    throw new FirmSwapError(
      "No RPC client available and no deposit address in API response",
      0,
    );
  }

  // ═══════════════════════════════════════════════════
  //  Solver Info (On-chain)
  // ═══════════════════════════════════════════════════

  /** Get solver's available bond */
  async getSolverBond(solver: Address): Promise<bigint> {
    this.requireContract();
    return this.contract!.getAvailableBond(solver);
  }

  /** Check if a solver is registered */
  async isSolverRegistered(solver: Address): Promise<boolean> {
    this.requireContract();
    const info = await this.contract!.getSolverInfo(solver);
    return info.registered;
  }

  // ═══════════════════════════════════════════════════
  //  Utility
  // ═══════════════════════════════════════════════════

  /** List active solvers from the API */
  async listSolvers(): Promise<Array<{ address: string; name: string }>> {
    const res = await this.fetch(`/v1/${this.chainId}/solvers`);
    if (!res.ok) {
      throw new FirmSwapError("Failed to list solvers", res.status);
    }
    return (await res.json()) as Array<{ address: string; name: string }>;
  }

  /** Check API health */
  async health(): Promise<{ status: string; supportedChains: number[] }> {
    const res = await this.fetch("/health");
    return (await res.json()) as { status: string; supportedChains: number[] };
  }

  // ═══════════════════════════════════════════════════
  //  Private
  // ═══════════════════════════════════════════════════

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireContract(): void {
    if (!this.contract) {
      throw new FirmSwapError(
        "On-chain operations require rpcUrl and firmSwapAddress in config",
        0,
      );
    }
  }
}

// ═══════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════

/** Convert a serialized (JSON) quote to the on-chain format */
export function deserializeQuote(sq: SerializedQuote): FirmSwapQuote {
  return {
    solver: sq.solver as Address,
    user: sq.user as Address,
    inputToken: sq.inputToken as Address,
    inputAmount: BigInt(sq.inputAmount),
    outputToken: sq.outputToken as Address,
    outputAmount: BigInt(sq.outputAmount),
    orderType: sq.orderType,
    outputChainId: BigInt(sq.outputChainId),
    depositDeadline: sq.depositDeadline,
    fillDeadline: sq.fillDeadline,
    nonce: BigInt(sq.nonce),
  };
}

/** Convert an on-chain quote to the JSON-serializable format */
export function serializeQuote(q: FirmSwapQuote): SerializedQuote {
  return {
    solver: q.solver,
    user: q.user,
    inputToken: q.inputToken,
    inputAmount: q.inputAmount.toString(),
    outputToken: q.outputToken,
    outputAmount: q.outputAmount.toString(),
    orderType: q.orderType,
    outputChainId: Number(q.outputChainId),
    depositDeadline: q.depositDeadline,
    fillDeadline: q.fillDeadline,
    nonce: q.nonce.toString(),
  };
}

export class FirmSwapError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "FirmSwapError";
  }
}
