'use client'

import { sendWorkspaceArtifact } from './workspaceArtifactRequest'
import { WorkspaceSaveStatus } from './WorkspaceSaveStatus'

import { displayActivityCode } from '@/types'

import { useEffect, useMemo, useRef, useState } from 'react'
import { isBlankWorkspace } from '@/lib/coedit/workspaceBlank'
import { createPortal } from 'react-dom'
import { CheckCircle, ChatCircleDots, CheckSquare, FileText, FloppyDisk, PaperPlaneRight, Plus, Square, Sparkle, Trash, X, TextH, TextHTwo, TextAlignLeft, Quotes, ListChecks, Table as TableIcon, DownloadSimple, DotsSixVertical, type Icon } from '@phosphor-icons/react'
import { CollaborativePromptModal } from './CollaborativePromptModal'
import type {
  ProblemSituationWorkspace,
  ProblemSituationWorkspaceBlock,
  ProblemSituationWorkspaceBlockType,
  ProblemSituationWorkspaceColumn,
  ProblemSituationWorkspaceRow,
  ProblemSituationWorkspaceTableData,
} from '@/types'
import type { Ds12Structured } from '@/lib/artifacts/schemas'

// 시나리오 요소 행 식별자 — element 셀 값으로 scenario 필드 매핑
const SCENARIO_ROWS = [
  { key: 'title',          element: '제목' },
  { key: 'authenticity',   element: '행1 실제성' },
  { key: 'contentProduct', element: '행2 학습 내용+산출물' },
  { key: 'audienceAction', element: '행3 청중+행위' },
  { key: 'drivingQuestion', element: '탐구 질문' },
] as const
import type { ProblemSituationWorkspacePatch } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import {
  AutoGrowTextarea,
  CaretOverlay,
  parseChecklist,
  stringifyChecklist,
  stripUndefinedDeep,
  reorderArray,
  useBlockDnd,
  type ChecklistItem,
} from './workspaceHelpers'
import type { ProblemSituationSuggestRequest, ProblemSituationSuggestResult, ProblemSituationScenario } from '@/app/api/problem-situation/suggest/route'
import { useWorkspaceSync } from './useWorkspaceSync'

interface PresenceEntry {
  uid: string
  displayName: string
  color: string
  cellKey: string
  caretPos?: number
  updatedAt: number
}

interface Props {
  open: boolean
  onClose: () => void
  workspace?: ProblemSituationWorkspace
  artifactContent?: Record<string, unknown>
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, PresenceEntry>
  isHost: boolean
  onPatchSave: (patch: ProblemSituationWorkspacePatch) => Promise<ProblemSituationWorkspace | void>
  onPresenceUpdate?: (presence: PresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: Ds12Structured) => Promise<void>
  /** 프로젝트 메타 — AI 제안 요청에 함께 전달 */
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 이전 단계 산출물 — AI 제안 보강용 */
  integratedGoal?: string
  subjectGoals?: Array<{ subject: string; goal: string }>
  learnerProfile?: string
  evaluationPlan?: string
  /** AI 제안 chat-mode에서 사용할 현재 활동의 채팅 메시지 (시간순, 최근 N개 권장) */
  chatMessages?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  /** 협업 프롬프트 모달용 */
  projectId?: string
  collaborativeMembers?: Array<{ uid: string; displayName: string; color?: string }>
}

const DEFAULT_COLUMNS: ProblemSituationWorkspaceColumn[] = [
  { id: 'element', label: '요소', color: '#E8F0FE' },
  { id: 'content', label: '내용', color: '#E8F0FE' },
]

const INSERT_BLOCK_TYPES: Array<{
  type: ProblemSituationWorkspaceBlockType
  label: string
  description: string
  icon: Icon
}> = [
  { type: 'heading',    label: '제목',      description: '큰 제목으로 섹션 시작', icon: TextH },
  { type: 'subheading', label: '부제목',    description: '소제목으로 묶음 표시',   icon: TextHTwo },
  { type: 'paragraph',  label: '본문',      description: '일반 문단 텍스트',       icon: TextAlignLeft },
  { type: 'quote',      label: '인용',      description: '근거·인용구 강조',       icon: Quotes },
  { type: 'checklist',  label: '체크리스트', description: '단계·점검 항목',         icon: ListChecks },
  { type: 'table',      label: '표',        description: '여러 열 비교 정리',     icon: TableIcon },
]

const SOURCE_LABEL = {
  workspace: '공동 초안 편집 중',
  aiDraft: 'AI 산출물 초안에서 시작',
  blank: '빈 문서에서 시작',
} as const

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function emptyRow(columns: ProblemSituationWorkspaceColumn[]): ProblemSituationWorkspaceRow {
  return {
    id: makeId('psw_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function emptyWorkspace(): ProblemSituationWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: [],
    blocks: [],
  }
}

// scenario/drivingQuestion → 요소·내용 표 5행으로 변환 (stable id)
function scenarioToRows(scenario?: Partial<Ds12Structured['scenario']>, drivingQuestion?: string): ProblemSituationWorkspaceRow[] {
  const map: Record<string, string> = {
    title: scenario?.title ?? '',
    authenticity: scenario?.authenticity ?? '',
    contentProduct: scenario?.contentProduct ?? '',
    audienceAction: scenario?.audienceAction ?? '',
    drivingQuestion: drivingQuestion ?? '',
  }
  return SCENARIO_ROWS.map((r, idx) => ({
    id: `psw_row_seed_${idx}`,
    cells: { element: r.element, content: map[r.key] ?? '' },
    color: '#FFFFFF',
  }))
}

// Ds-1-2 문제상황 산출물 예시. 사용자가 "예시" 버튼으로 미리보기 → 워크스페이스 채우기.
const EXAMPLE_PS_DATA = {
  scenario: {
    title: '우리 동네 미세먼지, 데이터로 말한다',
    authenticity: '구청 환경과가 내년 대기질 개선 예산 편성을 앞두고 우리 동네 학생들의 의견을 듣기로 했습니다. 단, 막연한 의견이 아니라 실제 데이터에 근거한 제안만 검토하겠다고 합니다.',
    contentProduct: "여러분은 '시민 데이터 분석팀'이 되어, 공공데이터포털의 동네 대기질 데이터를 수학(통계)으로 분석하고, 사회(지리)로 원인 지역을 해석하며, 정보(데이터 시각화)로 표현해 최종 정책 제안 보고서를 작성합니다.",
    audienceAction: '완성된 보고서를 구청 환경과 담당 주무관과 학급 전체 앞에서 5분 발표하고, 질의응답을 거쳐 제안서를 제출합니다.',
  },
  drivingQuestion: '우리 동네 공기, 우리가 데이터로 바꿀 수 있을까?',
} as const

function buildExampleWorkspace(): ProblemSituationWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: scenarioToRows(EXAMPLE_PS_DATA.scenario, EXAMPLE_PS_DATA.drivingQuestion),
    blocks: [],
  }
}

// 문자열 정규화 (배열·객체·문자열 혼재 대응)
function asText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n')
  return String(v)
}

function wsBlock(idx: number, type: ProblemSituationWorkspaceBlockType, content: string): ProblemSituationWorkspaceBlock {
  return { id: `psw_wb_seed_${idx}`, type, content, color: '#FFFFFF', checked: false, includeInArtifact: true }
}

function wsTableBlock(
  idx: number,
  columnLabels: string[],
  rowCells: string[][],
): ProblemSituationWorkspaceBlock {
  const columns: ProblemSituationWorkspaceColumn[] = columnLabels.map((label, ci) => ({
    id: `psw_wbcol_${idx}_${ci}`,
    label,
    color: '#E8F0FE',
  }))
  const rows: ProblemSituationWorkspaceRow[] = rowCells.map((cells, ri) => ({
    id: `psw_wbrow_${idx}_${ri}`,
    cells: Object.fromEntries(columns.map((c, ci) => [c.id, cells[ci] ?? ''])),
    color: '#FFFFFF',
  }))
  return {
    id: `psw_wb_seed_${idx}`,
    type: 'table',
    content: '',
    color: '#FFFFFF',
    checked: false,
    includeInArtifact: true,
    table: { columns, rows },
  }
}

// 문제상황 워크숍 산출물을 "산출물 형식에 최적화된" 공동 편집 워크스페이스로 변환한다.
// 요소·내용 2열 격자가 아니라 본문/표/체크리스트 등 문서 블록으로 자연스럽게 구성한다.
// (시나리오 rows는 비우고, workspaceToArtifact가 블록에서 scenario를 역추출)
function workshopArtifactToWorkspace(content: Record<string, unknown>): ProblemSituationWorkspace | null {
  const sel = content['선정 문제상황'] as
    | {
        제목?: string; 문제상황?: string; 교과별학습내용?: string; 산출물?: string
        성취기준연결?: Array<{ standardId?: string; subject?: string; isCenter?: boolean; connection?: string }>
        데이터출처?: Array<{ label?: string; url?: string } | string>
        AI점검?: string
      }
    | undefined
  const cands = content['문제상황 후보'] as
    | Array<{ 제목?: string; 문제상황?: string; 데이터출처?: string; 선정?: boolean }>
    | undefined
  const chosen = Array.isArray(cands) ? (cands.find(c => c.선정) ?? cands[0]) : undefined

  const title = (sel?.제목 || chosen?.제목 || '').trim()
  const authenticity = (sel?.문제상황 || chosen?.문제상황 || '').trim()
  const learning = asText(sel?.교과별학습내용)
  const product = asText(sel?.산출물)
  const contentProduct = [learning, product ? `[산출물]\n${product}` : ''].filter(Boolean).join('\n\n')
  const drivingQuestion = asText(content['핵심 질문'] ?? content['핵심질문'])
  const essentials = content['탐구 질문']
  const essentialList = Array.isArray(essentials)
    ? essentials.map(asText).filter(Boolean)
    : asText(essentials).split('\n').map(s => s.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean)

  if (!title && !authenticity && !contentProduct && !drivingQuestion) return null

  const blocks: ProblemSituationWorkspaceBlock[] = []
  let bi = 0
  if (title) blocks.push(wsBlock(bi++, 'heading', title))

  // 빈 섹션은 만들지 않는다 — 워크숍 산출물에 실제로 있는 내용만 블록으로 구성.
  if (authenticity) {
    blocks.push(wsBlock(bi++, 'subheading', '실제성 — 학생이 마주할 진짜 맥락'))
    blocks.push(wsBlock(bi++, 'paragraph', authenticity))
  }

  if (contentProduct) {
    blocks.push(wsBlock(bi++, 'subheading', '학습 내용 + 산출물'))
    blocks.push(wsBlock(bi++, 'paragraph', contentProduct))
  }

  if (drivingQuestion) {
    blocks.push(wsBlock(bi++, 'subheading', '탐구 질문 (Driving Question)'))
    blocks.push(wsBlock(bi++, 'paragraph', drivingQuestion))
  }

  const align = sel?.성취기준연결
  if (Array.isArray(align) && align.length > 0) {
    blocks.push(wsBlock(bi++, 'subheading', '성취기준 연결'))
    blocks.push(wsTableBlock(
      bi++,
      ['성취기준', '교과', '구분', '연결 방식'],
      align.map(a => [
        a.standardId ?? '',
        a.subject ?? '',
        a.isCenter ? '중심' : '연계',
        a.connection ?? '',
      ]),
    ))
  }

  const data = sel?.데이터출처 ?? chosen?.데이터출처
  const dataText = Array.isArray(data)
    ? data.map(d => (typeof d === 'string' ? d : [d.label, d.url].filter(Boolean).join(' — '))).filter(Boolean).join('\n')
    : asText(data)
  if (dataText) {
    blocks.push(wsBlock(bi++, 'subheading', '실제 데이터'))
    blocks.push(wsBlock(bi++, 'paragraph', dataText))
  }

  if (essentialList.length > 0) {
    blocks.push(wsBlock(bi++, 'subheading', '하위 탐구 질문 (Essential Questions)'))
    blocks.push(wsBlock(bi++, 'checklist', essentialList.map(q => `- [ ] ${q}`).join('\n')))
  }

  const aiCheck = asText(sel?.AI점검)
  if (aiCheck) {
    blocks.push(wsBlock(bi++, 'subheading', 'AI 점검 (목표·평가 정합성)'))
    blocks.push(wsBlock(bi++, 'quote', aiCheck))
  }

  // rows는 비움 — 본문/표 블록 중심 구조. scenario는 저장 시 블록에서 역추출.
  return { columns: DEFAULT_COLUMNS, rows: [], blocks }
}

function normalizeWorkspace(saved?: ProblemSituationWorkspace, artifactContent?: Record<string, unknown>): ProblemSituationWorkspace {
  if (saved && saved.columns && saved.columns.length > 0 && !isBlankWorkspace(saved)) {
    return {
      columns: saved.columns,
      rows: saved.rows ?? [],
      blocks: saved.blocks ?? [],
      updatedBy: saved.updatedBy,
      updatedAt: saved.updatedAt,
    }
  }
  // artifactContent가 Ds-1-2 structured면 scenario/drivingQuestion → 5행으로 자동 로드 (AI 초안 모드)
  const structured = artifactContent?._schema === 'Ds-1-2' ? artifactContent as unknown as Ds12Structured : null
  if (structured) {
    if (structured.manualWorkspace) return normalizeWorkspace(structured.manualWorkspace)
    // (1) 공동 편집 형태(scenario 객체)
    if (structured.scenario && (structured.scenario.title || structured.scenario.authenticity || structured.scenario.contentProduct || structured.scenario.audienceAction)) {
      return { columns: DEFAULT_COLUMNS, rows: scenarioToRows(structured.scenario, structured.drivingQuestion), blocks: [] }
    }
    // (2) 워크숍 저장 형태(선정 문제상황/문제상황 후보) → 시나리오 표 + 부가 블록으로 환원
    const fromWorkshop = workshopArtifactToWorkspace(artifactContent as Record<string, unknown>)
    if (fromWorkshop) return fromWorkshop
    // (3) 그 외(scenario만 비어 있고 drivingQuestion 등) — 기본 매핑
    return { columns: DEFAULT_COLUMNS, rows: scenarioToRows(structured.scenario, structured.drivingQuestion), blocks: [] }
  }
  return emptyWorkspace()
}

function getCell(row: ProblemSituationWorkspaceRow, columnId: string): string {
  return (row.cells?.[columnId] ?? '') as string
}

function defaultBlockTable(rowCount = 2, columnCount = 2): ProblemSituationWorkspaceTableData {
  const columns: ProblemSituationWorkspaceColumn[] = Array.from({ length: columnCount }, (_, i) => ({
    id: makeId(`col_${i}`),
    label: `열 ${i + 1}`,
    color: '#E8F0FE',
  }))
  const rows: ProblemSituationWorkspaceRow[] = Array.from({ length: rowCount }, () => ({
    id: makeId('blockrow'),
    cells: Object.fromEntries(columns.map(c => [c.id, ''])),
    color: '#FFFFFF',
  }))
  return { columns, rows }
}

function getBlockTable(block: ProblemSituationWorkspaceBlock): ProblemSituationWorkspaceTableData {
  return block.table ?? defaultBlockTable()
}

function makeDocumentBlock(
  type: ProblemSituationWorkspaceBlockType,
  table?: ProblemSituationWorkspaceTableData,
): ProblemSituationWorkspaceBlock {
  const block: ProblemSituationWorkspaceBlock = {
    id: makeId('ldd_block'),
    type,
    content: '',
    color: '#FFFFFF',
    checked: false,
    includeInArtifact: true,
  }
  if (type === 'table') block.table = table ?? defaultBlockTable()
  return block
}

function workspaceToArtifact(workspace: ProblemSituationWorkspace): Ds12Structured {
  // 요소(element) 셀 값 → scenario 필드/drivingQuestion 매핑.
  const scenario = { title: '', authenticity: '', contentProduct: '', audienceAction: '' }
  let drivingQuestion = ''
  for (const row of workspace.rows) {
    const el = getCell(row, 'element').trim()
    const val = getCell(row, 'content').trim()
    if (!val) continue
    if (el.includes('제목')) scenario.title = val
    else if (el.includes('실제성') || el.includes('행1')) scenario.authenticity = val
    else if (el.includes('학습') || el.includes('산출물') || el.includes('행2')) scenario.contentProduct = val
    else if (el.includes('청중') || el.includes('행위') || el.includes('행3')) scenario.audienceAction = val
    // 표의 질문 행은 '탐구 질문'(구 '핵심 질문') 하나뿐 — 라벨 변경 후에도 역파싱 유지
    else if (el.includes('탐구 질문') || el.includes('핵심 질문') || el.includes('핵심질문') || el.includes('Driving')) drivingQuestion = val
  }
  // rows에서 시나리오를 못 채웠으면 본문/표 블록 구조에서 역추출
  // (워크숍 불러오기 등 블록 중심 레이아웃 대응: 소제목 다음 본문/인용 = 그 섹션 값)
  const hasScenarioFromRows = scenario.title || scenario.authenticity || scenario.contentProduct || scenario.audienceAction || drivingQuestion
  if (!hasScenarioFromRows && workspace.blocks.length > 0) {
    const blocks = workspace.blocks
    const firstHeading = blocks.find(b => b.type === 'heading')
    if (firstHeading?.content?.trim()) scenario.title = firstHeading.content.trim()
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.type !== 'subheading') continue
      const label = (b.content ?? '').trim()
      // 다음 본문/인용 블록 (소제목 전까지)
      let val = ''
      for (let j = i + 1; j < blocks.length; j++) {
        const nb = blocks[j]
        if (nb.type === 'subheading' || nb.type === 'heading') break
        if ((nb.type === 'paragraph' || nb.type === 'quote') && nb.content?.trim()) { val = nb.content.trim(); break }
      }
      if (!val) continue
      if (label.includes('실제성') || label.includes('문제 상황')) scenario.authenticity = val
      else if (label.includes('학습') || label.includes('산출물')) scenario.contentProduct = val
      else if (label.includes('청중') || label.includes('행위')) scenario.audienceAction = val
      else if (label.includes('핵심 질문') || label.includes('핵심질문') || label.includes('Driving')) drivingQuestion = val
    }
  }
  // 블록 구조에서 워크숍 산출물과 동일한 리치 형태(선정 문제상황/탐구 질문/AI 점검)도 함께 생성한다.
  // → 공동 편집 저장 후에도 Ds12Renderer가 워크숍 저장본과 같은 풍부한 레이아웃으로 렌더.
  const blocks = workspace.blocks
  const subIdx = (pred: (label: string) => boolean) =>
    blocks.findIndex(b => b.type === 'subheading' && pred((b.content ?? '').trim()))
  const blockAfter = (
    startIdx: number,
    pred: (b: ProblemSituationWorkspaceBlock) => boolean,
  ): ProblemSituationWorkspaceBlock | undefined => {
    if (startIdx < 0) return undefined
    for (let j = startIdx + 1; j < blocks.length; j++) {
      const nb = blocks[j]
      if (nb.type === 'subheading' || nb.type === 'heading') break
      if (pred(nb)) return nb
    }
    return undefined
  }

  // 성취기준 연결: 컬럼 라벨에 '성취기준'이 포함된 표 블록
  const alignTable = blocks.find(
    b => b.type === 'table' && (b.table?.columns ?? []).some(c => (c.label ?? '').includes('성취기준')),
  )?.table
  const 성취기준연결 = alignTable
    ? alignTable.rows.map(r => {
        const cell = (kw: string) => {
          const col = alignTable.columns.find(c => (c.label ?? '').includes(kw))
          return col ? String(r.cells?.[col.id] ?? '').trim() : ''
        }
        return {
          standardId: cell('성취기준'),
          subject: cell('교과'),
          isCenter: cell('구분').includes('중심'),
          connection: cell('연결'),
        }
      }).filter(a => a.standardId || a.connection)
    : []

  const dataBlock = blockAfter(subIdx(l => l.includes('실제 데이터')), b => b.type === 'paragraph' && !!b.content?.trim())
  const 데이터출처 = (dataBlock?.content ?? '')
    .split('\n').map(s => s.trim()).filter(Boolean)
    .map(line => {
      const m = line.match(/(https?:\/\/\S+)/)
      return m ? { label: line.replace(m[1], '').replace(/[—\-·:]\s*$/, '').trim(), url: m[1] } : { label: line }
    })

  // 하위 탐구 질문 소제목(구 '탐구 질문')의 체크리스트. 대표 '탐구 질문 (Driving Question)' 소제목과
  // 구분하기 위해 'Essential' 또는 '하위 탐구'로 매칭한다.
  const eqBlock = blockAfter(subIdx(l => l.includes('Essential') || l.includes('하위 탐구')), b => b.type === 'checklist' && !!b.content?.trim())
  const 탐구질문 = eqBlock
    ? parseChecklist(eqBlock.content).map(it => it.text.trim()).filter(Boolean)
    : []

  const aiBlock = blockAfter(subIdx(l => l.includes('AI 점검')), b => b.type === 'quote' && !!b.content?.trim())
    ?? blocks.find(b => b.type === 'quote' && !!b.content?.trim())
  const AI점검 = (aiBlock?.content ?? '').trim()

  const rich: Record<string, unknown> = {}
  if (scenario.title || scenario.authenticity || scenario.contentProduct || 성취기준연결.length || AI점검) {
    rich['선정 문제상황'] = {
      제목: scenario.title,
      문제상황: scenario.authenticity,
      성취기준연결,
      데이터출처,
      교과별학습내용: scenario.contentProduct,
      산출물: '',
      AI점검,
    }
  }
  if (drivingQuestion) rich['핵심 질문'] = drivingQuestion
  if (탐구질문.length) rich['탐구 질문'] = 탐구질문

  return {
    _schema: 'Ds-1-2',
    scenario,
    drivingQuestion,
    manualWorkspace: workspace,
    ...rich,
  } as Ds12Structured
}

function preserveEditingValue(
  next: ProblemSituationWorkspace,
  current: ProblemSituationWorkspace,
  editingKey: string | null,
): ProblemSituationWorkspace {
  if (!editingKey) return next
  if (editingKey.startsWith('column:')) {
    const columnId = editingKey.slice('column:'.length)
    const currentColumn = current.columns.find(column => column.id === columnId)
    if (!currentColumn) return next
    return {
      ...next,
      columns: next.columns.map(column => column.id === columnId
        ? { ...column, label: currentColumn.label }
        : column),
    }
  }
  if (editingKey.startsWith('block:') || editingKey.startsWith('block-table:') || editingKey.startsWith('block-table-column:')) {
    const [, blockId] = editingKey.split(':')
    const currentBlock = current.blocks.find(block => block.id === blockId)
    if (!currentBlock) return next
    return {
      ...next,
      blocks: next.blocks.map(block => block.id === blockId ? currentBlock : block),
    }
  }
  const [rowId, columnId] = editingKey.split(':')
  if (!rowId || !columnId) return next
  const currentRow = current.rows.find(row => row.id === rowId)
  if (!currentRow) return next
  const currentValue = currentRow.cells?.[columnId] ?? ''
  return {
    ...next,
    rows: next.rows.map(row => row.id === rowId
      ? { ...row, cells: { ...row.cells, [columnId]: currentValue } }
      : row),
  }
}

export function ProblemSituationWorkspaceModal({
  open,
  onClose,
  workspace: savedWorkspace,
  artifactContent,
  currentUid,
  currentUserName,
  currentUserColor,
  presence,
  isHost,
  onPatchSave,
  onPresenceUpdate,
  onSendArtifact,
  projectTitle,
  targetGradeGroup,
  targetSubjects,
  integratedGoal,
  subjectGoals,
  learnerProfile,
  evaluationPlan,
  chatMessages,
  projectId,
  collaborativeMembers,
}: Props) {
  const [workspace, setWorkspace] = useState<ProblemSituationWorkspace>(() => normalizeWorkspace(savedWorkspace, artifactContent))
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>()
  const [offerReflection, setOfferReflection] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [tableDraft, setTableDraft] = useState({ open: false, rows: 3, columns: 2 })
  const [showExample, setShowExample] = useState(false)
  const [showCollaborativePrompt, setShowCollaborativePrompt] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [suggestion, setSuggestion] = useState<ProblemSituationSuggestResult | null>(null)
  const pendingDeletionsRef = useRef<Set<string>>(new Set())

  // 원격 스냅숏은 들어올 때만 반영하고, 편집 중·저장 대기 중 칸은 로컬 값을 지킨다(#T7 — 칸에서 나가면 옛 저장본으로 되돌아가던 결함).
  const incomingWorkspace = useMemo(() => normalizeWorkspace(savedWorkspace, artifactContent), [artifactContent, savedWorkspace])
  const sync = useWorkspaceSync({
    open, incoming: incomingWorkspace, workspace, setWorkspace, editingKey,
    // 서버 저장본이 비어 있으면(빈 초안·산출물에서 채워 연 표) 첫 변경은 화면 표 통째로 저장 (#T7b)
    remoteBlank: isBlankWorkspace(savedWorkspace),
    preserve: (next, current, key) => preserveEditingValue(next, current, key),
  })

  // 마지막 송신 presence 추적 + heartbeat
  const lastPresenceRef = useRef<{ cellKey: string; caretPos?: number }>({ cellKey: 'modal:idle' })

  useEffect(() => {
    if (!open) {
      onPresenceUpdate?.(null)
      lastPresenceRef.current = { cellKey: 'modal:idle' }
      return
    }
    if (!currentUid || !onPresenceUpdate) return
    const sendCurrent = () => {
      const last = lastPresenceRef.current
      onPresenceUpdate({
        uid: currentUid,
        displayName: currentUserName ?? '나',
        color: currentUserColor ?? '#1A73E8',
        cellKey: last.cellKey,
        caretPos: last.caretPos,
        updatedAt: Date.now(),
      })
    }
    sendCurrent()
    const t = setInterval(sendCurrent, 10000)
    return () => { clearInterval(t) }
  }, [open, currentUid, currentUserName, currentUserColor, onPresenceUpdate])

  const freshEditors = useMemo(() => {
    return Object.values(presence ?? {}).filter(entry => Date.now() - entry.updatedAt < 20000)
  }, [presence])

  const updatePresence = (cellKey: string | null, caretPos?: number) => {
    if (!onPresenceUpdate || !currentUid) return
    if (cellKey === null) {
      lastPresenceRef.current = { cellKey: 'modal:idle' }
      onPresenceUpdate({
        uid: currentUid,
        displayName: currentUserName ?? '나',
        color: currentUserColor ?? '#1A73E8',
        cellKey: 'modal:idle',
        updatedAt: Date.now(),
      })
      return
    }
    lastPresenceRef.current = { cellKey, caretPos }
    onPresenceUpdate({
      uid: currentUid,
      displayName: currentUserName ?? '나',
      color: currentUserColor ?? '#1A73E8',
      cellKey,
      caretPos,
      updatedAt: Date.now(),
    })
  }

  function focusField(cellKey: string, caretPos?: number) {
    setEditingKey(cellKey)
    updatePresence(cellKey, caretPos)
  }

  function blurField() {
    setEditingKey(null)
    updatePresence(null)
  }

  function editorForCell(cellKey: string): PresenceEntry | undefined {
    return freshEditors.find(entry => entry.cellKey === cellKey && entry.uid !== currentUid)
  }

  function setCellLocal(rowId: string, columnId: string, value: string) {
    setWorkspace(prev => ({
      ...prev,
      rows: prev.rows.map(row => row.id === rowId
        ? { ...row, cells: { ...row.cells, [columnId]: value } }
        : row),
    }))
  }

  function setColumnLabelLocal(columnId: string, label: string) {
    setWorkspace(prev => ({
      ...prev,
      columns: prev.columns.map(column => column.id === columnId ? { ...column, label } : column),
    }))
  }

  function setBlockLocal(block: ProblemSituationWorkspaceBlock) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(item => item.id === block.id ? block : item),
    }))
  }

  function setBlockTableLocal(blockId: string, table: ProblemSituationWorkspaceTableData) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(block => block.id === blockId ? { ...block, table } : block),
    }))
  }

  async function commit(patch: ProblemSituationWorkspacePatch, next: ProblemSituationWorkspace) {
    setWorkspace(next)
    setMessage('')
    try {
      const cleanPatch = stripUndefinedDeep(sync.prepare(patch, next)) as ProblemSituationWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (saved) sync.applySaved(normalizeWorkspace(saved))
      setLastSavedAt(saved?.updatedAt ?? Date.now())
    } catch (error) {
      console.error('[problemSituationWorkspace patch]', error)
      setMessage('저장하지 못했습니다. 다시 시도해주세요.')
    }
  }

  async function handleSaveAll() {
    if (saving || sending) return
    setSaving(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: await sync.settledLatest(), updatedBy: currentUserName }) as ProblemSituationWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (saved) sync.applySaved(normalizeWorkspace(saved))
      setLastSavedAt(saved?.updatedAt ?? Date.now())
      setMessage('공동 편집 초안을 저장했습니다.')
      setOfferReflection(isHost)
    } catch (error) {
      console.error('[problemSituationWorkspace save]', error)
      setMessage('저장하지 못했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  async function addRow() {
    const row = emptyRow(workspace.columns)
    const next = { ...workspace, rows: [...workspace.rows, row] }
    await commit({ type: 'add-row', row, updatedBy: currentUserName }, next)
  }

  async function deleteRow(rowId: string) {
    const next = { ...workspace, rows: workspace.rows.filter(r => r.id !== rowId) }
    await commit({ type: 'delete-row', rowId }, next)
  }

  async function addColumn() {
    const column: ProblemSituationWorkspaceColumn = {
      id: makeId('col'),
      label: '새 열',
      color: '#E8F0FE',
    }
    const next = {
      ...workspace,
      columns: [...workspace.columns, column],
      rows: workspace.rows.map(row => ({ ...row, cells: { ...row.cells, [column.id]: '' } })),
    }
    await commit({ type: 'add-column', column, updatedBy: currentUserName }, next)
  }

  async function updateColumnLabel(columnId: string, label: string) {
    const next = {
      ...workspace,
      columns: workspace.columns.map(col => col.id === columnId ? { ...col, label } : col),
    }
    await commit({ type: 'update-column', columnId, label, updatedBy: currentUserName }, next)
  }

  async function deleteColumn(columnId: string) {
    const next = {
      ...workspace,
      columns: workspace.columns.filter(col => col.id !== columnId),
      rows: workspace.rows.map(row => {
        const cells = { ...row.cells }
        delete cells[columnId]
        return { ...row, cells }
      }),
    }
    await commit({ type: 'delete-column', columnId }, next)
  }

  async function updateCell(rowId: string, columnId: string, value: string) {
    const next = {
      ...workspace,
      rows: workspace.rows.map(row => row.id === rowId
        ? { ...row, cells: { ...row.cells, [columnId]: value } }
        : row),
    }
    await commit({ type: 'update-cell', rowId, columnId, value, updatedBy: currentUserName }, next)
  }

  // ── Notion식 편집 편의 ─────────────────────────────────────────
  // 새 텍스트 블록을 만들면 곧바로 커서를 넣어 바로 타이핑할 수 있게 한다.
  // React 이펙트 안에서 포커스를 잡으면 리렌더 정리(cleanup)에 취소되어 놓치는 경우가 있어,
  // 생명주기 밖에서 DOM에 나타날 때까지 짧게 재시도한다.
  function focusBlockSoon(blockId: string, tries = 0) {
    const el = document.querySelector<HTMLTextAreaElement>(`[data-block-input="${blockId}"]`)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      return
    }
    if (tries < 40) setTimeout(() => focusBlockSoon(blockId, tries + 1), 25)
  }

  /** 빈 공간 클릭 / 본문에서 Enter → 새 본문 블록 추가 후 즉시 입력 가능 */
  async function appendParagraph(afterBlockId?: string) {
    const block = makeDocumentBlock('paragraph')
    const blocks = [...workspace.blocks]
    const at = afterBlockId ? blocks.findIndex(item => item.id === afterBlockId) : -1
    if (at >= 0) blocks.splice(at + 1, 0, block)
    else blocks.push(block)
    const next = { ...workspace, blocks }
    focusBlockSoon(block.id)
    // 중간 삽입은 순서가 중요하므로 replace-all로 전체를 보낸다 (append는 upsert로 충분)
    await commit(
      at >= 0
        ? { type: 'replace-all', workspace: next, updatedBy: currentUserName }
        : { type: 'upsert-block', block, updatedBy: currentUserName },
      next,
    )
    focusBlockSoon(block.id)
  }

  async function addBlock(type: ProblemSituationWorkspaceBlockType) {
    if (type === 'table') {
      setShowInsertMenu(false)
      setTableDraft({ open: true, rows: 3, columns: 2 })
      return
    }
    const block = makeDocumentBlock(type)
    const next = { ...workspace, blocks: [...workspace.blocks, block] }
    setShowInsertMenu(false)
    await commit({ type: 'upsert-block', block, updatedBy: currentUserName }, next)
  }

  async function addTableBlock(rowCount: number, columnCount: number) {
    const block = makeDocumentBlock('table', defaultBlockTable(rowCount, columnCount))
    const next = { ...workspace, blocks: [...workspace.blocks, block] }
    setTableDraft(prev => ({ ...prev, open: false }))
    await commit({ type: 'upsert-block', block, updatedBy: currentUserName }, next)
  }

  async function updateBlock(block: ProblemSituationWorkspaceBlock) {
    const next = { ...workspace, blocks: workspace.blocks.map(item => item.id === block.id ? block : item) }
    await commit({ type: 'upsert-block', block, updatedBy: currentUserName }, next)
  }

  async function deleteBlock(blockId: string) {
    const next = { ...workspace, blocks: workspace.blocks.filter(block => block.id !== blockId) }
    await commit({ type: 'delete-block', blockId }, next)
  }

  async function reorderBlocks(from: number, to: number) {
    const blocks = reorderArray(workspace.blocks, from, to)
    if (blocks === workspace.blocks) return
    const next = { ...workspace, blocks }
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next)
  }
  const blockDnd = useBlockDnd(reorderBlocks)

  async function applyExampleToWorkspace() {
    const hasContent = workspace.rows.length > 0 || workspace.blocks.length > 0
    if (hasContent && typeof window !== 'undefined' && !window.confirm('기존 내용을 예시로 교체할까요?')) return
    const example = buildExampleWorkspace()
    await commit({ type: 'replace-all', workspace: example, updatedBy: currentUserName }, example)
    setShowExample(false)
    setMessage('예시를 워크스페이스에 적용했습니다.')
  }

  // 워크숍/산출물에 저장된 Ds-1-2 내용을 공동 편집 표로 불러오기 (덮어쓰기)
  async function loadFromArtifact() {
    const loaded = normalizeWorkspace(undefined, artifactContent)
    if (loaded.rows.length === 0 && loaded.blocks.length === 0) {
      setMessage('불러올 워크숍/산출물 내용이 없습니다. 먼저 워크숍에서 후보를 선정·저장하세요.')
      return
    }
    const hasContent = workspace.rows.some(r => Object.values(r.cells ?? {}).some(v => String(v ?? '').trim())) || workspace.blocks.length > 0
    if (hasContent && typeof window !== 'undefined' && !window.confirm('현재 편집 중인 내용을 워크숍 저장본으로 교체할까요?')) return
    await commit({ type: 'replace-all', workspace: loaded, updatedBy: currentUserName }, loaded)
    setMessage('워크숍에서 저장된 문제상황을 불러왔습니다. 이어서 수정하세요.')
  }

  async function requestSuggestion(customPrompts?: Array<{ teacherName: string; text: string }>) {
    const hasContext = !!integratedGoal?.trim() || !!(subjectGoals && subjectGoals.length > 0)
    if (!hasContext) {
      setSuggestError(`이전 단계(${displayActivityCode('A-2-2')}) 통합 수업목표가 아직 준비되지 않아 AI 제안을 만들 수 없습니다.`)
      return
    }

    // AI 제안 2-mode 분기:
    //  - artifact: 채팅에서 이미 생성된 Ds-1-2 산출물(artifactContent._schema 일치) 기반으로 정교화
    //  - chat:    빈 워크스페이스 — 현재 활동의 팀 채팅 메시지를 컨텍스트로 초안 작성
    const artifactScenario = (artifactContent as { scenario?: Partial<Ds12Structured['scenario']>; drivingQuestion?: string } | undefined)
    const isArtifactMode = artifactContent?._schema === 'Ds-1-2' && !!(artifactScenario?.scenario || artifactScenario?.drivingQuestion)
    const mode: 'artifact' | 'chat' = isArtifactMode ? 'artifact' : 'chat'
    const existingArtifact = isArtifactMode ? { scenario: artifactScenario?.scenario, drivingQuestion: artifactScenario?.drivingQuestion } : undefined
    const chatContext = mode === 'chat'
      ? (chatMessages ?? []).slice(-40).map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))
      : undefined

    // 현재 워크스페이스 초안을 scenario/drivingQuestion으로 환원
    const draftStructured = workspaceToArtifact(workspace)

    setSuggestError('')
    setSuggestLoading(true)
    setSuggestion(null)
    try {
      const body: ProblemSituationSuggestRequest = {
        projectTitle,
        targetGradeGroup,
        targetSubjects,
        integratedGoal,
        subjectGoals,
        learnerProfile,
        evaluationPlan,
        currentDraft: {
          scenario: draftStructured.scenario,
          drivingQuestion: draftStructured.drivingQuestion,
        },
        mode,
        existingArtifact,
        chatContext,
        customPrompts,
      }
      const res = await fetch('/api/problem-situation/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(errBody?.error ?? `요청 실패 (${res.status})`)
      }
      const result = await res.json() as ProblemSituationSuggestResult
      setSuggestion(result)
    } catch (err) {
      console.error('[problemSituationWorkspace suggest]', err)
      setSuggestError(err instanceof Error ? err.message : '제안을 받지 못했습니다.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function applySuggestion() {
    if (!suggestion) return
    // 사용자가 컬럼 구조를 수정했어도 산출물 형식(DEFAULT_COLUMNS — 요소/내용 2열)으로 재구조화한다.
    const newRows = scenarioToRows(suggestion.scenario, suggestion.drivingQuestion)
    const nextWorkspace: ProblemSituationWorkspace = {
      ...workspace,
      columns: DEFAULT_COLUMNS,
      rows: newRows.length > 0 ? newRows : workspace.rows,
      updatedBy: currentUserName,
      updatedAt: Date.now(),
    }
    await commit({ type: 'replace-all', workspace: nextWorkspace, updatedBy: currentUserName }, nextWorkspace)
    setSuggestion(null)
    setMessage('AI 제안을 워크스페이스에 적용했습니다. (표 형식을 산출물 권장 형태로 복원)')
  }

  async function sendArtifact() {
    if (saving || sending) return
    setSending(true)
    try {
      const latestWorkspace = await sync.settledLatest()
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: latestWorkspace, updatedBy: currentUserName }) as ProblemSituationWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      const finalWorkspace = saved ?? latestWorkspace
      const structured = workspaceToArtifact(finalWorkspace)
      await sendWorkspaceArtifact({ isHost, projectId, activityCode: 'Ds-1-2', currentUid, currentUserName, content: stripUndefinedDeep(structured) as Ds12Structured, onSendArtifact })
      setLastSavedAt(saved?.updatedAt ?? Date.now())
      setOfferReflection(false)
      setMessage(isHost ? `${displayActivityCode('Ds-1-2')} 산출물로 보냈습니다.` : '방장에게 반영을 요청했어요')
      if (isHost) onClose()
    } catch (error) {
      console.error('[problemSituationWorkspace send]', error)
      const msg = error instanceof Error ? error.message : '알 수 없는 오류'
      setMessage(`산출물로 보내지 못했습니다: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const structuredDraft = artifactContent?._schema === 'Ds-1-2'
  const sourceMode = savedWorkspace ? 'workspace' : structuredDraft ? 'aiDraft' : 'blank'
  const editorModeLabel = isHost ? '편집 모드' : '공동 편집'
  // 워크숍/산출물에 불러올 Ds-1-2 내용이 있는지 (버튼 노출 조건)
  const canLoadFromArtifact = (() => {
    if (artifactContent?._schema !== 'Ds-1-2') return false
    const loaded = normalizeWorkspace(undefined, artifactContent)
    return loaded.rows.some(r => Object.values(r.cells ?? {}).some(v => String(v ?? '').trim())) || loaded.blocks.length > 0
  })()

  // 키워드만 안 쓰는 빈 변수 lint 경고 제거용
  void pendingDeletionsRef

  return createPortal(
    <>
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white w-full max-w-[1480px] h-[94vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[#DADCE0] bg-white">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#3C4043]">
            <FileText size={17} weight="bold" />
            {displayActivityCode('Ds-1-2')}
          </span>
          <span className="hidden sm:inline-flex h-8 items-center justify-center rounded-lg bg-[#D3E3FD] px-3 text-[13px] font-medium text-[#0842A0]">
            {editorModeLabel}
          </span>
          <span className="hidden md:inline-flex h-8 items-center rounded-lg bg-[#F1F3F4] px-3 text-[13px] font-medium text-[#5F6368]">
            {SOURCE_LABEL[sourceMode]}
          </span>
          <div className="flex-1" />
          {freshEditors.length > 0 && (
            <div className="hidden lg:flex items-center gap-1.5 mr-1">
              {freshEditors.slice(0, 4).map(entry => (
                <span key={entry.uid} className="text-[13px] font-bold px-2.5 py-1 rounded-full border border-white shadow-sm" style={{ color: entry.color, backgroundColor: `${entry.color}18` }}>
                  {entry.displayName || '팀원'}
                </span>
              ))}
            </div>
          )}
          <span className={cn(
            'hidden md:inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium',
            isHost ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'bg-[#F1F3F4] text-[#5F6368]',
          )}>
            {isHost ? '방장' : '팀원'}
          </span>
          {canLoadFromArtifact && isHost && (
            <button
              type="button"
              onClick={loadFromArtifact}
              title="문제상황 워크숍에서 선정·저장한 내용을 표로 불러옵니다"
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-full border border-[#AECBFA] bg-[#E8F0FE] text-[#1A73E8] text-[14px] font-bold shadow-sm transition-colors hover:bg-[#D2E3FC]"
            >
              <DownloadSimple size={17} weight="bold" />
              워크숍 내용 불러오기
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowExample(true)}
            title="최종 산출물 예시 보기"
            className="hidden sm:flex h-10 items-center gap-2 px-4 rounded-full border border-[#C4C7C5] bg-white text-[#3C4043] text-[14px] font-medium transition-colors hover:bg-[#F1F3F4] active:bg-[#E8EAED]"
          >
            <Sparkle size={17} weight="fill" className="text-[#1A73E8]" />
            예시
          </button>
          <button
            type="button"
            onClick={sendArtifact}
            disabled={sending || saving}
            title={isHost ? `현재 워크스페이스를 ${displayActivityCode('Ds-1-2')} 산출물로 보냅니다` : '편집 내용을 방장에게 반영 요청합니다'}
            className="hidden sm:flex h-10 items-center gap-2 px-5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#06327A] text-white text-[14px] font-medium shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)] transition-colors disabled:opacity-40 disabled:shadow-none"
          >
            <PaperPlaneRight size={17} weight="fill" />
            {sending ? '전송 중' : isHost ? '산출물로 보내기' : '방장에게 반영 요청'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-black/[0.08] active:bg-black/[0.12] text-[#5F6368] flex items-center justify-center transition-colors"
            aria-label="닫기"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {message && (
          <div className="px-6 py-2.5 border-b border-[#DADCE0] bg-[#FEF7E0] text-[14px] font-semibold text-[#B06000] flex items-center gap-2">
            <CheckCircle size={17} weight="fill" />
            {message}
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-white pb-24">
          <div className="max-w-[1400px] mx-auto px-5 py-12 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
            <article className="space-y-10 min-w-0">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 items-center rounded-md bg-[#D3E3FD] px-2.5 text-[13px] font-semibold text-[#0842A0]">{displayActivityCode('Ds-1-2')}</span>
                <span className="text-[30px] font-bold tracking-[-0.02em] text-[#37352F]">문제 상황 설정</span>
                <span className="ml-auto hidden sm:inline-flex h-7 items-center rounded-md bg-[#F1F3F4] px-2.5 text-[12px] font-medium text-[#6B6A67]">
                  {workspace.rows.length > 0 ? `${workspace.columns.length}열 · ${workspace.rows.length}행` : '문서 편집 중'}
                </span>
              </div>

              <p className="text-[15px] leading-[1.7] text-[#6B6A67]">
                {sourceMode === 'aiDraft'
                  ? 'AI가 만든 산출물 초안을 불러왔습니다. 직접 수정하거나 우측에서 AI 제안을 추가로 받을 수 있습니다.'
                  : sourceMode === 'workspace'
                    ? '저장된 공동 초안을 이어서 편집 중입니다. 우측에서 AI 제안을 받아 보강할 수 있습니다.'
                    : '빈 문서에서 시작합니다. 직접 작성하거나 우측에서 AI 제안을 받아 시작할 수 있습니다.'}
              </p>

              {/* 설계 원칙·근거 표 */}
              {workspace.rows.length > 0 ? (
              <section className="group relative space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-semibold tracking-[-0.01em] text-[#37352F]">문제상황 시나리오 (요소·내용)</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={addColumn} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#0B57D0] transition-colors hover:bg-[#D3E3FD]/50 active:bg-[#D3E3FD]">
                      <Plus size={15} weight="bold" /> 열
                    </button>
                    <button type="button" onClick={addRow} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#0B57D0] transition-colors hover:bg-[#D3E3FD]/50 active:bg-[#D3E3FD]">
                      <Plus size={15} weight="bold" /> 행
                    </button>
                  </div>
                </div>
                <div className="workspace-table-scroll overflow-x-auto rounded-lg border border-[#E9E9E7] bg-white">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-20 w-12 border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-2 py-2 text-left text-[13px] font-semibold text-[#202124]">행</th>
                        {workspace.columns.map(column => (
                          <th key={column.id} className="min-w-[150px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={column.label}
                                onChange={event => setColumnLabelLocal(column.id, event.target.value)}
                                onFocus={() => focusField(`column:${column.id}`)}
                                onBlur={event => {
                                  updateColumnLabel(column.id, event.target.value)
                                  blurField()
                                }}
                                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] font-semibold text-[#202124] placeholder:text-[#5F6368] hover:bg-black/5 focus:border-[#0B57D0] focus:bg-white focus:outline-none"
                              />
                              <button type="button" onClick={() => deleteColumn(column.id)} className="flex h-8 w-8 items-center justify-center rounded-md text-[#5F6368] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/5 hover:text-[#C5221F]" aria-label="열 삭제">
                                <Trash size={15} weight="bold" />
                              </button>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.rows.length === 0 ? (
                        <tr>
                          <td colSpan={workspace.columns.length + 1} className="border border-[#E9E9E7] bg-white px-4 py-10 text-center text-[14px] text-[#9B9A97]">
                            아직 설계 원칙이 없습니다. &lsquo;+ 행&rsquo;을 눌러 추가하거나 우측 AI 제안을 받아보세요.
                          </td>
                        </tr>
                      ) : workspace.rows.map((row, rowIndex) => (
                        <tr key={row.id}>
                          <td className="sticky left-0 z-10 w-12 border-b border-r border-[#E9E9E7] bg-[#FBFBFA] px-2 py-2 align-top">
                            <div className="flex items-center gap-1">
                              <span className="text-[13px] font-bold text-[#1A73E8]">{rowIndex + 1}</span>
                              <button type="button" onClick={() => deleteRow(row.id)} className="flex h-7 w-7 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 text-[#9B9A97] hover:bg-[#FCE8E6] hover:text-[#C5221F]" aria-label="행 삭제">
                                <Trash size={13} weight="bold" />
                              </button>
                            </div>
                          </td>
                          {workspace.columns.map(column => {
                            const cellKey = `${row.id}:${column.id}`
                            const editor = editorForCell(cellKey)
                            return (
                              <td key={column.id} className="border-b border-r border-[#E9E9E7] bg-white p-2 align-top">
                                <div className="relative">
                                  {editor && (
                                    <span className="absolute -top-2.5 left-3 z-10 px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm" style={{ backgroundColor: editor.color }}>
                                      {editor.displayName}
                                    </span>
                                  )}
                                  <AutoGrowTextarea
                                    value={getCell(row, column.id)}
                                    onChange={event => setCellLocal(row.id, column.id, event.target.value)}
                                    onFocus={() => focusField(cellKey)}
                                    onBlur={event => {
                                      updateCell(row.id, column.id, event.target.value)
                                      blurField()
                                    }}
                                    minRows={2}
                                    className="w-full min-h-[58px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-[#202124] hover:bg-[#F7F7F5] focus:border-[#0B57D0] focus:bg-white focus:outline-none"
                                  />
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              ) : (
                <button
                  type="button"
                  onClick={addRow}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#DADCE0] bg-white px-4 py-2.5 text-[14px] font-bold text-[#5F6368] hover:border-[#1A73E8] hover:text-[#1A73E8] hover:bg-[#E8F0FE] transition-colors"
                >
                  <Plus size={15} weight="bold" />
                  문제상황 시나리오 표 추가 (요소·내용)
                </button>
              )}

              {/* 추가 블록 + 삽입 영역 */}
              <div className="space-y-2">
                {workspace.blocks.length > 0 && workspace.blocks.map((block, blockIdx) => {
                  const table = block.type === 'table' ? getBlockTable(block) : null
                  return (
                    <section
                      key={block.id}
                      {...blockDnd.dropZoneProps(blockIdx)}
                      className={cn(
                        'group relative py-1 rounded-lg transition-colors',
                        blockDnd.overIndex === blockIdx && 'border-t-[3px] border-[#1A73E8] -mt-[3px]',
                      )}
                    >
                      <button
                        type="button"
                        {...blockDnd.handleProps(blockIdx)}
                        title="드래그하여 순서 이동"
                        className="absolute -left-9 top-10 flex h-9 w-9 cursor-grab items-center justify-center rounded-md text-[#9AA0A6] transition-colors hover:bg-[#E8F0FE] hover:text-[#1A73E8] active:cursor-grabbing opacity-0 group-hover:opacity-100"
                        aria-label="블록 순서 이동"
                      >
                        <DotsSixVertical size={17} weight="bold" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteBlock(block.id)}
                        className="absolute -left-9 top-3 flex h-9 w-9 items-center justify-center rounded-md text-[#9AA0A6] transition-colors hover:bg-[#FCE8E6] hover:text-[#C62828]"
                        aria-label="블록 삭제"
                      >
                        <Trash size={16} weight="bold" />
                      </button>
                      <div className="px-0 pb-2">
                        {table ? (
                          <div className="relative overflow-x-auto rounded-lg border border-[#E9E9E7] bg-white">
                            <table className="min-w-full border-collapse text-sm">
                              <thead>
                                <tr>
                                  {table.columns.map(column => (
                                    <th key={column.id} className="min-w-[180px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-2 py-2 text-left text-[13px] font-semibold text-[#202124]">
                                      {column.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {table.rows.map(row => (
                                  <tr key={row.id}>
                                    {table.columns.map(column => (
                                      <td key={column.id} className="border-b border-r border-[#E9E9E7] bg-white p-2 align-top">
                                        <AutoGrowTextarea
                                          value={(row.cells?.[column.id] ?? '') as string}
                                          onChange={event => {
                                            const nextTable = {
                                              ...table,
                                              rows: table.rows.map(item => item.id === row.id
                                                ? { ...item, cells: { ...item.cells, [column.id]: event.target.value } }
                                                : item),
                                            }
                                            setBlockTableLocal(block.id, nextTable)
                                          }}
                                          onFocus={() => focusField(`block-table:${block.id}:${row.id}:${column.id}`)}
                                          onBlur={event => {
                                            const nextTable = {
                                              ...table,
                                              rows: table.rows.map(item => item.id === row.id
                                                ? { ...item, cells: { ...item.cells, [column.id]: event.target.value } }
                                                : item),
                                            }
                                            updateBlock({ ...block, table: nextTable, content: '' })
                                            blurField()
                                          }}
                                          minRows={2}
                                          className="w-full min-h-[58px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-[#202124] hover:bg-[#F7F7F5] focus:border-[#0B57D0] focus:bg-white focus:outline-none"
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : block.type === 'checklist' ? (
                          (() => {
                            const items = parseChecklist(block.content)
                            const cm = (next: ChecklistItem[]) => updateBlock({ ...block, content: stringifyChecklist(next) })
                            const sl = (next: ChecklistItem[]) => setBlockLocal({ ...block, content: stringifyChecklist(next) })
                            const toggle = (i: number) => cm(items.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it))
                            const remove = (i: number) => cm(items.filter((_, idx) => idx !== i))
                            const add = () => cm([...items, { text: '', checked: false }])
                            return (
                              <div className="space-y-1.5 py-1">
                                {items.length === 0 && (
                                  <p className="text-[14px] text-[#9AA0A6]">체크리스트가 비어 있습니다.</p>
                                )}
                                {items.map((it, idx) => (
                                  <div key={idx} className="group/item flex items-start gap-2">
                                    <button type="button" onClick={() => toggle(idx)} className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center text-[#1A73E8] hover:text-[#1557B0]" aria-label={it.checked ? '체크 해제' : '체크'}>
                                      {it.checked ? <CheckSquare size={20} weight="fill" /> : <Square size={20} weight="regular" />}
                                    </button>
                                    <input
                                      value={it.text}
                                      onChange={event => sl(items.map((x, i) => i === idx ? { ...x, text: event.target.value } : x))}
                                      onFocus={() => focusField(`block:${block.id}`)}
                                      onBlur={event => {
                                        cm(items.map((x, i) => i === idx ? { ...x, text: event.target.value } : x))
                                        blurField()
                                      }}
                                      onKeyDown={event => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          cm([...items.slice(0, idx + 1), { text: '', checked: false }, ...items.slice(idx + 1)])
                                        } else if (event.key === 'Backspace' && it.text === '' && items.length > 1) {
                                          event.preventDefault()
                                          remove(idx)
                                        }
                                      }}
                                      placeholder="항목 내용"
                                      className={cn(
                                        'flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[16px] text-[#202124] hover:border-[#E8EAED] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20 focus:border-[#1A73E8]',
                                        it.checked && 'text-[#9AA0A6] line-through'
                                      )}
                                    />
                                    <button type="button" onClick={() => remove(idx)} className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-[#9AA0A6] opacity-0 transition-opacity hover:bg-[#FCE8E6] hover:text-[#C62828] group-hover/item:opacity-100" aria-label="항목 삭제">
                                      <Trash size={15} weight="bold" />
                                    </button>
                                  </div>
                                ))}
                                <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[14px] font-bold text-[#1A73E8] hover:bg-[#E8F0FE]">
                                  <Plus size={14} weight="bold" /> 항목 추가
                                </button>
                              </div>
                            )
                          })()
                        ) : (
                          <AutoGrowTextarea
                            value={block.content}
                            onChange={event => setBlockLocal({ ...block, content: event.target.value })}
                            data-block-input={block.id}
                            onFocus={() => focusField(`block:${block.id}`)}
                            onBlur={event => {
                              updateBlock({ ...block, content: event.target.value })
                              blurField()
                            }}
                            minRows={1}
                            placeholder={
                              block.type === 'heading' ? '제목을 입력하세요'
                              : block.type === 'subheading' ? '부제목을 입력하세요'
                              : block.type === 'quote' ? '인용·근거를 입력하세요'
                              : '내용을 입력하세요'
                            }
                            className={cn(
                              'w-full rounded-xl border border-transparent bg-transparent px-1 py-1.5 text-[18px] leading-[1.6] text-[#202124] hover:border-[#E8EAED] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20 focus:border-[#1A73E8]',
                              block.type === 'heading' && 'font-semibold text-[32px] leading-tight',
                              block.type === 'subheading' && 'font-bold text-[22px] leading-tight',
                              block.type === 'quote' && 'border-l-4 border-l-[#DADCE0] pl-4 italic text-[#5F6368]',
                            )}
                          />
                        )}
                      </div>
                    </section>
                  )
                })}

                <div className="relative pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowInsertMenu(value => !value)
                      setTableDraft(prev => ({ ...prev, open: false }))
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[14px] font-normal text-[#9B9A97] transition-colors hover:bg-[#EFEFEE] hover:text-[#37352F]"
                  >
                    <Plus size={17} weight="bold" />
                    삽입
                  </button>
                  {showInsertMenu && (
                    <div className="absolute left-0 top-10 z-20 w-72 rounded-xl border border-[#DADCE0] bg-white p-2 shadow-lg">
                      <p className="px-2 pb-2 pt-1 text-[12px] font-bold uppercase tracking-wider text-[#9AA0A6]">편집 도구</p>
                      {INSERT_BLOCK_TYPES.map(item => {
                        const ItemIcon = item.icon
                        return (
                          <button
                            key={item.type}
                            type="button"
                            onClick={() => addBlock(item.type)}
                            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#F1F3F4]"
                          >
                            <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-[#E8EAED] bg-white text-[#1A73E8]">
                              <ItemIcon size={18} weight="bold" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[15px] font-semibold text-[#202124]">{item.label}</span>
                              <span className="block text-[13px] text-[#5F6368]">{item.description}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {tableDraft.open && (
                    <div className="absolute left-0 top-10 z-20 w-64 rounded-xl border border-[#DADCE0] bg-white p-3 shadow-lg">
                      <p className="mb-3 text-[15px] font-semibold text-[#202124]">표 크기</p>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[14px] font-bold text-[#5F6368]">
                          행
                          <input type="number" min={1} max={12} value={tableDraft.rows} onChange={event => setTableDraft(prev => ({ ...prev, rows: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-[#DADCE0] px-3 py-2 text-[16px] text-[#202124] focus:border-[#1A73E8] focus:outline-none" />
                        </label>
                        <label className="text-[14px] font-bold text-[#5F6368]">
                          열
                          <input type="number" min={1} max={8} value={tableDraft.columns} onChange={event => setTableDraft(prev => ({ ...prev, columns: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-[#DADCE0] px-3 py-2 text-[16px] text-[#202124] focus:border-[#1A73E8] focus:outline-none" />
                        </label>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button type="button" onClick={() => setTableDraft(prev => ({ ...prev, open: false }))} className="rounded-lg px-3 py-2 text-[14px] font-bold text-[#5F6368] hover:bg-[#F1F3F4]">
                          취소
                        </button>
                        <button type="button" onClick={() => addTableBlock(tableDraft.rows, tableDraft.columns)} className="rounded-lg bg-[#1A73E8] px-3 py-2 text-[14px] font-bold text-white hover:bg-[#1557B0]">
                          삽입
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!isHost && (
                <div className="rounded-xl border border-[#DADCE0] bg-white px-3 py-2 text-[14px] text-[#5F6368] leading-relaxed">
                  팀원은 공동 초안을 편집할 수 있고, 최종 산출물 전송은 방장이 실행합니다.
                </div>
              )}
              {/* 빈 공간 클릭 → 바로 본문 입력 (Notion 편집창과 동일한 동작) */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => void appendParagraph()}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  void appendParagraph()
                }}
                aria-label="빈 곳을 눌러 내용 추가"
                className="min-h-[240px] w-full cursor-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B57D0]/30"
              />
            </article>

            {/* 우측: AI 추천 패널 */}
            <aside className="space-y-4 lg:sticky lg:top-6 self-start">
              <section className="rounded-2xl border border-[#E9E9E7] bg-[#FBFBFA] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#D3E3FD] text-[#0842A0]">
                    <Sparkle size={20} weight="fill" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-[#37352F]">추천 산출물 형식</p>
                    <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-[#5F6368]">
                      <li>· <b>실제성</b>: 학생이 실제로 마주할 법한 진짜 맥락·상황</li>
                      <li>· <b>학습 내용+산출물</b>: {displayActivityCode('A-2-2')} 목표와 연결된 핵심 학습·결과물</li>
                      <li>· <b>청중+행위</b>: 누구에게, 무엇을 하는가 (실제 청중·역할)</li>
                      <li>· <b>탐구 질문</b>: 단원을 관통하는 개방형 질문</li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[15px] font-bold text-[#202124]">AI 에이전트의 제안 받기</label>
                  <p className="text-[13px] leading-relaxed text-[#5F6368]">이전 단계({displayActivityCode('A-2-2')}) <b>통합 수업목표</b>·{displayActivityCode('Ds-1-1')} <b>평가 계획</b>과 학습자 맥락을 자동으로 읽어 <b>문제상황 시나리오 + 탐구 질문</b>을 한꺼번에 제안합니다. 결과는 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;하시면 됩니다.</p>
                  {suggestError && (
                    <p className="text-[14px] font-semibold text-[#C5221F]">{suggestError}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => requestSuggestion()}
                      disabled={suggestLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#06327A] px-5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)] transition-colors disabled:opacity-40 disabled:shadow-none"
                    >
                      <Sparkle size={16} weight="fill" />
                      {suggestLoading ? '제안 받는 중...' : 'AI 제안 받기'}
                    </button>
                    {suggestion && (
                      <span className="text-[14px] font-semibold text-[#137333]">미리보기 준비 완료</span>
                    )}
                  </div>
                  {projectId && (collaborativeMembers?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowCollaborativePrompt(true)}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#DADCE0] bg-white px-3 py-2 text-[14px] font-bold text-[#3C4043] hover:bg-[#F1F3F4] transition-colors"
                    >
                      <ChatCircleDots size={16} weight="bold" className="text-[#1A73E8]" />
                      구체적으로 AI에게 요청하기
                      <span className="ml-1 text-[12px] font-semibold text-[#5F6368]">(팀원 협업)</span>
                    </button>
                  )}
                </div>

                {suggestion && (
                  <div className="space-y-3 rounded-xl border border-[#DADCE0] bg-white p-4">
                    <p className="text-[13px] font-semibold text-[#5F6368]">아래 내용을 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;을 누르면 표가 교체됩니다.</p>
                    {suggestion.basedOn && (
                      <div className="rounded-md border border-[#AECBFA] bg-[#E8F0FE] px-3 py-2 space-y-1.5">
                        <p className="text-[13px] font-semibold text-[#1967D2] inline-flex items-center gap-1">
                          <Sparkle size={13} weight="fill" />
                          {suggestion.basedOn.mode === 'artifact' ? '채팅 산출물 기반' : '팀 채팅 대화 기반'} · 제안 근거
                        </p>
                        {suggestion.basedOn.summary && (
                          <p className="text-[14px] text-[#202124] leading-relaxed">{suggestion.basedOn.summary}</p>
                        )}
                        {suggestion.basedOn.references && suggestion.basedOn.references.length > 0 && (
                          <ul className="space-y-1 pt-1">
                            {suggestion.basedOn.references.map((ref, i) => (
                              <li key={i} className="text-[13px] text-[#3C4043] leading-relaxed border-l-2 border-[#1A73E8] pl-2">
                                {ref.source && <span className="font-bold text-[#1967D2]">{ref.source}</span>}
                                {ref.source && <span className="mx-1 text-[#5F6368]">·</span>}
                                <span className="italic">&ldquo;{ref.text}&rdquo;</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {(() => {
                      const patchScenario = (field: keyof ProblemSituationScenario, value: string) => setSuggestion(prev => {
                        if (!prev) return prev
                        return { ...prev, scenario: { ...prev.scenario, [field]: value } }
                      })
                      const patchDQ = (value: string) => setSuggestion(prev => prev ? { ...prev, drivingQuestion: value } : prev)
                      const sc = suggestion.scenario ?? { title: '', authenticity: '', contentProduct: '', audienceAction: '' }
                      return (
                        <div className="space-y-2">
                          <div className="rounded-md border border-[#E8EAED] bg-white p-2 space-y-1.5">
                            <div>
                              <p className="text-[12px] font-semibold text-[#5F6368] mb-0.5">시나리오 제목</p>
                              <AutoGrowTextarea value={sc.title} onChange={e => patchScenario('title', e.target.value)} minRows={1} placeholder="문제상황 제목" className="w-full rounded border-0 bg-transparent px-1.5 py-1 text-[14px] font-bold text-[#202124] focus:bg-[#F8F9FA] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                            </div>
                            <div>
                              <p className="text-[12px] font-semibold text-[#5F6368] mb-0.5">행1 · 실제성</p>
                              <AutoGrowTextarea value={sc.authenticity} onChange={e => patchScenario('authenticity', e.target.value)} minRows={2} placeholder="학생이 실제로 마주할 법한 진짜 맥락" className="w-full rounded border-0 bg-[#F8F9FA]/60 px-1.5 py-1 text-[13px] text-[#202124] focus:bg-[#F1F3F4] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                            </div>
                            <div>
                              <p className="text-[12px] font-semibold text-[#5F6368] mb-0.5">행2 · 학습 내용 + 산출물</p>
                              <AutoGrowTextarea value={sc.contentProduct} onChange={e => patchScenario('contentProduct', e.target.value)} minRows={2} placeholder="핵심 학습 내용과 학생이 만들 결과물" className="w-full rounded border-0 bg-[#F8F9FA]/60 px-1.5 py-1 text-[13px] text-[#202124] focus:bg-[#F1F3F4] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                            </div>
                            <div>
                              <p className="text-[12px] font-semibold text-[#5F6368] mb-0.5">행3 · 청중 + 행위</p>
                              <AutoGrowTextarea value={sc.audienceAction} onChange={e => patchScenario('audienceAction', e.target.value)} minRows={2} placeholder="누구에게 · 무엇을 하는가 (실제 청중·역할)" className="w-full rounded border-0 bg-[#F8F9FA]/60 px-1.5 py-1 text-[13px] text-[#202124] focus:bg-[#F1F3F4] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                            </div>
                          </div>
                          <div className="rounded-md border border-[#AECBFA] bg-[#E8F0FE] p-2">
                            <p className="text-[12px] font-semibold text-[#1967D2] mb-0.5">탐구 질문 (Driving Question)</p>
                            <AutoGrowTextarea value={suggestion.drivingQuestion ?? ''} onChange={e => patchDQ(e.target.value)} minRows={2} placeholder="단원을 관통하는 개방형 탐구 질문" className="w-full rounded border-0 bg-white/70 px-1.5 py-1 text-[14px] font-semibold text-[#202124] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                          </div>
                        </div>
                      )
                    })()}
                    {suggestion.rationale && (
                      <p className="text-[14px] italic text-[#5F6368]">{suggestion.rationale}</p>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSuggestion(null)}
                        className="rounded-full border border-[#DADCE0] bg-white px-3 py-1.5 text-[14px] font-bold text-[#5F6368] hover:bg-[#F1F3F4]"
                      >
                        무시
                      </button>
                      <button
                        type="button"
                        onClick={applySuggestion}
                        className="rounded-full bg-[#137333] px-3 py-1.5 text-[14px] font-bold text-white hover:bg-[#0D5C27]"
                      >
                        워크스페이스에 적용
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </aside>
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-[#E8EAED] bg-white px-5 py-3">
          <div className="mx-auto flex max-w-[1400px] items-center gap-3">
            <span className="hidden sm:inline-flex rounded-full bg-[#F8F9FA] px-3 py-2 text-[14px] font-bold text-[#5F6368]">
              자유 형식으로 작성해도 산출물로 인정됩니다
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <WorkspaceSaveStatus lastSavedAt={Math.max(lastSavedAt ?? 0, savedWorkspace?.updatedAt ?? 0)} offerReflection={isHost && offerReflection} busy={saving || sending} onReflect={sendArtifact} />
              <button type="button" onClick={sendArtifact} disabled={saving || sending} className="sm:hidden rounded-full bg-[#0B57D0] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {sending ? '전송 중' : isHost ? '산출물로 보내기' : '방장에게 반영 요청'}
              </button>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={saving || sending}
                className="inline-flex items-center gap-1.5 rounded-full bg-black text-white px-4 py-2 text-[14px] font-bold transition-colors hover:bg-[#202124] disabled:opacity-50 disabled:hover:bg-black"
              >
                <FloppyDisk size={17} weight="fill" />
                {saving ? '저장 중' : '초안 저장'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {showExample && (
      <div className="fixed inset-0 z-[9300] flex items-center justify-center bg-black/55 p-3" onClick={() => setShowExample(false)}>
        <div
          className="bg-white w-full max-w-[920px] max-h-[88vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col"
          onClick={event => event.stopPropagation()}
        >
          <div className="px-6 py-4 border-b border-[#E8EAED] bg-white flex items-center gap-3 flex-shrink-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] px-3 py-1.5 text-[14px] font-semibold text-[#1A73E8]">
              <Sparkle size={16} weight="fill" />
              예시
            </span>
            <span className="text-[17px] font-semibold text-[#202124]">최종 산출물 예시</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setShowExample(false)}
              className="w-10 h-10 rounded-full hover:bg-black/[0.08] active:bg-black/[0.12] text-[#5F6368] flex items-center justify-center transition-colors"
              aria-label="예시 닫기"
            >
              <X size={20} weight="bold" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            <p className="text-[14px] font-bold text-[#5F6368]">문제상황({displayActivityCode('Ds-1-2')}) 확정안 — 시나리오 + 탐구 질문</p>
            <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
              <table className="min-w-full border-collapse text-[14px]">
                <tbody>
                  <tr className="align-top">
                    <td className="border border-[#DADCE0] bg-[#F8F9FA] px-3 py-2 font-semibold text-[#202124] whitespace-nowrap w-[140px]">제목</td>
                    <td className="border border-[#DADCE0] px-3 py-2 font-bold text-[#202124]">{EXAMPLE_PS_DATA.scenario.title}</td>
                  </tr>
                  <tr className="align-top">
                    <td className="border border-[#DADCE0] bg-[#F8F9FA] px-3 py-2 font-semibold text-[#202124] whitespace-nowrap">행1 · 실제성</td>
                    <td className="border border-[#DADCE0] px-3 py-2 text-[#3C4043] leading-relaxed">{EXAMPLE_PS_DATA.scenario.authenticity}</td>
                  </tr>
                  <tr className="align-top">
                    <td className="border border-[#DADCE0] bg-[#F8F9FA] px-3 py-2 font-semibold text-[#202124] whitespace-nowrap">행2 · 학습 내용+산출물</td>
                    <td className="border border-[#DADCE0] px-3 py-2 text-[#3C4043] leading-relaxed">{EXAMPLE_PS_DATA.scenario.contentProduct}</td>
                  </tr>
                  <tr className="align-top">
                    <td className="border border-[#DADCE0] bg-[#F8F9FA] px-3 py-2 font-semibold text-[#202124] whitespace-nowrap">행3 · 청중+행위</td>
                    <td className="border border-[#DADCE0] px-3 py-2 text-[#3C4043] leading-relaxed">{EXAMPLE_PS_DATA.scenario.audienceAction}</td>
                  </tr>
                  <tr className="align-top">
                    <td className="border border-[#DADCE0] bg-[#E8F0FE] px-3 py-2 font-semibold text-[#1967D2] whitespace-nowrap">탐구 질문</td>
                    <td className="border border-[#DADCE0] bg-[#E8F0FE]/40 px-3 py-2 font-semibold text-[#202124] leading-relaxed">{EXAMPLE_PS_DATA.drivingQuestion}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-[#E8EAED] bg-white px-6 py-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowExample(false)}
              className="rounded-full border border-[#DADCE0] bg-white px-4 py-2 text-[14px] font-bold text-[#5F6368] hover:bg-[#F1F3F4]"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={applyExampleToWorkspace}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#1557B0] transition-colors"
            >
              <Sparkle size={16} weight="fill" />
              워크스페이스에 채우기
            </button>
          </div>
        </div>
      </div>
    )}

    {projectId && (
      <CollaborativePromptModal
        open={showCollaborativePrompt}
        onClose={() => setShowCollaborativePrompt(false)}
        projectId={projectId}
        scope="problemSituation"
        currentUid={currentUid}
        currentUserName={currentUserName}
        currentUserColor={currentUserColor}
        members={collaborativeMembers ?? []}
        title="문제상황 AI에게 구체적으로 요청"
        subtitle={`${displayActivityCode('Ds-1-2')} — 각자 자기 행에 추가 요청을 적은 뒤 AI 제안 받기`}
        onSubmit={async (prompts) => { await requestSuggestion(prompts) }}
      />
    )}
    </>,
    document.body,
  )
}
