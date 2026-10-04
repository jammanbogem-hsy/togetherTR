'use client'

export interface TrainingModeValue {
  enabled: boolean
  coreFormal: boolean
}

export function TrainingModeFields({ value, onChange, disabled = false }: {
  value: TrainingModeValue
  onChange: (value: TrainingModeValue) => void
  disabled?: boolean
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-2xl bg-[#E8F0FE] p-4 text-[#202124] disabled:opacity-60">
      <legend className="sr-only">연수용 모드 설정</legend>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={value.enabled}
          onChange={event => onChange({ ...value, enabled: event.target.checked })}
          className="mt-1 size-4 shrink-0 accent-[#0B57D0]" />
        <span>
          <span className="block text-sm font-semibold">연수용 모드</span>
          <span className="mt-1 block text-sm leading-relaxed text-[#3C4043]">오프라인 활동 결과를 간단히 옮겨 적습니다. AI는 필수 내용만 확인하고 더 묻지 않으며, 도움은 요청할 때만 줍니다.</span>
        </span>
      </label>
      {value.enabled && (
        <label className="flex cursor-pointer items-start gap-3 border-t border-[#A8C7FA] pt-3">
          <input type="checkbox" checked={value.coreFormal}
            onChange={event => onChange({ ...value, coreFormal: event.target.checked })}
            className="mt-1 size-4 shrink-0 accent-[#0B57D0]" />
          <span>
            <span className="block text-sm font-semibold">핵심 절차는 정식으로 진행</span>
            <span className="mt-1 block text-sm leading-relaxed text-[#3C4043]">T-1·T-2·A-2·A-3·A-4는 AI가 단계마다 안내합니다.</span>
          </span>
        </label>
      )}
    </fieldset>
  )
}
