/**
 * 성취기준별 성취수준(A·B·C) — 교육부·한국교육과정평가원 「2022 개정 교육과정에 따른 성취수준」
 * 초등 1~2·3~4·5~6학년군 3권에서 추출한 원문 (server only).
 *
 * 데이터: public/achievement-levels.json (scripts/extract-achievement-levels.mjs 가 생성).
 * data/ 는 배포 번들에 실리지 않으므로 public/ 에 둔다 — scripts/sync-runtime-assets.mjs 머리말 참고.
 *
 * 왜 필요한가: 성취기준 → 성취수준 → 학습활동 → 평가가 한 줄로 이어져야 한다. 수준 근거가 없으면
 * AI가 루브릭 상·중·하를 일반 문구("목표를 완전히 달성하고 창의적으로 확장")로 지어낸다.
 * 매칭은 반드시 성취기준 코드로만 한다(교과명·영역명은 문서마다 달라 신뢰하지 않는다).
 */

import fs from 'fs'
import path from 'path'
import type { ActivityCode } from '@/types'
import { designStandardSources, extractStandardCodes } from './standardCodes'

export { designStandardSources, extractStandardCodes }

export interface AchievementLevelEntry {
  band: string        // '1-2학년군' | '3-4학년군' | '5-6학년군'
  subject: string     // 성취수준 문서의 교과명 (표시용)
  A: string
  B: string
  C: string
  inferred?: boolean  // 원문에 A·B·C 글자가 없어 서술 순서로 배정한 경우
}

interface AchievementLevelFile {
  source: string
  count: number
  standards: Record<string, AchievementLevelEntry>
}

const DATA_FILE = path.join(process.cwd(), 'public', 'achievement-levels.json')

let cache: AchievementLevelFile | null = null

/** 성취수준 파일을 읽는다. 없거나 깨졌으면 빈 결과를 돌려주되 조용히 삼키지 않고 로그를 남긴다. */
export function loadAchievementLevels(): AchievementLevelFile {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as AchievementLevelFile
  } catch (error) {
    console.error(`[achievementLevels] failed to load ${DATA_FILE}:`, error)
    cache = { source: '', count: 0, standards: {} }
  }
  return cache
}

/** "[4사03-02]" 형식의 성취기준 코드 하나의 성취수준. 없으면 null. */
export function getAchievementLevels(code: string): AchievementLevelEntry | null {
  const key = code.trim().startsWith('[') ? code.trim() : `[${code.trim()}]`
  return loadAchievementLevels().standards[key] ?? null
}

/** 여러 글에서 성취기준 코드를 뽑아 성취수준 데이터가 있는 코드만 남긴다. */
export function knownStandardCodesIn(texts: readonly string[]): string[] {
  const { standards } = loadAchievementLevels()
  return extractStandardCodes(texts.join('\n')).filter(code => standards[code])
}

/** 이 설계에서 다루는 성취기준 코드(성취수준 데이터가 있는 것만, 처음 나온 순서). */
export function collectDesignStandardCodes(
  artifacts: Parameters<typeof designStandardSources>[0],
  curriculumSheet?: Parameters<typeof designStandardSources>[1],
): string[] {
  return knownStandardCodesIn(designStandardSources(artifacts, curriculumSheet))
}

/** 성취수준 원문을 주입하는 활동. A-2-1에서 성취기준이 확정된 뒤의 목표·설계 활동. */
export const ACHIEVEMENT_LEVEL_ACTIVITIES: readonly ActivityCode[] = ['A-2-2', 'Ds-1-1', 'Ds-1-3', 'Ds-2-2']

const ACTIVITY_USAGE: Partial<Record<ActivityCode, string>> = {
  'A-2-2': '통합 수업목표가 어느 수준의 행동을 겨냥하는지, 각 성취기준의 A·B·C 원문에 쓰인 동사와 조건으로 확인하도록 돕는다. 목표를 성취수준 원문으로 대체하지 않는다.',
  'Ds-1-1': '루브릭의 상·중·하는 해당 성취기준의 A·B·C 원문에서 출발한다(상↔A, 중↔B, 하↔C). 이 수업의 과제·산출물 장면에 맞게 표현만 구체화하고, 각 칸에 근거 성취기준 코드를 적는다. 수준을 일반 문구로 새로 지어내지 않는다.',
  'Ds-1-3': '핵심 활동마다 학생이 A 수준의 행동을 실제로 해 볼 기회가 있는지 점검한다. A 원문의 동사와 조건(예: "다양한 자료를 통해")이 활동 안에 없으면 그 수준에 도달할 기회가 없다는 뜻이다.',
  'Ds-2-2': 'C → B → A 원문 사이의 행동 차이를 근거로, 어느 활동에서 무엇을 지원하고 언제 지원을 줄일지 제안한다.',
}

/** 한 번에 넣는 성취기준 수 상한 — 융합 설계는 보통 3~8개, 프롬프트 비대화를 막는다. */
const MAX_CODES = 12

/**
 * 활동 프롬프트에 붙일 성취수준 블록. 대상 활동이 아니거나 코드가 없으면 빈 문자열.
 * @MX:NOTE [AUTO] 성취수준 주입 지점 — 채팅 스트림 라우트와 평가 계획 제안 라우트가 함께 쓴다
 */
export function buildAchievementLevelContext(activityCode: ActivityCode, codes: readonly string[]): string {
  if (!ACHIEVEMENT_LEVEL_ACTIVITIES.includes(activityCode)) return ''
  const entries = codes
    .map(code => [code, getAchievementLevels(code)] as const)
    .filter((pair): pair is readonly [string, AchievementLevelEntry] => pair[1] != null)
  if (entries.length === 0) return ''

  const shown = entries.slice(0, MAX_CODES)
  const blocks = shown.map(([code, e]) => [
    `### ${code} ${e.subject} (${e.band})${e.inferred ? ' — 원문에 A·B·C 표시가 없어 서술 순서로 배정' : ''}`,
    `- A: ${e.A}`,
    `- B: ${e.B}`,
    `- C: ${e.C}`,
  ].join('\n'))
  const omitted = entries.length - shown.length

  return `

---
## 성취기준별 성취수준 (공식 A·B·C 원문)

출처: ${loadAchievementLevels().source}
이 설계의 성취기준(A-2-1 분석표·교육과정 시트)에 해당하는 공식 성취수준이다.

⚠️ 원문을 그대로 인용한다. 새로 만든 서술을 "공식 성취수준"이라고 부르지 않는다.
⚠️ A·B·C는 **성취기준 하나 단위**의 수준이다. 재구조화 성취기준·통합 수업목표에는 공식 수준이 없으므로, 아래 원문을 근거로 보여 주고 합치는 방식은 교사팀이 정하게 한다.
⚠️ 교사에게 보여 줄 때는 코드와 함께 A·B·C를 구분해 표기한다.
**이 활동에서의 사용**: ${ACTIVITY_USAGE[activityCode]}

${blocks.join('\n\n')}${omitted > 0 ? `\n\n(성취기준 ${omitted}개는 길이 제한으로 생략 — 필요하면 교사에게 어느 성취기준을 먼저 볼지 묻는다.)` : ''}`
}
