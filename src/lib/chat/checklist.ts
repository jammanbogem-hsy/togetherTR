// AI 답변 속 체크리스트를 누를 수 있는 체크박스로 — 순수 함수(렌더러·저장·테스트 공용).
// 대상: GFM 작업 목록 '- [ ]'·'- [x]', 문장 속 '[ ]'·'[x]', 표 칸에 단독으로 있는 '☐'·'□'·'☑'(✅·⚠️ 는 AI 판단 표시라 제외).
// 체크박스는 메시지 글 안에서 나온 순서대로 0부터 순번을 매긴다(같은 글이면 항상 같은 순번).
// 렌더러는 각 체크박스를 인라인 코드 표식 `⟦체크:순번:기본값⟧` 으로 바꾼 글을 그리고, 그 표식을 체크박스로 바꾼다.

export interface ChecklistEntry {
  checked: boolean
  by?: string
  at?: unknown
}

/** messages/{id}.checklistState — 순번(문자열 키) → 상태 */
export type ChecklistState = Record<string, ChecklistEntry | undefined>

const MARK_RE = /^⟦체크:(\d+):([01])⟧$/

export function parseChecklistMark(text: string): { index: number; defaultChecked: boolean } | null {
  const match = text.trim().match(MARK_RE)
  return match ? { index: Number(match[1]), defaultChecked: match[2] === '1' } : null
}

const mark = (index: number, checked: boolean) => `\`⟦체크:${index}:${checked ? 1 : 0}⟧\``

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const isSeparatorRow = (line: string) => /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line)

/**
 * 체크박스 자리를 표식으로 바꾼다. 코드 블록(```)과 인라인 코드는 건드리지 않는다.
 * @returns markdown 표식으로 바꾼 글, count 체크박스 수, defaults 원문 기본 체크 상태
 */
export function prepareChecklistMarkdown(text: string): { markdown: string; count: number; defaults: boolean[] } {
  const defaults: boolean[] = []
  const next = (checked: boolean) => { defaults.push(checked); return mark(defaults.length - 1, checked) }
  let fence: string | null = null
  const lines = text.split('\n').map(line => {
    const fenceMatch = line.trim().match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0]
      else if (fence === fenceMatch[1][0]) fence = null
      return line
    }
    if (fence) return line
    if (isTableRow(line)) {
      if (isSeparatorRow(line)) return line
      // 표 칸: 단독 ☐·☑·✅·[ ]·[x] 만 체크박스로(설명 글 속 기호는 그대로)
      return line.replace(/\|([^|\n]*)(?=\|)/g, (whole, cell: string) => {
        const value = cell.trim()
        if (/^(?:☐|□|\[ \])$/.test(value)) return `| ${next(false)} `
        // ✅·⚠️ 는 AI 분석 칸의 판단 표시라 체크박스로 바꾸지 않는다
        if (/^(?:☑|☑️|\[[xX]\])$/.test(value)) return `| ${next(true)} `
        return whole
      })
    }
    // 작업 목록·문장 속 [ ]/[x] — 인라인 코드 구간은 건너뛴다
    return line.split(/(`[^`]*`)/).map(part => part.startsWith('`')
      ? part
      : part.replace(/\[( |x|X)\](?!\()/g, (_m, value: string) => next(value !== ' '))).join('')
  })
  return { markdown: lines.join('\n'), count: defaults.length, defaults }
}

/** 화면에 보일 체크 상태(저장된 상태가 있으면 그것, 없으면 원문 기본값) */
export function isChecklistChecked(index: number, defaults: readonly boolean[], state?: ChecklistState | null): boolean {
  const saved = state?.[String(index)]
  return saved ? saved.checked : defaults[index] === true
}

export function checklistProgress(text: string, state?: ChecklistState | null): { total: number; checked: number; allChecked: boolean } {
  const { count, defaults } = prepareChecklistMarkdown(text)
  let checked = 0
  for (let i = 0; i < count; i++) if (isChecklistChecked(i, defaults, state)) checked++
  return { total: count, checked, allChecked: count > 0 && checked === count }
}

export const CHECKLIST_ALL_DONE_NOTE = '모든 항목을 확인했어요. 다음 단계로 넘어갈 준비가 됐습니다.'

/** 메시지 문서 경로 — 레거시(단계 경로)로 불러온 메시지는 그 경로에 저장한다. */
export function messageDocPath(projectId: string, message: { id: string; activityCode: string; legacyPath?: boolean }, stageCode: string): string {
  const conversation = message.legacyPath ? stageCode : message.activityCode
  return `projects/${projectId}/conversations/${conversation}/messages/${message.id}`
}
