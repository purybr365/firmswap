import { config } from "./config.js";
import { publicClient, createSolverWalletClient } from "./chain.js";
import { Quoter } from "./quoter.js";
import { Signer } from "./signer.js";
import { NonceManager } from "./nonceManager.js";
import { Monitor } from "./monitor.js";
import { Filler } from "./filler.js";
import { buildSolverServer } from "./server.js";
import { MockCexAdapter } from "./cex/mock.js";
import { BinanceAdapter } from "./cex/binance.js";

async function main() {
  // Validate required config
  if (!config.privateKey) {
    console.error("SOLVER_PRIVATE_KEY is required");
    process.exit(1);
  }
  if (!config.firmSwapAddress) {
    console.error("FIRMSWAP_ADDRESS is required");
    process.exit(1);
  }

  // Set up wallet
  const { walletClient, account } = createSolverWalletClient(
    config.privateKey,
  );
  const solverAddress = account.address;
  console.log(`Solver address: ${solverAddress}`);

  // Choose CEX adapter (use mock if no Binance API key)
  const cex = process.env.BINANCE_API_KEY
    ? new BinanceAdapter()
    : new MockCexAdapter();
  console.log(`CEX adapter: ${cex.name}`);

  // Initialize components
  const quoter = new Quoter(cex, config.spreadBps);
  const signer = new Signer(
    config.privateKey,
    config.chainId,
    config.firmSwapAddress,
  );
  const nonceManager = new NonceManager(
    publicClient,
    config.firmSwapAddress,
    solverAddress,
  );

  console.log("Initializing nonce manager...");
  await nonceManager.initialize();
  console.log(`Next nonce: ${nonceManager.peekNextNonce()}`);

  // Build and start HTTP server
  const server = buildSolverServer({
    quoter,
    signer,
    nonceManager,
    solverAddress,
  });

  await server.listen({ port: config.port, host: config.host });
  console.log(`Solver HTTP server listening on ${config.host}:${config.port}`);

  // Start monitoring + auto-filling if enabled
  if (config.autoFill) {
    const filler = new Filler(
      walletClient,
      publicClient,
      config.firmSwapAddress,
      solverAddress,
    );

    const monitor = new Monitor(
      publicClient,
      config.firmSwapAddress,
      config.pollIntervalMs,
    );

    monitor.onDepositedEvent(async (event) => {
      await filler.onDeposited(event);
    });

    await monitor.start();
    console.log("Auto-filler enabled and monitoring for orders...");
  }

  // Register with API aggregator
  if (config.apiUrl) {
    try {
      const addrInfo = server.addresses()[0];
      const localUrl = process.env.SOLVER_PUBLIC_URL || `http://${addrInfo.address}:${addrInfo.port}`;
      const timestamp = Date.now();

      // EIP-191 signature proving ownership of the solver address
      const message = `FirmSwap Solver Registration\nAddress: ${solverAddress.toLowerCase()}\nEndpoint: ${localUrl}\nTimestamp: ${timestamp}`;
      const signature = await account.signMessage({ message });

      const res = await fetch(`${config.apiUrl}/v1/${config.chainId}/solvers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: solverAddress,
          endpointUrl: localUrl,
          name: config.solverName,
          signature,
          timestamp,
        }),
      });

      if (res.ok) {
        console.log(`Registered with API aggregator at ${config.apiUrl}`);
      } else {
        console.warn(
          `Failed to register with API: ${res.status} ${await res.text()}`,
        );
      }
    } catch (err) {
      console.warn("Could not register with API aggregator:", err);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
