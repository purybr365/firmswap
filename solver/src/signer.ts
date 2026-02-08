import {
  type Hex,
  type Address,
  encodeAbiParameters,
  keccak256,
  concatHex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { SerializedQuote } from "./types.js";

/**
 * EIP-712 type definitions matching the Solidity QuoteLib.
 *
 * FirmSwapQuote(
 *   address solver,
 *   address user,
 *   address inputToken,
 *   uint256 inputAmount,
 *   address outputToken,
 *   uint256 outputAmount,
 *   uint8 orderType,
 *   uint256 outputChainId,
 *   uint32 depositDeadline,
 *   uint32 fillDeadline,
 *   uint256 nonce
 * )
 */

const FIRMSWAP_QUOTE_TYPES = {
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

export class Signer {
  private account: PrivateKeyAccount;
  private chainId: number;
  private firmSwapAddress: Address;

  constructor(privateKey: Hex, chainId: number, firmSwapAddress: Address) {
    this.account = privateKeyToAccount(privateKey);
    this.chainId = chainId;
    this.firmSwapAddress = firmSwapAddress;
  }

  get address(): Address {
    return this.account.address;
  }

  /**
   * Sign a quote using EIP-712 typed structured data.
   * Returns the signature as a hex string.
   */
  async signQuote(quote: SerializedQuote): Promise<Hex> {
    const signature = await this.account.signTypedData({
      domain: {
        name: "FirmSwap",
        version: "1",
        chainId: this.chainId,
        verifyingContract: this.firmSwapAddress,
      },
      types: FIRMSWAP_QUOTE_TYPES,
      primaryType: "FirmSwapQuote",
      message: {
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
      },
    });

    return signature;
  }
}

/**
 * Compute the EIP-712 QUOTE_TYPEHASH matching the Solidity contract.
 * This is useful for testing to verify hash consistency.
 */
export const QUOTE_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "FirmSwapQuote(" +
      "address solver," +
      "address user," +
      "address inputToken," +
      "uint256 inputAmount," +
      "address outputToken," +
      "uint256 outputAmount," +
      "uint8 orderType," +
      "uint256 outputChainId," +
      "uint32 depositDeadline," +
      "uint32 fillDeadline," +
      "uint256 nonce" +
      ")",
  ),
);
