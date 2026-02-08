"use client";

import { motion } from "framer-motion";

const narrativeCards = [
  {
    title: "The Problem",
    description:
      "Picnic, a fully on-chain crypto neobank for Brazilian users, needed predictable FX swaps. Users would sign a swap transaction before paying via PIX, but the PIX-to-BRLA pipeline takes time \u2014 the user goes to their bank, pays PIX, and the payment becomes on-chain BRLA. By the time tokens arrived, the price had moved. An extra approval transaction made UX even worse.",
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
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
    ),
  },
  {
    title: "The Gap",
    description:
      "In traditional finance, services like Wise guarantee a quoted exchange rate for hours \u2014 sometimes even days. In DeFi, prices expire in seconds. Users were shown one price at quote time and received another at execution. This created frustration and eroded trust in a system that should be more transparent, not less.",
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
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
        />
      </svg>
    ),
  },
  {
    title: "The Solution",
    description:
      "FirmSwap locks every quote to an exact price and an on-chain deadline. Solvers bond capital as collateral \u2014 if they miss the deadline, users get a full refund plus bond compensation. Zero-transaction deposits remove the extra approval step. No slippage, no surprises, no trust assumptions.",
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
          d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
        />
      </svg>
    ),
  },
];

export function WhyFirmSwap() {
  return (
    <section className="py-12 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center md:mb-16"
        >
          <div className="mb-4 inline-flex items-center rounded-full border border-border-default bg-bg-card px-3 py-1 text-xs font-medium text-accent-hover">
            Built from Real Needs
          </div>
          <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
            Why FirmSwap Exists
          </h2>
          <p className="mx-auto max-w-2xl text-text-secondary">
            FirmSwap was born from a real problem at{" "}
            <span className="font-medium text-text-primary">Picnic</span>, a
            fully on-chain crypto neobank for Brazilian users. Picnic trades
            BRLA, a Brazilian Real stablecoin, to and from USDC &mdash; enabling
            users to go from fiat to any token in seconds via DeFi.
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-3">
          {narrativeCards.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="rounded-2xl border border-border-default bg-bg-card p-6 sm:p-8"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent-hover">
                {card.icon}
              </div>
              <h3 className="mb-3 text-lg font-semibold text-text-primary">
                {card.title}
              </h3>
              <p className="text-sm leading-relaxed text-text-secondary">
                {card.description}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="mt-10 text-center text-lg font-medium text-text-primary md:mt-14 md:text-xl"
        >
          That&apos;s crypto solving{" "}
          <span className="text-accent-hover">real-world problems</span>.
        </motion.p>
      </div>
    </section>
  );
}
