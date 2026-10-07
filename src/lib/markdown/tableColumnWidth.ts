// 표의 짧은 열 최소 폭 규칙 — 보고서(ReportMarkdown)와 같은 기준: 글자 폭(한글 2·영문 1)의 최댓값이 28 이하면 '짧은 열'로 보고
// 줄바꿈 없이(nowrap) max(6, 폭+4)ch 를 최소 폭으로 준다. 채팅 표('단계'·'팀 확인' 같은 열)가 세로로 쪼개지지 않게 한다.

export const SHORT_COLUMN_MAX_WIDTH = 28

export function textWidth(value: string): number {
  return Array.from(value).reduce((width, character) => width + (character.codePointAt(0)! > 127 ? 2 : 1), 0)
}

/** 열의 칸 글들(머리글 포함)로 짧은 열 여부와 최소 폭(ch)을 정한다. 긴 열은 null(기존 줄바꿈 유지). */
export function shortColumnMinCh(values: readonly string[]): number | null {
  const maxWidth = Math.max(0, ...values.map(value => textWidth(value.replace(/\s+/g, ' ').trim())))
  return maxWidth <= SHORT_COLUMN_MAX_WIDTH ? Math.max(6, maxWidth + 4) : null
}

interface MdNode { type: string; value?: string; children?: MdNode[]; data?: { hProperties?: Record<string, unknown> } }

function nodeText(node: MdNode): string {
  // 체크리스트 표식(인라인 코드 ⟦체크:n:0⟧)은 체크박스+이름 배지 폭으로 센다
  if (node.type === 'inlineCode' && /^⟦체크:\d+:[01]⟧$/.test(node.value ?? '')) return 'xxxxxx'
  return node.value ?? node.children?.map(nodeText).join('') ?? ''
}

/** remark 플러그인: 표의 짧은 열 칸(th·td)에 data-min-ch 를 붙인다. 렌더러가 nowrap + min-width 로 그린다. */
export function remarkShortColumns() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (node.type === 'table' && node.children?.length) {
        const rows = node.children
        const columns = Math.max(...rows.map(row => row.children?.length ?? 0))
        for (let i = 0; i < columns; i++) {
          const cells = rows.map(row => row.children?.[i]).filter((cell): cell is MdNode => !!cell)
          const minCh = shortColumnMinCh(cells.map(nodeText))
          const bodyWidth = Math.max(0, ...cells.slice(1).map(cell => textWidth(nodeText(cell).trim())))
          // Symbols/ratings need only a small column; their longer heading can wrap.
          // Give prose a readable minimum instead of squeezing it after nowrap headings.
          const layout = minCh === null ? 'prose' : bodyWidth > 0 && bodyWidth <= 4 ? 'rating' : 'short'
          for (const cell of cells) cell.data = { ...cell.data, hProperties: {
            ...cell.data?.hProperties, 'data-column-layout': layout,
            ...(minCh === null ? {} : { 'data-min-ch': minCh }),
          } }
        }
        return
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
