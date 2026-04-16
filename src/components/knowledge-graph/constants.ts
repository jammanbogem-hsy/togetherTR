import type { GraphRelationType } from '@/lib/knowledge-graph/domain'
import { DEFAULT_GRAPH_RELATION_TYPE, normalizeGraphRelationType, toUnitGraphScore } from '@/lib/knowledge-graph/domain'
import type { GNode, GEdge, GraphRelationAnalysis, RelationDisplayState } from './types'

// ─── 키워드 의미 정제 ─────────────────────────────────────────────────────

const VERB_ENDINGS = [
  '하는', '되는', '하기', '되기', '하여', '되어', '하며', '되며',
  '하고', '되고', '하다', '되다', '했다', '됐다', '하여서', '되어서',
  '하', '되', '된', '한', '할', '했', '됩', '합', '됩',
]

export function cleanKeyword(raw: string): string {
  if (raw.includes(' ')) {
    const parts = raw.split(/\s+/).filter(w => w.length >= 2)
    const FILLER_LAST = ['를', '을', '이', '가', '은', '는', '의', '와', '과', '로', '에', '도', '만']
    const cleaned = parts.filter(w => {
      const last = w[w.length - 1]
      return !FILLER_LAST.includes(last) || w.length > 2
    })
    return cleaned.slice(-2).join(' ')
  }
  let w = raw
  for (const e of VERB_ENDINGS.sort((a, b) => b.length - a.length)) {
    if (w.endsWith(e) && w.length - e.length >= 2) {
      w = w.slice(0, w.length - e.length)
      break
    }
  }
  return w
}

// ─── 색상 팔레트 ──────────────────────────────────────────────────────────

export const SUBJECT_COLORS: Record<string, string> = {
  sub_kor:   '#7C3AED',
  sub_math:  '#2563EB',
  sub_sci:   '#059669',
  sub_soc:   '#D97706',
  sub_mor:   '#DC2626',
  sub_art:   '#DB2777',
  sub_mus:   '#8B5CF6',
  sub_pe:    '#16A34A',
  sub_eng:   '#0891B2',
  sub_prac:  '#B45309',
  sub_int:   '#0D9488',
  sub_extra: '#7C2D12',
  default:   '#6B7280',
}

export const SUBJECT_NAMES: Record<string, string> = {
  sub_kor:   '국어',
  sub_math:  '수학',
  sub_sci:   '과학',
  sub_soc:   '사회',
  sub_mor:   '도덕',
  sub_art:   '미술',
  sub_mus:   '음악',
  sub_pe:    '체육',
  sub_eng:   '영어',
  sub_prac:  '실과',
  sub_int:   '통합교과',
  sub_extra: '창체',
}

export function subjectColor(id?: string): string {
  if (!id) return SUBJECT_COLORS.default
  return SUBJECT_COLORS[id] ?? SUBJECT_COLORS.default
}

export function subjectName(id?: string): string {
  if (!id) return ''
  return SUBJECT_NAMES[id] ?? id
}

// ─── 8종 교육적 관계 유형 ─────────────────────────────────────────────────

export const RELATION_COLORS: Record<string, string> = {
  '의미연결':  '#7C3AED',
  '도구-활용': '#EF4444',
  '현상-가치': '#F97316',
  '내용-표현': '#22C55E',
  '개념-적용': '#0EA5E9',
  '문제-해결': '#D946EF',
  '탐구-실천': '#84CC16',
  '원인-결과': '#F59E0B',
}

export const RELATION_EMOJIS: Record<string, string> = {
  '의미연결':  '🔗',
  '도구-활용': '🛠',
  '현상-가치': '⚖️',
  '내용-표현': '🎨',
  '개념-적용': '💡',
  '문제-해결': '🧩',
  '탐구-실천': '🌱',
  '원인-결과': '➡️',
}

// ─── 교과 간 관계 분류 휴리스틱 ───────────────────────────────────────────

const TOOL_SUBS  = new Set(['sub_math', 'sub_sci', 'sub_pe', 'sub_eng'])
const VALUE_SUBS = new Set(['sub_mor', 'sub_soc'])
const EXPR_SUBS  = new Set(['sub_kor', 'sub_art', 'sub_mus'])

export function classifyRelation(center: GNode, other: GNode): GraphRelationType {
  const cId = center.subject_id ?? ''
  const oId = other.subject_id ?? ''
  if (cId === oId) return DEFAULT_GRAPH_RELATION_TYPE
  if (EXPR_SUBS.has(oId)) return '내용-표현'
  if ((TOOL_SUBS.has(cId) && VALUE_SUBS.has(oId)) || (VALUE_SUBS.has(cId) && TOOL_SUBS.has(oId))) return '현상-가치'
  if (TOOL_SUBS.has(oId)) return '도구-활용'
  if (EXPR_SUBS.has(cId) && VALUE_SUBS.has(oId)) return '현상-가치'
  return DEFAULT_GRAPH_RELATION_TYPE
}

// ─── 폴백 텍스트 생성 ────────────────────────────────────────────────────

/**
 * 한국어 텍스트를 의미 단위로 스마트 절단.
 * slice(0, N)은 어절 중간에서 자르는 문제가 있어 띄어쓰기·구두점 경계 우선 탐색.
 */
function truncateSmart(text: string | undefined, maxChars: number): string {
  if (!text) return ''
  const t = text.trim()
  if (t.length <= maxChars) return t
  // 절단 후보 경계: 구두점 → 띄어쓰기 → 강제 자르기
  const cut = t.slice(0, maxChars)
  // 문장 종결 부호에서 자르는 것이 가장 자연스러움
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('; '), cut.lastIndexOf(', '))
  if (sentenceEnd >= Math.floor(maxChars * 0.6)) {
    return cut.slice(0, sentenceEnd + 1).trim() + '…'
  }
  // 띄어쓰기에서 자르기
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace >= Math.floor(maxChars * 0.6)) {
    return cut.slice(0, lastSpace).trim() + '…'
  }
  // 그래도 안 되면 강제 자르되 "…" 추가로 부자연스러운 느낌 완화
  return cut.trim() + '…'
}

export function buildFallbackTeachingHint(center: GNode, other: GNode, relationType: GraphRelationType): string {
  const cSubj = subjectName(center.subject_id) || center.label
  const oSubj = subjectName(other.subject_id) || other.label
  const cText = truncateSmart(center.text, 80) || center.label
  const oText = truncateSmart(other.text, 80) || other.label
  const oKw = other.keywords?.slice(0, 2).join('·') || ''
  switch (relationType) {
    case '도구-활용':
      return `${cSubj}에서 '${cText}'를 탐구한 뒤, ${oSubj}의 ${oKw ? oKw + ' ' : ''}기능을 활용해 결과를 정리하고 발표하는 활동을 해보세요.`
    case '현상-가치':
      return `${cSubj}에서 '${cText}'를 탐구한 후, ${oSubj} 관점에서 '${oText}'와 연결하여 가치 토론을 진행해보세요.`
    case '내용-표현':
      return `${cSubj}에서 '${cText}'를 학습한 뒤, ${oSubj}에서 '${oText}'를 활용해 창의적으로 표현하는 산출물을 제작해보세요.`
    case '문제-해결':
      return `'${cText}'와 '${oText}'를 함께 다루며, ${cSubj}·${oSubj} 관점에서 공동 해결안을 만드는 모둠 활동을 해보세요.`
    case '탐구-실천':
      return `${cSubj}에서 '${cText}'를 탐구한 결과를 ${oSubj}의 '${oText}' 활동으로 실천해보세요.`
    case '개념-적용':
      return `${cSubj}에서 배운 '${cText}' 개념을 ${oSubj}의 '${oText}' 맥락에 적용하는 수행 과제를 설계해보세요.`
    case '원인-결과':
      return `'${cText}'의 원인을 ${cSubj}에서 탐구하고, ${oSubj}에서 '${oText}'와 연결하여 결과를 분석해보세요.`
    case '의미연결':
    default:
      return `${cSubj}의 '${cText}'와 ${oSubj}의 '${oText}'에서 ${oKw ? '공통 개념(' + oKw + ')을' : '공통점을'} 찾아 통합적으로 탐구해보세요.`
  }
}

export function buildFallbackRelationExplanation(center: GNode, other: GNode, relationType: GraphRelationType): string {
  const cSubj = subjectName(center.subject_id) || center.label
  const oSubj = subjectName(other.subject_id) || other.label
  const cText = truncateSmart(center.text, 80) || center.label
  const oText = truncateSmart(other.text, 80) || other.label
  const oKw = other.keywords?.slice(0, 2).join('·') || ''
  switch (relationType) {
    case '도구-활용':
      return `${cSubj}(${center.label})의 내용을 ${oSubj}(${other.label})의 ${oKw || '기능'}으로 수행할 수 있습니다. '${cText}'를 '${oText}'의 방법으로 연결합니다.`
    case '현상-가치':
      return `${cSubj}에서 '${cText}'를 탐구한 후, ${oSubj}에서 '${oText}'와 관련된 가치·윤리적 성찰로 확장할 수 있습니다.`
    case '내용-표현':
      return `${cSubj}에서 '${cText}'를 학습한 내용을 ${oSubj}의 '${oText}' 활동을 통해 창의적으로 표현·재구성할 수 있습니다.`
    case '문제-해결':
      return `${cSubj}(${center.label})와 ${oSubj}(${other.label})가 ${oKw ? `'${oKw}'` : '공통 문제'} 맥락에서 함께 문제를 해결합니다.`
    case '탐구-실천':
      return `${cSubj}에서 '${cText}'를 탐구한 결과를 ${oSubj}의 '${oText}' 실천 활동으로 이어갈 수 있습니다.`
    case '개념-적용':
      return `${cSubj}에서 이해한 '${cText}' 개념을 ${oSubj}의 '${oText}' 상황에 적용해 볼 수 있습니다.`
    case '원인-결과':
      return `${cSubj}의 '${cText}'와 ${oSubj}의 '${oText}'를 인과 관계로 연결하여 분석할 수 있습니다.`
    case '의미연결':
    default:
      return `${cSubj}(${center.label})와 ${oSubj}(${other.label})가 ${oKw ? `'${oKw}'` : '공통 개념'}을 중심으로 의미적으로 연결됩니다.`
  }
}

// ─── 유틸 함수 ────────────────────────────────────────────────────────────

export function normCode(label: string): string {
  return label.replace(/[\[\]]/g, '').trim()
}

export function nodeRadius(type: GNode['type'], score?: number, isCenter?: boolean): number {
  if (type === 'subject')   return 14
  if (type === 'core_idea') return 10
  if (isCenter) return 52
  if (score !== undefined) return Math.round(32 + score * 18)
  return 40
}

export function normalizedEdgeWeight(weight?: number): number {
  return toUnitGraphScore(weight) ?? 0.45
}

export function hasCompletedRelationAnalysis(rel?: GraphRelationAnalysis | null): rel is GraphRelationAnalysis {
  return Boolean(rel?.explanation?.trim())
}

export function getRelationDisplayState(rel?: GraphRelationAnalysis | null): RelationDisplayState {
  if (!hasCompletedRelationAnalysis(rel)) return 'estimated'
  return rel.source === 'claude' ? 'claude' : 'rule'
}

export function getRelationStatusMeta(state: RelationDisplayState): {
  label: string
  className: string
} {
  switch (state) {
    case 'claude':
      return { label: 'AI 분석', className: 'text-[#7B1FA2] bg-[#F3E5F5]' }
    case 'rule':
      return { label: '규칙 보완', className: 'text-[#0F766E] bg-[#E0F2F1]' }
    case 'estimated':
    default:
      return { label: '관계 추정', className: 'text-gray-500 bg-gray-100' }
  }
}

export function edgeColor(method: string, relation?: string): string {
  if (method === 'manual' && relation && RELATION_COLORS[relation]) return RELATION_COLORS[relation]
  if (relation && RELATION_COLORS[relation]) return RELATION_COLORS[relation]
  if (method.includes('hybrid') || method.includes('tfidf')) return '#7C3AED'
  if (method === 'rule_based') return '#2563EB'
  return '#94A3B8'
}

export function edgeRelationLabel(edge: GEdge): string {
  let rel = normalizeGraphRelationType(edge.relation) ?? ''
  if (!rel) {
    if (edge.method.includes('tfidf') || edge.method.includes('hybrid')) rel = DEFAULT_GRAPH_RELATION_TYPE
    else if (edge.method === 'rule_based') return '위계'
    else if (edge.method === 'manual') rel = normalizeGraphRelationType(edge.relation) ?? DEFAULT_GRAPH_RELATION_TYPE
    else return ''
  }
  const emoji = RELATION_EMOJIS[rel] ?? ''
  if (edge.method !== 'manual' && edge.weight > 0 && edge.weight <= 1) {
    const pct = Math.round(edge.weight * 100)
    return `${emoji}${rel} ${pct}%`
  }
  return `${emoji}${rel}`
}
