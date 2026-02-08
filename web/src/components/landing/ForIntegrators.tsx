"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export function ForIntegrators() {
  return (
    <section className="bg-bg-secondary py-12 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="order-2 rounded-2xl border border-border-default bg-bg-card p-4 sm:p-6 md:order-1"
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-red/60" />
              <div className="h-3 w-3 rounded-full bg-yellow/60" />
              <div className="h-3 w-3 rounded-full bg-green/60" />
              <span className="ml-2 text-xs text-text-muted">index.ts</span>
            </div>
            <pre className="overflow-x-auto text-xs leading-relaxed sm:text-sm">
              <code className="font-mono text-text-secondary">
                <span className="text-accent-hover">import</span>
                {" { FirmSwapClient } "}
                <span className="text-accent-hover">from</span>
                {' "@firmswap/sdk";\n\n'}
                <span className="text-accent-hover">const</span>
                {" client = "}
                <span className="text-accent-hover">new</span>
                {" FirmSwapClient({\n"}
                {"  apiUrl: "}
                <span className="text-green">
                  &quot;https://api.firmswap.org&quot;
                </span>
                {",\n"}
                {"  chainId: "}
                <span className="text-yellow">100</span>
                {",\n});\n\n"}
                <span className="text-accent-hover">const</span>
                {" quote = "}
                <span className="text-accent-hover">await</span>
                {" client.getQuote({\n"}
                {"  inputToken: BRLA,\n"}
                {"  outputToken: USDC,\n"}
                {"  orderType: "}
                <span className="text-green">
                  &quot;EXACT_INPUT&quot;
                </span>
                {",\n"}
                {"  amount: "}
                <span className="text-green">
                  &quot;1000000000000000000&quot;
                </span>
                {",\n"}
                {"  userAddress: "}
                <span className="text-green">&quot;0x...&quot;</span>
                {",\n"}
                {"  depositMode: "}
                <span className="text-green">&quot;ADDRESS&quot;</span>
                {",\n});\n\n"}
                <span className="text-text-muted">
                  {"// Zero-tx deposit — just transfer tokens"}
                </span>
                {"\n"}
                <span className="text-accent-hover">const</span>
                {" addr = "}
                <span className="text-accent-hover">await</span>
                {" client.getDepositAddress(quote);"}
              </code>
            </pre>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="order-1 md:order-2"
          >
            <div className="mb-4 inline-flex items-center rounded-full border border-border-default bg-bg-card px-3 py-1 text-xs font-medium text-accent-hover">
              For Integrators
            </div>
            <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
              Integrate FirmSwap
            </h2>
            <p className="mb-6 text-text-secondary">
              Add guaranteed-price swaps with deadline enforcement to your dApp
              in minutes. Every quote includes deposit and fill deadlines — the
              user knows exactly when their trade expires. Built on viem with
              full type safety, ERC-4337 support, and Permit2.
            </p>
            <ul className="mb-8 space-y-3 text-sm text-text-secondary">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                TypeScript SDK with full type safety
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Smart account / ERC-4337 batching support
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Built-in safety checks (address verification, quote validation)
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Configurable deadlines — set deposit and fill windows per quote
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                WebSocket for real-time order updates
              </li>
            </ul>
            <Link
              href="/docs/sdk/"
              className="inline-flex h-10 items-center rounded-lg bg-accent px-6 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Read the SDK Docs
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
