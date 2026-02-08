"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";

type Heading = { id: string; text: string; level: number };

export function TableOfContents() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll("article h2, article h3")
    );
    const items: Heading[] = elements.map((el) => ({
      id: el.id,
      text: el.textContent || "",
      level: el.tagName === "H2" ? 2 : 3,
    }));
    setHeadings(items);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  if (headings.length === 0) return null;

  return (
    <aside className="hidden w-48 shrink-0 xl:block">
      <nav className="sticky top-16 overflow-y-auto p-4 pt-8 max-h-[calc(100vh-4rem)]">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          On this page
        </h4>
        <ul className="space-y-1">
          {headings.map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                className={clsx(
                  "block text-xs leading-relaxed transition-colors",
                  heading.level === 3 && "pl-3",
                  activeId === heading.id
                    ? "text-accent-hover"
                    : "text-text-muted hover:text-text-secondary"
                )}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
