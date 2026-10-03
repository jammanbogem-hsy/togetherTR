/**
 * 성취기준 → 성취수준 → 학습활동 → 평가 정렬 점검 — 순수 함수(클라이언트·서버 공용).
 *
 * 연결 근거는 산출물 안의 성취기준 코드 표기다. Ds-1-1 프롬프트는 평가 요소에 근거 코드를,
 * Ds-1-3 프롬프트는 활동 설명 끝에 "(근거: [코드] A)"를 적게 한다. 코드 옆 A·B·C는 목표 수준으로 읽는다.
 * 교과명·활동명으로 추측해 잇지 않는다 — 추측 연결은 빈칸을 가려 점검의 의미를 없앤다.
 */

import { extractStandardCodes } from './standardCodes'

export type LevelKey = 'A' | 'B' | 'C'

export interface AlignmentLink {
  label: string
  levels: LevelKey[]
}

export interface AlignmentRow {
  code: string
  evaluations: AlignmentLink[]
  activities: AlignmentLink[]
}

export interface AlignmentResult {
  rows: AlignmentRow[]
  hasEvaluationArtifact: boolean
  hasActivityArtifact: boolean
  /** 평가 산출물 어디에도 성취기준 코드가 적혀 있지 않음 — 빈칸이 아니라 '코드 미표기'로 보여 준다 */
  evaluationHasNoCodes: boolean
  /** 학습 활동 산출물 어디에도 성취기준 코드가 적혀 있지 않음 */
  activityHasNoCodes: boolean
}

interface LinkSource {
  label: string
  text: string
}

const TABLE_SEPARATOR_RE = /^\|[\s\-:|]+\|$/

function splitCells(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

/** 마크다운 표 문자열의 데이터 행을 셀 배열로. 머리글·구분선은 뺀다. */
function tableRows(raw: string): string[][] {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('|') && !TABLE_SEPARATOR_RE.test(l))
  return lines.slice(1).map(splitCells)
}

/** 글 속 표들을 머리글과 함께 나눈다(빈 줄·표 아닌 줄에서 표가 끊긴다). */
function tablesWithHeader(raw: string): Array<{ header: string[]; rows: string[][] }> {
  const tables: Array<{ header: string[]; rows: string[][] }> = []
  let current: { header: string[]; rows: string[][] } | null = null
  for (const line of raw.split('\n').map(l => l.trim())) {
    if (!line.startsWith('|')) { current = null; continue }
    if (TABLE_SEPARATOR_RE.test(line)) continue
    if (!current) { current = { header: splitCells(line), rows: [] }; tables.push(current); continue }
    current.rows.push(splitCells(line))
  }
  return tables
}

const EVALUATION_LABEL_HEADER_RE = /평가\s*(?:요소|항목|내용)|^항목$|^요소$|확인\s*지점/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 라벨에서 근거 표기("(… [4사03-02])", "(근거: [4사03-02] A)")를 걷어 읽기 쉽게. */
function cleanLabel(label: string): string {
  return label
    .replace(/\(\s*근거\s*[:：][^)]*\)/g, '')
    .replace(/\(\s*(?:\[[^\]]+\]\s*[ABC]?\s*[,·]?\s*)+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function evaluationSources(content: unknown): LinkSource[] {
  const record = asRecord(content)
  if (!record) return []
  const rubric = record.rubric
  if (Array.isArray(rubric)) {
    return rubric.map(row => {
      const r = asRecord(row) ?? {}
      const label = str(r.item) || str(r.checkpoint)
      return { label, text: Object.values(r).map(str).join(' ') }
    }).filter(s => s.label)
  }
  // '평가 계획' 표가 기본이고, 다른 섹션(예: '수준 기준' 표의 '근거 성취기준' 열, 문장 속 코드)도 평가 근거로 읽는다.
  const primary = str(record['평가 계획']) || str(record['평가계획'])
  const sources: LinkSource[] = tableRows(primary).map(cells => ({ label: cells[1] || cells[0] || '', text: cells.join(' ') }))
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('_') || key === '평가 계획' || key === '평가계획') continue
    const raw = str(value)
    if (!raw) continue
    for (const table of tablesWithHeader(raw)) {
      // 라벨은 평가 항목명 열(없으면 첫 열)
      const labelIndex = Math.max(0, table.header.findIndex(h => EVALUATION_LABEL_HEADER_RE.test(h)))
      for (const cells of table.rows) sources.push({ label: cells[labelIndex] || cells[0] || key, text: cells.join(' ') })
    }
    for (const line of raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('|'))) {
      if (extractStandardCodes(line).length === 0) continue
      const label = line.replace(/^[-*•]\s*/, '').replace(/\[[^\]]*\d{2}-\d{2}\][ABC]?/g, '').replace(/근거\s*성취기준\s*[:：]?/g, '').replace(/[:：·,\s]+$/, '').trim()
      sources.push({ label: label || key, text: line })
    }
  }
  return sources.filter(s => s.label)
}

function activitySources(content: unknown): LinkSource[] {
  const record = asRecord(content)
  if (!record) return []
  const activities = record.activities
  if (Array.isArray(activities)) {
    return activities.map(row => {
      const a = asRecord(row) ?? {}
      const label = [str(a.session), str(a.name)].filter(Boolean).join(' ')
      return { label, text: Object.values(a).map(str).join(' ') }
    }).filter(s => s.label)
  }
  const raw = str(record['학습 활동'])
  return tableRows(raw).map(cells => ({ label: [cells[6], cells[2]].filter(Boolean).join(' '), text: cells.join(' ') })).filter(s => s.label)
}

/** 글 안에서 이 코드 바로 뒤에 적힌 수준 글자(A·B·C)들. "[4사03-02] A", "[4사03-02]의 B 수준" 등. */
export function levelsNearCode(text: string, code: string): LevelKey[] {
  const escaped = code.replace(/[[\]]/g, m => `\\${m}`)
  const found = new Set<LevelKey>()
  for (const match of text.matchAll(new RegExp(`${escaped}\\s*(?:의\\s*)?([ABC])(?![A-Za-z])`, 'g'))) {
    found.add(match[1] as LevelKey)
  }
  return (['A', 'B', 'C'] as const).filter(k => found.has(k))
}

function linksFor(code: string, sources: LinkSource[]): AlignmentLink[] {
  return sources
    .filter(s => extractStandardCodes(s.text).includes(code))
    .map(s => ({ label: cleanLabel(s.label) || s.label, levels: levelsNearCode(s.text, code) }))
}

/**
 * 성취기준 코드별로 그 코드를 근거로 적은 평가 요소(Ds-1-1)와 학습 활동(Ds-1-3)을 모은다.
 * @MX:NOTE [AUTO] 연결은 코드 표기로만 — 빈칸이 곧 점검 결과다
 */
export function buildAlignment(
  codes: readonly string[],
  ds11Content: unknown,
  ds13Content: unknown,
): AlignmentResult {
  const evaluations = evaluationSources(ds11Content)
  const activities = activitySources(ds13Content)
  const hasNoCodes = (sources: LinkSource[]) =>
    sources.length > 0 && sources.every(s => extractStandardCodes(s.text).length === 0)
  return {
    rows: codes.map(code => ({
      code,
      evaluations: linksFor(code, evaluations),
      activities: linksFor(code, activities),
    })),
    hasEvaluationArtifact: evaluations.length > 0,
    hasActivityArtifact: activities.length > 0,
    evaluationHasNoCodes: hasNoCodes(evaluations),
    activityHasNoCodes: hasNoCodes(activities),
  }
}
