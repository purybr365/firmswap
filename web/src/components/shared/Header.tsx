"use client";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";

const navLinks = [
  { href: "/#how-it-works", label: "Protocol" },
  { href: "/docs/", label: "Docs" },
  {
    href: "https://github.com/purybr365/firmswap",
    label: "GitHub",
    external: true,
  },
];

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-white text-sm">
            FS
          </div>
          <span className="text-lg font-semibold text-text-primary">
            FirmSwap
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex flex-col gap-1.5 md:hidden"
          aria-label="Toggle menu"
        >
          <span
            className={clsx(
              "block h-0.5 w-5 bg-text-secondary transition-transform",
              mobileOpen && "translate-y-2 rotate-45"
            )}
          />
          <span
            className={clsx(
              "block h-0.5 w-5 bg-text-secondary transition-opacity",
              mobileOpen && "opacity-0"
            )}
          />
          <span
            className={clsx(
              "block h-0.5 w-5 bg-text-secondary transition-transform",
              mobileOpen && "-translate-y-2 -rotate-45"
            )}
          />
        </button>
      </div>

      {mobileOpen && (
        <nav className="border-t border-border-subtle bg-bg-primary/95 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-1 px-6 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
