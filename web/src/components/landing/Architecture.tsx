"use client";

import { motion } from "framer-motion";

export function Architecture() {
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
            Architecture
          </h2>
          <p className="mx-auto max-w-2xl text-text-secondary">
            A permissionless system where anyone can run the API, any solver can
            register with a bond, and users interact through the SDK or directly
            with the contract.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl"
        >
          <div className="rounded-2xl border border-border-default bg-bg-card p-8 md:p-12">
            {/* User -> SDK -> API row */}
            <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-8">
              <ArchNode label="User" sublabel="Wallet / dApp" accent />
              <Arrow />
              <ArchNode label="SDK" sublabel="TypeScript + viem" />
              <Arrow />
              <ArchNode label="API" sublabel="Aggregator" />
              <Arrow />
              <div className="flex flex-col gap-2">
                <ArchNode label="Solver 1" sublabel="Bonded" small />
                <ArchNode label="Solver 2" sublabel="Bonded" small />
                <ArchNode label="Solver N" sublabel="..." small />
              </div>
            </div>

            {/* Down arrow to contract */}
            <div className="flex justify-center py-6">
              <div className="h-12 w-px bg-gradient-to-b from-border-default to-accent/40" />
            </div>

            {/* Contract */}
            <div className="mx-auto max-w-md rounded-xl border border-accent/30 bg-accent/5 p-6 text-center">
              <div className="mb-1 font-mono text-sm font-semibold text-accent-hover">
                FirmSwap Contract
              </div>
              <div className="text-xs text-text-muted">
                630 lines &middot; Immutable &middot; ERC-7683
              </div>
            </div>

            {/* Two deposit modes */}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border-subtle bg-bg-secondary p-5">
                <div className="mb-2 text-sm font-semibold text-text-primary">
                  Mode A: Address Deposit
                </div>
                <p className="text-xs leading-relaxed text-text-muted">
                  User sends tokens to a deterministic CREATE2 address.
                  settle() sweeps funds and completes the swap in one
                  transaction. Zero user transactions with the contract.
                </p>
              </div>
              <div className="rounded-xl border border-border-subtle bg-bg-secondary p-5">
                <div className="mb-2 text-sm font-semibold text-text-primary">
                  Mode B: Contract Deposit
                </div>
                <p className="text-xs leading-relaxed text-text-muted">
                  User calls deposit() with the solver-signed quote. Solver
                  calls fill() to deliver output tokens. Two transactions total.
                  Permit2 supported.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function ArchNode({
  label,
  sublabel,
  accent,
  small,
}: {
  label: string;
  sublabel: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border ${
        accent
          ? "border-accent/40 bg-accent/10"
          : "border-border-subtle bg-bg-secondary"
      } ${small ? "px-3 py-1.5" : "px-5 py-3"} text-center`}
    >
      <div
        className={`font-mono font-semibold ${small ? "text-xs" : "text-sm"} ${
          accent ? "text-accent-hover" : "text-text-primary"
        }`}
      >
        {label}
      </div>
      <div className={`${small ? "text-[10px]" : "text-xs"} text-text-muted`}>
        {sublabel}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="hidden h-px w-8 bg-gradient-to-r from-border-default to-accent/30 md:block" />
  );
}
