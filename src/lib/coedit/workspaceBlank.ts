/**
 * 공동 편집 워크스페이스가 "비어 있는가" 판정 (2026-09-20).
 *
 * 왜: 각 *WorkspaceModal 의 normalizeWorkspace 는 저장된 워크스페이스가 있으면 그것을 우선했다.
 * 그런데 산출물(채팅 저장 결과)이 있어도 빈 워크스페이스가 한 번이라도 저장돼 있으면
 * 편집 창이 빈 채로 열렸다. 저장본이 실질적으로 비어 있으면 산출물 내용으로 시작하도록
 * 모든 모달이 이 판정을 공통으로 쓴다. 확정 여부와 무관하게 산출물 content 를 씨앗으로 쓴다.
 */

const META_KEYS = new Set(['columns', 'updatedBy', 'updatedAt'])

function hasText(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some(hasText)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasText)
  return false
}

export function isBlankWorkspace(workspace: unknown): boolean {
  if (!workspace || typeof workspace !== 'object') return true
  for (const [key, value] of Object.entries(workspace as Record<string, unknown>)) {
    if (META_KEYS.has(key)) continue
    if (key === 'rows' && Array.isArray(value)) {
      // 행 id·색만 있고 셀이 전부 빈 기본 행은 내용으로 치지 않는다
      if (value.some(row => hasText((row as { cells?: unknown })?.cells ?? Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([k]) => k !== 'id' && k !== 'color'))))) return false
      continue
    }
    if (key === 'blocks' && Array.isArray(value)) {
      if (value.some(block => hasText((block as { content?: unknown }).content) || hasText((block as { table?: { rows?: unknown } }).table?.rows))) return false
      continue
    }
    if (hasText(value)) return false
  }
  return true
}
