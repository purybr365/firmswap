import { buildServer } from "./server.js";
import { config } from "./config.js";

async function main() {
  const server = await buildServer();

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`FirmSwap API listening on ${config.host}:${config.port}`);
    console.log(`Supported chains: ${config.chains.map((c) => c.chainId).join(", ")}`);
    for (const chain of config.chains) {
      const addr = chain.firmSwapAddress ?? "not configured";
      console.log(`  Chain ${chain.chainId}: FirmSwap=${addr}, RPC=${chain.rpcUrl}`);
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
