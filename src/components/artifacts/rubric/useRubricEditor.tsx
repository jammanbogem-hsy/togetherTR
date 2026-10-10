'use client'

// 평가 루브릭 작성 창 상태 — 채팅 위 버튼과 산출물 아래 "편집"이 같은 창을 연다.
// 저장된 표·AI 제안 맥락(앞 활동 산출물·시트 성취기준·활동 대화)·저장 함수를 한곳에서 만든다.

import { useMemo, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { isDemoObservationOnly } from '@/lib/demo/observer'
import { useAdminObserver } from '@/components/admin/useAdminObserver'
import { ACTIVITY_META, displayActivityCode, type ActivityCode } from '@/types'
import { isRubricActivity, normalizeRubricRows, type RubricRow } from '@/lib/rubric/rubric'
import { serializeArtifactForPrompt } from '@/lib/artifacts/serializeArtifactForPrompt'
import { setActivityRubric } from '@/lib/firebase/projects'
import { RubricEditorModal, type RubricSuggestContext } from './RubricEditorModal'

/** 성취기준 근거(A-3) → 목표(A-4) → 설계 단계 산출물 순서. 이 활동까지만 AI 맥락에 넣는다. */
const CONTEXT_ORDER: ActivityCode[] = ['A-2-1', 'A-2-2', 'Ds-1-1', 'Ds-1-2', 'Ds-1-3', 'Ds-2-1', 'Ds-2-2']

export function useRubricEditor(activityCode: ActivityCode) {
  const project = useProjectStore(s => s.project)
  const userProfile = useProjectStore(s => s.userProfile)
  const messages = useProjectStore(s => s.messages)
  const adminObserver = useAdminObserver()
  const [open, setOpen] = useState(false)

  const enabled = isRubricActivity(activityCode)
  const canEdit = enabled && !!project && !isDemoObservationOnly(project) && !adminObserver
  const storedRows = project?.evaluationRubrics?.[activityCode]?.rows
  const rows = useMemo(() => normalizeRubricRows(storedRows), [storedRows])
  const title = `${displayActivityCode(activityCode)} ${ACTIVITY_META[activityCode]?.label ?? ''} 평가 루브릭`

  const suggestContext = (): RubricSuggestContext => {
    const artifactText = (code: ActivityCode) => {
      const content = project?.artifacts?.[code]?.content as Record<string, unknown> | undefined
      return content ? serializeArtifactForPrompt(content) : ''
    }
    const upto = CONTEXT_ORDER.indexOf(activityCode)
    const priorArtifacts = CONTEXT_ORDER.slice(0, upto + 1)
      .map(code => ({ label: `${displayActivityCode(code)} ${ACTIVITY_META[code].label}`, text: artifactText(code) }))
      .filter(a => a.text.trim())
    const sheetStandards = (project?.curriculumSheet ?? []).map(row => row.standard).filter(Boolean).join('\n')
    if (sheetStandards.trim()) priorArtifacts.unshift({ label: '교육과정 분석 시트 성취기준', text: sheetStandards })
    return {
      projectTitle: project?.title,
      targetGradeGroup: project?.targetGradeGroup,
      targetSubjects: project?.targetSubjects,
      priorArtifacts,
      chatContext: messages
        .filter(m => m.activityCode === activityCode)
        .map(m => ({ role: m.role, content: m.content, displayName: m.displayName })),
    }
  }

  const save = async (next: RubricRow[]) => {
    if (!project) return
    await setActivityRubric(project.id, activityCode, next, userProfile?.displayName)
  }

  const editor = open && canEdit ? (
    <RubricEditorModal
      activityCode={activityCode}
      activityLabel={title}
      initialRows={rows}
      suggestContext={suggestContext}
      onSave={save}
      onClose={() => setOpen(false)}
    />
  ) : null

  return { enabled, canEdit, rows, title, openEditor: () => setOpen(true), editor }
}
