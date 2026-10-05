'use client'

export function WorkspaceSaveStatus({ lastSavedAt, offerReflection, busy, onReflect }: {
  lastSavedAt?: number
  offerReflection: boolean
  busy: boolean
  onReflect: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#5F6368]" role="status">
      <span>입력은 자동 저장돼요{lastSavedAt ? ` · 마지막 저장 ${new Date(lastSavedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span>
      {offerReflection && (
        <span className="inline-flex flex-wrap items-center gap-2">
          산출물에도 반영할까요?
          <button type="button" disabled={busy} onClick={onReflect} className="rounded-full px-3 py-1.5 font-medium text-[#0B57D0] hover:bg-[#E8F0FE] disabled:opacity-50">산출물로 보내기</button>
        </span>
      )}
    </div>
  )
}
