'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, CheckSquare, FileText, FloppyDisk, PaperPlaneRight, Plus, Square, Trash, X, TextH, TextHTwo, TextAlignLeft, Quotes, ListChecks, Table as TableIcon, DotsSixVertical, type Icon } from '@phosphor-icons/react'
import type {
  TeamVisionWorkspace,
  TeamVisionWorkspaceBlock,
  TeamVisionWorkspaceBlockType,
  TeamVisionWorkspaceColumn,
  TeamVisionWorkspaceRow,
  TeamVisionWorkspaceTableData,
} from '@/types'
import type { T11Structured } from '@/lib/artifacts/schemas'
import type { TeamVisionWorkspacePatch } from '@/lib/firebase/projects'
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
import { Sparkle, ChatCircleDots } from '@phosphor-icons/react'
import { CollaborativePromptModal } from './CollaborativePromptModal'
import type { TeamVisionSuggestRequest, TeamVisionSuggestResult } from '@/app/api/team-vision/suggest/route'

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
  workspace?: TeamVisionWorkspace
  artifactContent?: Record<string, unknown>
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, PresenceEntry>
  isHost: boolean
  onPatchSave: (patch: TeamVisionWorkspacePatch) => Promise<TeamVisionWorkspace | void>
  onPresenceUpdate?: (presence: PresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: T11Structured) => Promise<void>
  /** 프로젝트 메타 — AI 제안 요청에 함께 전달 (정합성 향상) */
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /**
   * 현재 활동의 팀 채팅 메시지. mode='chat' 분기에서 chatContext로 전달.
   * 호출 측에서 시간순 메시지 배열을 전달. (slice는 모달 내부에서 토큰 절약을 위해 수행)
   */
  chatMessages?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  /** 협업 프롬프트 모달용 */
  projectId?: string
  collaborativeMembers?: Array<{ uid: string; displayName: string; color?: string }>
}

const DEFAULT_COLUMNS: TeamVisionWorkspaceColumn[] = [
  { id: 'teacherName', label: '교사명', color: '#E8F0FE' },
  { id: 'keywords', label: '개인 비전 키워드', color: '#E8F0FE' },
  { id: 'refinedVision', label: '정교화 비전 문장', color: '#E8F0FE' },
  { id: 'agreementNote', label: '합의 근거', color: '#E8F0FE' },
]

const INSERT_BLOCK_TYPES: Array<{
  type: TeamVisionWorkspaceBlockType
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

function emptyRow(columns: TeamVisionWorkspaceColumn[]): TeamVisionWorkspaceRow {
  return {
    id: makeId('vision_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function emptyWorkspace(): TeamVisionWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: [],
    teamVision: '',
    coreKeywords: [],
    blocks: [],
  }
}

// Why: T-1-1 산출물 예시. 사용자가 "예시" 버튼으로 미리보기 → 워크스페이스 채우기.
const EXAMPLE_TVW_DATA = {
  teamVision: '미래사회를 살아가는 학생들이 지속가능한 성장을 위해 자신의 삶의 문제를 능동적으로 해결하는 시민으로 성장하도록 돕습니다.',
  coreKeywords: ['지속가능한 성장', '실제적 문제 해결', '주도성', '능동적 시민'],
  rows: [
    { teacherName: '홍성용', keywords: '분석력, 의미 발견', refinedVision: '학생들이 다양한 정보를 분석하고, 그 속에서 의미를 발견하는 과정을 통해 성장할 수 있는 교육', agreementNote: '비전 합의: 학생 주도성 강조' },
    { teacherName: '인주상', keywords: '문제해결력, 자기주도', refinedVision: '학생들이 복잡한 문제를 스스로 정의하고, 창의적이고 실용적인 해결책을 찾는 능력을 기르는 교육', agreementNote: '비전 합의: 실제적 문제 해결' },
  ],
} as const

function buildExampleWorkspace(): TeamVisionWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: EXAMPLE_TVW_DATA.rows.map(row => ({
      id: makeId('vision_row'),
      cells: {
        teacherName: row.teacherName,
        keywords: row.keywords,
        refinedVision: row.refinedVision,
        agreementNote: row.agreementNote,
      },
      color: '#FFFFFF',
    })),
    teamVision: EXAMPLE_TVW_DATA.teamVision,
    coreKeywords: [...EXAMPLE_TVW_DATA.coreKeywords],
    blocks: [],
  }
}

function normalizeWorkspace(workspace?: TeamVisionWorkspace, artifactContent?: Record<string, unknown>): TeamVisionWorkspace {
  if (workspace) {
    const columns = workspace.columns?.length ? workspace.columns : DEFAULT_COLUMNS
    const blocks = (workspace.blocks ?? []).map(block => block.type === 'table'
      ? { ...block, table: getBlockTable(block), content: '' }
      : block)
    return {
      columns,
      rows: workspace.rows ?? [],
      teamVision: workspace.teamVision ?? '',
      coreKeywords: workspace.coreKeywords ?? [],
      blocks,
      updatedBy: workspace.updatedBy,
      updatedAt: workspace.updatedAt,
    }
  }

  const structured = artifactContent?._schema === 'T-1-1' ? artifactContent as unknown as T11Structured : null
  if (!structured) return emptyWorkspace()

  const workspaceFromArtifact = structured.manualWorkspace
  if (workspaceFromArtifact) return normalizeWorkspace(workspaceFromArtifact)

  const rows = (structured.personalVisions ?? []).map(pv => ({
    id: makeId('vision_row'),
    cells: {
      teacherName: pv.teacherName ?? '',
      keywords: (pv.keywords ?? []).join(', '),
      refinedVision: pv.refinedVision ?? '',
      agreementNote: '',
    },
    color: '#FFFFFF',
  }))

  return {
    columns: DEFAULT_COLUMNS,
    rows,
    teamVision: structured.teamVision ?? '',
    coreKeywords: structured.coreKeywords ?? [],
    blocks: [],
  }
}

function keywordsFromText(value: string): string[] {
  return value.split(/[,，·\n]/).map(item => item.trim()).filter(Boolean).slice(0, 8)
}

function getCell(row: TeamVisionWorkspaceRow, columnId: string): string {
  return row.cells?.[columnId] ?? ''
}

function emptyTableRow(columns: TeamVisionWorkspaceColumn[]): TeamVisionWorkspaceRow {
  return {
    id: makeId('vision_table_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function defaultBlockTable(rowCount = 2, columnCount = 2): TeamVisionWorkspaceTableData {
  const safeRowCount = Math.max(1, Math.min(rowCount, 12))
  const safeColumnCount = Math.max(1, Math.min(columnCount, 8))
  const columns: TeamVisionWorkspaceColumn[] = Array.from({ length: safeColumnCount }, (_, index) => ({
    id: makeId('vision_table_col'),
    label: index === 0 ? '관점' : index === 1 ? '내용' : `열 ${index + 1}`,
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

function legacyTableFromContent(content: string): TeamVisionWorkspaceTableData | null {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.includes('|'))
  if (lines.length < 2) return null
  const header = splitLegacyTableRow(lines[0]).filter(Boolean)
  if (header.length < 2) return null
  const dataLines = lines.slice(1).filter(line => {
    const cells = splitLegacyTableRow(line)
    return !cells.every(cell => /^:?-{2,}:?$/.test(cell))
  })
  const columns = header.map(label => ({ id: makeId('vision_table_col'), label, color: '#E8F0FE' }))
  const rows = dataLines.map(line => {
    const cells = splitLegacyTableRow(line)
    return {
      id: makeId('vision_table_row'),
      cells: Object.fromEntries(columns.map((column, index) => [column.id, cells[index] ?? ''])),
      color: '#FFFFFF',
    }
  })
  return { columns, rows: rows.length ? rows : [emptyTableRow(columns)] }
}

function getBlockTable(block: TeamVisionWorkspaceBlock): TeamVisionWorkspaceTableData {
  return block.table ?? legacyTableFromContent(block.content) ?? defaultBlockTable()
}

function makeDocumentBlock(
  type: TeamVisionWorkspaceBlockType,
  table?: TeamVisionWorkspaceTableData,
): TeamVisionWorkspaceBlock {
  // Firestore는 nested undefined를 거부 — table은 'table' 블록에서만 키 자체를 포함.
  const block: TeamVisionWorkspaceBlock = {
    id: makeId('vision_block'),
    type,
    content: '',
    color: '#FFFFFF',
    checked: false,
    includeInArtifact: true,
  }
  if (type === 'table') block.table = table ?? defaultBlockTable()
  return block
}

function workspaceToArtifact(workspace: TeamVisionWorkspace): T11Structured {
  const personalVisions = workspace.rows
    .map(row => ({
      teacherName: getCell(row, 'teacherName').replace(/\s*선생님$/, '').trim(),
      keywords: keywordsFromText(getCell(row, 'keywords')),
      refinedVision: getCell(row, 'refinedVision').trim(),
    }))
    .filter(row => row.teacherName || row.keywords.length > 0 || row.refinedVision)

  return {
    _schema: 'T-1-1',
    personalVisions,
    teamVision: workspace.teamVision.trim(),
    coreKeywords: workspace.coreKeywords.map(item => item.trim()).filter(Boolean).slice(0, 8),
    manualWorkspace: workspace,
  }
}

function preserveEditingValue(
  next: TeamVisionWorkspace,
  current: TeamVisionWorkspace,
  editingKey: string | null,
): TeamVisionWorkspace {
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

  if (
    editingKey.startsWith('block:') ||
    editingKey.startsWith('block-table:') ||
    editingKey.startsWith('block-table-column:')
  ) {
    const [, blockId] = editingKey.split(':')
    const currentBlock = current.blocks.find(block => block.id === blockId)
    if (!currentBlock) return next
    return {
      ...next,
      blocks: next.blocks.map(block => block.id === blockId
        ? currentBlock
        : block),
    }
  }

  if (editingKey === 'meta:teamVision') {
    return { ...next, teamVision: current.teamVision }
  }

  if (editingKey === 'meta:coreKeywords') {
    return { ...next, coreKeywords: current.coreKeywords }
  }

  const [rowId, columnId] = editingKey.split(':')
  if (!rowId || !columnId) return next
  const currentRow = current.rows.find(row => row.id === rowId)
  if (!currentRow) return next
  return {
    ...next,
    rows: next.rows.map(row => row.id === rowId
      ? { ...row, cells: { ...row.cells, [columnId]: getCell(currentRow, columnId) } }
      : row),
  }
}

export function TeamVisionWorkspaceModal({
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
  chatMessages,
  projectId,
  collaborativeMembers,
}: Props) {
  const [workspace, setWorkspace] = useState<TeamVisionWorkspace>(() => normalizeWorkspace(savedWorkspace, artifactContent))
  const [keywordDraft, setKeywordDraft] = useState(() => normalizeWorkspace(savedWorkspace, artifactContent).coreKeywords.join(', '))
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  // AI 제안 받기 — 사용자 추가 프롬프트 없이 이전 단계(개인 비전) 데이터만으로 한 번에 제안
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [suggestion, setSuggestion] = useState<TeamVisionSuggestResult | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [tableDraft, setTableDraft] = useState({ open: false, rows: 3, columns: 2 })
  const [showCollaborativePrompt, setShowCollaborativePrompt] = useState(false)
  // Why: 산출물 예시 미리보기 다이얼로그 (헤더 "예시" 버튼으로 토글).
  const [showExample, setShowExample] = useState(false)

  useEffect(() => {
    if (!open) return
    const next = normalizeWorkspace(savedWorkspace, artifactContent)
    setWorkspace(current => preserveEditingValue(next, current, editingKey))
    if (editingKey !== 'meta:coreKeywords') {
      setKeywordDraft(next.coreKeywords.join(', '))
    }
  }, [artifactContent, editingKey, open, savedWorkspace])

  // 마지막으로 송신한 presence를 추적해 heartbeat에서 동일 cellKey/caretPos로 갱신.
  const lastPresenceRef = useRef<{ cellKey: string; caretPos?: number }>({ cellKey: 'modal:idle' })

  // 모달이 열려 있는 동안 idle presence 유지 + 10초 heartbeat.
  // 모달을 열어둔 팀원 전원이 헤더 chip에 계속 표시되며, focus가 아니어도 "참여 중" 표시 유지.
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
    // [2026-05-15] 시계 차이/네트워크 지연으로 host entry가 stale 판정되는 케이스 — 60초로 확장.
    return Object.values(presence ?? {}).filter(entry => Date.now() - entry.updatedAt < 60000)
  }, [presence])

  const updatePresence = (cellKey: string | null, caretPos?: number) => {
    if (!onPresenceUpdate || !currentUid) return
    if (cellKey === null) {
      // blur: cellKey를 'modal:idle'로 즉시 바꾸면 다른 사용자 화면에서 셀 chip이 사라져
      // "동시에 1명만 작업 중인 것처럼" 보임. 마지막 활성 셀을 그대로 유지해
      // 모든 동시 접속자의 chip이 표 위에 계속 보이도록 한다 (구글 문서 패턴).
      // caretPos만 유지하고 updatedAt만 갱신 — 새 셀 focus나 모달 close 시 자연스럽게 교체.
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

  function setMetaLocal(field: 'teamVision' | 'coreKeywords', value: string | string[]) {
    setWorkspace(prev => ({ ...prev, [field]: value }))
  }

  function setBlockLocal(block: TeamVisionWorkspaceBlock) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(item => item.id === block.id ? block : item),
    }))
  }

  function setBlockTableLocal(blockId: string, table: TeamVisionWorkspaceTableData) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(block => block.id === blockId ? { ...block, table, content: '' } : block),
    }))
  }

  async function commit(patch: TeamVisionWorkspacePatch, next: TeamVisionWorkspace) {
    setWorkspace(next)
    setMessage('')
    try {
      // Firestore는 nested undefined를 거부 — patch에 잔존하는 undefined를 송신 직전에 청소.
      const cleanPatch = stripUndefinedDeep(patch) as TeamVisionWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      if (saved) setWorkspace(normalizeWorkspace(saved))
    } catch (error) {
      console.error('[teamVisionWorkspace patch]', error)
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
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace, updatedBy: currentUserName }) as TeamVisionWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      if (saved) setWorkspace(normalizeWorkspace(saved))
      setMessage('공동 편집 초안을 저장했습니다.')
    } catch (error) {
      console.error('[teamVisionWorkspace save]', error)
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
    const column: TeamVisionWorkspaceColumn = { id: makeId('vision_col'), label: '새 열', color: '#E8F0FE' }
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
    await commit({ type: 'delete-column', columnId }, next)
  }

  async function addRow() {
    const row = emptyRow(workspace.columns)
    const next = { ...workspace, rows: [...workspace.rows, row] }
    await commit({ type: 'add-row', row, updatedBy: currentUserName }, next)
  }

  async function deleteRow(rowId: string) {
    const rows = workspace.rows.filter(row => row.id !== rowId)
    const next = { ...workspace, rows }
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next)
  }

  async function deleteVisionTable() {
    const next = { ...workspace, rows: [] }
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next)
  }

  async function updateMeta(field: 'teamVision' | 'coreKeywords', value: string | string[]) {
    const next = { ...workspace, [field]: value, updatedBy: currentUserName, updatedAt: Date.now() }
    await commit({ type: 'update-meta', field, value, updatedBy: currentUserName }, next)
  }

  async function addBlock(type: TeamVisionWorkspaceBlockType) {
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

  async function updateBlock(block: TeamVisionWorkspaceBlock) {
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

  async function addBlockTableColumn(block: TeamVisionWorkspaceBlock) {
    const table = getBlockTable(block)
    const column = { id: makeId('vision_table_col'), label: '새 열', color: '#E8F0FE' }
    const nextTable = {
      ...table,
      columns: [...table.columns, column],
      rows: table.rows.map(row => ({ ...row, cells: { ...row.cells, [column.id]: '' } })),
    }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableColumn(block: TeamVisionWorkspaceBlock, columnId: string) {
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

  async function addBlockTableRow(block: TeamVisionWorkspaceBlock) {
    const table = getBlockTable(block)
    const nextTable = { ...table, rows: [...table.rows, emptyTableRow(table.columns)] }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableRow(block: TeamVisionWorkspaceBlock, rowId: string) {
    const table = getBlockTable(block)
    const nextRows = table.rows.filter(row => row.id !== rowId)
    const nextTable = { ...table, rows: nextRows.length ? nextRows : [emptyTableRow(table.columns)] }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function requestSuggestion(customPrompts?: Array<{ teacherName: string; text: string }>) {
    // 사용자 추가 프롬프트 없음 — workspace.rows의 개인 비전이 자동 컨텍스트
    const personalVisions = workspace.rows.map(row => ({
      teacherName: getCell(row, 'teacherName').replace(/\s*선생님$/, '').trim() || undefined,
      keywords: keywordsFromText(getCell(row, 'keywords')),
      refinedVision: getCell(row, 'refinedVision').trim() || undefined,
    })).filter(pv => pv.teacherName || (pv.keywords && pv.keywords.length > 0) || pv.refinedVision)

    // [2026-05-15] AI 제안 2-mode 분기 (RoleDistribution과 동일 패턴):
    //  - artifact: 채팅에서 이미 생성된 T-1-1 산출물(artifactContent._schema 일치, 의미있는 데이터)을 기반으로 정교화
    //  - chat:    빈 워크스페이스 — 현재 활동의 팀 채팅 메시지를 컨텍스트로 초안 작성
    const artifactAsT11 = artifactContent?._schema === 'T-1-1'
      ? (artifactContent as {
          personalVisions?: Array<{ teacherName?: string; keywords?: string[]; refinedVision?: string }>
          teamVision?: string
          coreKeywords?: string[]
        })
      : null
    const artifactHasMeaningfulData = !!artifactAsT11 && (
      (artifactAsT11.personalVisions && artifactAsT11.personalVisions.length > 0) ||
      !!artifactAsT11.teamVision?.trim() ||
      (artifactAsT11.coreKeywords && artifactAsT11.coreKeywords.length > 0)
    )
    const isArtifactMode = artifactHasMeaningfulData
    const mode: 'artifact' | 'chat' = isArtifactMode ? 'artifact' : 'chat'
    const existingArtifact = isArtifactMode && artifactAsT11
      ? {
          personalVisions: artifactAsT11.personalVisions,
          teamVision: artifactAsT11.teamVision,
          coreKeywords: artifactAsT11.coreKeywords,
        }
      : undefined
    // 채팅 메시지는 토큰 절약을 위해 최근 40개로 자름 (가장 최근 = 가장 관련성 높음).
    const chatContext = mode === 'chat'
      ? (chatMessages ?? []).slice(-40).map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))
      : undefined

    if (
      personalVisions.length === 0
      && !workspace.teamVision.trim()
      && workspace.coreKeywords.length === 0
      && !existingArtifact
      && (!chatContext || chatContext.length === 0)
    ) {
      setSuggestError('팀원 개인 비전이 아직 수집되지 않아 제안을 만들 수 없습니다.')
      return
    }
    setSuggestError('')
    setSuggestLoading(true)
    setSuggestion(null)
    try {
      const body: TeamVisionSuggestRequest = {
        projectTitle,
        targetGradeGroup,
        targetSubjects,
        personalVisions,
        currentDraft: {
          teamVision: workspace.teamVision,
          coreKeywords: workspace.coreKeywords,
        },
        mode,
        existingArtifact,
        chatContext,
        customPrompts,
      }
      const res = await fetch('/api/team-vision/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(errBody?.error ?? `요청 실패 (${res.status})`)
      }
      const result = await res.json() as TeamVisionSuggestResult
      setSuggestion(result)
    } catch (err) {
      console.error('[teamVisionWorkspace suggest]', err)
      setSuggestError(err instanceof Error ? err.message : '제안을 받지 못했습니다.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function applySuggestion() {
    if (!suggestion) return
    // 표 컬럼은 산출물 형식(DEFAULT_COLUMNS)으로 복원해 AI 제안이 의도한 4열 구조 보장.
    // 행은 기존 사용자 입력 유지 (TVW 제안은 개인 비전 표 자체를 새로 만들지 않고 메타만 갱신).
    const columnsChanged = workspace.columns.length !== DEFAULT_COLUMNS.length ||
      workspace.columns.some((c, i) => c.id !== DEFAULT_COLUMNS[i]?.id)
    const remappedRows = columnsChanged
      ? workspace.rows.map(row => ({
          ...row,
          cells: Object.fromEntries(DEFAULT_COLUMNS.map(col => [col.id, (row.cells?.[col.id] as string | undefined) ?? ''])),
        }))
      : workspace.rows
    const nextWorkspace: TeamVisionWorkspace = {
      ...workspace,
      columns: DEFAULT_COLUMNS,
      rows: remappedRows,
      teamVision: suggestion.teamVision || workspace.teamVision,
      coreKeywords: (suggestion.coreKeywords && suggestion.coreKeywords.length > 0)
        ? suggestion.coreKeywords
        : workspace.coreKeywords,
      updatedBy: currentUserName,
      updatedAt: Date.now(),
    }
    await commit({ type: 'replace-all', workspace: nextWorkspace, updatedBy: currentUserName }, nextWorkspace)
    setKeywordDraft(nextWorkspace.coreKeywords.join(', '))
    setSuggestion(null)
    setMessage(columnsChanged
      ? 'AI 제안을 워크스페이스에 적용했습니다. (표 컬럼이 산출물 권장 형태로 복원됨)'
      : 'AI 제안을 워크스페이스에 적용했습니다.')
  }

  async function applyExampleToWorkspace() {
    const hasContent = workspace.rows.length > 0
      || workspace.blocks.length > 0
      || !!workspace.teamVision
      || workspace.coreKeywords.length > 0
    if (hasContent && !window.confirm('기존 내용을 예시로 교체할까요?')) return
    const example = buildExampleWorkspace()
    setKeywordDraft(example.coreKeywords.join(', '))
    await commit({ type: 'replace-all', workspace: example, updatedBy: currentUserName }, example)
    setShowExample(false)
    setMessage('예시를 워크스페이스에 적용했습니다.')
  }

  async function sendArtifact() {
    if (!isHost) return
    setSending(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace, updatedBy: currentUserName }) as TeamVisionWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      const finalWorkspace = normalizeWorkspace(saved ?? workspace)
      const structured = workspaceToArtifact(finalWorkspace)
      // Firestore nested undefined 청소 — manualWorkspace.blocks 등 깊은 곳 잔존 undefined 방지
      await onSendArtifact(stripUndefinedDeep(structured) as T11Structured)
      setMessage('T-1-1 산출물로 보냈습니다.')
      onClose()
    } catch (error) {
      console.error('[teamVisionWorkspace send]', error)
      const msg = error instanceof Error ? error.message : '알 수 없는 오류'
      setMessage(`산출물로 보내지 못했습니다: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const structuredDraft = artifactContent?._schema === 'T-1-1'
  const sourceMode = savedWorkspace ? 'workspace' : structuredDraft ? 'aiDraft' : 'blank'
  const editorModeLabel = isHost ? '편집 모드' : '공동 편집'

  return createPortal(
    <>
    <div className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div
        className="bg-white w-full max-w-[1480px] h-[94vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col"
        onClick={event => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E8EAED] bg-white flex items-center gap-3 flex-shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full border border-[#E8EAED] bg-white px-3 py-2 text-[14px] font-extrabold text-[#3C4043] shadow-sm">
            <FileText size={17} weight="bold" />
            T-1-1
          </span>
          <span className="hidden sm:inline-flex items-center justify-center rounded-full bg-[#E8F0FE] px-4 py-2 text-[14px] font-extrabold text-[#1A73E8]">
            {editorModeLabel}
          </span>
          <span className="hidden md:inline-flex items-center rounded-full bg-[#F8F9FA] px-3 py-2 text-[14px] font-bold text-[#5F6368]">
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
            'hidden md:inline-flex rounded-full px-3 py-2 text-[14px] font-bold',
            isHost ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'bg-[#F1F3F4] text-[#5F6368]',
          )}>
            {isHost ? '방장' : '팀원'}
          </span>
          <button
            type="button"
            onClick={() => setShowExample(true)}
            title="최종 산출물 예시 보기"
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-full border border-[#E8EAED] bg-white text-[#3C4043] text-[14px] font-bold shadow-sm transition-colors hover:bg-[#F1F3F4]"
          >
            <Sparkle size={17} weight="fill" className="text-[#1A73E8]" />
            예시
          </button>
          <button
            type="button"
            onClick={sendArtifact}
            disabled={!isHost || sending}
            title={isHost ? '현재 워크스페이스를 T-1-1 산출물로 보냅니다' : '방장만 산출물로 보낼 수 있습니다'}
            className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1A73E8] hover:bg-[#1557B0] text-white text-[14px] font-bold transition-colors disabled:opacity-50 disabled:hover:bg-[#1A73E8]"
          >
            <PaperPlaneRight size={17} weight="fill" />
            {sending ? '전송 중' : '산출물로 보내기'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] flex items-center justify-center transition-colors"
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
                <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-5 py-2 text-[20px] font-black text-[#1A73E8]">T-1-1</span>
                <span className="text-[20px] font-extrabold text-[#202124]">공동 비전 설정</span>
                <span className="ml-auto hidden sm:inline-flex rounded-full border border-[#E8EAED] bg-white px-3 py-1.5 text-[14px] font-bold text-[#5F6368]">
                  {workspace.rows.length > 0 ? `${workspace.columns.length}열 · ${workspace.rows.length}행` : '문서 편집 중'}
                </span>
              </div>

              {(() => {
                const cellKey = 'meta:teamVision'
                const editors = editorsForCell(cellKey)
                const accentColor = editors[0]?.color
                return (
                  <div className="space-y-1">
                    {editors.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {editors.map(ed => (
                          <span key={ed.uid} className="px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm" style={{ backgroundColor: ed.color }}>
                            {ed.displayName} 편집 중
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <AutoGrowTextarea
                        value={workspace.teamVision}
                        onChange={event => {
                          setMetaLocal('teamVision', event.target.value)
                          updatePresence(cellKey, event.target.selectionStart ?? undefined)
                        }}
                        onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                        onSelect={trackCaret(cellKey)}
                        onKeyUp={trackCaret(cellKey)}
                        onClick={trackCaret(cellKey)}
                        onBlur={event => {
                          updateMeta('teamVision', event.target.value)
                          blurField()
                        }}
                        minRows={2}
                        placeholder="팀 공통 비전 제목을 입력하세요"
                        style={accentColor ? { border: `1px solid ${accentColor}`, boxShadow: `0 0 0 2px ${accentColor}33`, borderRadius: 8 } : undefined}
                        className="relative w-full border-0 bg-transparent px-0 py-0 text-[44px] font-black leading-tight text-[#202124] placeholder:text-[#C4C7C5] focus:outline-none"
                      />
                      <CaretOverlay
                        text={workspace.teamVision}
                        editors={editors}
                        className="px-0 py-0 text-[44px] font-black leading-tight"
                      />
                    </div>
                  </div>
                )
              })()}
              {(() => {
                const cellKey = 'meta:coreKeywords'
                const editors = editorsForCell(cellKey)
                const accentColor = editors[0]?.color
                return (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-bold text-[#5F6368]">핵심 키워드</span>
                    {editors.map(ed => (
                      <span key={ed.uid} className="px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm" style={{ backgroundColor: ed.color }}>
                        {ed.displayName} 편집 중
                      </span>
                    ))}
                    <input
                      value={keywordDraft}
                      onChange={event => {
                        setKeywordDraft(event.target.value)
                        setMetaLocal('coreKeywords', keywordsFromText(event.target.value))
                        updatePresence(cellKey, event.target.selectionStart ?? undefined)
                      }}
                      onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                      onSelect={event => updatePresence(cellKey, event.currentTarget.selectionStart ?? 0)}
                      onBlur={event => {
                        updateMeta('coreKeywords', keywordsFromText(event.target.value))
                        blurField()
                      }}
                      style={accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
                      className="min-w-[260px] flex-1 rounded-full border border-[#E8EAED] bg-[#F8F9FA] px-4 py-2 text-[16px] focus:outline-none focus:border-[#1A73E8] focus:bg-white"
                      placeholder="예: 협력, 탐구, 실제성"
                    />
                  </div>
                )
              })()}
              <p className="text-[14px] font-semibold leading-relaxed text-[#5F6368]">
                {sourceMode === 'aiDraft'
                  ? 'AI가 만든 산출물 초안을 불러왔습니다. 직접 수정하거나 우측에서 AI 제안을 추가로 받을 수 있습니다.'
                  : sourceMode === 'workspace'
                    ? '저장된 공동 초안을 이어서 편집 중입니다. 우측에서 AI 제안을 받아 보강할 수 있습니다.'
                    : '빈 문서에서 시작합니다. 직접 작성하거나 우측에서 AI 제안을 받아 시작할 수 있습니다.'}
              </p>

              {workspace.rows.length > 0 && (
              <section className="group relative space-y-3">
                <button
                  type="button"
                  onClick={deleteVisionTable}
                  className="absolute -left-9 top-10 flex h-9 w-9 items-center justify-center rounded-md text-[#9AA0A6] transition-colors hover:bg-[#FCE8E6] hover:text-[#C62828]"
                  aria-label="팀원 비전 표 삭제"
                >
                  <Trash size={16} weight="bold" />
                </button>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-extrabold text-[#202124]">팀원 비전 표</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={addColumn} className="inline-flex items-center gap-1.5 rounded-lg border border-[#DADCE0] bg-white px-3 py-1.5 text-[14px] font-bold text-[#1A73E8] transition-colors hover:bg-[#E8F0FE]">
                      <Plus size={15} weight="bold" /> 열
                    </button>
                    <button type="button" onClick={addRow} className="inline-flex items-center gap-1.5 rounded-lg border border-[#DADCE0] bg-white px-3 py-1.5 text-[14px] font-bold text-[#1A73E8] transition-colors hover:bg-[#E8F0FE]">
                      <Plus size={15} weight="bold" /> 행
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-[#DADCE0] bg-white">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-[76px] border-b border-r border-[#1557B0] bg-[#1A73E8] px-3 py-3 text-left text-[14px] font-extrabold text-white">행</th>
                        {workspace.columns.map(column => (
                          <th key={column.id} className="min-w-[190px] border-b border-r border-[#1557B0] bg-[#1A73E8] px-2 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={column.label}
                                onChange={event => setColumnLabelLocal(column.id, event.target.value)}
                                onBlur={event => {
                                  updateColumn(column.id, event.target.value)
                                  blurField()
                                }}
                                onFocus={() => focusField(`column:${column.id}`)}
                                className="w-full rounded-md border border-transparent bg-white/10 px-2 py-1 text-[14px] font-extrabold text-white placeholder:text-white/70 hover:bg-white/15 focus:border-white focus:bg-white focus:text-[#202124] focus:outline-none"
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
                              <span className="text-[14px] font-extrabold text-[#1A73E8]">{rowIndex + 1}</span>
                              <button type="button" onClick={() => deleteRow(row.id)} className="flex h-9 w-9 items-center justify-center rounded-md text-[#5F6368] opacity-60 transition-colors hover:bg-white hover:text-[#C62828] group-hover/row:opacity-100" aria-label={`${rowIndex + 1}행 삭제`}>
                                <Trash size={15} weight="bold" />
                              </button>
                            </div>
                          </td>
                          {workspace.columns.map(column => {
                            const cellKey = `${row.id}:${column.id}`
                            const cellEditors = editorsForCell(cellKey)
                            const accentColor = cellEditors[0]?.color
                            return (
                              <td key={column.id} className="border-b border-r border-[#DADCE0] bg-white p-2 align-top">
                                <div className="relative">
                                  {cellEditors.map((ed, idx) => (
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
                                    style={accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
                                    className="w-full rounded-md border border-transparent bg-transparent px-2 py-2 text-[16px] leading-relaxed text-[#202124] hover:bg-[#F8F9FA] focus:border-[#1A73E8] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
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

              {/* 추가 블록 + 삽입 영역 — 블록끼리는 좁게(space-y-2), 다른 sibling과는 article의 space-y-10 유지 */}
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
                      <div className="relative overflow-x-auto rounded-xl border border-[#DADCE0] bg-white">
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
                                <th key={column.id} className="min-w-[180px] border-b border-r border-[#1557B0] bg-[#1A73E8] px-2 py-2">
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
                                      className="w-full rounded-md border border-transparent bg-white/10 px-2 py-1 text-[14px] font-extrabold text-white hover:bg-white/15 focus:border-white focus:bg-white focus:text-[#202124] focus:outline-none"
                                    />
                                    <button type="button" onClick={() => deleteBlockTableColumn(block, column.id)} className="flex h-9 w-9 items-center justify-center rounded-md text-white/75 hover:bg-white/15 hover:text-white">
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
                                  const cellEditors = editorsForCell(cellKey)
                                  const accentColor = cellEditors[0]?.color
                                  return (
                                    <td key={column.id} className="border-b border-r border-[#DADCE0] bg-white p-2 align-top">
                                      <div className="relative">
                                        {cellEditors.map((ed, idx) => (
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
                                          style={accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
                                          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-[#202124] hover:bg-[#F8F9FA] focus:border-[#1A73E8] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
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
                        const toggle = (i: number) => commit(items.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it))
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
                          block.type === 'heading' && 'font-extrabold text-[32px] leading-tight',
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
                  className="inline-flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-[15px] font-bold text-[#5F6368] transition-colors hover:border-[#DADCE0] hover:bg-[#F8F9FA]"
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
                            <span className="block text-[15px] font-extrabold text-[#202124]">{item.label}</span>
                            <span className="block text-[13px] text-[#5F6368]">{item.description}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {tableDraft.open && (
                  <div className="absolute left-0 top-10 z-20 w-64 rounded-xl border border-[#DADCE0] bg-white p-3 shadow-lg">
                    <p className="mb-3 text-[15px] font-extrabold text-[#202124]">표 크기</p>
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
            </article>

            {/* 우측: AI 추천 패널 — 좌측 수동 / 우측 AI. 사용자 추가 프롬프트 없이 개인 비전만으로 한 번에 제안. */}
            <aside className="space-y-4 lg:sticky lg:top-6 self-start">
              <section className="rounded-2xl border border-[#E8EAED] bg-[#FAFBFC] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1A73E8] to-[#7B2FF7] text-white">
                    <Sparkle size={20} weight="fill" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-extrabold text-[#202124]">추천 산출물 형식</p>
                    <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-[#5F6368]">
                      <li>· <b>팀 공통 비전</b>: 팀이 합의한 1문장 (&ldquo;우리는 ~ 한다&rdquo;)</li>
                      <li>· <b>핵심 키워드</b>: 3~5개의 수렴 단어</li>
                      <li>· <b>개인 비전 표</b>: 교사별 키워드·정교화 비전·합의 근거</li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[15px] font-bold text-[#202124]">AI 에이전트의 제안 받기</label>
                  <p className="text-[13px] leading-relaxed text-[#5F6368]">현재 워크스페이스의 <b>개인 비전 표</b>를 읽어 <b>팀 공통 비전 · 핵심 키워드</b>를 제안합니다. 결과는 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;하시면 됩니다.</p>
                  {suggestError && (
                    <p className="text-[14px] font-semibold text-[#C5221F]">{suggestError}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => requestSuggestion()}
                      disabled={suggestLoading}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#1A73E8] to-[#7B2FF7] px-4 py-2 text-[14px] font-extrabold text-white shadow-sm transition-opacity disabled:opacity-50"
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
                        <p className="text-[13px] font-extrabold text-[#1967D2] inline-flex items-center gap-1">
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
                      <label className="block text-[13px] font-bold text-[#5F6368] mb-1">팀 공통 비전</label>
                      <AutoGrowTextarea
                        value={suggestion.teamVision}
                        onChange={event => setSuggestion(prev => prev ? { ...prev, teamVision: event.target.value } : prev)}
                        minRows={2}
                        className="w-full rounded-md border border-[#E8EAED] bg-white px-3 py-2 text-[15px] font-semibold text-[#202124] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-bold text-[#5F6368] mb-1">핵심 키워드 (쉼표·중점 구분)</label>
                      <input
                        value={suggestion.coreKeywords.join(', ')}
                        onChange={event => setSuggestion(prev => prev ? { ...prev, coreKeywords: keywordsFromText(event.target.value) } : prev)}
                        className="w-full rounded-md border border-[#E8EAED] bg-white px-3 py-2 text-[15px] text-[#202124] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                    </div>
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
            <span className="hidden sm:inline-flex rounded-full bg-[#F8F9FA] px-3 py-2 text-[14px] font-bold text-[#5F6368]">마크다운 없이 직접 편집</span>
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
                className="flex items-center gap-1.5 rounded-full bg-[#111827] px-5 py-3 text-[15px] font-extrabold text-white shadow-lg transition-colors hover:bg-[#1F2937] disabled:opacity-45"
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
            <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] px-3 py-1.5 text-[14px] font-extrabold text-[#1A73E8]">
              <Sparkle size={16} weight="fill" />
              예시
            </span>
            <span className="text-[17px] font-extrabold text-[#202124]">최종 산출물 예시</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setShowExample(false)}
              className="w-11 h-11 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] flex items-center justify-center transition-colors"
              aria-label="예시 닫기"
            >
              <X size={20} weight="bold" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-1.5">팀 공통 비전</p>
              <p className="text-[20px] font-extrabold leading-snug text-[#202124]">{EXAMPLE_TVW_DATA.teamVision}</p>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-1.5">핵심 키워드</p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_TVW_DATA.coreKeywords.map(kw => (
                  <span key={kw} className="rounded-full bg-[#E8F0FE] px-2.5 py-1 text-[13px] font-bold text-[#1A73E8]">{kw}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-2">팀원 비전 표</p>
              <div className="overflow-x-auto rounded-xl border border-[#DADCE0]">
                <table className="min-w-full border-collapse text-[15px]">
                  <thead>
                    <tr>
                      {DEFAULT_COLUMNS.map(column => (
                        <th key={column.id} className="border-b border-r border-[#1557B0] bg-[#1A73E8] px-3 py-2 text-left text-[14px] font-extrabold text-white">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_TVW_DATA.rows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="border-b border-r border-[#DADCE0] bg-[#E8F0FE] px-3 py-2 align-top font-extrabold text-[#1A73E8]">{row.teacherName}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.keywords}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#202124] leading-relaxed">{row.refinedVision}</td>
                        <td className="border-b border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.agreementNote}</td>
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
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-4 py-2 text-[14px] font-extrabold text-white hover:bg-[#1557B0] transition-colors"
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
        scope="teamVision"
        currentUid={currentUid}
        currentUserName={currentUserName}
        currentUserColor={currentUserColor}
        members={collaborativeMembers ?? []}
        title="팀 공통 비전 AI에게 구체적으로 요청"
        subtitle="T-1-1 — 각자 자기 행에 추가 요청을 적은 뒤 AI 제안 받기"
        onSubmit={async (prompts) => { await requestSuggestion(prompts) }}
      />
    )}
    </>,
    document.body,
  )
}
