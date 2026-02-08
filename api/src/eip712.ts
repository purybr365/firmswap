import { verifyTypedData, type Address, type Hex } from "viem";
import type { SerializedQuote } from "./types.js";

/**
 * EIP-712 domain and type definitions matching FirmSwap.sol's EIP712("FirmSwap", "1")
 */
const QUOTE_TYPES = {
  FirmSwapQuote: [
    { name: "solver", type: "address" },
    { name: "user", type: "address" },
    { name: "inputToken", type: "address" },
    { name: "inputAmount", type: "uint256" },
    { name: "outputToken", type: "address" },
    { name: "outputAmount", type: "uint256" },
    { name: "orderType", type: "uint8" },
    { name: "outputChainId", type: "uint256" },
    { name: "depositDeadline", type: "uint32" },
    { name: "fillDeadline", type: "uint32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/**
 * Verify a solver's EIP-712 signature over a FirmSwapQuote.
 *
 * @param quote - The serialized quote from the solver
 * @param signature - The solver's EIP-712 signature
 * @param firmSwapAddress - The FirmSwap contract address (verifyingContract)
 * @param chainId - The chain ID (part of EIP-712 domain)
 * @returns true if the signature is valid and was signed by quote.solver
 */
export async function verifyQuoteSignature(
  quote: SerializedQuote,
  signature: string,
  firmSwapAddress: Address,
  chainId: number,
): Promise<boolean> {
  try {
    const domain = {
      name: "FirmSwap",
      version: "1",
      chainId,
      verifyingContract: firmSwapAddress,
    };

    const message = {
      solver: quote.solver as Address,
      user: quote.user as Address,
      inputToken: quote.inputToken as Address,
      inputAmount: BigInt(quote.inputAmount),
      outputToken: quote.outputToken as Address,
      outputAmount: BigInt(quote.outputAmount),
      orderType: quote.orderType,
      outputChainId: BigInt(quote.outputChainId),
      depositDeadline: quote.depositDeadline,
      fillDeadline: quote.fillDeadline,
      nonce: BigInt(quote.nonce),
    };

    const valid = await verifyTypedData({
      address: quote.solver as Address,
      domain,
      types: QUOTE_TYPES,
      primaryType: "FirmSwapQuote",
      message,
      signature: signature as Hex,
    });

    return valid;
  } catch {
    return false;
  }
}
