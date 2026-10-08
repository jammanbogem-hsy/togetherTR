'use client'

import { useId, useRef, useState } from 'react'

export interface ReplyChoicesProps {
  question: string
  options: string[]
  disabled?: boolean
  onSelect: (option: string) => void | Promise<void>
  onCustom: () => void
}

export function ReplyChoices(props: ReplyChoicesProps) {
  if (props.options.length < 2 || props.options.length > 4 || props.options.some(option => !option.trim())) return null
  // 새 질문에는 앞 질문의 클릭 잠금을 넘기지 않는다.
  return <ReplyChoicesContent key={JSON.stringify([props.question, props.options])} {...props} />
}

function ReplyChoicesContent({ question, options, disabled = false, onSelect, onCustom }: ReplyChoicesProps) {
  const id = useId()
  const lockRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const locked = disabled || busy || selected !== null

  async function choose(option: string) {
    if (disabled || lockRef.current) return
    lockRef.current = true
    setBusy(true)
    setError('')
    try {
      await onSelect(option)
      setSelected(option)
    } catch {
      lockRef.current = false
      setError('답변을 보내지 못했어요. 다시 선택하거나 직접 입력해 주세요.')
    } finally { setBusy(false) }
  }

  function custom() {
    if (disabled || lockRef.current) return
    setError('')
    onCustom()
  }

  return <section role="group" aria-labelledby={id} aria-busy={busy} className="my-3 min-w-0 rounded-2xl border border-[#C4C7C5] bg-[#F8F9FA] p-4">
    <p id={id} className="sr-only">{question}</p>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
      {options.map(option => <button key={option} type="button" disabled={locked} onClick={() => void choose(option)}
        className="min-h-11 min-w-0 rounded-2xl bg-[#D3E3FD] px-4 py-2.5 text-left text-base font-medium leading-relaxed text-[#0842A0] transition-colors hover:bg-[#A8C7FA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0] disabled:opacity-50 [word-break:keep-all] [overflow-wrap:anywhere]">
        {option}
      </button>)}
    </div>
    <button type="button" disabled={locked} onClick={custom}
      className="mt-3 min-h-11 rounded-full border border-[#747775] bg-white px-4 py-2.5 text-base font-medium text-[#444746] hover:bg-[#E8EAED] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0] disabled:opacity-50">직접 입력하기</button>
    {busy && <p role="status" aria-live="polite" className="mt-2 text-sm text-[#444746]">답변을 보내는 중…</p>}
    {selected && <p role="status" aria-live="polite" className="mt-2 text-sm text-[#137333]">선택한 답변: {selected}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-[#C5221F]">{error}</p>}
  </section>
}
