import { Sidebar } from "@/components/docs/Sidebar";
import { MobileDocsSidebar } from "@/components/docs/MobileDocsSidebar";
import { TableOfContents } from "@/components/docs/TableOfContents";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[1400px] pt-16">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <MobileDocsSidebar />
        <article className="prose prose-invert min-w-0 max-w-none px-4 py-6 sm:px-6 md:px-8 md:py-12 lg:px-12">
          {children}
        </article>
      </div>
      <TableOfContents />
    </div>
  );
}
