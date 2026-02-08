"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const stats = [
  { value: "630", label: "Lines of Solidity" },
  { value: "114", label: "Tests passing" },
  { value: "5%", label: "Bond per order" },
  { value: "0", label: "Governance deps" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-32">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-accent/5 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-center"
        >
          <div className="mb-6 inline-flex items-center rounded-full border border-border-default bg-bg-card px-4 py-1.5 text-sm text-text-secondary">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green" />
            Live on Gnosis Chiado testnet
          </div>

          <h1 className="mb-6 text-4xl font-bold tracking-tight text-text-primary md:text-6xl">
            Guaranteed-price swaps with{" "}
            <span className="text-accent-hover">bonded solvers</span>
          </h1>

          <p className="mb-10 text-lg text-text-secondary md:text-xl">
            FirmSwap is a firm-quote swap protocol where solvers commit to exact
            prices bound to an on-chain deadline. No slippage, no MEV, and if
            the solver misses the deadline — full refund plus bond compensation.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/docs/"
              className="inline-flex h-12 items-center rounded-xl bg-accent px-8 font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Read the Docs
            </Link>
            <Link
              href="https://github.com/purybr365/firmswap"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center rounded-xl border border-border-default bg-bg-card px-8 font-medium text-text-primary transition-colors hover:bg-bg-card-hover"
            >
              View on GitHub
            </Link>
          </div>
        </motion.div>

        {/* Flow diagram */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mx-auto mt-16 max-w-2xl"
        >
          <div className="flex items-center justify-center gap-4 md:gap-8">
            {["Quote", "Deposit", "Fill"].map((step, i) => (
              <div key={step} className="flex items-center gap-4 md:gap-8">
                <div className="flex flex-col items-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border-default bg-bg-card text-sm font-mono font-semibold text-accent-hover md:h-16 md:w-16">
                    {i + 1}
                  </div>
                  <span className="mt-2 text-xs font-medium text-text-secondary md:text-sm">
                    {step}
                  </span>
                </div>
                {i < 2 && (
                  <div className="h-px w-8 bg-gradient-to-r from-border-default to-accent/40 md:w-16" />
                )}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-6 md:grid-cols-4"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold text-text-primary md:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-xs text-text-muted md:text-sm">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
