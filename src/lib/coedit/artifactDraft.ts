// #S1: 공동 편집 창을 열 때 '저장된 산출물'과 '공동 초안' 중 무엇을 기준으로 할지 정한다.
// 결함: 초안에 글자가 하나라도 있으면(예: 예전 핵심 키워드 한 줄) 산출물을 보지 않았고, 연수 양식으로 저장한
// 산출물(_schema 없는 섹션 글)은 초안이 비어 있어도 표로 읽지 못해 저장된 비전·표가 사라진 것처럼 보였다.
import {
  buildA12Structured, buildA22Structured, buildDs11Structured, buildDs12Structured, buildDs13Structured, buildDs21Structured,
  buildDs22Structured, buildT11Structured, buildT12Structured, buildT21Structured, buildT22Structured, buildT23Structured,
} from '@/lib/artifacts/schemas'
import { isInternalArtifactKey } from '@/lib/artifacts/internalKeys'
import { isBlankWorkspace } from './workspaceBlank'

type Builder = (sections: Record<string, string>, chat: Array<{ role: string; content: string }>) => object
const BUILDERS: Record<string, Builder> = {
  'T-1-1': (sections, chat) => buildT11Structured(sections, chat), 'T-1-2': buildT12Structured, 'T-2-1': buildT21Structured,
  'T-2-2': buildT22Structured, 'T-2-3': buildT23Structured, 'A-1-2': buildA12Structured, 'A-2-2': buildA22Structured,
  'Ds-1-1': buildDs11Structured, 'Ds-1-2': buildDs12Structured, 'Ds-1-3': buildDs13Structured, 'Ds-2-1': buildDs21Structured,
  'Ds-2-2': buildDs22Structured,
}

export type ArtifactMeta = {
  content?: Record<string, unknown> | null
  updatedAt?: number
  confirmedAt?: number
  versions?: Array<{ savedAt?: number }>
} | null | undefined

/** 산출물이 마지막으로 바뀐 시각 — updatedAt(R1) → confirmedAt → 이력의 가장 늦은 저장 시각. 모르면 undefined. */
export function artifactSavedAt(meta: ArtifactMeta): number | undefined {
  if (!meta) return undefined
  const times = [meta.updatedAt, meta.confirmedAt, ...(meta.versions ?? []).map(version => version?.savedAt)]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return typeof meta.updatedAt === 'number' ? meta.updatedAt : times.length ? Math.max(...times) : undefined
}

/**
 * 공동 편집 창이 읽을 수 있는 구조화 산출물. 이미 구조화(_schema)면 그대로, 연수 양식·AI 섹션 글이면
 * 활동별 변환기로 구조화한다. 섹션 글로 저장된 산출물의 manualWorkspace 는 옛 초안이라 쓰지 않는다.
 */
export function structuredArtifactContent(code: string, content: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  if (typeof content._schema === 'string') return content
  const builder = BUILDERS[code]
  if (!builder) return undefined
  const sections = Object.fromEntries(Object.entries(content)
    .filter(([key, value]) => !isInternalArtifactKey(key) && typeof value === 'string' && value.trim())) as Record<string, string>
  if (!Object.keys(sections).length) return undefined
  return builder(sections, []) as Record<string, unknown>
}

type Row = { id?: string; cells?: Record<string, unknown> }
type WorkspaceLike = { rows?: Row[]; columns?: unknown[]; blocks?: Array<{ id?: string; content?: unknown; table?: unknown }> } & Record<string, unknown>
const META_KEYS = new Set(['rows', 'columns', 'blocks', 'updatedAt', 'updatedBy'])
const text = (value: unknown): string => typeof value === 'string' ? value.trim()
  : Array.isArray(value) ? value.map(text).filter(Boolean).join('\u0001')
  : value && typeof value === 'object' ? Object.keys(value).sort().map(key => text((value as Record<string, unknown>)[key])).filter(Boolean).join('\u0002')
  : value == null ? '' : String(value)

/** 내용 비교용 서명 — id·색·시각은 무시하고 칸·제목·블록 글만 본다. */
export function workspaceSignature(workspace: unknown): string {
  const ws = (workspace ?? {}) as WorkspaceLike
  const meta = Object.keys(ws).filter(key => !META_KEYS.has(key)).sort().map(key => `${key}=${text(ws[key])}`)
  const rows = (ws.rows ?? []).map(row => text(row?.cells ?? {})).filter(Boolean)
  const blocks = (ws.blocks ?? []).map(block => text([block?.content, block?.table])).filter(Boolean)
  return JSON.stringify([meta, rows, blocks])
}

const rowsHaveText = (rows: Row[] | undefined) => (rows ?? []).some(row => text(row?.cells ?? {}))

/** 초안의 빈 칸(제목·문장·키워드, 내용 없는 표)만 산출물 값으로 채운다. 초안에 쓴 글은 그대로. */
export function fillBlankDraft<W>(draft: W, fromArtifact: W): W {
  const d = draft as WorkspaceLike, a = fromArtifact as WorkspaceLike
  const next: WorkspaceLike = { ...d }
  for (const [key, value] of Object.entries(a)) {
    if (META_KEYS.has(key)) continue
    if (!text(d[key]) && text(value)) next[key] = value
  }
  if (!rowsHaveText(d.rows) && rowsHaveText(a.rows)) {
    next.rows = a.rows
    if (Array.isArray(a.columns) && a.columns.length) next.columns = a.columns
  }
  return next as W
}

/** 동시에 두 사람이 같은 산출물로 바꿔도 같은 행 id 가 되게 한다(CRDT 에서 행이 두 벌 생기지 않게). */
export function stabilizeRowIds<W>(workspace: W, keep: W, seed: string): W {
  const ws = workspace as WorkspaceLike
  const kept = new Set(((keep as WorkspaceLike).rows ?? []).map(row => row?.id))
  if (!Array.isArray(ws.rows)) return workspace
  return { ...ws, rows: ws.rows.map((row, index) => kept.has(row?.id) ? row : { ...row, id: `art_${seed}_${index}` }) } as W
}

export type DraftAction = 'keep' | 'fill' | 'replace'
/** target: 바로 적용할 결과, offer: 사람이 고르면 적용할 산출물 기준 결과(시각을 모를 때) */
export type DraftDecision<W> = { action: DraftAction; target: W; reason: string; offer?: W }

/**
 * - 산출물이 비었거나 내용이 같으면 keep
 * - 초안이 비었으면 replace(잃을 것 없음)
 * - 두 시각을 다 알면: 산출물이 더 새로우면 replace, 아니면 빈 칸만 fill
 * - 시각을 모르면 빈 칸만 fill 하고, 산출물로 바꾸는 것은 사람이 고르게 offer 로 남긴다
 */
export function decideArtifactDraft<W>({ draft, artifactWorkspace, draftAt, artifactAt }: {
  draft: W
  artifactWorkspace: W | undefined
  draftAt?: number
  artifactAt?: number
}): DraftDecision<W> {
  if (!artifactWorkspace || isBlankWorkspace(artifactWorkspace)) return { action: 'keep', target: draft, reason: 'no-artifact' }
  if (workspaceSignature(draft) === workspaceSignature(artifactWorkspace)) return { action: 'keep', target: draft, reason: 'same' }
  if (isBlankWorkspace(draft)) return { action: 'replace', target: artifactWorkspace, reason: 'draft-blank' }
  const filled = fillBlankDraft(draft, artifactWorkspace)
  const fills = workspaceSignature(filled) !== workspaceSignature(draft)
  if (artifactAt !== undefined && draftAt !== undefined) {
    if (artifactAt > draftAt) return { action: 'replace', target: artifactWorkspace, reason: 'artifact-newer' }
    return fills ? { action: 'fill', target: filled, reason: 'draft-newer' } : { action: 'keep', target: draft, reason: 'draft-newer' }
  }
  const offer = workspaceSignature(filled) === workspaceSignature(artifactWorkspace) ? undefined : artifactWorkspace
  return fills
    ? { action: 'fill', target: filled, reason: 'time-unknown', offer }
    : { action: 'keep', target: draft, reason: 'time-unknown', offer }
}
