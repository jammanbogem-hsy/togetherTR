import type { ActivityCode } from '@/types'

// 산출물 content 안의 내부 전용 키 — 화면·보고서·AI 입력·내보내기 어디에도 섹션으로 나열하지 않는다.
// '_' 접두(_schema, _schemaVersion 등)와 공동 편집 원본(manualWorkspace: blocks/rows/columns/updatedAt/id).
export const INTERNAL_ARTIFACT_KEYS: ReadonlySet<string> = new Set(['manualWorkspace'])

export function isInternalArtifactKey(key: string): boolean {
  return key.startsWith('_') || INTERNAL_ARTIFACT_KEYS.has(key)
}

export function withoutInternalArtifactKeys(content: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(content ?? {}).filter(([key]) => !isInternalArtifactKey(key)))
}

// 공동 편집 표가 산출물의 어느 섹션에 해당하는지(연수 양식·일반 섹션 이름과 같음). 없으면 '공동 편집 표'.
export const WORKSPACE_SECTION_KEY: Partial<Record<ActivityCode, string>> = {
  'T-1-2': '설계 방향',
  'T-2-1': '역할 배분',
  'T-2-2': '팀 규칙',
  'T-2-3': '팀 일정',
  'Ds-1-1': '평가 계획',
  'Ds-1-3': '학습 활동',
  'Ds-2-1': '활동별 자료 설계',
  'Ds-2-2': '스캐폴딩 계획',
}
export const WORKSPACE_FALLBACK_SECTION = '공동 편집 표'

type WorkspaceLike = {
  columns?: Array<{ id?: unknown; label?: unknown }>
  rows?: Array<{ cells?: Record<string, unknown> }>
}

const cell = (value: unknown) => String(value ?? '').trim().replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' / ')

/** 공동 편집 표(rows/columns)를 한국어 머리글 마크다운 표로. 내용이 하나도 없으면 ''. */
export function workspaceTableMarkdown(workspace: unknown): string {
  const ws = workspace as WorkspaceLike | null | undefined
  if (!ws || !Array.isArray(ws.columns) || !Array.isArray(ws.rows)) return ''
  const columns = ws.columns.filter(column => typeof column?.id === 'string')
  const rows = ws.rows
    .map(row => columns.map(column => cell(row?.cells?.[column.id as string])))
    .filter(cells => cells.some(Boolean))
  if (!columns.length || !rows.length) return ''
  const header = columns.map((column, index) => cell(column.label) || `${index + 1}열`)
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(cells => `| ${cells.join(' | ')} |`),
  ].join('\n')
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

export type DisplayArtifactContent = {
  content: Record<string, unknown>
  /** 저장값이 아니라 표시용으로 만든 섹션 키(삭제 버튼 등 저장 동작을 붙이지 않는다) */
  derivedKeys: string[]
}

/**
 * 섹션 나열용 content. 구조화 산출물(_schema)은 전용 렌더러가 다루므로 그대로 둔다.
 * 그 밖에는 내부 키를 빼고, 공동 편집 내용이 manualWorkspace 에만 있고 해당 섹션이 비어 있으면
 * 그 표를 해당 섹션 자리에 표시용으로 채운다. 저장 데이터는 바꾸지 않는다.
 */
export function displayArtifactContent(content: Record<string, unknown> | null | undefined, activityCode?: string): DisplayArtifactContent {
  const source = content ?? {}
  if (typeof source._schema === 'string') return { content: source, derivedKeys: [] }
  const visible = withoutInternalArtifactKeys(source)
  const table = workspaceTableMarkdown(source.manualWorkspace)
  if (!table) return { content: visible, derivedKeys: [] }
  const key = WORKSPACE_SECTION_KEY[activityCode as ActivityCode] ?? WORKSPACE_FALLBACK_SECTION
  if (!isBlank(visible[key])) return { content: visible, derivedKeys: [] }
  return { content: { ...visible, [key]: table }, derivedKeys: [key] }
}
