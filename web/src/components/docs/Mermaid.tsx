"use client";

import { useEffect, useRef, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        darkMode: true,
        themeVariables: {
          primaryColor: "#6366f1",
          primaryTextColor: "#f0f0f5",
          primaryBorderColor: "#2a2a3a",
          lineColor: "#818cf8",
          secondaryColor: "#16161f",
          tertiaryColor: "#1a1a24",
          background: "#0a0a0f",
          mainBkg: "#16161f",
          nodeBorder: "#2a2a3a",
          clusterBkg: "#111118",
          clusterBorder: "#2a2a3a",
          titleColor: "#f0f0f5",
          edgeLabelBackground: "#16161f",
          nodeTextColor: "#f0f0f5",
        },
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: 14,
      });

      const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
      try {
        const { svg: renderedSvg } = await mermaid.render(id, chart.trim());
        if (!cancelled) {
          setSvg(renderedSvg);
        }
      } catch {
        // Fallback to showing the raw chart in a code block
        if (!cancelled) {
          setSvg("");
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (!svg) {
    // Fallback: show as preformatted text while rendering or on error
    return (
      <pre className="my-6 overflow-x-auto rounded-xl border border-border-default bg-bg-card p-4 text-xs text-text-secondary">
        <code>{chart.trim()}</code>
      </pre>
    );
  }

  return (
    <div
      className="not-prose my-6 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
