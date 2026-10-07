'use client'

import { sendWorkspaceArtifact } from './workspaceArtifactRequest'
import { WorkspaceSaveStatus } from './WorkspaceSaveStatus'
import { useRealtimeWorkspace, WorkspaceRealtimeStatus } from './useRealtimeWorkspace'

import { displayActivityCode } from '@/types'

import { useEffect, useMemo, useRef, useState } from 'react'
import { isBlankWorkspace } from '@/lib/coedit/workspaceBlank'
import { createPortal } from 'react-dom'
import { CheckCircle, CheckSquare, FileText, FloppyDisk, PaperPlaneRight, Plus, Square, Trash, X, TextH, TextHTwo, TextAlignLeft, Quotes, ListChecks, Table as TableIcon, DotsSixVertical, type Icon } from '@phosphor-icons/react'
import type {
  TeamRulesWorkspace,
  TeamRulesWorkspaceBlock,
  TeamRulesWorkspaceBlockType,
  TeamRulesWorkspaceColumn,
  TeamRulesWorkspaceRow,
  TeamRulesWorkspaceTableData,
} from '@/types'
import type { T22Structured, T22Rule } from '@/lib/artifacts/schemas'
import type { TeamRulesWorkspacePatch, TeamRulesPresenceEntry } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import { resolveWorkspacePresence, shouldReportWorkspaceCaret } from './workspacePresence'
import {
  AutoGrowTextarea,
  PresenceInput,
  parseChecklist,
  stringifyChecklist,
  stripUndefinedDeep,
  reorderArray,
  useBlockDnd,
  type ChecklistItem,
} from './workspaceHelpers'
import { Sparkle } from '@phosphor-icons/react'
import type { TeamRulesSuggestRequest, TeamRulesSuggestResult } from '@/app/api/team-rules/suggest/route'
import { useWorkspaceSync } from './useWorkspaceSync'
import { useArtifactDraftSync } from './useArtifactDraftSync'
import { structuredArtifactContent } from '@/lib/coedit/artifactDraft'
import { PresenceAwayChips, presenceAccentStyle, presenceChipStyle, presenceTagStyle, presenceTitle, splitPresence, usePresenceClock } from './presence'

interface Props {
  open: boolean
  onClose: () => void
  workspace?: TeamRulesWorkspace
  artifactContent?: Record<string, unknown>
  projectId?: string
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, TeamRulesPresenceEntry>
  isHost: boolean
  onPatchSave: (patch: TeamRulesWorkspacePatch) => Promise<TeamRulesWorkspace | void>
  onPresenceUpdate?: (presence: TeamRulesPresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: T22Structured) => Promise<void>
  /** 프로젝트 메타 — AI 제안 요청에 함께 전달 */
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** AI 제안 chat-mode에서 사용할 현재 활동의 채팅 메시지 (시간순, 최근 N개 권장) */
  chatMessages?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  /** 직전 단계(T-1-1) 팀 비전·핵심 키워드 — 제안 정합성 보강 */
  teamVision?: string
  coreKeywords?: string[]
  /** 직전 단계(T-2-1) 역할 배분 — 규칙 설계에 반영 */
  existingRoles?: Array<{ teacherName?: string; role?: string }>
}

const DEFAULT_COLUMNS: TeamRulesWorkspaceColumn[] = [
  { id: 'category',    label: '분류',         color: '#E8F0FE' },
  { id: 'name',        label: '규칙명',       color: '#E8F0FE' },
  { id: 'description', label: '설명',         color: '#E8F0FE' },
  { id: 'feasibility', label: '실천 방법', color: '#E8F0FE' },
]

const INSERT_BLOCK_TYPES: Array<{
  type: TeamRulesWorkspaceBlockType
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

function emptyRow(columns: TeamRulesWorkspaceColumn[]): TeamRulesWorkspaceRow {
  return {
    id: makeId('rule_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function emptyWorkspace(): TeamRulesWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: [],
    blocks: [],
  }
}

// Why: T-2-2 산출물 예시. 사용자가 "예시" 버튼으로 미리보기 → 워크스페이스 채우기.
const EXAMPLE_TRW_DATA = {
  rows: [
    { category: '소통', name: '확인 가능 시간을 함께 남기기', description: '메시지를 바로 답하기 어려우면 확인 가능한 시간을 먼저 남깁니다.', feasibility: '수업 중에는 응답을 요구하지 않고 평일 24시간 안에 확인합니다.' },
    { category: '시간', name: '회의 시간을 50분으로 제한하기', description: '안건을 미리 공유하고 회의는 합의한 종료 시각에 마칩니다.', feasibility: '참석이 어려운 팀원은 회의 전에 공유 문서에 의견을 남길 수 있습니다.' },
    { category: '역할', name: '마감 전에 막힘을 공유하기', description: '담당 산출물이 지연될 것 같으면 마감 하루 전에 막힌 지점을 공유합니다.', feasibility: '도움을 요청한 일을 팀이 다시 나누며 개인에게 책임을 몰지 않습니다.' },
    { category: '갈등', name: '비전과 기준으로 다시 판단하기', description: '의견이 충돌하면 사람을 평가하지 않고 팀 비전과 합의 기준에 비추어 대안을 비교합니다.', feasibility: '결정이 어려우면 하루 숙고한 뒤 다음 회의 첫 안건으로 다룹니다.' },
  ],
} as const

function buildExampleWorkspace(): TeamRulesWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: EXAMPLE_TRW_DATA.rows.map(row => ({
      id: makeId('rule_row'),
      cells: {
        category: row.category,
        name: row.name,
        description: row.description,
        feasibility: row.feasibility,
      },
      color: '#FFFFFF',
    })),
    blocks: [],
  }
}

function normalizeWorkspace(workspace?: TeamRulesWorkspace, artifactContent?: Record<string, unknown>): TeamRulesWorkspace {
  if (workspace && !isBlankWorkspace(workspace)) {
    const sourceColumns = workspace.columns?.length ? workspace.columns : DEFAULT_COLUMNS
    const columns = sourceColumns.map(column => column.id === 'violation'
      ? { ...column, id: 'feasibility', label: '실천 방법' }
      : column)
    const blocks = (workspace.blocks ?? []).map(block => block.type === 'table'
      ? { ...block, table: getBlockTable(block), content: '' }
      : block)
    return {
      columns,
      rows: (workspace.rows ?? []).map(row => {
        const { violation, ...cells } = row.cells ?? {}
        return { ...row, cells: { ...cells, feasibility: cells.feasibility || violation || '' } }
      }),
      blocks,
      updatedBy: workspace.updatedBy,
      updatedAt: workspace.updatedAt,
    }
  }

  const structured = artifactContent?._schema === 'T-2-2' ? artifactContent as unknown as T22Structured : null
  if (!structured) return emptyWorkspace()

  const workspaceFromArtifact = structured.manualWorkspace
  if (workspaceFromArtifact) return normalizeWorkspace(workspaceFromArtifact)

  const rows = (structured.rules ?? []).map(rule => ({
    id: makeId('rule_row'),
    cells: {
      category: rule.category ?? '',
      name: rule.name ?? '',
      description: rule.description ?? '',
      feasibility: rule.feasibility ?? rule.violation ?? '',
    },
    color: '#FFFFFF',
  }))

  return {
    columns: DEFAULT_COLUMNS,
    rows,
    blocks: [],
  }
}

function getCell(row: TeamRulesWorkspaceRow, columnId: string): string {
  return row.cells?.[columnId] ?? ''
}

function emptyTableRow(columns: TeamRulesWorkspaceColumn[]): TeamRulesWorkspaceRow {
  return {
    id: makeId('rule_table_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function defaultBlockTable(rowCount = 2, columnCount = 2): TeamRulesWorkspaceTableData {
  const safeRowCount = Math.max(1, Math.min(rowCount, 12))
  const safeColumnCount = Math.max(1, Math.min(columnCount, 8))
  const columns: TeamRulesWorkspaceColumn[] = Array.from({ length: safeColumnCount }, (_, index) => ({
    id: makeId('rule_table_col'),
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

function legacyTableFromContent(content: string): TeamRulesWorkspaceTableData | null {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.includes('|'))
  if (lines.length < 2) return null
  const header = splitLegacyTableRow(lines[0]).filter(Boolean)
  if (header.length < 2) return null
  const dataLines = lines.slice(1).filter(line => {
    const cells = splitLegacyTableRow(line)
    return !cells.every(cell => /^:?-{2,}:?$/.test(cell))
  })
  const columns = header.map(label => ({ id: makeId('rule_table_col'), label, color: '#E8F0FE' }))
  const rows = dataLines.map(line => {
    const cells = splitLegacyTableRow(line)
    return {
      id: makeId('rule_table_row'),
      cells: Object.fromEntries(columns.map((column, index) => [column.id, cells[index] ?? ''])),
      color: '#FFFFFF',
    }
  })
  return { columns, rows: rows.length ? rows : [emptyTableRow(columns)] }
}

function getBlockTable(block: TeamRulesWorkspaceBlock): TeamRulesWorkspaceTableData {
  return block.table ?? legacyTableFromContent(block.content) ?? defaultBlockTable()
}

function makeDocumentBlock(
  type: TeamRulesWorkspaceBlockType,
  table?: TeamRulesWorkspaceTableData,
): TeamRulesWorkspaceBlock {
  // Firestore는 nested undefined를 거부 — table은 'table' 블록에서만 키 자체를 포함.
  const block: TeamRulesWorkspaceBlock = {
    id: makeId('rule_block'),
    type,
    content: '',
    color: '#FFFFFF',
    checked: false,
    includeInArtifact: true,
  }
  if (type === 'table') block.table = table ?? defaultBlockTable()
  return block
}

function workspaceToArtifact(workspace: TeamRulesWorkspace): T22Structured {
  const rules: T22Rule[] = workspace.rows
    .map(row => ({
      category: getCell(row, 'category').trim(),
      name: getCell(row, 'name').trim(),
      description: getCell(row, 'description').trim(),
      feasibility: getCell(row, 'feasibility').trim(),
    }))
    .filter(r => r.category || r.name || r.description || r.feasibility)

  return {
    _schema: 'T-2-2',
    rules,
    manualWorkspace: workspace,
  }
}

function preserveEditingValue(
  next: TeamRulesWorkspace,
  current: TeamRulesWorkspace,
  editingKey: string | null,
): TeamRulesWorkspace {
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

export function TeamRulesWorkspaceModal({
  open,
  onClose,
  workspace: savedWorkspace,
  artifactContent,
  projectId,
  currentUid,
  currentUserName,
  currentUserColor,
  presence,
  isHost,
  onPatchSave: legacyPatchSave,
  onPresenceUpdate,
  onSendArtifact,
  projectTitle,
  targetGradeGroup,
  targetSubjects,
  chatMessages,
  teamVision,
  coreKeywords,
  existingRoles,
}: Props) {
  const [workspace, setLegacyWorkspace] = useState<TeamRulesWorkspace>(() => normalizeWorkspace(savedWorkspace, structuredArtifactContent('T-2-2', artifactContent)))
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>()
  const [offerReflection, setOfferReflection] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  // AI 제안 받기 — 사용자 추가 프롬프트 없이 팀 채팅·기존 행만으로 한 번에 제안
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [suggestion, setSuggestion] = useState<TeamRulesSuggestResult | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [tableDraft, setTableDraft] = useState({ open: false, rows: 3, columns: 2 })
  const [showExample, setShowExample] = useState(false)

  // 원격 스냅숏은 들어올 때만 반영하고, 편집 중·저장 대기 중 칸은 로컬 값을 지킨다(#T7 — 칸에서 나가면 옛 저장본으로 되돌아가던 결함).
  const incomingWorkspace = useMemo(() => normalizeWorkspace(savedWorkspace, structuredArtifactContent('T-2-2', artifactContent)), [artifactContent, savedWorkspace])
  const realtime = useRealtimeWorkspace({
    open, projectId, workspaceField: 'teamRulesWorkspace', workspace, incoming: incomingWorkspace,
    setWorkspace: setLegacyWorkspace, editingKey,
  })
  const setWorkspace = realtime.setWorkspace
  const onPatchSave: Props['onPatchSave'] = realtime.enabled ? realtime.flush : legacyPatchSave
  const sync = useWorkspaceSync({
    open, incoming: incomingWorkspace, workspace, setWorkspace: setLegacyWorkspace, editingKey, external: realtime.enabled,
    // 서버 저장본이 비어 있으면(빈 초안·산출물에서 채워 연 표) 첫 변경은 화면 표 통째로 저장 (#T7b)
    remoteBlank: isBlankWorkspace(savedWorkspace),
    preserve: (next, current, key) => preserveEditingValue(next, current, key),
  })

  // 마지막으로 송신한 presence를 추적해 heartbeat에서 동일 cellKey/caretPos로 갱신.
  const lastPresenceRef = useRef<{ cellKey: string; caretPos?: number; relativeCaret?: string; interactionAt?: number }>({ cellKey: 'modal:idle' })

  // 모달이 열려 있는 동안 idle presence 유지 + 10초 heartbeat.
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
        relativeCaret: last.relativeCaret,
        interactionAt: last.interactionAt,
        updatedAt: Date.now(),
      })
    }
    sendCurrent()
    const t = setInterval(sendCurrent, 10000)
    return () => { clearInterval(t) }
  }, [open, currentUid, currentUserName, currentUserColor, onPresenceUpdate])

  // 참여자 표시: 시계로 다시 계산해 신호가 끊긴 사람이 남지 않게 하고, 잠시 비운 사람은 흐리게(#R2)
  const presenceNow = usePresenceClock()
  const { fresh: receivedEditors, away: awayEditors } = useMemo(
    () => splitPresence(Object.values(presence ?? {}), presenceNow, 60000),
    [presence, presenceNow],
  )

  const freshEditors = resolveWorkspacePresence(receivedEditors, realtime)
  // 저장된 산출물과 공동 초안 맞추기(#S1) — 산출물이 더 새로우면 산출물 기준, 초안이 더 새로우면 빈 칸만 채움
  const artifactDraft = useArtifactDraftSync({
    open, projectId, activityCode: 'T-2-2', workspaceField: 'teamRulesWorkspace', workspace, incoming: incomingWorkspace, savedWorkspace, artifactContent,
    normalize: normalizeWorkspace, realtime, othersEditing: freshEditors.some(entry => entry.uid !== currentUid), currentUid,
    apply: next => commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next),
  })

  const updatePresence = (cellKey: string | null, caretPos?: number) => {
    if (typeof caretPos === 'number' && !shouldReportWorkspaceCaret(realtime)) return
    if (!onPresenceUpdate || !currentUid) return
    if (cellKey === null) {
      // blur 시 마지막 활성 cellKey/caretPos 유지 — 다른 사용자 화면에서 chip이 계속 보이도록.
      const last = lastPresenceRef.current
      onPresenceUpdate({
        uid: currentUid,
        displayName: currentUserName ?? '나',
        color: currentUserColor ?? '#1A73E8',
        cellKey: last.cellKey,
        caretPos: last.caretPos,
        relativeCaret: last.relativeCaret,
        interactionAt: last.interactionAt,
        updatedAt: Date.now(),
      })
      return
    }
    const relativeCaret = typeof caretPos === 'number' ? realtime.encodeCaret(cellKey, caretPos) : undefined
    const interactionAt = Math.max(Date.now(), (lastPresenceRef.current.interactionAt ?? 0) + 1)
    lastPresenceRef.current = { cellKey, caretPos, relativeCaret, interactionAt }
    onPresenceUpdate({
      uid: currentUid,
      displayName: currentUserName ?? '나',
      color: currentUserColor ?? '#1A73E8',
      cellKey,
      caretPos,
      relativeCaret,
      interactionAt,
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

  function trackCaret(cellKey: string) {
    return (event: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (!realtime.shouldSendPresence(event.currentTarget)) return
      updatePresence(cellKey, event.currentTarget.selectionStart ?? 0)
    }
  }

  function editorsForCell(cellKey: string): TeamRulesPresenceEntry[] {
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

  function setBlockLocal(block: TeamRulesWorkspaceBlock) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(item => item.id === block.id ? block : item),
    }))
  }

  function setBlockTableLocal(blockId: string, table: TeamRulesWorkspaceTableData) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(block => block.id === blockId ? { ...block, table, content: '' } : block),
    }))
  }

  async function commit(patch: TeamRulesWorkspacePatch, next: TeamRulesWorkspace) {
    setWorkspace(next)
    setMessage('')
    try {
      const cleanPatch = stripUndefinedDeep(sync.prepare(patch, next)) as TeamRulesWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (saved) sync.applySaved(normalizeWorkspace(saved))
      setLastSavedAt(saved?.updatedAt ?? Date.now())
    } catch (error) {
      console.error('[teamRulesWorkspace patch]', error)
      setMessage('저장하지 못했습니다. 다시 시도해주세요.')
    }
  }

  async function handleSaveAll() {
    if (saving || sending) return
    setSaving(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: await sync.settledLatest(), updatedBy: currentUserName }) as TeamRulesWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (saved) sync.applySaved(normalizeWorkspace(saved))
      setLastSavedAt(saved?.updatedAt ?? Date.now())
      setMessage('공동 편집 초안을 저장했습니다.')
      setOfferReflection(isHost)
    } catch (error) {
      console.error('[teamRulesWorkspace save]', error)
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
    const column: TeamRulesWorkspaceColumn = { id: makeId('rule_col'), label: '새 열', color: '#E8F0FE' }
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

  async function deleteRulesTable() {
    const next = { ...workspace, rows: [] }
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next)
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

  async function addBlock(type: TeamRulesWorkspaceBlockType) {
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

  async function updateBlock(block: TeamRulesWorkspaceBlock) {
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

  async function addBlockTableColumn(block: TeamRulesWorkspaceBlock) {
    const table = getBlockTable(block)
    const column = { id: makeId('rule_table_col'), label: '새 열', color: '#E8F0FE' }
    const nextTable = {
      ...table,
      columns: [...table.columns, column],
      rows: table.rows.map(row => ({ ...row, cells: { ...row.cells, [column.id]: '' } })),
    }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableColumn(block: TeamRulesWorkspaceBlock, columnId: string) {
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

  async function addBlockTableRow(block: TeamRulesWorkspaceBlock) {
    const table = getBlockTable(block)
    const nextTable = { ...table, rows: [...table.rows, emptyTableRow(table.columns)] }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableRow(block: TeamRulesWorkspaceBlock, rowId: string) {
    const table = getBlockTable(block)
    const nextRows = table.rows.filter(row => row.id !== rowId)
    const nextTable = { ...table, rows: nextRows.length ? nextRows : [emptyTableRow(table.columns)] }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function requestSuggestion() {
    // 사용자 추가 프롬프트 없음 — 채팅·기존 산출물·현재 행이 컨텍스트
    const currentRows = workspace.rows.map(row => ({
      category: getCell(row, 'category').trim() || undefined,
      name: getCell(row, 'name').trim() || undefined,
      description: getCell(row, 'description').trim() || undefined,
      feasibility: getCell(row, 'feasibility').trim() || undefined,
    })).filter(r => r.category || r.name || r.description || r.feasibility)

    // [2026-05-15] AI 제안 2-mode 분기:
    //  - artifact: 채팅에서 이미 생성된 T-2-2 산출물(artifactContent._schema 일치) 기반으로 정교화
    //  - chat:    빈 워크스페이스 — 현재 활동의 팀 채팅 메시지를 컨텍스트로 초안 작성
    const isArtifactMode = artifactContent?._schema === 'T-2-2' && Array.isArray((artifactContent as { rules?: unknown }).rules) && ((artifactContent as { rules?: unknown[] }).rules?.length ?? 0) > 0
    const mode: 'artifact' | 'chat' = isArtifactMode ? 'artifact' : 'chat'
    const existingArtifact = isArtifactMode
      ? { rules: (artifactContent as { rules?: Array<{ category?: string; name?: string; description?: string; feasibility?: string; violation?: string }> }).rules ?? [] }
      : undefined
    // 채팅 메시지는 토큰 절약을 위해 최근 40개로 자름 (가장 최근 = 가장 관련성 높음).
    const chatContext = mode === 'chat'
      ? (chatMessages ?? []).slice(-40).map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))
      : undefined

    setSuggestError('')
    setSuggestLoading(true)
    setSuggestion(null)
    try {
      const body: TeamRulesSuggestRequest = {
        projectTitle,
        targetGradeGroup,
        targetSubjects,
        currentRows,
        teamVision,
        coreKeywords,
        existingRoles,
        mode,
        existingArtifact,
        chatContext,
      }
      const res = await fetch('/api/team-rules/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(errBody?.error ?? `요청 실패 (${res.status})`)
      }
      const result = await res.json() as TeamRulesSuggestResult
      setSuggestion(result)
    } catch (err) {
      console.error('[teamRulesWorkspace suggest]', err)
      setSuggestError(err instanceof Error ? err.message : '제안을 받지 못했습니다.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function applySuggestion() {
    if (!suggestion || suggestion.rules.length === 0) return
    // 병합 전략 (3단계 우선순위):
    //  1) name이 일치하는 기존 행이 있으면 그 행에 빈 셀만 보강
    //  2) 매칭 없는 제안은 "완전히 빈 행"(4개 셀 모두 비어 있음)을 먼저 채워 사용
    //  3) 그래도 남으면 새 행으로 append
    // Why: 워크스페이스가 초기 상태로 빈 행 1개를 두고 시작하는데, 이전 구현은 새 행만 append해
    //      빈 1행이 그대로 남는 문제가 있었음.
    const existingRows = [...workspace.rows]
    const remaining: TeamRulesSuggestResult['rules'] = []
    for (const sugg of suggestion.rules) {
      const matchIdx = sugg.name
        ? existingRows.findIndex(row => getCell(row, 'name').trim() === sugg.name.trim())
        : -1
      if (matchIdx >= 0) {
        const row = existingRows[matchIdx]
        const cells = { ...row.cells }
        if (!cells.category)    cells.category = sugg.category
        if (!cells.description) cells.description = sugg.description
        if (!cells.feasibility) cells.feasibility = sugg.feasibility
        existingRows[matchIdx] = { ...row, cells, updatedBy: currentUserName, updatedAt: Date.now() }
      } else {
        remaining.push(sugg)
      }
    }
    // 매칭 안 된 제안 — 먼저 빈 행을 활용
    const stillRemaining: TeamRulesSuggestResult['rules'] = []
    for (const sugg of remaining) {
      const emptyIdx = existingRows.findIndex(row =>
        !getCell(row, 'category').trim() &&
        !getCell(row, 'name').trim() &&
        !getCell(row, 'description').trim() &&
        !getCell(row, 'feasibility').trim(),
      )
      if (emptyIdx >= 0) {
        const row = existingRows[emptyIdx]
        existingRows[emptyIdx] = {
          ...row,
          cells: {
            category: sugg.category,
            name: sugg.name,
            description: sugg.description,
            feasibility: sugg.feasibility,
          },
          updatedBy: currentUserName,
          updatedAt: Date.now(),
        }
      } else {
        stillRemaining.push(sugg)
      }
    }
    const appended = stillRemaining.map(sugg => ({
      id: makeId('rule_row'),
      cells: {
        category: sugg.category,
        name: sugg.name,
        description: sugg.description,
        feasibility: sugg.feasibility,
      },
      color: '#FFFFFF',
      updatedBy: currentUserName,
      updatedAt: Date.now(),
    }))
    // 사용자가 컬럼을 수정했어도 최신 산출물 형식(분류/규칙명/설명/실천 방법)으로 복원한다.
    const allRows = [...existingRows, ...appended]
    const columnsChanged = workspace.columns.length !== DEFAULT_COLUMNS.length ||
      workspace.columns.some((c, i) => c.id !== DEFAULT_COLUMNS[i]?.id)
    const remappedRows = columnsChanged
      ? allRows.map(row => {
          const cellsAsRecord = row.cells as Record<string, string> | undefined
          return {
            ...row,
            cells: Object.fromEntries(DEFAULT_COLUMNS.map(col => [col.id, cellsAsRecord?.[col.id] ?? ''])),
          }
        })
      : allRows
    const nextWorkspace: TeamRulesWorkspace = {
      ...workspace,
      columns: DEFAULT_COLUMNS,
      rows: remappedRows,
      updatedBy: currentUserName,
      updatedAt: Date.now(),
    }
    await commit({ type: 'replace-all', workspace: nextWorkspace, updatedBy: currentUserName }, nextWorkspace)
    setSuggestion(null)
    setMessage(columnsChanged
      ? 'AI 제안을 워크스페이스에 적용했습니다. (표 컬럼이 산출물 권장 형태로 복원됨)'
      : 'AI 제안을 워크스페이스에 적용했습니다.')
  }

  async function applyExampleToWorkspace() {
    const hasContent = workspace.rows.length > 0 || workspace.blocks.length > 0
    if (hasContent && !window.confirm('기존 내용을 예시로 교체할까요?')) return
    const example = buildExampleWorkspace()
    await commit({ type: 'replace-all', workspace: example, updatedBy: currentUserName }, example)
    setShowExample(false)
    setMessage('예시를 워크스페이스에 적용했습니다.')
  }

  async function sendArtifact() {
    if (saving || sending) return
    setSending(true)
    try {
      const latestWorkspace = await sync.settledLatest()
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: latestWorkspace, updatedBy: currentUserName }) as TeamRulesWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      const finalWorkspace = normalizeWorkspace(saved ?? latestWorkspace)
      const structured = workspaceToArtifact(finalWorkspace)
      await sendWorkspaceArtifact({ isHost, projectId, activityCode: 'T-2-2', currentUid, currentUserName, content: stripUndefinedDeep(structured) as T22Structured, onSendArtifact })
      setLastSavedAt(saved?.updatedAt ?? Date.now())
      setOfferReflection(false)
      setMessage(isHost ? `${displayActivityCode('T-2-2')} 산출물로 보냈습니다.` : '기록 담당에게 반영을 요청했어요')
      if (isHost) onClose()
    } catch (error) {
      console.error('[teamRulesWorkspace send]', error)
      const msg = error instanceof Error ? error.message : '알 수 없는 오류'
      setMessage(`산출물로 보내지 못했습니다: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const structuredDraft = artifactContent?._schema === 'T-2-2'
  const sourceMode = savedWorkspace ? 'workspace' : structuredDraft ? 'aiDraft' : 'blank'
  const editorModeLabel = isHost ? '편집 모드' : '공동 편집'

  return createPortal(
    <>
    <div {...realtime.boundaryProps} className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <WorkspaceRealtimeStatus session={realtime} onClose={onClose} />
      {artifactDraft.banner}
      <div
        className="bg-white w-full max-w-[1480px] h-[94vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col"
        onClick={event => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E8EAED] bg-white flex items-center gap-3 flex-shrink-0">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#3C4043]">
            <FileText size={17} weight="bold" />
            {displayActivityCode('T-2-2')}
          </span>
          <span className="hidden sm:inline-flex h-8 items-center justify-center rounded-lg bg-[#D3E3FD] px-3 text-[13px] font-medium text-[#0842A0]">
            {editorModeLabel}
          </span>
          <span className="hidden md:inline-flex h-8 items-center rounded-lg bg-[#F1F3F4] px-3 text-[13px] font-medium text-[#5F6368]">
            {SOURCE_LABEL[sourceMode]}
          </span>
          <div className="flex-1" />
          {(freshEditors.length > 0 || awayEditors.length > 0) && (
            <div className="hidden lg:flex items-center gap-1.5 mr-1">
              {freshEditors.slice(0, 4).map(entry => (
                <span key={entry.uid} title={presenceTitle(entry)} className="text-[13px] font-bold px-2.5 py-1 rounded-full border shadow-sm" style={presenceChipStyle(entry.color)}>
                  {entry.displayName || '팀원'}
                </span>
              ))}
              <PresenceAwayChips entries={awayEditors} />
            </div>
          )}
          <span className={cn(
            'hidden md:inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium',
            isHost ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'bg-[#F1F3F4] text-[#5F6368]',
          )}>
            {isHost ? '기록' : '팀원'}
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
            disabled={sending || saving}
            title={isHost ? `현재 워크스페이스를 ${displayActivityCode('T-2-2')} 산출물로 보냅니다` : '편집 내용을 기록 담당에게 반영 요청합니다'}
            className="hidden sm:flex h-10 items-center gap-2 px-5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] active:bg-[#06327A] text-white text-[14px] font-medium shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)] transition-colors disabled:opacity-40 disabled:shadow-none"
          >
            <PaperPlaneRight size={17} weight="fill" />
            {sending ? '전송 중' : isHost ? '산출물로 보내기' : '기록 담당에게 반영 요청'}
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
                <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-5 py-2 text-[20px] font-bold text-[#1A73E8]">{displayActivityCode('T-2-2')}</span>
                <span className="text-[30px] font-bold tracking-[-0.02em] text-[#37352F]">팀 규칙 결정</span>
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

              {/* 팀 규칙 표 — 비어 있어도 표 자체는 항상 표시 (4열 구조가 핵심 입력 UI) */}
              <section className="group relative space-y-3">
                {workspace.rows.length > 0 && (
                  <button
                    type="button"
                    onClick={deleteRulesTable}
                    className="absolute -left-9 top-10 flex h-9 w-9 items-center justify-center rounded-md text-[#9AA0A6] transition-colors hover:bg-[#FCE8E6] hover:text-[#C62828]"
                    aria-label="팀 규칙 표 비우기"
                  >
                    <Trash size={16} weight="bold" />
                  </button>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-semibold tracking-[-0.01em] text-[#37352F]">팀 규칙 표</p>
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
                        <th className="sticky left-0 z-20 w-[64px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-2 py-3 text-left text-[13px] font-semibold text-[#202124]">행</th>
                        {workspace.columns.map(column => (
                          <th key={column.id} className="min-w-[110px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-2 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <PresenceInput
                                {...realtime.fieldProps(`column:${column.id}`)}
                                caretEditors={editorsForCell(`column:${column.id}`)}
                                onSelect={trackCaret(`column:${column.id}`)}
                                onKeyUp={trackCaret(`column:${column.id}`)}
                                onClick={trackCaret(`column:${column.id}`)}
                                value={column.label}
                                onChange={event => { setColumnLabelLocal(column.id, event.target.value); updatePresence(`column:${column.id}`, event.currentTarget.selectionStart ?? 0) }}
                                onBlur={event => {
                                  updateColumn(column.id, event.target.value)
                                  blurField()
                                }}
                                onFocus={event => focusField(`column:${column.id}`, event.currentTarget.selectionStart ?? 0)}
                                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] font-semibold text-[#202124] placeholder:text-[#5F6368] hover:bg-black/5 focus:border-[#0B57D0] focus:bg-white focus:outline-none"
                              />
                              <button type="button" onClick={() => deleteColumn(column.id)} className="flex h-9 w-9 items-center justify-center rounded-md text-[#5F6368] transition-colors hover:bg-black/5 hover:text-[#C5221F]">
                                <Trash size={15} weight="bold" />
                              </button>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.rows.length === 0 && (
                        <tr>
                          <td colSpan={workspace.columns.length + 1} className="border-b border-[#DADCE0] bg-[#FAFBFC] px-3 py-6 text-center text-[14px] font-semibold text-[#9AA0A6]">
                            아직 행이 없습니다. 우측 상단 &lsquo;행&rsquo; 버튼으로 추가하거나 AI 제안을 받아 보세요.
                          </td>
                        </tr>
                      )}
                      {workspace.rows.map((row, rowIndex) => (
                        <tr key={row.id} className="group/row">
                          <td className="border-b border-r border-[#DADCE0] bg-[#E8F0FE] px-2 py-3 align-top">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[14px] font-semibold text-[#1A73E8]">{rowIndex + 1}</span>
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
                              <td key={column.id} className="border-b border-r border-[#E9E9E7] bg-white p-2 align-top">
                                <div className="relative">
                                  {cellEditors.map((ed, idx) => (
                                    <span
                                      key={ed.uid}
                                      className="absolute -top-2.5 z-10 px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm"
                                      style={{ ...presenceTagStyle(ed.color), left: `${12 + idx * 60}px` }}
                                    >
                                      {ed.displayName}
                                    </span>
                                  ))}
                                  <AutoGrowTextarea
                                    {...realtime.fieldProps(cellKey)}
                                    caretEditors={cellEditors}
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
                                    minRows={2}
                                    style={accentColor ? presenceAccentStyle(accentColor) : undefined}
                                    className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-[#202124] hover:bg-[#F7F7F5] focus:border-[#0B57D0] focus:bg-white focus:outline-none"
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
                                    <PresenceInput
                                      {...realtime.fieldProps(`block-table-column:${block.id}:${column.id}`)}
                                      caretEditors={editorsForCell(`block-table-column:${block.id}:${column.id}`)}
                                      onSelect={trackCaret(`block-table-column:${block.id}:${column.id}`)}
                                      onKeyUp={trackCaret(`block-table-column:${block.id}:${column.id}`)}
                                      onClick={trackCaret(`block-table-column:${block.id}:${column.id}`)}
                                      value={column.label}
                                      onChange={event => {
                                        const nextTable = {
                                          ...table,
                                          columns: table.columns.map(item => item.id === column.id ? { ...item, label: event.target.value } : item),
                                        }
                                        setBlockTableLocal(block.id, nextTable)
                                        updatePresence(`block-table-column:${block.id}:${column.id}`, event.currentTarget.selectionStart ?? 0)
                                      }}
                                      onFocus={event => focusField(`block-table-column:${block.id}:${column.id}`, event.currentTarget.selectionStart ?? 0)}
                                      onBlur={event => {
                                        const nextTable = {
                                          ...table,
                                          columns: table.columns.map(item => item.id === column.id ? { ...item, label: event.target.value } : item),
                                        }
                                        updateBlock({ ...block, table: nextTable, content: '' })
                                        blurField()
                                      }}
                                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] font-semibold text-[#202124] placeholder:text-[#5F6368] hover:bg-black/5 focus:border-[#0B57D0] focus:bg-white focus:outline-none"
                                    />
                                    <button type="button" onClick={() => deleteBlockTableColumn(block, column.id)} className="flex h-8 w-8 items-center justify-center rounded-md text-[#5F6368] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/5 hover:text-[#C5221F]">
                                      <Trash size={15} weight="bold" />
                                    </button>
                                  </div>
                                </th>
                              ))}
                              <th className="w-[72px] border-b border-[#E9E9E7] bg-[#F7F7F5]" />
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
                                    <td key={column.id} className="border-b border-r border-[#E9E9E7] bg-white p-2 align-top">
                                      <div className="relative">
                                        {cellEditors.map((ed, idx) => (
                                          <span
                                            key={ed.uid}
                                            className="absolute -top-2.5 z-10 px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm"
                                            style={{ ...presenceTagStyle(ed.color), left: `${12 + idx * 60}px` }}
                                          >
                                            {ed.displayName}
                                          </span>
                                        ))}
                                        <AutoGrowTextarea
                                          {...realtime.fieldProps(cellKey)}
                                          caretEditors={cellEditors}
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
                                          style={accentColor ? presenceAccentStyle(accentColor) : undefined}
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
                        const commitChecklist = (next: ChecklistItem[]) => updateBlock({ ...block, content: stringifyChecklist(next) })
                        const setLocal = (next: ChecklistItem[]) => setBlockLocal({ ...block, content: stringifyChecklist(next) })
                        const toggle = (i: number) => commitChecklist(items.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it))
                        const remove = (i: number) => commitChecklist(items.filter((_, idx) => idx !== i))
                        const add = () => commitChecklist([...items, { text: '', checked: false }])
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
                                <PresenceInput
                                  {...realtime.fieldProps(`block:${block.id}:check:${idx}`)}
                                  caretEditors={editorsForCell(`block:${block.id}:check:${idx}`)}
                                  onSelect={trackCaret(`block:${block.id}:check:${idx}`)}
                                  onKeyUp={trackCaret(`block:${block.id}:check:${idx}`)}
                                  onClick={trackCaret(`block:${block.id}:check:${idx}`)}
                                  value={it.text}
                                  onChange={event => { setLocal(items.map((x, i) => i === idx ? { ...x, text: event.target.value } : x)); updatePresence(`block:${block.id}:check:${idx}`, event.currentTarget.selectionStart ?? 0) }}
                                  onFocus={event => focusField(`block:${block.id}:check:${idx}`, event.currentTarget.selectionStart ?? 0)}
                                  onBlur={event => {
                                    commitChecklist(items.map((x, i) => i === idx ? { ...x, text: event.target.value } : x))
                                    blurField()
                                  }}
                                  onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitChecklist([...items.slice(0, idx + 1), { text: '', checked: false }, ...items.slice(idx + 1)])
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
                        {...realtime.fieldProps(`block:${block.id}`)}
                        caretEditors={editorsForCell(`block:${block.id}`)}
                        onSelect={trackCaret(`block:${block.id}`)}
                        onKeyUp={trackCaret(`block:${block.id}`)}
                        onClick={trackCaret(`block:${block.id}`)}
                        value={block.content}
                        onChange={event => { setBlockLocal({ ...block, content: event.target.value }); updatePresence(`block:${block.id}`, event.currentTarget.selectionStart ?? 0) }}
                        data-block-input={block.id}
                        onFocus={event => focusField(`block:${block.id}`, event.currentTarget.selectionStart ?? 0)}
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
                팀원은 공동 초안을 편집할 수 있고, 최종 산출물 전송은 기록 담당이 실행합니다.
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

            {/* 우측: AI 추천 패널 — 좌측 수동 / 우측 AI. 사용자 추가 프롬프트 없이 채팅·기존 행만으로 한 번에 제안. */}
            <aside className="space-y-4 lg:sticky lg:top-6 self-start">
              <section className="rounded-2xl border border-[#E9E9E7] bg-[#FBFBFA] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#D3E3FD] text-[#0842A0]">
                    <Sparkle size={20} weight="fill" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-[#37352F]">추천 산출물 형식</p>
                    <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-[#5F6368]">
                      <li>· <b>팀 규칙 3-6개</b></li>
                      <li>· <b>분류로 묶기</b> (소통·시간·의사결정·역할·갈등 등)</li>
                      <li>· <b>규칙명</b>은 명확한 행동 동사로</li>
                      <li>· <b>실천 방법</b>은 가장 여건이 빠듯한 팀원도 지킬 수 있게</li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[15px] font-bold text-[#202124]">AI 에이전트의 제안 받기</label>
                  <p className="text-[13px] leading-relaxed text-[#5F6368]">팀 채팅과 기존 행을 읽어 <b>4열 팀 규칙 표(분류 · 규칙명 · 설명 · 실천 방법)</b>의 행을 제안합니다. 결과는 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;하시면 됩니다.</p>
                  {existingRoles && existingRoles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {existingRoles.slice(0, 6).map((r, idx) => (
                        <span key={`${r.teacherName ?? 'role'}-${idx}`} className="rounded-full bg-white border border-[#DADCE0] px-2 py-0.5 text-[13px] font-bold text-[#3C4043]">
                          {r.teacherName ? `${r.teacherName}` : ''}{r.teacherName && r.role ? '·' : ''}{r.role ?? ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {suggestError && (
                    <p className="text-[14px] font-semibold text-[#C5221F]">{suggestError}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={requestSuggestion}
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
                </div>

                {suggestion && (
                  <div className="space-y-3 rounded-xl border border-[#DADCE0] bg-white p-4">
                    <p className="text-[13px] font-semibold text-[#5F6368]">아래 규칙을 검토하고 &ldquo;워크스페이스에 적용&rdquo;을 누르면 표에 병합됩니다. (규칙명이 같은 행은 빈 셀만 보강)</p>
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
                    <ul className="space-y-2">
                      {suggestion.rules.map((r, idx) => (
                        <li key={idx} className="rounded-md border border-[#E8EAED] bg-[#FAFBFC] px-3 py-2">
                          <p className="text-[15px] font-semibold text-[#202124]">
                            {r.name || '규칙명 미정'}
                            {r.category && <span className="ml-1.5 text-[#1A73E8] font-bold">[{r.category}]</span>}
                          </p>
                          {r.description && <p className="text-[14px] text-[#3C4043] leading-relaxed mt-0.5"><span className="font-bold text-[#5F6368]">설명·</span>{r.description}</p>}
                          {r.feasibility && <p className="text-[14px] text-[#202124] leading-relaxed mt-0.5"><span className="font-bold text-[#5F6368]">실천 방법·</span>{r.feasibility}</p>}
                        </li>
                      ))}
                    </ul>
                    {suggestion.tips && suggestion.tips.length > 0 && (
                      <ul className="space-y-0.5 text-[14px] italic text-[#5F6368]">
                        {suggestion.tips.map((tip, i) => <li key={i}>· {tip}</li>)}
                      </ul>
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
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <WorkspaceSaveStatus lastSavedAt={Math.max(lastSavedAt ?? 0, savedWorkspace?.updatedAt ?? 0)} offerReflection={isHost && offerReflection} busy={saving || sending} onReflect={sendArtifact} />
              <button type="button" onClick={sendArtifact} disabled={saving || sending} className="sm:hidden rounded-full bg-[#0B57D0] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {sending ? '전송 중' : isHost ? '산출물로 보내기' : '기록 담당에게 반영 요청'}
              </button>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={saving || sending}
                title="현재 공동 초안을 저장합니다"
                className="flex items-center gap-1.5 rounded-full bg-[#111827] px-5 py-3 text-[15px] font-semibold text-white shadow-lg transition-colors hover:bg-[#1F2937] disabled:opacity-45"
              >
                <FloppyDisk size={18} weight="bold" />
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

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-2">팀 규칙 표</p>
              <div className="overflow-x-auto rounded-xl border border-[#DADCE0]">
                <table className="min-w-full border-collapse text-[15px]">
                  <thead>
                    <tr>
                      {DEFAULT_COLUMNS.map(column => (
                        <th key={column.id} className="border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-3 py-2 text-left text-[13px] font-semibold text-[#202124]">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_TRW_DATA.rows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="border-b border-r border-[#DADCE0] bg-[#E8F0FE] px-3 py-2 align-top font-semibold text-[#1A73E8]">{row.category}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#202124] leading-relaxed font-bold">{row.name}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.description}</td>
                        <td className="border-b border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.feasibility}</td>
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
    </>,
    document.body,
  )
}
