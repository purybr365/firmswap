"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { navigation } from "./Sidebar";

export function MobileDocsSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // Find current page label for display
  const currentPage =
    navigation
      .flatMap((s) => s.items)
      .find((item) => item.href === pathname)?.label ?? "Documentation";

  return (
    <div className="lg:hidden">
      {/* Mobile top bar */}
      <div className="sticky top-16 z-30 flex items-center gap-3 border-b border-border-subtle bg-bg-primary/95 px-4 py-3 backdrop-blur-md">
        <button
          onClick={() => setIsOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-bg-card text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary"
          aria-label="Open navigation"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>
        <span className="text-sm font-medium text-text-primary">
          {currentPage}
        </span>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-over drawer */}
      <div
        className={clsx(
          "fixed top-0 left-0 z-50 h-full w-72 transform border-r border-border-subtle bg-bg-primary shadow-xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Drawer header */}
        <div className="flex h-16 items-center justify-between border-b border-border-subtle px-4">
          <Link
            href="/"
            className="flex items-center gap-2"
            onClick={() => setIsOpen(false)}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white">
              FS
            </div>
            <span className="text-sm font-semibold text-text-primary">
              FirmSwap
            </span>
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-card hover:text-text-primary"
            aria-label="Close navigation"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="overflow-y-auto p-4 pt-6" style={{ maxHeight: "calc(100vh - 4rem)" }}>
          {navigation.map((section) => (
            <div key={section.title} className="mb-5">
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
                        onClick={() => setIsOpen(false)}
                        className={clsx(
                          "block rounded-lg px-3 py-2 text-sm transition-colors",
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
      </div>
    </div>
  );
}
