import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 pt-32">
      <div className="text-6xl font-bold text-text-muted">404</div>
      <p className="mt-4 text-text-secondary">Page not found</p>
      <Link
        href="/"
        className="mt-8 inline-flex h-10 items-center rounded-lg bg-accent px-6 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Back to Home
      </Link>
    </div>
  );
}
