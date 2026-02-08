import "dotenv/config";

export const config = {
  // Solver identity
  solverAddress: process.env.SOLVER_ADDRESS as `0x${string}` | undefined,
  privateKey: process.env.SOLVER_PRIVATE_KEY as `0x${string}` | undefined,

  // Chain config
  chainId: parseInt(process.env.CHAIN_ID || "100"), // Gnosis
  rpcUrl: process.env.RPC_URL || "https://rpc.gnosis.gateway.fm",

  // FirmSwap contract
  firmSwapAddress: process.env.FIRMSWAP_ADDRESS as `0x${string}` | undefined,

  // HTTP server (receives quote requests from aggregator)
  port: parseInt(process.env.PORT || "3001"),
  host: process.env.HOST || "0.0.0.0",

  // API aggregator (for self-registration)
  apiUrl: process.env.API_URL || "http://localhost:3000",
  solverName: process.env.SOLVER_NAME || "FirmSwap Reference Solver",

  // Pricing
  spreadBps: parseInt(process.env.SPREAD_BPS || "50"), // 0.5% default spread
  maxOrderSizeUsd: parseInt(process.env.MAX_ORDER_SIZE_USD || "50000"),

  // Token addresses (Gnosis defaults)
  brlaAddress: (process.env.BRLA_ADDRESS ||
    "0xfecb3f7c54e2caae9dc6ac9060a822d47e053760") as `0x${string}`,
  usdcAddress: (process.env.USDC_ADDRESS ||
    "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83") as `0x${string}`,

  // Token decimals
  brlaDecimals: parseInt(process.env.BRLA_DECIMALS || "18"),
  usdcDecimals: parseInt(process.env.USDC_DECIMALS || "6"),

  // Monitor settings
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "3000"),

  // Auto-fill settings
  autoFill: process.env.AUTO_FILL !== "false", // enabled by default

  // Database
  dbPath: process.env.DB_PATH || "./solver.db",
} as const;
