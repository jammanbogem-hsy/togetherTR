'use client'

import { useEffect, useMemo, useState } from 'react'
import { FilePdf, FileText, X } from '@phosphor-icons/react'
import type { ChatAttachment } from '@/lib/chat/attachments'

/** Files picked in the composer, before sending. */
export function PendingAttachmentTray({ files, onRemove, busy }: { files: File[]; onRemove: (index: number) => void; busy: boolean }) {
  const previews = useMemo(() => files.map(file => file.type.startsWith('image/') ? URL.createObjectURL(file) : ''), [files])
  useEffect(() => () => previews.forEach(url => url && URL.revokeObjectURL(url)), [previews])
  if (!files.length) return null
  return <ul aria-label="보낼 첨부 파일" className="mb-2 flex flex-wrap gap-2">
    {files.map((file, index) => <li key={`${file.name}-${index}`} className="relative flex h-16 max-w-[220px] items-center gap-2 rounded-xl border border-[#C4C7C5] bg-white pl-1 pr-9">
      {previews[index]
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        ? <img src={previews[index]} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#F1F4F9] text-[#444746]">{file.type === 'application/pdf' ? <FilePdf size={28} /> : <FileText size={28} />}</span>}
      <span className="min-w-0 truncate text-xs text-[#1F1F1F]">{file.name}</span>
      <button type="button" aria-label={`${file.name} 빼기`} disabled={busy} onClick={() => onRemove(index)}
        className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#444746] hover:bg-[#E3E3E3] disabled:opacity-40"><X size={16} /></button>
    </li>)}
  </ul>
}

/** Attachments inside a sent message: photo thumbnails open full size, files open in a new tab. */
export function MessageAttachments({ items, alignRight }: { items: ChatAttachment[]; alignRight?: boolean }) {
  const [openText, setOpenText] = useState(false)
  const read = items.filter(item => item.extract?.trim())
  return <div className={`mt-1 flex max-w-full flex-col gap-1 ${alignRight ? 'items-end' : 'items-start'}`}>
    <ul className={`flex max-w-full flex-wrap gap-2 ${alignRight ? 'justify-end' : ''}`}>
      {items.map(item => <li key={item.id}>
        <a href={item.url} target="_blank" rel="noopener noreferrer" title={`${item.name} 열기`}
          className="flex max-w-[240px] items-center gap-2 rounded-xl border border-[#C4C7C5] bg-white p-1 pr-3 text-xs text-[#1F1F1F] hover:bg-[#F1F4F9] focus-visible:outline-2 focus-visible:outline-[#0B57D0]">
          {item.kind === 'image'
            // eslint-disable-next-line @next/next/no-img-element -- Storage download URL
            ? <img src={item.url} alt={item.name} loading="lazy" className="h-20 w-20 rounded-lg object-cover" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#F1F4F9] text-[#444746]">{item.kind === 'pdf' ? <FilePdf size={26} /> : <FileText size={26} />}</span>}
          <span className="min-w-0 truncate">{item.name}</span>
        </a>
      </li>)}
    </ul>
    {read.length > 0 && <button type="button" aria-expanded={openText} onClick={() => setOpenText(value => !value)}
      className="min-h-8 rounded-full px-2 text-[11px] font-medium text-[#0B57D0] hover:bg-[#E8F0FE]">{openText ? 'AI가 읽은 내용 접기' : 'AI가 읽은 내용 보기'}</button>}
    {openText && <div className="max-h-64 max-w-full overflow-y-auto rounded-xl bg-[#F8FAFD] p-3 text-left text-xs leading-5 text-[#1F1F1F]">
      {read.map(item => <section key={item.id} className="mb-2 last:mb-0"><p className="font-semibold">{item.name}</p><p className="whitespace-pre-wrap break-words">{item.extract}</p></section>)}
    </div>}
    {items.some(item => !item.extract?.trim()) && <p className="px-2 text-[11px] text-[#5F6368]">일부 파일은 AI가 읽지 못했어요. 필요하면 핵심을 한두 줄로 적어 주세요.</p>}
  </div>
}
