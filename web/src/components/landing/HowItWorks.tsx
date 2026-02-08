"use client";

import { motion } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Request a Quote",
    description:
      "User requests a swap quote. The API fans out to all registered solvers and returns the best firm quote — locked to exact amounts and a deadline — signed with EIP-712.",
    icon: (
      <svg
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
        />
      </svg>
    ),
  },
  {
    number: "02",
    title: "Deposit Tokens",
    description:
      "Deposit before the deposit deadline. Two modes: (A) Transfer tokens to a deterministic CREATE2 address — zero user transactions. (B) Call deposit() on the contract.",
    icon: (
      <svg
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
        />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Solver Fills",
    description:
      "The solver delivers exact output tokens before the fill deadline. If the deadline passes without delivery, the user calls refund() and receives their tokens back plus 5% of the solver's bond.",
    icon: (
      <svg
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-bg-secondary py-12 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center md:mb-16"
        >
          <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto max-w-2xl text-text-secondary">
            Three steps from quote to settlement. Every quote is locked to an
            exact price and an on-chain deadline. Miss the deadline, and the
            protocol compensates the user automatically.
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="relative rounded-2xl border border-border-default bg-bg-card p-6 transition-colors hover:border-accent/30 hover:bg-bg-card-hover sm:p-8"
            >
              <div className="mb-4 flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent-hover">
                  {step.icon}
                </div>
                <span className="font-mono text-sm text-text-muted">
                  {step.number}
                </span>
              </div>
              <h3 className="mb-3 text-lg font-semibold text-text-primary">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-text-secondary">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
