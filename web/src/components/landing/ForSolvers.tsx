"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export function ForSolvers() {
  return (
    <section className="py-12 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="mb-4 inline-flex items-center rounded-full border border-border-default bg-bg-card px-3 py-1 text-xs font-medium text-accent-hover">
              For Solvers
            </div>
            <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
              Run a Solver
            </h2>
            <p className="mb-6 text-text-secondary">
              Earn spread profits by providing firm quotes with on-chain
              deadlines. Bond 1,000+ USDC, register with any API instance, and
              start quoting. Each quote you sign commits to an exact price and a
              fill deadline — your obligation expires if the user misses the
              deposit window. The reference solver includes a pluggable CEX
              adapter system.
            </p>
            <ul className="mb-8 space-y-3 text-sm text-text-secondary">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Permissionless registration — just post a bond
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Configurable spread (default 0.5%)
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Deadline-bound quotes — your commitment has a clear expiry
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Auto-fill deposits with on-chain monitoring
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-green">&#10003;</span>
                Open source reference implementation
              </li>
            </ul>
            <Link
              href="/docs/solver-guide/"
              className="inline-flex h-10 items-center rounded-lg bg-accent px-6 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Read the Solver Guide
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-border-default bg-bg-card p-4 sm:p-6"
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-red/60" />
              <div className="h-3 w-3 rounded-full bg-yellow/60" />
              <div className="h-3 w-3 rounded-full bg-green/60" />
              <span className="ml-2 text-xs text-text-muted">terminal</span>
            </div>
            <pre className="overflow-x-auto text-xs leading-relaxed sm:text-sm">
              <code className="font-mono text-text-secondary">
                <span className="text-text-muted"># Clone and configure</span>
                {"\n"}
                <span className="text-green">$</span> git clone
                https://github.com/purybr365/firmswap.git{"\n"}
                <span className="text-green">$</span> cd
                firmswap/solver{"\n"}
                <span className="text-green">$</span> cp .env.example .env
                {"\n"}
                <span className="text-text-muted">
                  # Set SOLVER_PRIVATE_KEY, CHAIN_ID, RPC_URL
                </span>
                {"\n\n"}
                <span className="text-text-muted"># Install and start</span>
                {"\n"}
                <span className="text-green">$</span> npm install{"\n"}
                <span className="text-green">$</span> npm start{"\n"}
                <span className="text-accent-hover">
                  {">"} Solver registered on chain 100
                </span>
                {"\n"}
                <span className="text-accent-hover">
                  {">"} Listening on http://0.0.0.0:3001
                </span>
                {"\n"}
                <span className="text-accent-hover">
                  {">"} Monitoring for deposits...
                </span>
              </code>
            </pre>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
