import {
  type Address,
  type PublicClient,
  type WalletClient,
  type Hex,
  getContract,
  createPublicClient,
  http,
} from "viem";
import { gnosis, gnosisChiado, base, polygon, arbitrum, optimism } from "viem/chains";
import { firmSwapAbi, erc20Abi } from "./abi/index.js";
import type { FirmSwapQuote, OrderState } from "./types.js";

const chainMap: Record<number, import("viem").Chain> = {
  100: gnosis,
  10200: gnosisChiado,
  8453: base,
  137: polygon,
  42161: arbitrum,
  10: optimism,
};

/**
 * Create a public client for reading on-chain data.
 */
export function createFirmSwapPublicClient(
  rpcUrl: string,
  chainId: number = 100,
): PublicClient {
  const chain = chainMap[chainId] ?? gnosis;
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

/**
 * Typed wrapper around the FirmSwap contract for read operations.
 */
export class FirmSwapContract {
  constructor(
    private client: PublicClient,
    private address: Address,
  ) {}

  /** Get order details by ID */
  async getOrder(orderId: Hex): Promise<{
    user: Address;
    solver: Address;
    inputToken: Address;
    inputAmount: bigint;
    outputToken: Address;
    outputAmount: bigint;
    outputChainId: bigint;
    fillDeadline: number;
    state: number;
  }> {
    const result = await this.client.readContract({
      address: this.address,
      abi: firmSwapAbi,
      functionName: "orders",
      args: [orderId],
    });

    const [
      user,
      solver,
      inputToken,
      inputAmount,
      outputToken,
      outputAmount,
      outputChainId,
      fillDeadline,
      state,
    ] = result as [Address, Address, Address, bigint, Address, bigint, bigint, number, number];

    return {
      user,
      solver,
      inputToken,
      inputAmount,
      outputToken,
      outputAmount,
      outputChainId,
      fillDeadline,
      state,
    };
  }

  /** Get solver info */
  async getSolverInfo(solver: Address): Promise<{
    totalBond: bigint;
    reservedBond: bigint;
    unstakeAmount: bigint;
    unstakeTimestamp: number;
    registered: boolean;
  }> {
    const result = await this.client.readContract({
      address: this.address,
      abi: firmSwapAbi,
      functionName: "solvers",
      args: [solver],
    });

    const [totalBond, reservedBond, unstakeAmount, unstakeTimestamp, registered] =
      result as [bigint, bigint, bigint, number, boolean];

    return { totalBond, reservedBond, unstakeAmount, unstakeTimestamp, registered };
  }

  /** Get available (unreserved) bond for a solver */
  async getAvailableBond(solver: Address): Promise<bigint> {
    return (await this.client.readContract({
      address: this.address,
      abi: firmSwapAbi,
      functionName: "availableBond",
      args: [solver],
    })) as bigint;
  }

  /** Check if a nonce has been used */
  async isNonceUsed(solver: Address, nonce: bigint): Promise<boolean> {
    return (await this.client.readContract({
      address: this.address,
      abi: firmSwapAbi,
      functionName: "isNonceUsed",
      args: [solver, nonce],
    })) as boolean;
  }

  /** Compute the CREATE2 deposit address for an Address Deposit order */
  async computeDepositAddress(
    quote: FirmSwapQuote,
    solverSignature: Hex,
  ): Promise<Address> {
    return (await this.client.readContract({
      address: this.address,
      abi: firmSwapAbi,
      functionName: "computeDepositAddress",
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
        solverSignature,
      ],
    })) as Address;
  }

  /** Get ERC-20 token balance */
  async getTokenBalance(token: Address, account: Address): Promise<bigint> {
    return (await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    })) as bigint;
  }

  /** Get ERC-20 token allowance */
  async getTokenAllowance(
    token: Address,
    owner: Address,
    spender: Address,
  ): Promise<bigint> {
    return (await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
  }
}
