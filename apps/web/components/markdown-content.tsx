import Markdown, { type Components } from "react-markdown";

import { Link } from "./link";

const components: Components = {
  a: ({ children, href }) =>
    href ? (
      <Link
        className="rounded-sm font-semibold text-accent underline underline-offset-4 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent data-hovered:decoration-2 data-pressed:opacity-75"
        href={href}
      >
        {children}
      </Link>
    ) : (
      children
    ),
  h2: ({ children }) => <h2 className="text-xl font-bold tracking-tight text-ink">{children}</h2>,
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-6">{children}</ol>,
  p: ({ children }) => <p className="leading-7 text-ink">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>,
};

export function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="space-y-3">
      <Markdown components={components} skipHtml>
        {children}
      </Markdown>
    </div>
  );
}
