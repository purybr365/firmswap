"use client";

import { motion } from "framer-motion";

type Phase = {
  title: string;
  status: "done" | "planned" | "future";
  description: string;
};

const phases: Phase[] = [
  {
    title: "Smart Contracts",
    status: "done",
    description:
      "630 lines of immutable Solidity. EIP-712 typed signatures, Permit2 support, CREATE2 address deposits, ERC-7683 compatible.",
  },
  {
    title: "API + Solver + SDK",
    status: "done",
    description:
      "Multi-chain quote aggregator API, reference solver with CEX price integration, TypeScript SDK built on viem.",
  },
  {
    title: "Testnet Deployment",
    status: "done",
    description:
      "Live on Gnosis Chiado testnet. Full end-to-end flows verified: both deposit modes, refunds, bond slashing.",
  },
  {
    title: "Security Audit",
    status: "planned",
    description:
      "Internal security review completed with 20 findings remediated (3 critical, 8 high, 7 medium, 2 low). External audit planned before mainnet.",
  },
  {
    title: "Mainnet Launch",
    status: "planned",
    description:
      "Gnosis Chain mainnet deployment with production solver infrastructure and monitoring.",
  },
  {
    title: "Multi-chain Expansion",
    status: "planned",
    description:
      "Deploy to Base, Polygon, Arbitrum, and Optimism. Single API instance serving all chains.",
  },
  {
    title: "Cross-chain Support",
    status: "future",
    description:
      "Fill orders on a different chain than the deposit chain. Full cross-chain intent settlement.",
  },
];

const statusConfig = {
  done: { color: "bg-green", label: "Done", textColor: "text-green" },
  planned: { color: "bg-yellow", label: "Planned", textColor: "text-yellow" },
  future: {
    color: "bg-text-muted",
    label: "Future",
    textColor: "text-text-muted",
  },
};

export function Roadmap() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
            Roadmap
          </h2>
          <p className="mx-auto max-w-2xl text-text-secondary">
            From smart contracts to cross-chain settlement — built
            incrementally, tested thoroughly.
          </p>
        </motion.div>

        <div className="mx-auto max-w-2xl">
          {phases.map((phase, i) => {
            const config = statusConfig[phase.status];
            return (
              <motion.div
                key={phase.title}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="relative flex gap-6 pb-10 last:pb-0"
              >
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div
                    className={`h-3 w-3 rounded-full ${config.color} mt-1.5 shrink-0`}
                  />
                  {i < phases.length - 1 && (
                    <div className="w-px grow bg-border-subtle" />
                  )}
                </div>

                {/* Content */}
                <div className="pb-2">
                  <div className="mb-1 flex items-center gap-3">
                    <h3 className="font-semibold text-text-primary">
                      {phase.title}
                    </h3>
                    <span
                      className={`text-xs font-medium ${config.textColor}`}
                    >
                      {config.label}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    {phase.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
