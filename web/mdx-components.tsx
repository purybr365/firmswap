import type { MDXComponents } from "mdx/types";
import { Callout } from "@/components/docs/Callout";
import { Mermaid } from "@/components/docs/Mermaid";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    Callout,
    Mermaid,
  };
}
