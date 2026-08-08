'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, ChatCircleDots, CheckSquare, FileText, FloppyDisk, PaperPlaneRight, Plus, Square, Sparkle, Trash, X, TextH, TextHTwo, TextAlignLeft, Quotes, ListChecks, Table as TableIcon, DotsSixVertical, type Icon } from '@phosphor-icons/react'
import { CollaborativePromptModal } from './CollaborativePromptModal'
import type {
  IntegratedGoalWorkspace,
  IntegratedGoalWorkspaceBlock,
  IntegratedGoalWorkspaceBlockType,
  IntegratedGoalWorkspaceColumn,
  IntegratedGoalWorkspaceRow,
  IntegratedGoalWorkspaceTableData,
  IntegratedGoalMethod,
} from '@/types'
import type { A22Structured } from '@/lib/artifacts/schemas'
import { workspaceToA22Structured } from '@/lib/artifacts/schemas'
import type { IntegratedGoalWorkspacePatch } from '@/lib/firebase/projects'
import type { IntegratedGoalSuggestRequest, IntegratedGoalSuggestResult } from '@/app/api/integrated-goal/suggest/route'
import { cn } from '@/lib/utils'
import {
  AutoGrowTextarea,
  CaretOverlay,
  parseChecklist,
  stringifyChecklist,
  stripUndefinedDeep,
  type ChecklistItem,
  reorderArray,
  useBlockDnd,
} from './workspaceHelpers'

interface PresenceEntry {
  uid: string
  displayName: string
  color: string
  cellKey: string
  /** textarea selectionStart — 다른 팀원의 caret 위치 시각화용 */
  caretPos?: number
  updatedAt: number
}

interface Props {
  open: boolean
  onClose: () => void
  workspace?: IntegratedGoalWorkspace
  artifactContent?: Record<string, unknown>
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, PresenceEntry>
  isHost: boolean
  onPatchSave: (patch: IntegratedGoalWorkspacePatch) => Promise<IntegratedGoalWorkspace | void>
  onPresenceUpdate?: (presence: PresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: A22Structured) => Promise<void>
  /** 프로젝트 메타 — AI 제안 요청에 함께 전달 */
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** A-2-1 분석 결과 — AI 제안 보강용 */
  existingAnalysis?: string
  existingCoreIdea?: string
  /** AI 제안 chat-mode에서 사용할 현재 활동의 채팅 메시지 (시간순, 최근 N개 권장) */
  chatMessages?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  /** 협업 프롬프트 모달용 */
  projectId?: string
  collaborativeMembers?: Array<{ uid: string; displayName: string; color?: string }>
}

const DEFAULT_COLUMNS: IntegratedGoalWorkspaceColumn[] = [
  { id: 'subject', label: '교과', color: '#E8F0FE' },
  { id: 'goal', label: '교과별 수업목표', color: '#E6F4EA' },
  { id: 'knowledge', label: '지식·이해', color: '#FEF7E0' },
  { id: 'process', label: '과정·기능', color: '#FCE8E6' },
  { id: 'attitude', label: '가치·태도', color: '#F3E8FF' },
]

const INSERT_BLOCK_TYPES: Array<{
  type: IntegratedGoalWorkspaceBlockType
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

function emptyRow(columns: IntegratedGoalWorkspaceColumn[]): IntegratedGoalWorkspaceRow {
  return {
    id: makeId('a22_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function emptyWorkspace(): IntegratedGoalWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: [],
    commonCoreIdea: '',
    inquiryQuestion: '',
    integratedGoal: '',
    convergentKeywords: [],
    blocks: [],
  }
}

const EXAMPLE_WORKSPACE_DATA = {
  commonCoreIdea: '기후변화는 자연·사회·언어가 교차하는 복합적 쟁점이며, 학습자는 이를 다각적으로 탐구하고 시민으로서 협력적으로 대응할 수 있다.',
  inquiryQuestion: '기후변화에 대응하기 위해 우리 학교와 지역사회는 무엇을 함께 바꿀 수 있을까?',
  integratedGoal: '학생은 기후변화의 원인과 영향을 다각적으로 탐구하고, 근거에 기반한 해결 방안을 협력적으로 제안할 수 있다.',
  convergentKeywords: ['기후변화', '탐구', '시민적 책임'],
  rows: [
    { subject: '과학', goal: '학생은 지구온난화의 원인과 탄소 순환 과정(지식·이해)을 자료 해석과 실험 설계(과정·기능)를 통해 분석하고 검증할 수 있다.', knowledge: '지구온난화의 원인, 탄소 순환', process: '자료 해석, 실험 설계', attitude: '과학적 태도' },
    { subject: '사회', goal: '학생은 기후변화 관련 정책과 환경 정의(지식·이해)를 비교·분석하고 의사결정(과정·기능)하여, 시민으로서의 대응 방안을 책임감 있게 제안(가치·태도: 시민적 책임)할 수 있다.', knowledge: '기후변화 정책, 환경 정의', process: '비교·분석, 의사결정', attitude: '시민적 책임' },
    { subject: '국어', goal: '학생은 기후변화에 대한 자신의 입장(지식·이해)을 논증적으로 구성하고, 토론과 글쓰기(과정·기능)를 통해 효과적으로 표현할 수 있다.', knowledge: '논증의 구성', process: '토론, 글쓰기', attitude: '경청과 존중' },
  ],
} as const

function buildExampleWorkspace(): IntegratedGoalWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: EXAMPLE_WORKSPACE_DATA.rows.map(row => ({
      id: makeId('a22_row'),
      cells: {
        subject: row.subject,
        goal: row.goal,
        knowledge: row.knowledge,
        process: row.process,
        attitude: row.attitude,
      },
      color: '#FFFFFF',
    })),
    commonCoreIdea: EXAMPLE_WORKSPACE_DATA.commonCoreIdea,
    inquiryQuestion: EXAMPLE_WORKSPACE_DATA.inquiryQuestion,
    integratedGoal: EXAMPLE_WORKSPACE_DATA.integratedGoal,
    convergentKeywords: [...EXAMPLE_WORKSPACE_DATA.convergentKeywords],
    blocks: [],
  }
}

function keywordsFromText(value: string): string[] {
  return value.split(/[,，·\n]/).map(item => item.trim()).filter(Boolean).slice(0, 8)
}

function getCell(row: IntegratedGoalWorkspaceRow, columnId: string): string {
  return row.cells?.[columnId] ?? ''
}

function emptyTableRow(columns: IntegratedGoalWorkspaceColumn[]): IntegratedGoalWorkspaceRow {
  return {
    id: makeId('a22_table_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function defaultBlockTable(rowCount = 2, columnCount = 2): IntegratedGoalWorkspaceTableData {
  const safeRowCount = Math.max(1, Math.min(rowCount, 12))
  const safeColumnCount = Math.max(1, Math.min(columnCount, 8))
  const columns: IntegratedGoalWorkspaceColumn[] = Array.from({ length: safeColumnCount }, (_, index) => ({
    id: makeId('a22_table_col'),
    label: index === 0 ? '구분' : index === 1 ? '내용' : `열 ${index + 1}`,
    color: '#E8F0FE',
  }))
  return {
    columns,
    rows: Array.from({ length: safeRowCount }, () => emptyTableRow(columns)),
  }
}

function splitLegacyTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function legacyTableFromContent(content: string): IntegratedGoalWorkspaceTableData | null {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.includes('|'))
  if (lines.length < 2) return null
  const header = splitLegacyTableRow(lines[0]).filter(Boolean)
  if (header.length < 2) return null
  const dataLines = lines.slice(1).filter(line => {
    const cells = splitLegacyTableRow(line)
    return !cells.every(cell => /^:?-{2,}:?$/.test(cell))
  })
  const columns = header.map(label => ({ id: makeId('a22_table_col'), label, color: '#E8F0FE' }))
  const rows = dataLines.map(line => {
    const cells = splitLegacyTableRow(line)
    return {
      id: makeId('a22_table_row'),
      cells: Object.fromEntries(columns.map((column, index) => [column.id, cells[index] ?? ''])),
      color: '#FFFFFF',
    }
  })
  return { columns, rows: rows.length ? rows : [emptyTableRow(columns)] }
}

function getBlockTable(block: IntegratedGoalWorkspaceBlock): IntegratedGoalWorkspaceTableData {
  return block.table ?? legacyTableFromContent(block.content) ?? defaultBlockTable()
}

function makeDocumentBlock(
  type: IntegratedGoalWorkspaceBlockType,
  table?: IntegratedGoalWorkspaceTableData,
): IntegratedGoalWorkspaceBlock {
  // Firestore는 nested undefined를 거부 — table은 'table' 블록에서만 키 자체를 포함시킨다.
  const block: IntegratedGoalWorkspaceBlock = {
    id: makeId('a22_block'),
    type,
    content: '',
    color: '#FFFFFF',
    checked: false,
    includeInArtifact: true,
  }
  if (type === 'table') block.table = table ?? defaultBlockTable()
  return block
}

/**
 * artifactContent (A22Structured 또는 sections) → workspace 자동 로드.
 * AI 산출물 초안이 있으면 표/메타 필드를 그대로 워크스페이스에 매핑한다.
 */
function workspaceFromA22(structured: A22Structured): IntegratedGoalWorkspace {
  if (structured.manualWorkspace) return normalizeWorkspace(structured.manualWorkspace)
  const rows: IntegratedGoalWorkspaceRow[] = (structured.subjectGoals ?? []).map(sg => ({
    id: makeId('a22_row'),
    cells: {
      subject: sg.subject ?? '',
      goal: sg.goal ?? '',
      knowledge: sg.knowledge ?? '',
      process: sg.process ?? '',
      attitude: sg.attitude ?? '',
    },
    color: '#FFFFFF',
  }))
  return {
    columns: DEFAULT_COLUMNS,
    rows,
    commonCoreIdea: structured.commonCoreIdea ?? '',
    inquiryQuestion: structured.inquiryQuestion ?? '',
    integratedGoal: structured.integratedGoal ?? '',
    convergentKeywords: structured.convergentKeywords ?? [],
    method: structured.method,
    blocks: [],
  }
}

function normalizeWorkspace(workspace?: IntegratedGoalWorkspace, artifactContent?: Record<string, unknown>): IntegratedGoalWorkspace {
  if (workspace) {
    const columns = workspace.columns?.length ? workspace.columns : DEFAULT_COLUMNS
    const blocks = (workspace.blocks ?? []).map(block => block.type === 'table'
      ? { ...block, table: getBlockTable(block), content: '' }
      : block)
    return {
      columns,
      rows: workspace.rows ?? [],
      commonCoreIdea: workspace.commonCoreIdea ?? '',
      inquiryQuestion: workspace.inquiryQuestion ?? '',
      integratedGoal: workspace.integratedGoal ?? '',
      convergentKeywords: workspace.convergentKeywords ?? [],
      method: workspace.method,
      blocks,
      updatedBy: workspace.updatedBy,
      updatedAt: workspace.updatedAt,
    }
  }

  const structured = artifactContent?._schema === 'A-2-2' ? artifactContent as unknown as A22Structured : null
  if (!structured) return emptyWorkspace()
  return workspaceFromA22(structured)
}

function preserveEditingValue(
  next: IntegratedGoalWorkspace,
  current: IntegratedGoalWorkspace,
  editingKey: string | null,
  pendingDeletions: Set<string>,
): IntegratedGoalWorkspace {
  // server stale 대비: 방금 삭제한 id가 server next에 아직 살아있으면 미리 제거
  const filteredRows = pendingDeletions.size
    ? next.rows.filter(row => !pendingDeletions.has(row.id))
    : next.rows
  const filteredBlocks = pendingDeletions.size
    ? next.blocks.filter(block => !pendingDeletions.has(block.id))
    : next.blocks
  const rowsChanged = filteredRows !== next.rows
  const blocksChanged = filteredBlocks !== next.blocks

  // in-flight pending: 트랜잭션 contention으로 server에 아직 안 반영된 로컬 row/block 보존
  // (단, 사용자가 방금 삭제 요청한 id는 보존 대상에서 제외 — 그렇지 않으면 server stale 응답으로 부활)
  const nextRowIds = new Set(filteredRows.map(row => row.id))
  const pendingRows = current.rows.filter(row => !nextRowIds.has(row.id) && !pendingDeletions.has(row.id))
  const nextBlockIds = new Set(filteredBlocks.map(block => block.id))
  const pendingBlocks = current.blocks.filter(block => !nextBlockIds.has(block.id) && !pendingDeletions.has(block.id))

  // Why: 변경 없을 때 동일 reference 반환 — useEffect 재실행 시 setState 폭주 방지
  let merged: IntegratedGoalWorkspace
  if (pendingRows.length || pendingBlocks.length) {
    merged = {
      ...next,
      rows: [...filteredRows, ...pendingRows],
      blocks: [...filteredBlocks, ...pendingBlocks],
    }
  } else if (rowsChanged || blocksChanged) {
    merged = { ...next, rows: filteredRows, blocks: filteredBlocks }
  } else {
    merged = next
  }

  if (!editingKey) return merged

  if (editingKey.startsWith('column:')) {
    const columnId = editingKey.slice('column:'.length)
    const currentColumn = current.columns.find(column => column.id === columnId)
    if (!currentColumn) return merged
    const mergedColumn = merged.columns.find(column => column.id === columnId)
    if (!mergedColumn || mergedColumn.label === currentColumn.label) return merged
    return {
      ...merged,
      columns: merged.columns.map(column => column.id === columnId
        ? { ...column, label: currentColumn.label }
        : column),
    }
  }

  if (
    editingKey.startsWith('block:') ||
    editingKey.startsWith('block-table:') ||
    editingKey.startsWith('block-table-column:')
  ) {
    const [, blockId] = editingKey.split(':')
    const currentBlock = current.blocks.find(block => block.id === blockId)
    if (!currentBlock) return merged
    const mergedBlock = merged.blocks.find(block => block.id === blockId)
    if (!mergedBlock || mergedBlock === currentBlock) return merged
    return {
      ...merged,
      blocks: merged.blocks.map(block => block.id === blockId
        ? currentBlock
        : block),
    }
  }

  if (editingKey === 'meta:commonCoreIdea') {
    if (merged.commonCoreIdea === current.commonCoreIdea) return merged
    return { ...merged, commonCoreIdea: current.commonCoreIdea }
  }
  if (editingKey === 'meta:inquiryQuestion') {
    if (merged.inquiryQuestion === current.inquiryQuestion) return merged
    return { ...merged, inquiryQuestion: current.inquiryQuestion }
  }
  if (editingKey === 'meta:integratedGoal') {
    if (merged.integratedGoal === current.integratedGoal) return merged
    return { ...merged, integratedGoal: current.integratedGoal }
  }
  if (editingKey === 'meta:convergentKeywords') {
    if (merged.convergentKeywords === current.convergentKeywords) return merged
    return { ...merged, convergentKeywords: current.convergentKeywords }
  }

  const [rowId, columnId] = editingKey.split(':')
  if (!rowId || !columnId) return merged
  const currentRow = current.rows.find(row => row.id === rowId)
  if (!currentRow) return merged
  const mergedRow = merged.rows.find(row => row.id === rowId)
  if (!mergedRow) return merged
  const desired = getCell(currentRow, columnId)
  if (getCell(mergedRow, columnId) === desired) return merged
  return {
    ...merged,
    rows: merged.rows.map(row => row.id === rowId
      ? { ...row, cells: { ...row.cells, [columnId]: desired } }
      : row),
  }
}

export function IntegratedGoalWorkspaceModal({
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
  existingAnalysis,
  existingCoreIdea,
  chatMessages,
  projectId,
  collaborativeMembers,
}: Props) {
  const [workspace, setWorkspace] = useState<IntegratedGoalWorkspace>(() => normalizeWorkspace(savedWorkspace, artifactContent))
  const [keywordDraft, setKeywordDraft] = useState(() => normalizeWorkspace(savedWorkspace, artifactContent).convergentKeywords.join(', '))
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [tableDraft, setTableDraft] = useState({ open: false, rows: 3, columns: 2 })
  const [showExample, setShowExample] = useState(false)
  const [showCollaborativePrompt, setShowCollaborativePrompt] = useState(false)
  // AI 제안 받기 — 사용자 추가 프롬프트는 제거됨. 이전 단계(A-2-1) 산출물만으로 한 번에 제안.
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [suggestion, setSuggestion] = useState<IntegratedGoalSuggestResult | null>(null)
  // Why: 방금 삭제 요청한 id가 server stale 응답으로 부활하는 것 방지 — ref라 mutate해도 render 안 일으킴
  const pendingDeletionsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    const next = normalizeWorkspace(savedWorkspace, artifactContent)
    setWorkspace(current => preserveEditingValue(next, current, editingKey, pendingDeletionsRef.current))
    if (editingKey !== 'meta:convergentKeywords') {
      setKeywordDraft(next.convergentKeywords.join(', '))
    }
  }, [artifactContent, editingKey, open, savedWorkspace])

  // 마지막으로 송신한 presence를 추적해 heartbeat에서 동일 cellKey/caretPos로 갱신.
  // (focus 중인 cellKey와 caretPos를 stale 없이 유지)
  const lastPresenceRef = useRef<{ cellKey: string; caretPos?: number }>({ cellKey: 'modal:idle' })

  // 모달이 열려 있는 동안 idle presence 유지 + 10초 heartbeat.
  // 다른 팀원 화면에서 참여자 chip이 사라지지 않고, focus가 아니어도 "참여 중" 표시 유지.
  // updatedAt 20초 stale 필터(freshEditors)를 통과시키기 위해 10초마다 갱신.
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
    // [2026-05-15] TVW와 동일 — 시계 차이로 host entry가 stale 판정되는 케이스 대비 60초로 확장.
    return Object.values(presence ?? {}).filter(entry => Date.now() - entry.updatedAt < 60000)
  }, [presence])

  const updatePresence = (cellKey: string | null, caretPos?: number) => {
    if (!onPresenceUpdate || !currentUid) return
    if (cellKey === null) {
      // blur: cellKey를 'modal:idle'로 바꾸면 다른 사용자 화면에서 셀 chip이 즉시 사라져
      // "동시에 1명만 작업 중인 것처럼" 보임. 마지막 활성 셀을 유지해 모든 동시 접속자의
      // chip이 표 위에 계속 보이도록 한다 (TVW와 동일 패턴).
      const last = lastPresenceRef.current
      onPresenceUpdate({
        uid: currentUid,
        displayName: currentUserName ?? '나',
        color: currentUserColor ?? '#1A73E8',
        cellKey: last.cellKey,
        caretPos: last.caretPos,
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

  // textarea select/keyup/click 이벤트에서 selectionStart를 caretPos로 전달.
  function trackCaret(cellKey: string) {
    return (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
      updatePresence(cellKey, event.currentTarget.selectionStart ?? 0)
    }
  }

  function editorForCell(cellKey: string): PresenceEntry | undefined {
    return freshEditors.find(entry => entry.cellKey === cellKey && entry.uid !== currentUid)
  }

  // 같은 cellKey에 동시에 있는 다른 사용자 모두 (가장 최근만이 아닌 전체)
  function editorsForCell(cellKey: string): PresenceEntry[] {
    return freshEditors.filter(entry => entry.cellKey === cellKey && entry.uid !== currentUid)
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

  function setMetaLocal(field: 'commonCoreIdea' | 'inquiryQuestion' | 'integratedGoal' | 'convergentKeywords' | 'method', value: string | string[] | IntegratedGoalMethod | undefined) {
    setWorkspace(prev => ({ ...prev, [field]: value } as IntegratedGoalWorkspace))
  }

  function setBlockLocal(block: IntegratedGoalWorkspaceBlock) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(item => item.id === block.id ? block : item),
    }))
  }

  function setBlockTableLocal(blockId: string, table: IntegratedGoalWorkspaceTableData) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(block => block.id === blockId ? { ...block, table, content: '' } : block),
    }))
  }

  async function commit(
    patch: IntegratedGoalWorkspacePatch,
    next: IntegratedGoalWorkspace,
    deletedIds?: string[],
  ) {
    setWorkspace(next)
    setMessage('')
    try {
      // Firestore는 nested undefined를 거부 — patch에 잔존하는 undefined를 송신 직전에 청소.
      const cleanPatch = stripUndefinedDeep(patch) as IntegratedGoalWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      // Why: server 응답 수신 후에야 stale 부활 위험이 사라짐 — 그 시점에 pending 해제
      if (deletedIds?.length) {
        for (const id of deletedIds) pendingDeletionsRef.current.delete(id)
      }
      if (saved) setWorkspace(normalizeWorkspace(saved))
    } catch (error) {
      console.error('[integratedGoalWorkspace patch]', error)
      // 실패 시에도 pending 해제 — 그렇지 않으면 영구히 가려져 사용자가 다시 시도해도 부활
      if (deletedIds?.length) {
        for (const id of deletedIds) pendingDeletionsRef.current.delete(id)
      }
      setMessage('저장하지 못했습니다. 다시 시도해주세요.')
    }
  }

  async function handleSaveAll() {
    if (!isHost) {
      setMessage('초안 저장과 산출물 전송은 방장만 실행할 수 있습니다.')
      return
    }
    setSaving(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace, updatedBy: currentUserName }) as IntegratedGoalWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      if (saved) setWorkspace(normalizeWorkspace(saved))
      setMessage('공동 편집 초안을 저장했습니다.')
    } catch (error) {
      console.error('[integratedGoalWorkspace save]', error)
      setMessage('저장하지 못했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  async function updateCell(rowId: string, columnId: string, value: string) {
    const rows = workspace.rows.map(row => row.id === rowId
      ? { ...row, cells: { ...row.cells, [columnId]: value }, updatedBy: currentUserName, updatedAt: Date.now() }
      : row)
    const next = { ...workspace, rows, updatedBy: currentUserName, updatedAt: Date.now() }
    await commit({ type: 'update-cell', rowId, columnId, value, updatedBy: currentUserName }, next)
  }

  async function updateColumn(columnId: string, label: string) {
    const columns = workspace.columns.map(column => column.id === columnId ? { ...column, label } : column)
    const next = { ...workspace, columns, updatedBy: currentUserName, updatedAt: Date.now() }
    await commit({ type: 'update-column', columnId, label, updatedBy: currentUserName }, next)
  }

  async function addColumn() {
    const column: IntegratedGoalWorkspaceColumn = { id: makeId('a22_col'), label: '새 열', color: '#E8F0FE' }
    const next = {
      ...workspace,
      columns: [...workspace.columns, column],
      rows: workspace.rows.map(row => ({ ...row, cells: { ...row.cells, [column.id]: '' } })),
    }
    await commit({ type: 'add-column', column, updatedBy: currentUserName }, next)
  }

  async function deleteColumn(columnId: string) {
    if (workspace.columns.length <= 1) return
    const rows = workspace.rows.map(row => {
      const cells = { ...row.cells }
      delete cells[columnId]
      return { ...row, cells }
    })
    const next = { ...workspace, columns: workspace.columns.filter(column => column.id !== columnId), rows }
    pendingDeletionsRef.current.add(columnId)
    await commit({ type: 'delete-column', columnId }, next, [columnId])
  }

  async function addRow() {
    const row = emptyRow(workspace.columns)
    const next = { ...workspace, rows: [...workspace.rows, row] }
    await commit({ type: 'add-row', row, updatedBy: currentUserName }, next)
  }

  async function deleteRow(rowId: string) {
    const rows = workspace.rows.filter(row => row.id !== rowId)
    const next = { ...workspace, rows }
    pendingDeletionsRef.current.add(rowId)
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next, [rowId])
  }

  async function deleteSubjectTable() {
    const deletedIds = workspace.rows.map(row => row.id)
    const next = { ...workspace, rows: [] }
    for (const id of deletedIds) pendingDeletionsRef.current.add(id)
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next, deletedIds)
  }

  async function updateMeta(field: 'commonCoreIdea' | 'inquiryQuestion' | 'integratedGoal' | 'convergentKeywords' | 'method', value: string | string[] | IntegratedGoalMethod | null) {
    const next = { ...workspace, [field]: value, updatedBy: currentUserName, updatedAt: Date.now() } as IntegratedGoalWorkspace
    if (field === 'method' && (value === null || value === '' || value === undefined)) {
      delete (next as Partial<IntegratedGoalWorkspace>).method
    }
    await commit({ type: 'update-meta', field, value, updatedBy: currentUserName }, next)
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

  async function addBlock(type: IntegratedGoalWorkspaceBlockType) {
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

  async function updateBlock(block: IntegratedGoalWorkspaceBlock) {
    const next = { ...workspace, blocks: workspace.blocks.map(item => item.id === block.id ? block : item) }
    await commit({ type: 'upsert-block', block, updatedBy: currentUserName }, next)
  }

  async function deleteBlock(blockId: string) {
    const next = { ...workspace, blocks: workspace.blocks.filter(block => block.id !== blockId) }
    pendingDeletionsRef.current.add(blockId)
    await commit({ type: 'delete-block', blockId }, next, [blockId])
  }

  async function reorderBlocks(from: number, to: number) {
    const blocks = reorderArray(workspace.blocks, from, to)
    if (blocks === workspace.blocks) return
    const next = { ...workspace, blocks }
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next)
  }
  const blockDnd = useBlockDnd(reorderBlocks)

  async function addBlockTableColumn(block: IntegratedGoalWorkspaceBlock) {
    const table = getBlockTable(block)
    const column = { id: makeId('a22_table_col'), label: '새 열', color: '#E8F0FE' }
    const nextTable = {
      ...table,
      columns: [...table.columns, column],
      rows: table.rows.map(row => ({ ...row, cells: { ...row.cells, [column.id]: '' } })),
    }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableColumn(block: IntegratedGoalWorkspaceBlock, columnId: string) {
    const table = getBlockTable(block)
    if (table.columns.length <= 1) return
    const nextTable = {
      ...table,
      columns: table.columns.filter(column => column.id !== columnId),
      rows: table.rows.map(row => {
        const cells = { ...row.cells }
        delete cells[columnId]
        return { ...row, cells }
      }),
    }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function addBlockTableRow(block: IntegratedGoalWorkspaceBlock) {
    const table = getBlockTable(block)
    const nextTable = { ...table, rows: [...table.rows, emptyTableRow(table.columns)] }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableRow(block: IntegratedGoalWorkspaceBlock, rowId: string) {
    const table = getBlockTable(block)
    const nextRows = table.rows.filter(row => row.id !== rowId)
    const nextTable = { ...table, rows: nextRows.length ? nextRows : [emptyTableRow(table.columns)] }
    // 부연: 이 rowId는 블록 내부 테이블 row이며 next.rows의 id와는 다른 네임스페이스다.
    // preserveEditingValue의 block 분기는 currentBlock 전체를 통째로 되돌리므로, 부모 block update 직후
    // 만약 server stale 응답에 옛 row가 살아있다면 currentBlock 보존 분기를 통해서도 부활할 수 있다.
    // pending set에 add해 두면 그 block이 editingKey 보호 대상이 아닐 때 부활을 막는다.
    pendingDeletionsRef.current.add(rowId)
    try {
      await updateBlock({ ...block, table: nextTable, content: '' })
    } finally {
      pendingDeletionsRef.current.delete(rowId)
    }
  }

  async function requestSuggestion(customPrompts?: Array<{ teacherName: string; text: string }>) {
    // 사용자 추가 프롬프트가 없으므로 이전 단계 산출물(existingAnalysis/existingCoreIdea)이 반드시 필요.
    const hasContext = !!(existingAnalysis?.trim() || existingCoreIdea?.trim())
    if (!hasContext) {
      setSuggestError('이전 단계(A-2-1) 산출물이 아직 준비되지 않아 AI 제안을 만들 수 없습니다.')
      return
    }

    // [2026-05-15] AI 제안 2-mode 분기:
    //  - artifact: 채팅에서 이미 생성된 A-2-2 산출물(artifactContent._schema 일치 + 의미있는 데이터) 기반으로 정교화
    //  - chat:    빈 워크스페이스 — 현재 활동의 팀 채팅 메시지를 컨텍스트로 초안 작성
    const ac = (artifactContent ?? {}) as {
      _schema?: string
      commonCoreIdea?: string
      inquiryQuestion?: string
      integratedGoal?: string
      subjectGoals?: Array<{ subject?: string; goal?: string; knowledge?: string; process?: string; attitude?: string }>
      convergentKeywords?: string[]
    }
    const isArtifactMode = ac._schema === 'A-2-2' && (
      (typeof ac.integratedGoal === 'string' && ac.integratedGoal.trim().length > 0) ||
      (typeof ac.commonCoreIdea === 'string' && ac.commonCoreIdea.trim().length > 0) ||
      (typeof ac.inquiryQuestion === 'string' && ac.inquiryQuestion.trim().length > 0) ||
      (Array.isArray(ac.subjectGoals) && ac.subjectGoals.length > 0) ||
      (Array.isArray(ac.convergentKeywords) && ac.convergentKeywords.length > 0)
    )
    const mode: 'artifact' | 'chat' = isArtifactMode ? 'artifact' : 'chat'
    const existingArtifact = isArtifactMode
      ? {
          commonCoreIdea: typeof ac.commonCoreIdea === 'string' ? ac.commonCoreIdea : undefined,
          inquiryQuestion: typeof ac.inquiryQuestion === 'string' ? ac.inquiryQuestion : undefined,
          integratedGoal: typeof ac.integratedGoal === 'string' ? ac.integratedGoal : undefined,
          subjectGoals: Array.isArray(ac.subjectGoals)
            ? ac.subjectGoals.map(sg => ({
                subject: sg?.subject ?? '',
                goal: sg?.goal ?? '',
                knowledge: sg?.knowledge,
                process: sg?.process,
                attitude: sg?.attitude,
              }))
            : undefined,
          convergentKeywords: Array.isArray(ac.convergentKeywords) ? ac.convergentKeywords : undefined,
        }
      : undefined
    // 채팅 메시지는 토큰 절약을 위해 최근 40개로 자름 (가장 최근 = 가장 관련성 높음).
    const chatContext = mode === 'chat'
      ? (chatMessages ?? []).slice(-40).map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))
      : undefined

    setSuggestError('')
    setSuggestLoading(true)
    setSuggestion(null)
    try {
      const body: IntegratedGoalSuggestRequest = {
        prompt: '이전 단계 산출물(공통 핵심 아이디어, 교과별 핵심아이디어 분석)을 바탕으로 통합 수업목표 초안을 작성해 주세요.',
        projectTitle,
        targetGradeGroup,
        targetSubjects,
        existingAnalysis,
        existingCoreIdea,
        mode,
        existingArtifact,
        chatContext,
        currentDraft: {
          commonCoreIdea: workspace.commonCoreIdea,
          inquiryQuestion: workspace.inquiryQuestion,
          integratedGoal: workspace.integratedGoal,
          convergentKeywords: workspace.convergentKeywords,
          method: workspace.method,
          subjectGoals: workspace.rows.map(row => ({
            subject: getCell(row, 'subject'),
            goal: getCell(row, 'goal'),
            knowledge: getCell(row, 'knowledge'),
            process: getCell(row, 'process'),
            attitude: getCell(row, 'attitude'),
          })).filter(item => item.subject || item.goal),
        },
        customPrompts,
      }
      const resp = await fetch('/api/integrated-goal/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setSuggestError(data?.error ?? '제안을 가져오지 못했습니다.')
      } else {
        setSuggestion(data as IntegratedGoalSuggestResult)
      }
    } catch (error) {
      console.error('[integrated-goal suggest]', error)
      setSuggestError('네트워크 오류로 제안을 가져오지 못했습니다.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function applySuggestion() {
    if (!suggestion) return
    // 워크스페이스에 머지: 메타는 덮어쓰고, 표는 교과별로 매칭/추가.
    // 빈 행(subject도 goal도 비어있는 placeholder 행)은 제거 — AI 제안 행들이 1행부터 채워지도록.
    const baseRows = workspace.rows.filter(row => getCell(row, 'subject').trim() || getCell(row, 'goal').trim())
    const nextRowsBySubject = new Map(baseRows.map(row => [getCell(row, 'subject').trim(), row]))
    const mergedRows: IntegratedGoalWorkspaceRow[] = [...baseRows]
    for (const sg of suggestion.subjectGoals) {
      const subject = (sg.subject ?? '').trim()
      if (!subject) continue
      const existing = nextRowsBySubject.get(subject)
      if (existing) {
        const updated: IntegratedGoalWorkspaceRow = {
          ...existing,
          cells: {
            ...existing.cells,
            subject,
            goal: sg.goal ?? existing.cells.goal ?? '',
            knowledge: sg.knowledge ?? existing.cells.knowledge ?? '',
            process: sg.process ?? existing.cells.process ?? '',
            attitude: sg.attitude ?? existing.cells.attitude ?? '',
          },
        }
        const idx = mergedRows.findIndex(row => row.id === existing.id)
        if (idx >= 0) mergedRows[idx] = updated
      } else {
        mergedRows.push({
          id: makeId('a22_row'),
          cells: {
            subject,
            goal: sg.goal ?? '',
            knowledge: sg.knowledge ?? '',
            process: sg.process ?? '',
            attitude: sg.attitude ?? '',
          },
          color: '#FFFFFF',
        })
      }
    }
    // 산출물에는 공통 핵심 아이디어/통합 수업목표/교과별 수업목표만 포함 — keywords·method는 적용하지 않음.
    // 사용자가 컬럼을 수정했어도 산출물 형식(DEFAULT_COLUMNS — 교과·목표·지식이해·과정기능·가치태도)으로 복원해
    // AI 제안의 모든 필드가 누락 없이 들어가게 한다.
    const columnsChanged = workspace.columns.length !== DEFAULT_COLUMNS.length ||
      workspace.columns.some((c, i) => c.id !== DEFAULT_COLUMNS[i]?.id)
    const remappedRows: IntegratedGoalWorkspaceRow[] = columnsChanged
      ? mergedRows.map(row => ({
          ...row,
          cells: Object.fromEntries(DEFAULT_COLUMNS.map(col => [col.id, (row.cells?.[col.id] as string | undefined) ?? ''])),
        }))
      : mergedRows
    const nextWorkspace: IntegratedGoalWorkspace = {
      ...workspace,
      columns: DEFAULT_COLUMNS,
      commonCoreIdea: suggestion.commonCoreIdea || workspace.commonCoreIdea,
      inquiryQuestion: suggestion.inquiryQuestion || workspace.inquiryQuestion,
      integratedGoal: suggestion.integratedGoal || workspace.integratedGoal,
      rows: remappedRows,
      updatedBy: currentUserName,
      updatedAt: Date.now(),
    }
    await commit({ type: 'replace-all', workspace: nextWorkspace, updatedBy: currentUserName }, nextWorkspace)
    setSuggestion(null)
    setMessage('AI 제안을 워크스페이스에 적용했습니다.')
  }

  async function applyExampleToWorkspace() {
    const hasContent = workspace.rows.length > 0
      || workspace.blocks.length > 0
      || !!workspace.commonCoreIdea
      || !!workspace.inquiryQuestion
      || !!workspace.integratedGoal
      || workspace.convergentKeywords.length > 0
    if (hasContent && !window.confirm('기존 내용을 예시로 교체할까요?')) return
    const example = buildExampleWorkspace()
    setKeywordDraft(example.convergentKeywords.join(', '))
    await commit({ type: 'replace-all', workspace: example, updatedBy: currentUserName }, example)
    setShowExample(false)
    setMessage('예시를 워크스페이스에 적용했습니다.')
  }

  async function sendArtifact() {
    if (!isHost) return
    setSending(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace, updatedBy: currentUserName }) as IntegratedGoalWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      const finalWorkspace = normalizeWorkspace(saved ?? workspace)
      const structured = workspaceToA22Structured(finalWorkspace)
      // Firestore는 nested undefined를 거부 — manualWorkspace.blocks 등에 잔존하는 undefined 키 제거.
      await onSendArtifact(stripUndefinedDeep(structured) as A22Structured)
      setMessage('A-2-2 산출물로 보냈습니다.')
      onClose()
    } catch (error) {
      console.error('[integratedGoalWorkspace send]', error)
      const msg = error instanceof Error ? error.message : '알 수 없는 오류'
      setMessage(`산출물로 보내지 못했습니다: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const structuredDraft = artifactContent?._schema === 'A-2-2'
  const sourceMode = savedWorkspace ? 'workspace' : structuredDraft ? 'aiDraft' : 'blank'
  const editorModeLabel = isHost ? '편집 모드' : '공동 편집'

  return createPortal(
    <>
    <div className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div
        className="bg-white w-full h-[94vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col"
        onClick={event => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E8EAED] bg-white flex items-center gap-3 flex-shrink-0">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#3C4043]">
            <FileText size={17} weight="bold" />
            A-2-2
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
            disabled={!isHost || sending}
            title={isHost ? '현재 워크스페이스를 A-2-2 산출물로 보냅니다' : '방장만 산출물로 보낼 수 있습니다'}
            className="hidden sm:flex h-10 items-center gap-2 px-5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#06327A] text-white text-[14px] font-medium shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)] transition-colors disabled:opacity-40 disabled:shadow-none"
          >
            <PaperPlaneRight size={17} weight="fill" />
            {sending ? '전송 중' : '산출물로 보내기'}
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
                <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-5 py-2 text-[20px] font-bold text-[#1A73E8]">A-4</span>
                <span className="text-[30px] font-bold tracking-[-0.02em] text-[#37352F]">핵심 아이디어 도출 및 통합 수업목표 진술</span>
                <span className="ml-auto hidden sm:inline-flex h-7 items-center rounded-md bg-[#F1F3F4] px-2.5 text-[12px] font-medium text-[#6B6A67]">
                  {workspace.rows.length > 0 ? `${workspace.columns.length}열 · ${workspace.rows.length}행` : '문서 편집 중'}
                </span>
              </div>

              {/* 공통 핵심 아이디어 (상위 — 모든 진술의 출발점) */}
              {(() => {
                const cellKey = 'meta:commonCoreIdea'
                const editors = editorsForCell(cellKey)
                const accentColor = editors[0]?.color
                return (
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <label className="text-[15px] font-bold text-[#5F6368]">공통 핵심 아이디어</label>
                      {editors.map(ed => (
                        <span key={ed.uid} className="px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm" style={{ backgroundColor: ed.color }}>
                          {ed.displayName} 편집 중
                        </span>
                      ))}
                    </div>
                    <div className="relative">
                      <AutoGrowTextarea
                        value={workspace.commonCoreIdea}
                        onChange={event => {
                          setMetaLocal('commonCoreIdea', event.target.value)
                          updatePresence(cellKey, event.target.selectionStart ?? undefined)
                        }}
                        onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                        onSelect={trackCaret(cellKey)}
                        onKeyUp={trackCaret(cellKey)}
                        onClick={trackCaret(cellKey)}
                        onBlur={event => {
                          updateMeta('commonCoreIdea', event.target.value)
                          blurField()
                        }}
                        minRows={2}
                        placeholder="예: 기후변화는 자연·사회·언어가 교차하는 복합적 쟁점이며, 학습자는 이를 다각적으로 탐구하고 시민으로서 협력적으로 대응할 수 있다."
                        style={accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
                        className="relative w-full rounded-xl border border-[#E8EAED] bg-white px-4 py-3 text-[18px] leading-relaxed text-[#202124] placeholder:text-[#C4C7C5] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                      <CaretOverlay
                        text={workspace.commonCoreIdea}
                        editors={editors}
                        className="rounded-xl border border-transparent px-4 py-3 text-[18px] leading-relaxed"
                      />
                    </div>
                  </div>
                )
              })()}

              {/* 탐구 질문 — 공통 핵심 아이디어를 학생의 언어로 전환 */}
              {(() => {
                const cellKey = 'meta:inquiryQuestion'
                const editors = editorsForCell(cellKey)
                const accentColor = editors[0]?.color
                return (
                  <div className="relative rounded-2xl border border-[#A8DAB5] bg-[#E6F4EA]/50 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <label className="text-[15px] font-bold text-[#137333]">탐구 질문</label>
                      <span className="text-[12px] font-medium text-[#5F6368]">핵심 아이디어를 학생이 탐구할 개방형 질문으로 바꿉니다.</span>
                      {editors.map(ed => (
                        <span key={ed.uid} className="rounded-full px-2 py-0.5 text-[12px] font-bold text-white shadow-sm" style={{ backgroundColor: ed.color }}>
                          {ed.displayName} 편집 중
                        </span>
                      ))}
                    </div>
                    <div className="relative">
                      <AutoGrowTextarea
                        value={workspace.inquiryQuestion}
                        onChange={event => {
                          setMetaLocal('inquiryQuestion', event.target.value)
                          updatePresence(cellKey, event.target.selectionStart ?? undefined)
                        }}
                        onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                        onSelect={trackCaret(cellKey)}
                        onKeyUp={trackCaret(cellKey)}
                        onClick={trackCaret(cellKey)}
                        onBlur={event => {
                          updateMeta('inquiryQuestion', event.target.value)
                          blurField()
                        }}
                        minRows={2}
                        placeholder="예: 우리 학교가 기후변화에 대응하려면 무엇을 함께 바꿀 수 있을까?"
                        style={accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
                        className="relative w-full rounded-xl border border-[#A8DAB5] bg-white px-4 py-3 text-[18px] font-bold leading-relaxed text-[#202124] placeholder:text-[#9AA0A6] focus:border-[#137333] focus:outline-none focus:ring-2 focus:ring-[#137333]/20"
                      />
                      <CaretOverlay
                        text={workspace.inquiryQuestion}
                        editors={editors}
                        className="rounded-xl border border-transparent px-4 py-3 text-[18px] font-bold leading-relaxed"
                      />
                    </div>
                  </div>
                )
              })()}

              {/* 통합 수업목표 (하위 — 공통 핵심 아이디어로부터 도출되는 최종 진술) */}
              {(() => {
                const cellKey = 'meta:integratedGoal'
                const editors = editorsForCell(cellKey)
                const accentColor = editors[0]?.color
                return (
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <label className="text-[15px] font-bold text-[#5F6368]">통합 수업목표</label>
                      {editors.map(ed => (
                        <span key={ed.uid} className="px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm" style={{ backgroundColor: ed.color }}>
                          {ed.displayName} 편집 중
                        </span>
                      ))}
                    </div>
                    <div className="relative">
                      <AutoGrowTextarea
                        value={workspace.integratedGoal}
                        onChange={event => {
                          setMetaLocal('integratedGoal', event.target.value)
                          updatePresence(cellKey, event.target.selectionStart ?? undefined)
                        }}
                        onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                        onSelect={trackCaret(cellKey)}
                        onKeyUp={trackCaret(cellKey)}
                        onClick={trackCaret(cellKey)}
                        onBlur={event => {
                          updateMeta('integratedGoal', event.target.value)
                          blurField()
                        }}
                        minRows={2}
                        placeholder="예: 학생은 기후변화의 원인과 영향을 다각적으로 탐구하고, 근거에 기반한 해결 방안을 협력적으로 제안할 수 있다."
                        style={accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
                        className="relative w-full rounded-xl border border-[#E8EAED] bg-white px-4 py-3 text-[18px] font-bold leading-relaxed text-[#202124] placeholder:text-[#C4C7C5] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                      <CaretOverlay
                        text={workspace.integratedGoal}
                        editors={editors}
                        className="rounded-xl border border-transparent px-4 py-3 text-[18px] font-bold leading-relaxed"
                      />
                    </div>
                  </div>
                )
              })()}

              {workspace.rows.length > 0 && (
              <section className="group relative space-y-3">
                <button
                  type="button"
                  onClick={deleteSubjectTable}
                  className="absolute -left-9 top-10 flex h-9 w-9 items-center justify-center rounded-md text-[#9AA0A6] transition-colors hover:bg-[#FCE8E6] hover:text-[#C62828]"
                  aria-label="교과별 수업목표 표 삭제"
                >
                  <Trash size={16} weight="bold" />
                </button>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-semibold tracking-[-0.01em] text-[#37352F]">교과별 수업목표</p>
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
                        <th className="sticky left-0 z-20 w-[76px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-3 py-3 text-left text-[13px] font-medium text-[#6B6A67]">행</th>
                        {workspace.columns.map(column => (
                          <th key={column.id} className="min-w-[180px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-2 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={column.label}
                                onChange={event => setColumnLabelLocal(column.id, event.target.value)}
                                onBlur={event => {
                                  updateColumn(column.id, event.target.value)
                                  blurField()
                                }}
                                onFocus={() => focusField(`column:${column.id}`)}
                                className="w-full rounded-md border border-transparent bg-white/10 px-2 py-1 text-[14px] font-semibold text-white placeholder:text-white/70 hover:bg-white/15 focus:border-white focus:bg-white focus:text-[#202124] focus:outline-none"
                              />
                              <button type="button" onClick={() => deleteColumn(column.id)} className="flex h-9 w-9 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/15 hover:text-white">
                                <Trash size={15} weight="bold" />
                              </button>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.rows.map((row, rowIndex) => (
                        <tr key={row.id} className="group/row">
                          <td className="border-b border-r border-[#DADCE0] bg-[#E8F0FE] px-3 py-3 align-top">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[14px] font-semibold text-[#1A73E8]">{rowIndex + 1}</span>
                              <button type="button" onClick={() => deleteRow(row.id)} className="flex h-9 w-9 items-center justify-center rounded-md text-[#5F6368] opacity-60 transition-colors hover:bg-white hover:text-[#C62828] group-hover/row:opacity-100" aria-label={`${rowIndex + 1}행 삭제`}>
                                <Trash size={15} weight="bold" />
                              </button>
                            </div>
                          </td>
                          {workspace.columns.map(column => {
                            const cellKey = `${row.id}:${column.id}`
                            const editors = editorsForCell(cellKey)
                            return (
                              <td key={column.id} className="border-b border-r border-[#E9E9E7] bg-white p-2 align-top">
                                <div className="relative">
                                  {/* Why: 같은 셀에 동시 진입한 팀원 모두 stack 표시 — left offset으로 chip 겹침 방지 */}
                                  {editors.map((ed, idx) => (
                                    <span
                                      key={ed.uid}
                                      className="absolute -top-2.5 z-10 px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm"
                                      style={{ backgroundColor: ed.color, left: `${12 + idx * 60}px` }}
                                    >
                                      {ed.displayName}
                                    </span>
                                  ))}
                                  <AutoGrowTextarea
                                    value={getCell(row, column.id)}
                                    onChange={event => {
                                      setCellLocal(row.id, column.id, event.target.value)
                                      updatePresence(cellKey, event.target.selectionStart ?? undefined)
                                    }}
                                    onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                                    onSelect={trackCaret(cellKey)}
                                    onKeyUp={trackCaret(cellKey)}
                                    onClick={trackCaret(cellKey)}
                                    onBlur={event => {
                                      updateCell(row.id, column.id, event.target.value)
                                      blurField()
                                    }}
                                    minRows={3}
                                    className="w-full rounded-md border border-transparent bg-transparent px-2 py-2 text-[16px] leading-relaxed text-[#202124] hover:bg-[#F7F7F5] focus:border-[#0B57D0] focus:bg-white focus:outline-none"
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
              )}

              {workspace.rows.length === 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#DADCE0] bg-[#FAFBFC] px-4 py-3">
                  <span className="text-[15px] font-semibold text-[#5F6368]">교과별 수업목표 표가 비어 있습니다.</span>
                  <button type="button" onClick={addRow} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#0B57D0] transition-colors hover:bg-[#D3E3FD]/50 active:bg-[#D3E3FD]">
                    <Plus size={15} weight="bold" /> 표 만들기 (첫 행 추가)
                  </button>
                </div>
              )}

              {/* 추가 블록 + 삽입 영역 — 블록끼리는 좁게(space-y-2), 다른 sibling과는 article의 space-y-10 간격 유지 */}
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
                        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button type="button" onClick={() => addBlockTableColumn(block)} className="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[13px] font-bold text-[#1A73E8] shadow-sm hover:bg-[#E8F0FE]">
                            <Plus size={13} weight="bold" /> 열
                          </button>
                          <button type="button" onClick={() => addBlockTableRow(block)} className="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[13px] font-bold text-[#1A73E8] shadow-sm hover:bg-[#E8F0FE]">
                            <Plus size={13} weight="bold" /> 행
                          </button>
                        </div>
                        <table className="min-w-full border-collapse text-sm">
                          <thead>
                            <tr>
                              {table.columns.map(column => (
                                <th key={column.id} className="min-w-[180px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-2 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      value={column.label}
                                      onChange={event => {
                                        const nextTable = {
                                          ...table,
                                          columns: table.columns.map(item => item.id === column.id ? { ...item, label: event.target.value } : item),
                                        }
                                        setBlockTableLocal(block.id, nextTable)
                                      }}
                                      onFocus={() => focusField(`block-table-column:${block.id}:${column.id}`)}
                                      onBlur={event => {
                                        const nextTable = {
                                          ...table,
                                          columns: table.columns.map(item => item.id === column.id ? { ...item, label: event.target.value } : item),
                                        }
                                        updateBlock({ ...block, table: nextTable, content: '' })
                                        blurField()
                                      }}
                                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] font-semibold text-[#37352F] hover:bg-[#EFEFEE] focus:border-[#0B57D0] focus:bg-white focus:outline-none"
                                    />
                                    <button type="button" onClick={() => deleteBlockTableColumn(block, column.id)} className="flex h-8 w-8 items-center justify-center rounded-md text-[#9B9A97] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[#EFEFEE] hover:text-[#37352F]">
                                      <Trash size={15} weight="bold" />
                                    </button>
                                  </div>
                                </th>
                              ))}
                              <th className="w-[72px] border-b border-[#1557B0] bg-[#1A73E8]" />
                            </tr>
                          </thead>
                          <tbody>
                            {table.rows.map((row, rowIndex) => (
                              <tr key={row.id}>
                                {table.columns.map(column => {
                                  const cellKey = `block-table:${block.id}:${row.id}:${column.id}`
                                  const editors = editorsForCell(cellKey)
                                  return (
                                    <td key={column.id} className="border-b border-r border-[#E9E9E7] bg-white p-2 align-top">
                                      <div className="relative">
                                        {/* Why: 같은 셀에 동시 진입한 팀원 모두 stack 표시 — left offset으로 chip 겹침 방지 */}
                                        {editors.map((ed, idx) => (
                                          <span
                                            key={ed.uid}
                                            className="absolute -top-2.5 z-10 px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm"
                                            style={{ backgroundColor: ed.color, left: `${12 + idx * 60}px` }}
                                          >
                                            {ed.displayName}
                                          </span>
                                        ))}
                                        <AutoGrowTextarea
                                          value={getCell(row, column.id)}
                                          onChange={event => {
                                            const nextTable = {
                                              ...table,
                                              rows: table.rows.map(item => item.id === row.id
                                                ? { ...item, cells: { ...item.cells, [column.id]: event.target.value } }
                                                : item),
                                            }
                                            setBlockTableLocal(block.id, nextTable)
                                            updatePresence(cellKey, event.target.selectionStart ?? undefined)
                                          }}
                                          onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                                          onSelect={trackCaret(cellKey)}
                                          onKeyUp={trackCaret(cellKey)}
                                          onClick={trackCaret(cellKey)}
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
                                          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-[#202124] hover:bg-[#F7F7F5] focus:border-[#0B57D0] focus:bg-white focus:outline-none"
                                        />
                                      </div>
                                    </td>
                                  )
                                })}
                                <td className="border-b border-[#DADCE0] p-2 align-top text-center">
                                  <button type="button" onClick={() => deleteBlockTableRow(block, row.id)} className="inline-flex items-center gap-1 text-[13px] font-bold text-[#C62828] hover:underline">
                                    <Trash size={14} weight="bold" />
                                    {rowIndex + 1}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : block.type === 'checklist' ? (
                      (() => {
                        const items = parseChecklist(block.content)
                        const commit = (next: ChecklistItem[]) => updateBlock({ ...block, content: stringifyChecklist(next) })
                        const setLocal = (next: ChecklistItem[]) => setBlockLocal({ ...block, content: stringifyChecklist(next) })
                        const toggle = (i: number) => {
                          const next = items.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it)
                          commit(next)
                        }
                        const remove = (i: number) => commit(items.filter((_, idx) => idx !== i))
                        const add = () => commit([...items, { text: '', checked: false }])
                        return (
                          <div className="space-y-1.5 py-1">
                            {items.length === 0 && (
                              <p className="text-[14px] text-[#9AA0A6]">체크리스트가 비어 있습니다. 아래 &lsquo;항목 추가&rsquo;를 눌러 시작하세요.</p>
                            )}
                            {items.map((it, idx) => (
                              <div key={idx} className="group/item flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggle(idx)}
                                  className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center text-[#1A73E8] hover:text-[#1557B0]"
                                  aria-label={it.checked ? '체크 해제' : '체크'}
                                >
                                  {it.checked ? <CheckSquare size={20} weight="fill" /> : <Square size={20} weight="regular" />}
                                </button>
                                <input
                                  value={it.text}
                                  onChange={event => setLocal(items.map((x, i) => i === idx ? { ...x, text: event.target.value } : x))}
                                  onFocus={() => focusField(`block:${block.id}`)}
                                  onBlur={event => {
                                    commit(items.map((x, i) => i === idx ? { ...x, text: event.target.value } : x))
                                    blurField()
                                  }}
                                  onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commit([...items.slice(0, idx + 1), { text: '', checked: false }, ...items.slice(idx + 1)])
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
                                <button
                                  type="button"
                                  onClick={() => remove(idx)}
                                  className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-[#9AA0A6] opacity-0 transition-opacity hover:bg-[#FCE8E6] hover:text-[#C62828] group-hover/item:opacity-100"
                                  aria-label="항목 삭제"
                                >
                                  <Trash size={15} weight="bold" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={add}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[14px] font-bold text-[#1A73E8] hover:bg-[#E8F0FE]"
                            >
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
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={tableDraft.rows}
                          onChange={event => setTableDraft(prev => ({ ...prev, rows: Number(event.target.value) }))}
                          className="mt-1 w-full rounded-lg border border-[#DADCE0] px-3 py-2 text-[16px] text-[#202124] focus:border-[#1A73E8] focus:outline-none"
                        />
                      </label>
                      <label className="text-[14px] font-bold text-[#5F6368]">
                        열
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={tableDraft.columns}
                          onChange={event => setTableDraft(prev => ({ ...prev, columns: Number(event.target.value) }))}
                          className="mt-1 w-full rounded-lg border border-[#DADCE0] px-3 py-2 text-[16px] text-[#202124] focus:border-[#1A73E8] focus:outline-none"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setTableDraft(prev => ({ ...prev, open: false }))}
                        className="rounded-lg px-3 py-2 text-[14px] font-bold text-[#5F6368] hover:bg-[#F1F3F4]"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => addTableBlock(tableDraft.rows, tableDraft.columns)}
                        className="rounded-lg bg-[#1A73E8] px-3 py-2 text-[14px] font-bold text-white hover:bg-[#1557B0]"
                      >
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

            {/* 우측: AI 추천 패널 — 좌측은 수동 작업, 우측은 AI 추천. 사용자 추가 프롬프트 없이 이전 단계 데이터로 한 번에 제안. */}
            <aside className="space-y-4 lg:sticky lg:top-6 self-start">
              <section className="rounded-2xl border border-[#E9E9E7] bg-[#FBFBFA] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#D3E3FD] text-[#0842A0]">
                    <Sparkle size={20} weight="fill" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-[#37352F]">추천 산출물 형식</p>
                    <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-[#5F6368]">
                      <li>· <b>공통 핵심 아이디어</b>: 교과를 가로지르는 1문장</li>
                      <li>· <b>통합 수업목표</b>: &ldquo;학생은 ~를 통해 ~할 수 있다&rdquo; 1문장</li>
                      <li>· <b>교과별 수업목표 표</b>: 과목·목표 + 본문에 <em>(지식·이해)</em>, <em>(과정·기능)</em>, <em>(가치·태도)</em> 인라인 태그</li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[15px] font-bold text-[#202124]">AI 에이전트의 제안 받기</label>
                  <p className="text-[13px] leading-relaxed text-[#5F6368]"><b>이전 단계(A-2-1)의 교과별 핵심아이디어 시트</b>를 자동으로 읽어 <b>공통 핵심 아이디어 · 통합 수업목표 · 교과별 수업목표</b>를 한꺼번에 제안합니다. 결과는 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;하시면 됩니다.</p>
                  {suggestError && (
                    <p className="text-[14px] font-semibold text-[#C5221F]">{suggestError}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => requestSuggestion()}
                      disabled={suggestLoading || (!existingAnalysis?.trim() && !existingCoreIdea?.trim())}
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
                    <p className="text-[13px] font-semibold text-[#5F6368]">아래 내용을 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;을 누르면 그대로 반영됩니다.</p>
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
                    <div>
                      <label className="block text-[13px] font-bold text-[#5F6368] mb-1">통합 수업목표</label>
                      <AutoGrowTextarea
                        value={suggestion.integratedGoal}
                        onChange={event => setSuggestion(prev => prev ? { ...prev, integratedGoal: event.target.value } : prev)}
                        minRows={2}
                        className="w-full rounded-md border border-[#E8EAED] bg-white px-3 py-2 text-[15px] font-semibold text-[#202124] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-bold text-[#5F6368] mb-1">공통 핵심 아이디어</label>
                      <AutoGrowTextarea
                        value={suggestion.commonCoreIdea}
                        onChange={event => setSuggestion(prev => prev ? { ...prev, commonCoreIdea: event.target.value } : prev)}
                        minRows={2}
                        className="w-full rounded-md border border-[#E8EAED] bg-white px-3 py-2 text-[15px] text-[#202124] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-bold text-[#137333] mb-1">탐구 질문</label>
                      <AutoGrowTextarea
                        value={suggestion.inquiryQuestion}
                        onChange={event => setSuggestion(prev => prev ? { ...prev, inquiryQuestion: event.target.value } : prev)}
                        minRows={2}
                        className="w-full rounded-md border border-[#A8DAB5] bg-[#E6F4EA]/40 px-3 py-2 text-[15px] font-semibold text-[#202124] focus:border-[#137333] focus:outline-none focus:ring-2 focus:ring-[#137333]/20"
                      />
                    </div>
                    {suggestion.subjectGoals?.length > 0 && (
                      <div>
                        <label className="block text-[13px] font-bold text-[#5F6368] mb-1">교과별 수업목표</label>
                        <div className="overflow-x-auto">
                          <table className="min-w-full border-collapse text-[14px]">
                            <thead>
                              <tr className="bg-[#F1F3F4]">
                                <th className="border border-[#DADCE0] px-2 py-1.5 text-left font-bold text-[#5F6368] w-[80px]">교과</th>
                                <th className="border border-[#DADCE0] px-2 py-1.5 text-left font-bold text-[#5F6368]">교과별 수업목표</th>
                              </tr>
                            </thead>
                            <tbody>
                              {suggestion.subjectGoals.map((sg, idx) => (
                                <tr key={`sg-${idx}`}>
                                  <td className="border border-[#DADCE0] p-1 align-top">
                                    <input
                                      value={sg.subject}
                                      onChange={event => setSuggestion(prev => {
                                        if (!prev) return prev
                                        const next = [...prev.subjectGoals]
                                        next[idx] = { ...next[idx], subject: event.target.value }
                                        return { ...prev, subjectGoals: next }
                                      })}
                                      className="w-full rounded border-0 bg-transparent px-1.5 py-1 text-[14px] font-semibold text-[#202124] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1A73E8]"
                                    />
                                  </td>
                                  <td className="border border-[#DADCE0] p-1 align-top">
                                    <AutoGrowTextarea
                                      value={sg.goal}
                                      onChange={event => setSuggestion(prev => {
                                        if (!prev) return prev
                                        const next = [...prev.subjectGoals]
                                        next[idx] = { ...next[idx], goal: event.target.value }
                                        return { ...prev, subjectGoals: next }
                                      })}
                                      minRows={2}
                                      className="w-full rounded border-0 bg-transparent px-1.5 py-1 text-[14px] text-[#3C4043] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1A73E8]"
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
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
          <div className="mx-auto flex max-w-[980px] items-center gap-3">
            <span className="hidden sm:inline-flex rounded-full bg-[#F8F9FA] px-3 py-2 text-[14px] font-bold text-[#5F6368]">
              자유 형식으로 작성해도 산출물로 인정됩니다
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1 text-[14px] font-bold text-[#5F6368]">
                <CheckCircle size={17} weight="fill" className="text-[#9AA0A6]" />
                {isHost ? '저장 가능' : '편집 중'}
              </span>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={!isHost || saving}
                title={isHost ? '현재 공동 초안을 저장합니다' : '초안 저장은 방장만 실행할 수 있습니다'}
                className="flex items-center gap-1.5 rounded-full bg-[#111827] px-5 py-3 text-[15px] font-semibold text-white shadow-lg transition-colors hover:bg-[#1F2937] disabled:opacity-45"
              >
                <FloppyDisk size={18} weight="bold" />
                {saving ? '저장 중' : '저장하기'}
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

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-1.5">공통 핵심 아이디어</p>
              <p className="text-[16px] leading-relaxed text-[#202124]">{EXAMPLE_WORKSPACE_DATA.commonCoreIdea}</p>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-1.5">통합 수업목표</p>
              <p className="text-[18px] font-semibold leading-snug text-[#202124]">{EXAMPLE_WORKSPACE_DATA.integratedGoal}</p>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-1.5">핵심 키워드</p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_WORKSPACE_DATA.convergentKeywords.map(kw => (
                  <span key={kw} className="rounded-full bg-[#E8F0FE] px-2.5 py-1 text-[13px] font-bold text-[#1A73E8]">{kw}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-2">교과별 수업목표</p>
              <div className="overflow-x-auto rounded-xl border border-[#DADCE0]">
                <table className="min-w-full border-collapse text-[15px]">
                  <thead>
                    <tr>
                      {DEFAULT_COLUMNS.map(column => (
                        <th key={column.id} className="border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-3 py-2 text-left text-[13px] font-medium text-[#6B6A67]">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_WORKSPACE_DATA.rows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="border-b border-r border-[#DADCE0] bg-[#E8F0FE] px-3 py-2 align-top font-semibold text-[#1A73E8]">{row.subject}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#202124] leading-relaxed">{row.goal}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.knowledge}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.process}</td>
                        <td className="border-b border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.attitude}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
        scope="integratedGoal"
        currentUid={currentUid}
        currentUserName={currentUserName}
        currentUserColor={currentUserColor}
        members={collaborativeMembers ?? []}
        title="통합 수업목표 AI에게 구체적으로 요청"
        subtitle="A-2-2 — 각자 자기 행에 추가 요청을 적은 뒤 AI 제안 받기"
        onSubmit={async (prompts) => { await requestSuggestion(prompts) }}
      />
    )}
    </>,
    document.body,
  )
}
