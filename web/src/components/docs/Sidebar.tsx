"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export type NavItem = { href: string; label: string };
export type NavSection = { title: string; items: NavItem[] };

export const navigation: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { href: "/docs/", label: "Overview" },
      { href: "/docs/why-firmswap/", label: "Why FirmSwap" },
      { href: "/docs/getting-started/", label: "Quick Start" },
    ],
  },
  {
    title: "For Integrators",
    items: [
      { href: "/docs/sdk/", label: "SDK Reference" },
      { href: "/docs/api-reference/", label: "API Reference" },
    ],
  },
  {
    title: "For Solvers",
    items: [{ href: "/docs/solver-guide/", label: "Solver Guide" }],
  },
  {
    title: "Protocol",
    items: [
      { href: "/docs/smart-contracts/", label: "Smart Contracts" },
      { href: "/docs/architecture/", label: "Architecture" },
      { href: "/docs/deposit-addresses/", label: "Deposit Addresses" },
      { href: "/docs/deployments/", label: "Deployments" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-border-subtle lg:block">
      <nav className="sticky top-16 overflow-y-auto p-6 pt-8 max-h-[calc(100vh-4rem)]">
        {navigation.map((section) => (
          <div key={section.title} className="mb-6">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {section.title}
            </h4>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={clsx(
                        "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-accent/10 font-medium text-accent-hover"
                          : "text-text-secondary hover:bg-bg-card hover:text-text-primary"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
