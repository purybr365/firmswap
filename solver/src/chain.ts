import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Address,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { gnosis, gnosisChiado, base, polygon, arbitrum, optimism } from "viem/chains";
import { config } from "./config.js";
import firmSwapAbi from "./abi/FirmSwap.json" with { type: "json" };

const chainMap: Record<number, import("viem").Chain> = {
  100: gnosis,
  10200: gnosisChiado,
  8453: base,
  137: polygon,
  42161: arbitrum,
  10: optimism,
};

const chain = chainMap[config.chainId] ?? gnosis;

export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});

export function createSolverWalletClient(
  privateKey: `0x${string}`,
): { walletClient: WalletClient; account: PrivateKeyAccount } {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });
  return { walletClient, account };
}

export { firmSwapAbi };
