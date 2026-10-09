'use client'

/** 연수 기록은 글 입력 하나로 제공하며 기존 표 문자열도 변경 없이 받는다. */
export function TrainingFieldInput({ id, label, value, onChange, placeholder }: {
  id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string;
}) {
  return <textarea id={id} aria-label={label} value={value} rows={12} placeholder={placeholder ?? '정리한 내용을 적어 주세요.'}
    onChange={event => onChange(event.target.value)}
    className="block w-full min-w-0 min-h-72 resize-y rounded-2xl border border-[#C4C7C5] bg-white px-4 py-3 text-base leading-relaxed text-[#202124] focus:border-[#0B57D0] focus:outline-none focus:ring-2 focus:ring-[#D3E3FD] disabled:bg-[#F8F9FA]" />
}
