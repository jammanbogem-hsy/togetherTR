import ReactMarkdown, { type Components } from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 whitespace-pre-line">{children}</p>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="font-bold mt-2 mb-1">{children}</h3>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-[#AECBFA] bg-[#F8F9FA] pl-3 py-2 my-2">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-xl border border-[#DADCE0]">
      <table className="min-w-full border-collapse text-inherit">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#F8F9FA]">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 text-left font-bold border-b border-[#DADCE0]">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top border-t border-[#E8EAED]">{children}</td>,
}

// 산출물 본문만 Markdown으로 표시하며, 저장된 문자열과 전용 표 구조는 그대로 둔다.
export function ArtifactMarkdown({ children, className, components }: {
  children: string
  className?: string
  components?: Components
}) {
  return (
    <div className={['min-w-0 break-words leading-relaxed', className].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={{ ...markdownComponents, ...components }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
