import {
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
  encodeFunctionData,
} from "viem";
import { erc20Abi } from "./abi/index.js";
import { firmSwapAbi } from "./abi/index.js";
import type { FirmSwapQuote } from "./types.js";

/**
 * Well-known Permit2 address (same on all chains).
 */
export const PERMIT2_ADDRESS: Address =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/**
 * Permit2 ABI subset used for FirmSwap deposits.
 */
const permit2Abi = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

/**
 * Permit2 EIP-712 types for SignatureTransfer.
 */
const PERMIT2_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

export interface Permit2DepositParams {
  quote: FirmSwapQuote;
  solverSignature: Hex;
  /** Permit2 nonce (not the quote nonce) — must be unique per Permit2 use */
  permit2Nonce: bigint;
  /** Permit2 deadline (Unix timestamp) */
  permit2Deadline: bigint;
}

/**
 * Ensure the user has approved Permit2 to spend the input token.
 * Returns the tx hash if an approval was needed, or null if already approved.
 */
export async function ensurePermit2Approval(
  walletClient: WalletClient,
  publicClient: PublicClient,
  token: Address,
  amount: bigint,
): Promise<Hex | null> {
  const owner = walletClient.account!.address;

  const allowance = (await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, PERMIT2_ADDRESS],
  })) as bigint;

  if (allowance >= amount) return null;

  // Approve Permit2 for max amount (standard practice)
  const tx = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [PERMIT2_ADDRESS, 2n ** 256n - 1n],
    chain: walletClient.chain!,
    account: walletClient.account!,
  });

  await publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

/**
 * Sign a Permit2 transfer and call depositWithPermit2 on FirmSwap.
 *
 * This allows depositing tokens without a separate approve() call to the
 * FirmSwap contract — only Permit2 needs to be approved once.
 *
 * @returns Transaction hash
 */
export async function depositWithPermit2(
  walletClient: WalletClient,
  publicClient: PublicClient,
  firmSwapAddress: Address,
  params: Permit2DepositParams,
): Promise<Hex> {
  const { quote, solverSignature, permit2Nonce, permit2Deadline } = params;
  const account = walletClient.account!;

  // Ensure Permit2 is approved to spend the input token
  await ensurePermit2Approval(
    walletClient,
    publicClient,
    quote.inputToken,
    quote.inputAmount,
  );

  // Sign the Permit2 transfer via WalletClient.signTypedData().
  // This works with any account type: EOA, hardware wallets, and smart accounts
  // (ERC-4337 / ERC-1271) that implement signTypedData.
  const permitSignature = await walletClient.signTypedData({
    account,
    domain: {
      name: "Permit2",
      chainId: walletClient.chain!.id,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: PERMIT2_TYPES,
    primaryType: "PermitTransferFrom" as const,
    message: {
      permitted: {
        token: quote.inputToken,
        amount: quote.inputAmount,
      },
      spender: firmSwapAddress,
      nonce: permit2Nonce,
      deadline: permit2Deadline,
    },
  });

  // Call depositWithPermit2
  const tx = await walletClient.writeContract({
    address: firmSwapAddress,
    abi: firmSwapAbi,
    functionName: "depositWithPermit2",
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
      {
        permitted: {
          token: quote.inputToken,
          amount: quote.inputAmount,
        },
        nonce: permit2Nonce,
        deadline: permit2Deadline,
      },
      permitSignature,
    ],
    chain: walletClient.chain!,
    account,
  });

  return tx;
}
