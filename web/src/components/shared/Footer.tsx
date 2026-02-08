import Link from "next/link";

const links = [
  { href: "/#how-it-works", label: "Protocol" },
  { href: "/docs/", label: "Docs" },
  {
    href: "https://github.com/purybr365/firmswap",
    label: "GitHub",
    external: true,
  },
  {
    href: "https://github.com/purybr365/firmswap/blob/main/LICENSE",
    label: "MIT License",
    external: true,
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border-subtle bg-bg-primary">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-accent text-xs font-bold text-white">
            FS
          </div>
          <span className="text-sm font-medium text-text-secondary">
            FirmSwap Protocol
          </span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="text-sm text-text-muted transition-colors hover:text-text-secondary"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="text-xs text-text-muted">
          Built by FirmSwap contributors
        </p>
      </div>
    </footer>
  );
}
