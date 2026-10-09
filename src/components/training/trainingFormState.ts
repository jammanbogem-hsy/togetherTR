import { TRAINING_ACTIVITIES, TRAINING_ADVICE_ON, TRAINING_ADVICE_OFF, TRAINING_ADVICE_ONCE } from '@/lib/training/trainingMode'
import { trainingFormText } from './trainingFormText'
import type { ActivityCode } from '@/types'

// 일반 모드의 구조화 산출물도 입력칸에 불러와 기존 기록을 이어 쓴다.
export const STRUCTURED_FIELDS: Partial<Record<ActivityCode, Record<string, string[]>>> = {
  'T-1-1': { '팀 공통 비전': ['teamVision'], '핵심 키워드': ['coreKeywords'], '개인 비전': ['personalVisions'] },
  'T-1-2': { '설계 방향': ['designPrinciples'] },
  'T-2-1': { '역할 배분': ['roles'] },
  'T-2-2': { '팀 규칙': ['rules'] },
  'T-2-3': { '팀 일정': ['schedule'] },
  'A-1-2': { '최종 선정 주제': ['selectedTopic'], '선정 근거': ['rationale'], '주제 선정 기준': ['criteria'], '주제 유형': ['topicType'] },
  'A-2-1': { '성취기준분석표': ['rows'] },
  'A-2-2': { '통합 수업목표': ['integratedGoal'], '공통 핵심 아이디어': ['commonCoreIdea'], '탐구 질문': ['inquiryQuestion'], '교과별 수업목표': ['subjectGoals'] },
  'A-2-3': { '학습자 프로필': ['commonProfile', 'teacherNotes'] },
  'Ds-1-1': { '평가 계획': ['rubric'] },
  'Ds-1-2': { '문제상황': ['scenario'], '핵심 질문': ['drivingQuestion'] },
  'Ds-1-3': { '학습 활동': ['activities'], 'AI 점검': ['review'] },
  'Ds-2-1': { '활동별 자료 설계': ['materials'], 'Human-AI Agency': ['humanAIAgency'], 'AI 점검': ['envCheck'] },
  'Ds-2-2': { '스캐폴딩 계획': ['scaffolds'], '지원 방안 정리': ['supportPlans'], 'AI 점검': ['review'] },
}

export function trainingFormValues(code: ActivityCode, content: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(TRAINING_ACTIVITIES[code].fields.map(field => {
    const direct = content[field.key]
    const aliases = STRUCTURED_FIELDS[code]?.[field.key] ?? []
    const value = direct ?? (aliases.length === 1 ? content[aliases[0]] : aliases.length > 1
      ? Object.fromEntries(aliases.filter(key => content[key] != null).map(key => [key, content[key]])) : undefined)
    return [field.key, trainingFormText(value, code)]
  }))
}

export function buildTrainingFormContent(code: ActivityCode, previous: Record<string, unknown>, values: Record<string, string>): Record<string, unknown> {
  const result = { ...previous }
  const aliases = STRUCTURED_FIELDS[code] ?? {}
  // 기존 섹션 형식으로 저장한다. 같은 칸의 구조화 별칭이 편집값과 충돌하지 않게 정리한다.
  if (Object.keys(aliases).length > 0) delete result._schema
  for (const keys of Object.values(aliases)) for (const key of keys) delete result[key]
  for (const field of TRAINING_ACTIVITIES[code].fields) {
    const text = (values[field.key] ?? '').trim()
    if (!text) delete result[field.key]
    else result[field.key] = text
  }
  return result
}

export function trainingAdviceKey(projectId: string): string {
  return `tcid:training-advice:${projectId}`
}

export function trainingSaveAdviceSuffix(quiet: boolean, advice: boolean): string {
  if (!advice) return TRAINING_ADVICE_OFF
  return quiet ? TRAINING_ADVICE_ONCE : TRAINING_ADVICE_ON
}


export interface TrainingDraft {
  sourceKey: string
  sourceValues: Record<string, string>
  values: Record<string, string>
  dirty: Record<string, boolean>
  conflicts: string[]
}

export function createTrainingDraft(code: ActivityCode, content: Record<string, unknown>): TrainingDraft {
  const values = trainingFormValues(code, content)
  return { sourceKey: JSON.stringify(content), sourceValues: values, values, dirty: {}, conflicts: [] }
}

/** 실질적인 미저장 수정만 보호한다. 원래 값으로 되돌린 칸은 최신 AI/팀 저장값을 받는다. */
export function syncTrainingDraft(draft: TrainingDraft, code: ActivityCode, content: Record<string, unknown>): TrainingDraft {
  const incoming = createTrainingDraft(code, content)
  for (const [key, value] of Object.entries(incoming.values)) {
    const edited = draft.dirty[key] && draft.values[key] !== draft.sourceValues[key]
    if (edited && draft.values[key] !== value) {
      incoming.values = { ...incoming.values, [key]: draft.values[key] }
      incoming.dirty[key] = true
      if (value !== draft.sourceValues[key] || draft.conflicts.includes(key)) incoming.conflicts.push(key)
    }
  }
  return incoming
}

export function editTrainingDraft(draft: TrainingDraft, key: string, value: string): TrainingDraft {
  const dirty = value !== draft.sourceValues[key]
  return { ...draft, values: { ...draft.values, [key]: value }, dirty: { ...draft.dirty, [key]: dirty },
    conflicts: dirty ? draft.conflicts : draft.conflicts.filter(field => field !== key) }
}

export function loadSavedTrainingFields(draft: TrainingDraft): TrainingDraft {
  const values = { ...draft.values }, dirty = { ...draft.dirty }
  for (const key of draft.conflicts) { values[key] = draft.sourceValues[key]; dirty[key] = false }
  return { ...draft, values, dirty, conflicts: [] }
}
