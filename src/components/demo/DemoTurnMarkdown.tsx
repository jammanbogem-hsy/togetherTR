'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Material Design 3 rendering for live agent turns — the model writes GFM
// (tables, lists, bold), so raw pipes/asterisks must never reach the screen.
const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--md-sys-on-surface)]">{children}</strong>,
  em: ({ children }) => <em className="not-italic text-[var(--md-sys-primary)]">{children}</em>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-[15px] font-semibold text-[var(--md-sys-on-surface)] first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-[15px] font-semibold text-[var(--md-sys-on-surface)] first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold text-[var(--md-sys-on-surface)] first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold text-[var(--md-sys-on-surface)] first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 space-y-1.5 pl-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-[var(--md-sys-primary)]">{children}</ol>,
  li: ({ children, ...props }) => {
    const ordered = (props as { node?: { parent?: { tagName?: string } } }).node?.parent?.tagName === 'ol'
    if (ordered) return <li className="pl-1">{children}</li>
    return (
      <li className="flex gap-2.5">
        <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--md-sys-primary)]" />
        <span className="min-w-0 flex-1">{children}</span>
      </li>
    )
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-r-[var(--md-sys-radius-md)] border-l-4 border-[var(--md-sys-primary)] bg-[var(--md-sys-surface-container)] px-4 py-2 text-[var(--md-sys-on-surface-variant)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-[var(--md-sys-outline-variant)]" />,
  code: ({ children }) => (
    <code className="rounded-[var(--md-sys-radius-xs)] bg-[var(--md-sys-surface-container-high)] px-1.5 py-0.5 text-[0.9em]">{children}</code>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-[var(--md-sys-primary)] underline underline-offset-2">{children}</a>
  ),
  // M3 data table: outlined container, tinted header row, divider-only body
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-[var(--md-sys-radius-md)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)]">
      <table className="w-full min-w-[480px] border-collapse text-left text-[13px] leading-5">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--md-sys-surface-container)]">{children}</thead>,
  th: ({ children }) => (
    <th className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-[var(--md-sys-on-surface-variant)]">{children}</th>
  ),
  tr: ({ children }) => <tr className="border-t border-[var(--md-sys-outline-variant)] first:border-t-0">{children}</tr>,
  td: ({ children }) => <td className="px-4 py-2.5 align-top text-[var(--md-sys-on-surface)]">{children}</td>,
}

export function DemoTurnMarkdown({ content }: { content: string }) {
  return (
    <div className="break-words text-sm leading-6 text-[var(--md-sys-on-surface-variant)]">
      <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]} skipHtml components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
