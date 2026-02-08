import { createPublicClient, http, type PublicClient, type Chain } from "viem";
import { gnosis, gnosisChiado, base, polygon, arbitrum, optimism } from "viem/chains";
import type { ChainConfig } from "./config.js";
import firmSwapAbi from "./abi/FirmSwap.json" with { type: "json" };

const chainMap: Record<number, Chain> = {
  100: gnosis,
  10200: gnosisChiado,
  8453: base,
  137: polygon,
  42161: arbitrum,
  10: optimism,
};

/** Everything needed to interact with FirmSwap on one chain. */
export interface ChainContext {
  chainId: number;
  publicClient: PublicClient;
  firmSwapAddress?: `0x${string}`;
}

/** Build a ChainContext from a single chain's config. */
export function createChainContext(cfg: ChainConfig): ChainContext {
  const chain = chainMap[cfg.chainId];
  if (!chain) throw new Error(`Unsupported chainId: ${cfg.chainId}`);

  const publicClient = createPublicClient({
    chain,
    transport: http(cfg.rpcUrl),
  });

  return {
    chainId: cfg.chainId,
    publicClient,
    firmSwapAddress: cfg.firmSwapAddress,
  };
}

/** Build a map of chainId -> ChainContext from config.chains. */
export function createChainContextMap(chains: ChainConfig[]): Map<number, ChainContext> {
  const map = new Map<number, ChainContext>();
  for (const cfg of chains) {
    map.set(cfg.chainId, createChainContext(cfg));
  }
  return map;
}

export { firmSwapAbi };
