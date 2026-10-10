/**
 * 활동 완료 판정 헬퍼 (P1-I)
 *
 * 이전: `isEffectivelyDone`이 StageBar.tsx:335, ActivitySidebar.tsx:263 두 곳에 중복 존재.
 * 현재: 여기로 중앙화 + E 단계 필수 섹션 검증 추가.
 *
 * ── 회귀 방지 원칙 ────────────────────────────────────────
 * - non-E 활동(T/A/Ds/DI): 기존 로직(status + artifact 존재 여부)과 100% 동일.
 * - E 활동: `_schemaVersion === 'v2-sections'` 인 산출물만 섹션 검증 수행.
 *   레거시(undefined/기타) E 산출물은 grandfather — 기존 로직으로만 완료 판정.
 */

import type { ActivityCode, Project, StageStatus } from '@/types'
import { ACTIVITY_META } from '@/types'
import { validateRequiredSections } from './requiredSections'
import { isTrainingActivity } from '@/lib/training/trainingMode'
import { trainingRecordText } from '@/lib/training/trainingRecord'

export { validateRequiredSections } from './requiredSections'

type ActivityStatusMap = Partial<Record<ActivityCode, StageStatus>> | Record<string, StageStatus>
type ArtifactsMap = Project['artifacts']

/**
 * 활동이 "실질적으로 완료"되었는지 판정.
 * - 상태(status)가 completed 또는 warning 이면서
 * - 해당 활동의 산출물이 존재하고
 * - requiredSections 정의가 있고 v2-sections 스키마면 → 섹션 검증까지 통과해야 완료
 */
export function isEffectivelyDone(
  code: ActivityCode,
  activityStatus: ActivityStatusMap,
  artifacts: ArtifactsMap,
  project?: Pick<Project, 'trainingMode'> | null,
): boolean {
  const status = activityStatus[code]
  const artifact = artifacts?.[code]
  const hasArtifact = !!artifact

  // 연수용 활동은 하나의 기록을 저장하면 완료한다. 기존 섹션/표 저장도 동일하게 읽는다.
  if (isTrainingActivity(project, code)) {
    if (!artifact || artifact.status === 'rejected') return false
    return !!trainingRecordText(code, artifact.content ?? {}).trim()
  }

  // 기존 로직 (non-E 활동은 여기서 판정 종료)
  const baseDone = (status === 'completed' || status === 'warning') && hasArtifact
  if (!baseDone) return false

  // 섹션 검증은 requiredSections가 정의된 활동에만 적용
  const meta = ACTIVITY_META[code]
  if (!meta.requiredSections || meta.requiredSections.length === 0) return true

  // Grandfather: v2-sections 스키마가 아니면 레거시 산출물로 간주 → 통과
  if (artifact!._schemaVersion !== 'v2-sections') return true

  // v2-sections: 실제 섹션 검증
  return validateRequiredSections(
    artifact!.content,
    meta.requiredSections
  )
}

/**
 * 사이드바 배지에 보일 상태. '완료'는 isEffectivelyDone과 같은 기준으로만 보인다 —
 * 저장된 상태가 completed여도(다음 활동으로 넘어갔다 돌아옴, 산출물 삭제 등) 기록이 없으면
 * 지금 활동은 '진행 중', 지나간 활동은 '미완성 — 복귀 필요'로 보인다.
 */
export function displayActivityStatus(status: StageStatus, done: boolean, isCurrent: boolean): StageStatus {
  if (done) return 'completed'
  if (status === 'completed') return isCurrent ? 'in_progress' : 'warning'
  return status
}

/**
 * artifact.content(Record<string, unknown>)에 대해 requiredSections 검증.
 * content 키는 AI의 [ARTIFACT_UPDATE: <섹션명>=<값>] 신호에서 유래하므로
 * RequiredSection.key와 자연스럽게 매칭됨(한글 라벨 그대로).
 */
/**
 * E 산출물에서 "수정안"/"개선안"/"팀 개선안" 섹션을 안전하게 추출.
 * - v2-sections 스키마면 content[key] 직접 접근.
 * - 레거시면 content의 모든 string 값 중 알려진 키 후보에 해당하는 것을 best-effort로 찾음.
 *
 * 결과: 추출 실패 시 undefined (호출부는 필드 미기록 처리).
 */
export function extractImprovementText(
  artifact: { content: Record<string, unknown>; _schemaVersion?: string } | undefined,
  candidateKeys: string[]
): string | undefined {
  if (!artifact?.content) return undefined
  for (const k of candidateKeys) {
    const v = artifact.content[k]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  // fallback: 키 정규화(공백/기호 제거) 비교
  const normalized = (s: string) => s.replace(/[\s:·.-]/g, '').toLowerCase()
  const normalizedCandidates = candidateKeys.map(normalized)
  for (const [k, v] of Object.entries(artifact.content)) {
    if (typeof v !== 'string' || v.trim().length === 0) continue
    if (normalizedCandidates.includes(normalized(k))) return v.trim()
  }
  return undefined
}

/**
 * E-2-1의 "다음 주기 선택" 값에서 A안/B안 판정.
 * 'A안 ...', 'A', 'a안' 등 관대하게 해석. 판별 불가 시 undefined.
 */
export function parseNextCycleChoice(text: string | undefined): 'A' | 'B' | undefined {
  if (!text) return undefined
  const t = text.trim().toLowerCase()
  // 가장 먼저 등장하는 A/B 단일 문자를 사용 (B안 먼저, A안 나중 등의 혼동 방지)
  const aIdx = t.search(/\ba안\b|^a\b|\s+a\s+|\ba\s*안/)
  const bIdx = t.search(/\bb안\b|^b\b|\s+b\s+|\bb\s*안/)
  if (aIdx < 0 && bIdx < 0) return undefined
  if (aIdx >= 0 && (bIdx < 0 || aIdx < bIdx)) return 'A'
  if (bIdx >= 0) return 'B'
  return undefined
}
