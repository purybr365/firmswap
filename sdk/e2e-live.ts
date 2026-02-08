/**
 * Full off-chain E2E test against live Chiado deployment.
 *
 * Starts the API + Solver as child processes, then exercises:
 *   1. Solver registration via API
 *   2. Quote request via API aggregator
 *   3. Contract Deposit on-chain using the signed quote
 *   4. Solver auto-fill detection + settlement
 *   5. Order status verification via API + on-chain
 *
 * Usage:
 *   npx tsx e2e-live.ts
 */

import { createPublicClient, createWalletClient, http, keccak256, encodePacked, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosisChiado } from "viem/chains";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ═══════════════════════════════════════════════════
//  Config — Deployed Chiado addresses
// ═══════════════════════════════════════════════════

const FIRMSWAP = "0xE08Ee2901bbfD8A7837D294D3e43338871e075a4" as Address;
const BRLA     = "0x8bf8beBaBb2305F32C4fc5DBbE93b8accA5C45BC" as Address;
const USDC     = "0xdC874bD78D67A27025e3b415A5ED698C88042FaC" as Address;
const PK = process.env.TESTNET_PRIVATE_KEY as Hex;
if (!PK) throw new Error("TESTNET_PRIVATE_KEY env var is required. Set it to a funded Chiado testnet key.");
const RPC_URL  = "https://rpc.chiadochain.net";
const CHAIN_ID = 10200;

const API_PORT    = 3100;
const SOLVER_PORT = 3101;

const account = privateKeyToAccount(PK);

const publicClient = createPublicClient({
  chain: gnosisChiado,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: gnosisChiado,
  transport: http(RPC_URL),
});

// Minimal ABIs
const erc20Abi = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const firmSwapAbi = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "quote", type: "tuple", components: [{ name: "solver", type: "address" }, { name: "user", type: "address" }, { name: "inputToken", type: "address" }, { name: "inputAmount", type: "uint256" }, { name: "outputToken", type: "address" }, { name: "outputAmount", type: "uint256" }, { name: "orderType", type: "uint8" }, { name: "outputChainId", type: "uint256" }, { name: "depositDeadline", type: "uint32" }, { name: "fillDeadline", type: "uint32" }, { name: "nonce", type: "uint256" }] }, { name: "solverSignature", type: "bytes" }], outputs: [] },
  { name: "fill", type: "function", stateMutability: "nonpayable", inputs: [{ name: "orderId", type: "bytes32" }], outputs: [] },
  { name: "settle", type: "function", stateMutability: "nonpayable", inputs: [{ name: "quote", type: "tuple", components: [{ name: "solver", type: "address" }, { name: "user", type: "address" }, { name: "inputToken", type: "address" }, { name: "inputAmount", type: "uint256" }, { name: "outputToken", type: "address" }, { name: "outputAmount", type: "uint256" }, { name: "orderType", type: "uint8" }, { name: "outputChainId", type: "uint256" }, { name: "depositDeadline", type: "uint32" }, { name: "fillDeadline", type: "uint32" }, { name: "nonce", type: "uint256" }] }, { name: "solverSignature", type: "bytes" }], outputs: [] },
  { name: "computeDepositAddress", type: "function", stateMutability: "view", inputs: [{ name: "quote", type: "tuple", components: [{ name: "solver", type: "address" }, { name: "user", type: "address" }, { name: "inputToken", type: "address" }, { name: "inputAmount", type: "uint256" }, { name: "outputToken", type: "address" }, { name: "outputAmount", type: "uint256" }, { name: "orderType", type: "uint8" }, { name: "outputChainId", type: "uint256" }, { name: "depositDeadline", type: "uint32" }, { name: "fillDeadline", type: "uint32" }, { name: "nonce", type: "uint256" }] }, { name: "solverSignature", type: "bytes" }], outputs: [{ name: "", type: "address" }] },
  { name: "orders", type: "function", stateMutability: "view", inputs: [{ name: "orderId", type: "bytes32" }], outputs: [{ name: "user", type: "address" }, { name: "solver", type: "address" }, { name: "inputToken", type: "address" }, { name: "inputAmount", type: "uint256" }, { name: "outputToken", type: "address" }, { name: "outputAmount", type: "uint256" }, { name: "outputChainId", type: "uint256" }, { name: "fillDeadline", type: "uint32" }, { name: "state", type: "uint8" }] },
] as const;

// ═══════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════

const log = (msg: string) => console.log(`\x1b[36m[E2E]\x1b[0m ${msg}`);
const pass = (name: string) => console.log(`\x1b[32m  PASS\x1b[0m ${name}`);
const fail = (name: string, err: unknown) => {
  console.error(`\x1b[31m  FAIL\x1b[0m ${name}:`, err);
  process.exit(1);
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url: string, label: string, maxWait = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        log(`${label} is ready at ${url}`);
        return;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error(`${label} did not start within ${maxWait}ms`);
}

function computeOrderId(quoteHash: Hex, sigHash: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [quoteHash, sigHash]));
}

// ═══════════════════════════════════════════════════
//  Process Management
// ═══════════════════════════════════════════════════

const children: ChildProcess[] = [];

function startProcess(label: string, cmd: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (data: Buffer) => {
    // Only show important lines
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.includes("listening") || line.includes("Registered") || line.includes("[Filler]") || line.includes("error")) {
        console.log(`\x1b[33m[${label}]\x1b[0m ${line.trim()}`);
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.includes("Error") || line.includes("error") || line.includes("listening") || line.includes("Filler")) {
        console.log(`\x1b[31m[${label}]\x1b[0m ${line.trim()}`);
      }
    }
  });

  children.push(child);
  return child;
}

function killAll() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => { killAll(); process.exit(0); });
process.on("exit", killAll);

// ═══════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════

async function main() {
  log("=== FirmSwap Full Off-Chain E2E Test ===");
  log(`Chain: Chiado (${CHAIN_ID})`);
  log(`Account: ${account.address}`);
  log(`FirmSwap: ${FIRMSWAP}`);
  log(`tBRLA: ${BRLA}`);
  log(`tUSDC: ${USDC}`);

  // Check balances
  const brlaBalance = await publicClient.readContract({ address: BRLA, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const usdcBalance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  log(`tBRLA balance: ${brlaBalance}`);
  log(`tUSDC balance: ${usdcBalance}`);
  log("");

  // ─────────────────────────────────────────────────
  //  Step 1: Start API server
  // ─────────────────────────────────────────────────
  log("Step 1: Starting API server...");
  startProcess("API", "npx", ["tsx", "api/src/index.ts"], {
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    SUPPORTED_CHAINS: String(CHAIN_ID),
    [`RPC_URL_${CHAIN_ID}`]: RPC_URL,
    [`FIRMSWAP_ADDRESS_${CHAIN_ID}`]: FIRMSWAP,
    MIN_SOLVER_BOND: "1000000000", // 1000 USDC
  });
  await waitForServer(`http://127.0.0.1:${API_PORT}`, "API");

  // ─────────────────────────────────────────────────
  //  Step 2: Start Solver
  // ─────────────────────────────────────────────────
  log("Step 2: Starting Solver...");
  startProcess("Solver", "npx", ["tsx", "solver/src/index.ts"], {
    SOLVER_PRIVATE_KEY: PK,
    CHAIN_ID: String(CHAIN_ID),
    RPC_URL,
    FIRMSWAP_ADDRESS: FIRMSWAP,
    PORT: String(SOLVER_PORT),
    HOST: "127.0.0.1",
    API_URL: `http://127.0.0.1:${API_PORT}`,
    BRLA_ADDRESS: BRLA,
    USDC_ADDRESS: USDC,
    SPREAD_BPS: "0", // 0% spread for predictable math
    POLL_INTERVAL_MS: "2000",
    AUTO_FILL: "true",
  });
  await waitForServer(`http://127.0.0.1:${SOLVER_PORT}`, "Solver");

  // Give solver time to register with API + initialize nonce manager
  await sleep(3000);

  // ─────────────────────────────────────────────────
  //  Step 3: Verify solver is registered in API
  // ─────────────────────────────────────────────────
  log("");
  log("Step 3: Verifying solver registration...");
  const solversRes = await fetch(`http://127.0.0.1:${API_PORT}/v1/${CHAIN_ID}/solvers`);
  const solvers = await solversRes.json() as any[];
  assert(solvers.length >= 1, "Expected at least 1 solver registered");
  assert(
    solvers.some((s: any) => s.address.toLowerCase() === account.address.toLowerCase()),
    "Our solver should be registered"
  );
  pass("Solver registered with API");

  // ─────────────────────────────────────────────────
  //  Step 4: Request a quote from API (EXACT_OUTPUT)
  // ─────────────────────────────────────────────────
  log("");
  log("Step 4: Requesting quote for 100 USDC (EXACT_OUTPUT)...");
  const quoteRes = await fetch(`http://127.0.0.1:${API_PORT}/v1/${CHAIN_ID}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_OUTPUT",
      amount: "100000000", // 100 USDC (6 dec)
      userAddress: account.address,
      originChainId: CHAIN_ID,
      destinationChainId: CHAIN_ID,
      depositMode: "CONTRACT",
    }),
  });

  if (!quoteRes.ok) {
    const errBody = await quoteRes.text();
    throw new Error(`Quote request failed: ${quoteRes.status} ${errBody}`);
  }
  const quoteData = await quoteRes.json() as any;

  log(`  Quote received:`);
  log(`    solver: ${quoteData.quote.solver}`);
  log(`    inputAmount: ${quoteData.quote.inputAmount} tBRLA`);
  log(`    outputAmount: ${quoteData.quote.outputAmount} tUSDC`);
  log(`    nonce: ${quoteData.quote.nonce}`);
  log(`    depositDeadline: ${quoteData.quote.depositDeadline}`);
  log(`    fillDeadline: ${quoteData.quote.fillDeadline}`);
  log(`    signature: ${quoteData.solverSignature.slice(0, 20)}...`);

  assert(quoteData.quote.outputAmount === "100000000", "Output should be 100 USDC");
  assert(quoteData.solverSignature.length === 132, "Signature should be 65 bytes hex");
  pass("Quote received and validated");

  // ─────────────────────────────────────────────────
  //  Step 5: Contract Deposit on-chain
  // ─────────────────────────────────────────────────
  log("");
  log("Step 5: Depositing tBRLA on-chain (Contract Deposit)...");

  const q = quoteData.quote;

  // Build the quote struct for the contract call
  const quoteStruct = {
    solver: q.solver as Address,
    user: q.user as Address,
    inputToken: q.inputToken as Address,
    inputAmount: BigInt(q.inputAmount),
    outputToken: q.outputToken as Address,
    outputAmount: BigInt(q.outputAmount),
    orderType: q.orderType,
    outputChainId: BigInt(q.outputChainId),
    depositDeadline: q.depositDeadline,
    fillDeadline: q.fillDeadline,
    nonce: BigInt(q.nonce),
  };

  // Deposit
  const depositTx = await walletClient.writeContract({
    address: FIRMSWAP,
    abi: firmSwapAbi,
    functionName: "deposit",
    args: [quoteStruct, quoteData.solverSignature as Hex],
  });

  log(`  Deposit tx: ${depositTx}`);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
  log(`  Deposit confirmed in block ${depositReceipt.blockNumber} (gas: ${depositReceipt.gasUsed})`);
  assert(depositReceipt.status === "success", "Deposit tx should succeed");
  pass("Contract Deposit confirmed on-chain");

  // ─────────────────────────────────────────────────
  //  Step 6: Wait for solver auto-fill
  // ─────────────────────────────────────────────────
  log("");
  log("Step 6: Waiting for solver auto-fill...");

  // The solver monitors for Deposited events and auto-fills.
  // We need to find the orderId. Let's read the deposit logs.
  const depositLogs = await publicClient.getLogs({
    address: FIRMSWAP,
    event: {
      type: "event",
      name: "Deposited",
      inputs: [
        { type: "bytes32", name: "orderId", indexed: true },
        { type: "address", name: "user", indexed: true },
        { type: "address", name: "solver", indexed: true },
        { type: "address", name: "inputToken" },
        { type: "uint256", name: "inputAmount" },
        { type: "address", name: "outputToken" },
        { type: "uint256", name: "outputAmount" },
        { type: "uint32", name: "fillDeadline" },
      ],
    },
    fromBlock: depositReceipt.blockNumber,
    toBlock: depositReceipt.blockNumber,
  });

  assert(depositLogs.length > 0, "Should have emitted Deposited event");
  const orderId = depositLogs[0].args.orderId as Hex;
  log(`  Order ID: ${orderId}`);

  // Poll for settlement (solver should fill within a few seconds + next poll interval)
  let settled = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);

    const order = await publicClient.readContract({
      address: FIRMSWAP,
      abi: firmSwapAbi,
      functionName: "orders",
      args: [orderId],
    }) as any[];

    const state = Number(order[8]);
    if (state === 2) { // SETTLED
      settled = true;
      log(`  Order settled after ~${(i + 1) * 2}s`);
      break;
    }
    if (i % 5 === 0) {
      log(`  Waiting... (state=${state === 1 ? "DEPOSITED" : state}, ${(i + 1) * 2}s elapsed)`);
    }
  }

  assert(settled, "Order should be settled by solver auto-fill");
  pass("Solver auto-filled the order (Contract Deposit complete)");

  // ─────────────────────────────────────────────────
  //  Step 7: Verify order status via API
  // ─────────────────────────────────────────────────
  log("");
  log("Step 7: Verifying order status via API...");
  const orderRes = await fetch(`http://127.0.0.1:${API_PORT}/v1/${CHAIN_ID}/order/${orderId}`);
  assert(orderRes.ok, "Order status request should succeed");
  const orderData = await orderRes.json() as any;
  assert(orderData.state === "SETTLED", `Order should be SETTLED, got ${orderData.state}`);
  pass("Order status confirmed SETTLED via API");

  // ─────────────────────────────────────────────────
  //  Step 8: Test Address Deposit via API quote
  // ─────────────────────────────────────────────────
  log("");
  log("Step 8: Testing Address Deposit via API quote...");

  const modeAQuoteRes = await fetch(`http://127.0.0.1:${API_PORT}/v1/${CHAIN_ID}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_OUTPUT",
      amount: "50000000", // 50 USDC
      userAddress: account.address,
      originChainId: CHAIN_ID,
      destinationChainId: CHAIN_ID,
      depositMode: "ADDRESS",
    }),
  });

  if (!modeAQuoteRes.ok) {
    const errBody = await modeAQuoteRes.text();
    throw new Error(`Address Deposit quote failed: ${modeAQuoteRes.status} ${errBody}`);
  }
  const modeAData = await modeAQuoteRes.json() as any;

  log(`  Quote: ${modeAData.quote.inputAmount} tBRLA -> ${modeAData.quote.outputAmount} tUSDC`);
  if (modeAData.depositAddress) {
    log(`  Deposit address (API): ${modeAData.depositAddress}`);
  }

  // Build quote struct
  const mqStruct = {
    solver: modeAData.quote.solver as Address,
    user: modeAData.quote.user as Address,
    inputToken: modeAData.quote.inputToken as Address,
    inputAmount: BigInt(modeAData.quote.inputAmount),
    outputToken: modeAData.quote.outputToken as Address,
    outputAmount: BigInt(modeAData.quote.outputAmount),
    orderType: modeAData.quote.orderType,
    outputChainId: BigInt(modeAData.quote.outputChainId),
    depositDeadline: modeAData.quote.depositDeadline,
    fillDeadline: modeAData.quote.fillDeadline,
    nonce: BigInt(modeAData.quote.nonce),
  };

  // Compute deposit address on-chain
  const depositAddr = await publicClient.readContract({
    address: FIRMSWAP,
    abi: firmSwapAbi,
    functionName: "computeDepositAddress",
    args: [mqStruct, modeAData.solverSignature as Hex],
  }) as Address;
  log(`  Deposit address (on-chain): ${depositAddr}`);

  if (modeAData.depositAddress) {
    assert(
      depositAddr.toLowerCase() === modeAData.depositAddress.toLowerCase(),
      "API and on-chain deposit addresses should match"
    );
    pass("Deposit address matches between API and on-chain");
  }

  // Send tokens to the deposit address (simulating Picnic minting BRLA)
  const transferTx = await walletClient.writeContract({
    address: BRLA,
    abi: erc20Abi,
    functionName: "transfer",
    args: [depositAddr, BigInt(modeAData.quote.inputAmount)],
  });
  const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferTx });
  log(`  Transferred tBRLA to deposit address (block ${transferReceipt.blockNumber})`);

  // Solver settles (in this test, solver is the same account, so we call settle directly)
  const settleTx = await walletClient.writeContract({
    address: FIRMSWAP,
    abi: firmSwapAbi,
    functionName: "settle",
    args: [mqStruct, modeAData.solverSignature as Hex],
  });
  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleTx });
  log(`  Settled in block ${settleReceipt.blockNumber} (gas: ${settleReceipt.gasUsed})`);
  assert(settleReceipt.status === "success", "Settle tx should succeed");
  pass("Address Deposit settle confirmed on-chain");

  // ─────────────────────────────────────────────────
  //  Step 9: Test EXACT_INPUT quote
  // ─────────────────────────────────────────────────
  log("");
  log("Step 9: Testing EXACT_INPUT quote...");
  const exactInputRes = await fetch(`http://127.0.0.1:${API_PORT}/v1/${CHAIN_ID}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputToken: BRLA,
      outputToken: USDC,
      orderType: "EXACT_INPUT",
      amount: "500000000000000000000", // 500 tBRLA (18 dec)
      userAddress: account.address,
      originChainId: CHAIN_ID,
      destinationChainId: CHAIN_ID,
      depositMode: "CONTRACT",
    }),
  });

  if (!exactInputRes.ok) {
    const errBody = await exactInputRes.text();
    throw new Error(`EXACT_INPUT quote failed: ${exactInputRes.status} ${errBody}`);
  }
  const exactInputData = await exactInputRes.json() as any;
  log(`  EXACT_INPUT: 500 tBRLA -> ${exactInputData.quote.outputAmount} tUSDC`);
  assert(BigInt(exactInputData.quote.inputAmount) === 500_000_000_000_000_000_000n, "Input should be 500 BRLA");
  assert(BigInt(exactInputData.quote.outputAmount) > 0n, "Output should be > 0");
  pass("EXACT_INPUT quote works correctly");

  // ─────────────────────────────────────────────────
  //  Done!
  // ─────────────────────────────────────────────────
  log("");
  log("=== ALL E2E TESTS PASSED ===");

  // Final balances
  const finalBrla = await publicClient.readContract({ address: BRLA, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const finalUsdc = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  log(`Final tBRLA: ${finalBrla}`);
  log(`Final tUSDC: ${finalUsdc}`);

  killAll();
  process.exit(0);
}

main().catch((err) => {
  console.error("\x1b[31m[E2E] FATAL:\x1b[0m", err);
  killAll();
  process.exit(1);
});
