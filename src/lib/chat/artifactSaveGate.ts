// 산출물 저장 관문 — AI 응답의 [ARTIFACT_UPDATE]를 Firestore에 쓰기 전에 거른다.
//  ① 근거 코드(#39): 허용 목록 밖 코드를 '(근거: …)' 묶음에서 뺀다 (evidenceCodeGate).
//  ② 행 누락(#40): '표는 그대로'라 했는데 이전 표의 행이 빠졌고 사용자가 지우라고 하지 않았으면 그 섹션 저장을 보류한다.
// 대상은 Ds-1-1 평가 계획·Ds-1-3 학습 활동뿐이며, 다른 활동·섹션은 그대로 통과한다.
import { trainingRecordText } from '@/lib/training/trainingRecord'
import type { ArtifactUpdateItem } from './signals'
import { EVIDENCE_GATED_SECTIONS, evidenceGateNotice, gateEvidenceCodes } from './evidenceCodeGate'
import { findDroppedTableRows, userAskedToDeleteRows } from './tableRowGuard'

export interface ArtifactSaveGateInput {
  updates: readonly ArtifactUpdateItem[]
  confirmCodes: readonly string[]
  currentActivity: string
  allowedCodes: readonly string[]
  /** 기존 저장본의 섹션 원문(표 마크다운). 없으면 빈 문자열. */
  previousSection: (activityCode: string, sectionKey: string) => string
  /** 이번 요청을 포함한 최근 사용자 발화 */
  recentUserTexts: readonly string[]
}

export interface ArtifactSaveGateResult {
  updates: ArtifactUpdateItem[]
  confirmCodes: string[]
  notices: string[]
}

function heldRowsNotice(dropped: readonly string[]): string {
  const sample = dropped.slice(0, 2).map(key => `'${key}'`).join(', ')
  return `이전 표의 ${sample}${dropped.length > 2 ? ' 등' : ''} ${dropped.length}줄이 빠져 저장하지 않았습니다. 일부러 지운 거라면 "그 줄은 지우고 저장"이라고 말씀해 주세요.`
}

export function gateArtifactSave(input: ArtifactSaveGateInput): ArtifactSaveGateResult {
  const evidence = gateEvidenceCodes(input.updates, input.currentActivity, input.allowedCodes)
  const notices = [evidenceGateNotice(evidence.removed)]
  const deletionAsked = userAskedToDeleteRows([...input.recentUserTexts])
  const heldActivities = new Set<string>()
  const updates: ArtifactUpdateItem[] = []
  for (const update of evidence.updates) {
    const activityCode = update.activityCode || input.currentActivity
    const keys = EVIDENCE_GATED_SECTIONS[activityCode]
    if (!keys || deletionAsked) { updates.push(update); continue }
    const sections = { ...update.sections }
    for (const key of keys) {
      if (typeof sections[key] !== 'string') continue
      const dropped = findDroppedTableRows(input.previousSection(activityCode, key), sections[key])
      if (!dropped.length) continue
      delete sections[key]
      heldActivities.add(activityCode)
      notices.push(heldRowsNotice(dropped))
    }
    if (Object.keys(sections).length) updates.push({ ...update, sections })
  }
  // 보류한 섹션의 활동은 확정도 함께 보류한다(빠진 표가 확정되지 않게).
  const confirmCodes = input.confirmCodes.filter(code => !heldActivities.has(code || input.currentActivity))
  return { updates, confirmCodes, notices: notices.filter(Boolean) }
}

type StructuredRow = Record<string, unknown>

/**
 * 저장본 섹션을 행 비교용 표 마크다운으로 꺼낸다. 원문 문자열이 있으면 그대로,
 * 구조화 저장본(Ds-1-1 rubric·Ds-1-3 activities)이면 첫 열만 담은 표로 만든다.
 */
export function previousSectionText(content: unknown, activityCode: string, sectionKey: string): string {
  if (!content || typeof content !== 'object') return ''
  const record = content as Record<string, unknown>
  if (sectionKey === '연수 기록' && (activityCode === 'Ds-1-1' || activityCode === 'Ds-1-3')) return trainingRecordText(activityCode, record)
  if (typeof record[sectionKey] === 'string') return record[sectionKey] as string
  if (typeof record['연수 기록'] === 'string') return record['연수 기록']
  const rows = activityCode === 'Ds-1-1' ? record.rubric : activityCode === 'Ds-1-3' ? record.activities : null
  const field = activityCode === 'Ds-1-1' ? 'checkpoint' : 'order'
  if (!Array.isArray(rows) || !rows.length) return ''
  const keys = rows
    .map(row => (row && typeof row === 'object' ? String((row as StructuredRow)[field] ?? '') : '').trim())
    .filter(Boolean)
  return keys.length ? ['| 첫 열 |', '|---|', ...keys.map(key => `| ${key} |`)].join('\n') : ''
}
