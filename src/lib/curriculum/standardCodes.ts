/**
 * 성취기준 코드 추출 — 순수 함수(클라이언트·서버 공용, fs 없음).
 * 성취수준 조회(서버 전용)는 achievementLevels.ts 가 담당한다.
 */

import type { CurriculumSheetRow } from '@/types'

const STANDARD_CODE_RE = /\[(\d[가-힣]{1,3}\d{2}-\d{2})\]/g

/** 글 안의 성취기준 코드를 처음 나온 순서대로 중복 없이 뽑는다. */
export function extractStandardCodes(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(STANDARD_CODE_RE)) seen.add(`[${match[1]}]`)
  return [...seen]
}

type ArtifactMap = Record<string, { content?: Record<string, unknown> | null } | undefined>

/**
 * 이 설계의 성취기준 코드를 찾을 글 목록. A-2-1 산출물(성취기준 분석표)이 1순위,
 * 공동 편집 교육과정 시트가 2순위다.
 */
export function designStandardSources(
  artifacts: ArtifactMap | null | undefined,
  curriculumSheet?: readonly Pick<CurriculumSheetRow, 'standard'>[] | null,
): string[] {
  const sources: string[] = []
  const a21 = artifacts?.['A-2-1']?.content
  if (a21) sources.push(JSON.stringify(a21))
  for (const row of curriculumSheet ?? []) {
    if (row?.standard) sources.push(row.standard)
  }
  return sources
}
