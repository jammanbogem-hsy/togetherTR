'use client'

// 메인 채팅 제목 줄의 "평가 루브릭 작성" 버튼 — 설계 단계(Ds-1~Ds-5)에서만 보인다.

import { ListChecks } from '@phosphor-icons/react'
import { MD3Button, MD3_ICON } from '@/components/ui/MD3Button'
import type { ActivityCode } from '@/types'
import { useRubricEditor } from './useRubricEditor'

export function ChatRubricButton({ activityCode }: { activityCode: ActivityCode }) {
  const rubric = useRubricEditor(activityCode)
  if (!rubric.enabled || !rubric.canEdit) return null
  return (
    <>
      <MD3Button
        onClick={rubric.openEditor}
        title="평가 루브릭을 작성해 산출물 아래에 붙입니다"
        variant="tonal"
        tone="purple"
        icon={<ListChecks size={MD3_ICON.sm} weight="bold" />}
      >
        {rubric.rows.length > 0 ? '루브릭 편집' : '평가 루브릭 작성'}
      </MD3Button>
      {rubric.editor}
    </>
  )
}
