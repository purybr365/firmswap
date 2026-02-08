import "dotenv/config";

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  firmSwapAddress?: `0x${string}`;
}

function parseChains(): ChainConfig[] {
  const supported = process.env.SUPPORTED_CHAINS;
  if (supported) {
    return supported.split(",").map((id) => {
      const chainId = parseInt(id.trim());
      return {
        chainId,
        rpcUrl: process.env[`RPC_URL_${chainId}`] || "",
        firmSwapAddress: process.env[`FIRMSWAP_ADDRESS_${chainId}`] as `0x${string}` | undefined,
      };
    });
  }
  // Single-chain fallback (backward compat)
  return [{
    chainId: parseInt(process.env.CHAIN_ID || "100"),
    rpcUrl: process.env.RPC_URL || "https://rpc.gnosis.gateway.fm",
    firmSwapAddress: process.env.FIRMSWAP_ADDRESS as `0x${string}` | undefined,
  }];
}

export const config = {
  port: parseInt(process.env.PORT || "3000"),
  host: process.env.HOST || "0.0.0.0",

  // Multi-chain
  chains: parseChains(),

  // Quote settings
  quoteTimeoutMs: parseInt(process.env.QUOTE_TIMEOUT_MS || "2000"),
  defaultDepositWindow: parseInt(process.env.DEFAULT_DEPOSIT_WINDOW || "300"), // 5 min
  defaultFillWindow: parseInt(process.env.DEFAULT_FILL_WINDOW || "120"), // 2 min after deposit deadline

  // Solver settings
  minSolverBond: BigInt(process.env.MIN_SOLVER_BOND || "1000000000"), // 1000 USDC (6 dec)
  maxSolversPerChain: parseInt(process.env.MAX_SOLVERS_PER_CHAIN || "50"),
  maxQuoteFanOut: parseInt(process.env.MAX_QUOTE_FAN_OUT || "10"),

  // Database
  dbPath: process.env.DB_PATH || "./firmswap-api.db",

  // Rate limiting
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100"),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"), // 1 minute

  // CORS — default "*" prevents credentialed requests; set CORS_ORIGINS for whitelist
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((s: string) => s.trim())
    : ("*" as const),

  // SSRF protection — allow HTTP solver URLs in dev/test only
  allowHttpSolverUrls: process.env.NODE_ENV !== "production",

  // Allow private/reserved IPs for solver endpoints (e.g. Docker internal network).
  // In production Docker deployments, set ALLOW_PRIVATE_SOLVER_IPS=true so that
  // solvers on the Docker bridge network (172.x.x.x) can register and receive quotes.
  allowPrivateIps: process.env.ALLOW_PRIVATE_SOLVER_IPS === "true" || process.env.NODE_ENV !== "production",

  // Metrics auth (optional): "user:password" for Basic auth
  metricsAuth: process.env.METRICS_AUTH || undefined,
} as const;
