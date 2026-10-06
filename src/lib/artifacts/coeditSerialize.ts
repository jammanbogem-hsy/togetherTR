import type { CoeditWorkspaceBlock } from '@/types'

export function findTableBlock(blocks: CoeditWorkspaceBlock[], blockId: string) {
  const block = blocks.find(block => block.id === blockId)
  return block?.table
}

// DI·E 공동 편집 워크스페이스의 순수 변환 함수.
// React·Firebase 의존이 없어야 단위 테스트가 가능하므로 별도 모듈로 분리한다.
// (scripts/coeditSerialize.test.mjs가 이 파일을 직접 import 한다)

export interface CoeditColumnLike { id: string; label: string }
export interface CoeditRowLike { id: string; cells?: Record<string, string> }

/** 표를 마크다운으로 직렬화 — 산출물 저장·HWPX 내보내기가 모두 마크다운 표를 읽는다. */
export function tableToMarkdown(columns: CoeditColumnLike[], rows: CoeditRowLike[]): string {
  if (columns.length === 0) return ''
  const filled = rows.filter(r => Object.values(r.cells ?? {}).some(v => (v ?? '').trim()))
  if (filled.length === 0) return ''
  const head = `| ${columns.map(c => c.label).join(' | ')} |`
  const sep = `| ${columns.map(() => '---').join(' | ')} |`
  const body = filled.map(r =>
    // 셀 안의 개행·파이프는 표 구조를 깨뜨리므로 치환한다
    `| ${columns.map(c => (r.cells?.[c.id] ?? '').replace(/\|/g, '/').replace(/\s*\n+\s*/g, ' ').trim() || '-').join(' | ')} |`
  )
  return [head, sep, ...body].join('\n')
}

/** 특정 열의 값만 뽑아 번호 목록으로 — '운영 원칙', 'E단계 확인 질문'처럼 한 열이 곧 섹션인 경우 */
export function columnToList(rows: CoeditRowLike[], columnId: string): string {
  const items = rows
    .map(r => (r.cells?.[columnId] ?? '').trim())
    .filter(Boolean)
  return items.map((t, i) => `${i + 1}. ${t}`).join('\n')
}

/**
 * E-2-1 합의 대조판의 '초기 합의' 행을 T단계 산출물에서 만든다.
 * 가이드 p68 HOW: 비전·설계 방향·역할·규칙·일정을 실제 진행과 비교하라 —
 * 이미 저장된 산출물을 손으로 옮겨 적게 하지 않는다.
 * solo 모드는 T-1-2·T-2-1·T-2-2가 숨김 활동이므로 비전·일정 2행만 만든다.
 */
export function buildCollaborationAgreementRows(
  artifacts: Record<string, { content?: Record<string, unknown> } | undefined> | undefined,
  isSolo: boolean,
): Array<{ id: string; cells: Record<string, string> }> {
  const pick = (code: string, keys: string[]): string => {
    const content = artifacts?.[code]?.content
    if (!content) return ''
    for (const k of keys) {
      const v = content[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  const specs: Array<{ label: string; code: string; keys: string[] }> = [
    { label: '팀 비전',       code: 'T-1-1', keys: ['팀 공통 비전', '개인 비전'] },
    { label: '수업설계 방향', code: 'T-1-2', keys: ['설계 방향', '설계 원칙'] },
    { label: '역할 배분',     code: 'T-2-1', keys: ['역할 배분'] },
    { label: '팀 규칙',       code: 'T-2-2', keys: ['팀 규칙'] },
    { label: '팀 일정',       code: 'T-2-3', keys: ['팀 일정'] },
  ]
  const visible = isSolo
    ? specs.filter(s => s.code === 'T-1-1' || s.code === 'T-2-3')
    : specs
  return visible.map((s, i) => {
    const saved = pick(s.code, s.keys)
    return {
      id: `agreement-${i}`,
      cells: {
        agreement: saved ? `${s.label}: ${saved}` : `${s.label} — (산출물 없음)`,
        actual: '',
        kept: '',
        structural: '',
        principle: '',
      },
    }
  })
}
