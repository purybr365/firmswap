"use client";

import { motion } from "framer-motion";

const firmswap = {
  name: "FirmSwap",
  highlight: true,
  priceGuarantee: "Firm (exact)",
  deadlineModel: "On-chain (uint32)",
  solverBond: "5% per order",
  contractSize: "~630 lines",
  governance: "None",
  token: "None",
  oracle: "None",
  zeroTxDeposit: true,
  erc7683: true,
};

const competitors = [
  {
    name: "CoW Protocol",
    highlight: false,
    priceGuarantee: "Batch auction",
    deadlineModel: "Batch window",
    solverBond: "No",
    contractSize: "~5,000+",
    governance: "CowDAO",
    token: "COW",
    oracle: "Batch auction",
    zeroTxDeposit: false,
    erc7683: false,
  },
  {
    name: "UniswapX",
    highlight: false,
    priceGuarantee: "Dutch auction",
    deadlineModel: "Auction decay",
    solverBond: "No",
    contractSize: "~3,000+",
    governance: "Uniswap DAO",
    token: "UNI",
    oracle: "None",
    zeroTxDeposit: false,
    erc7683: false,
  },
  {
    name: "1inch Fusion",
    highlight: false,
    priceGuarantee: "Dutch auction",
    deadlineModel: "Auction decay",
    solverBond: "No",
    contractSize: "Closed source",
    governance: "1inch DAO",
    token: "1INCH",
    oracle: "None",
    zeroTxDeposit: false,
    erc7683: false,
  },
  {
    name: "Across",
    highlight: false,
    priceGuarantee: "Firm",
    deadlineModel: "On-chain",
    solverBond: "Yes",
    contractSize: "~4,000+",
    governance: "UMA DAO",
    token: "ACX",
    oracle: "UMA oracle",
    zeroTxDeposit: false,
    erc7683: false,
  },
];

const protocols = [firmswap, ...competitors];

type Protocol = typeof firmswap;

const featureKeys: { label: string; key: keyof Protocol; type: "text" | "bool" }[] = [
  { label: "Price guarantee", key: "priceGuarantee", type: "text" },
  { label: "Deadline model", key: "deadlineModel", type: "text" },
  { label: "Solver bond", key: "solverBond", type: "text" },
  { label: "Contract size", key: "contractSize", type: "text" },
  { label: "Governance", key: "governance", type: "text" },
  { label: "Token required", key: "token", type: "text" },
  { label: "Oracle dependency", key: "oracle", type: "text" },
  { label: "Zero-tx deposit", key: "zeroTxDeposit", type: "bool" },
  { label: "ERC-7683", key: "erc7683", type: "bool" },
];

const Check = () => (
  <span className="font-bold text-green">&#10003;</span>
);
const Cross = () => (
  <span className="text-text-muted">&#10007;</span>
);

function BoolValue({ value }: { value: boolean }) {
  return value ? <Check /> : <Cross />;
}

export function Comparison() {
  return (
    <section className="bg-bg-secondary py-12 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center md:mb-16"
        >
          <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
            How FirmSwap Compares
          </h2>
          <p className="mx-auto max-w-2xl text-text-secondary">
            FirmSwap is the simplest bonded-solver protocol. No token, no DAO,
            no oracle — just guaranteed prices with deadline enforcement and
            accountability.
          </p>
        </motion.div>

        {/* Desktop table — hidden on mobile */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="hidden overflow-x-auto md:block"
        >
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="pb-4 pr-4 text-left font-semibold text-text-primary">
                  Feature
                </th>
                {protocols.map((p) => (
                  <th
                    key={p.name}
                    className={`px-3 pb-4 text-center font-semibold ${
                      p.highlight ? "text-accent-hover" : "text-text-primary"
                    }`}
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-text-secondary">
              {featureKeys.map((feat) => (
                <Row key={feat.key} label={feat.label}>
                  {protocols.map((p) => (
                    <Cell key={p.name} highlight={p.highlight}>
                      {feat.type === "bool" ? (
                        <BoolValue value={p[feat.key] as boolean} />
                      ) : (
                        (p[feat.key] as string)
                      )}
                    </Cell>
                  ))}
                </Row>
              ))}
            </tbody>
          </table>
        </motion.div>

        {/* Mobile card layout — visible on mobile only */}
        <div className="space-y-4 md:hidden">
          {competitors.map((comp, i) => (
            <motion.div
              key={comp.name}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="rounded-xl border border-border-default bg-bg-card overflow-hidden"
            >
              {/* Card header */}
              <div className="flex border-b border-border-subtle">
                <div className="flex-1 bg-accent/5 px-4 py-3 text-center text-sm font-semibold text-accent-hover">
                  FirmSwap
                </div>
                <div className="flex-1 px-4 py-3 text-center text-sm font-semibold text-text-primary">
                  {comp.name}
                </div>
              </div>

              {/* Feature rows */}
              {featureKeys.map((feat) => (
                <div
                  key={feat.key}
                  className="flex border-b border-border-subtle last:border-b-0"
                >
                  <div className="w-full">
                    <div className="px-4 pt-2 text-xs font-medium text-text-muted">
                      {feat.label}
                    </div>
                    <div className="flex">
                      <div className="flex-1 bg-accent/5 px-4 pb-2 pt-1 text-center text-xs text-text-primary">
                        {feat.type === "bool" ? (
                          <BoolValue value={firmswap[feat.key] as boolean} />
                        ) : (
                          (firmswap[feat.key] as string)
                        )}
                      </div>
                      <div className="flex-1 px-4 pb-2 pt-1 text-center text-xs text-text-secondary">
                        {feat.type === "bool" ? (
                          <BoolValue value={comp[feat.key] as boolean} />
                        ) : (
                          (comp[feat.key] as string)
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-b border-border-subtle">
      <td className="py-3.5 pr-4 text-left font-medium text-text-primary">
        {label}
      </td>
      {children}
    </tr>
  );
}

function Cell({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <td
      className={`px-3 py-3.5 text-center ${
        highlight ? "bg-accent/5 font-medium text-text-primary" : ""
      }`}
    >
      {children}
    </td>
  );
}
