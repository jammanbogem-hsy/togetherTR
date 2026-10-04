'use client'

import { displayActivityCode } from '@/types'

import { useEffect, useMemo, useRef, useState } from 'react'
import { isBlankWorkspace } from '@/lib/coedit/workspaceBlank'
import { createPortal } from 'react-dom'
import { CheckCircle, CheckSquare, FileText, FloppyDisk, PaperPlaneRight, Plus, Square, Sparkle, Trash, X, TextH, TextHTwo, TextAlignLeft, Quotes, ListChecks, Table as TableIcon, DotsSixVertical, type Icon } from '@phosphor-icons/react'
import type {
  ScaffoldingWorkspace,
  ScaffoldingWorkspaceBlock,
  ScaffoldingWorkspaceBlockType,
  ScaffoldingWorkspaceColumn,
  ScaffoldingWorkspaceRow,
  ScaffoldingWorkspaceTableData,
} from '@/types'
import type { Ds22Structured } from '@/lib/artifacts/schemas'
import type { ScaffoldingWorkspacePatch, ScaffoldingPresenceEntry } from '@/lib/firebase/projects'
import type { ScaffoldingSuggestRequest, ScaffoldingSuggestResult } from '@/app/api/scaffolding/suggest/route'
import { cn } from '@/lib/utils'
import { useWorkspaceSync } from './useWorkspaceSync'
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

interface Props {
  open: boolean
  onClose: () => void
  workspace?: ScaffoldingWorkspace
  artifactContent?: Record<string, unknown>
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, ScaffoldingPresenceEntry>
  isHost: boolean
  onPatchSave: (patch: ScaffoldingWorkspacePatch) => Promise<ScaffoldingWorkspace | void>
  onPresenceUpdate?: (presence: ScaffoldingPresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: Ds22Structured) => Promise<void>
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  chatMessages?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  /** 직전 단계(Ds-1-3) 학습활동 표 요약 — 활동명 + 누적 차시 */
  learningActivities?: string
  /** 직전 단계(A-2-3) 학습자 프로필 요약 */
  learnerProfile?: string
}

const DEFAULT_COLUMNS: ScaffoldingWorkspaceColumn[] = [
  { id: 'targetActivity', label: '대상 활동',        color: '#E8F0FE' },
  { id: 'type',           label: '스캐폴딩 유형',     color: '#E8F0FE' },
  { id: 'content',        label: '구체적 내용',       color: '#E8F0FE' },
  { id: 'level',          label: '대상 수준',         color: '#E8F0FE' },
  { id: 'fadeOut',        label: '점진적 제거 계획',  color: '#E8F0FE' },
]

const INSERT_BLOCK_TYPES: Array<{
  type: ScaffoldingWorkspaceBlockType
  label: string
  description: string
  icon: Icon
}> = [
  { type: 'heading',    label: '제목',      description: '큰 제목으로 섹션 시작', icon: TextH },
  { type: 'subheading', label: '부제목',    description: '소제목으로 묶음 표시',   icon: TextHTwo },
  { type: 'paragraph',  label: '본문',      description: '일반 문단 텍스트',       icon: TextAlignLeft },
  { type: 'quote',      label: '인용',      description: '근거·인용구 강조',       icon: Quotes },
  { type: 'checklist',  label: '체크리스트', description: '단계·점검 항목',         icon: ListChecks },
  { type: 'table',      label: '표',        description: '지원 방안 정리 등 비교', icon: TableIcon },
]

const SOURCE_LABEL = {
  workspace: '공동 초안 편집 중',
  aiDraft: 'AI 산출물 초안에서 시작',
  blank: '빈 문서에서 시작',
} as const

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function emptyRow(columns: ScaffoldingWorkspaceColumn[]): ScaffoldingWorkspaceRow {
  return {
    id: makeId('ds22_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function emptyWorkspace(): ScaffoldingWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: [],
    review: '',
    blocks: [],
  }
}

const EXAMPLE_WORKSPACE_DATA = {
  review: '제안한 스캐폴딩은 GRR(점진적 책임 이양) 원칙에 부합합니다. 데이터 비교·해석하기(3차시)에는 분석 워크시트와 예시를 먼저 제공하고 차시가 누적될수록 체크리스트 → 자율 수행으로 발판을 단계적으로 거두도록 설계되어, 정답 제공이 아닌 발판 제공의 성격이 분명합니다. 학습 지원 학생에게는 절차 안내형 카드, 다문화 학생에게는 핵심 어휘 언어 프레임을 별도로 두어 개별화 충분성이 확보되었고, 제거 시점이 누적 차시 기준으로 명확히 명시되어 실행 가능성이 높습니다.',
  rows: [
    { targetActivity: '데이터 비교·해석하기 (3차시)', type: '구조화 틀(분석 워크시트)', content: '시간·지역별 비교 항목이 미리 구획된 워크시트를 제공하고, 1개 항목은 교사가 모델링으로 함께 채운다.', level: '전체', fadeOut: '3차시: 항목 구획+모델링 → 4차시: 빈 워크시트만 → 5차시: 자율 정리' },
    { targetActivity: '해결 방안 토의·결정하기 (3~4차시)', type: '언어 프레임', content: '"우리는 ~ 근거로 ~을 제안한다" 형태의 의사결정 발언 프레임 카드를 모둠별 배부하여 토의 발화를 지원한다.', level: '전체', fadeOut: '3~4차시: 프레임 카드 제공 → 4차시: 핵심 동사만 → 이후 자율' },
    { targetActivity: '데이터 비교·해석하기 (3차시)', type: '절차 안내형', content: '분석 단계를 1~5로 쪼갠 절차 카드를 제공하고, 단계별 완료 후 다음 단계를 여는 방식으로 인지 부담을 분산한다.', level: '학습 지원', fadeOut: '3차시: 5단계 카드 → 4차시: 2단계로 축약 → 5차시: 제거' },
    { targetActivity: '시민 제안서 작성하기 (4차시)', type: '예시 제시형', content: '완성 제안서 예시 1편과 핵심 어휘 글로사리를 제공하여 글의 구조와 표현을 모방·변형하도록 한다.', level: '다문화', fadeOut: '4차시: 예시+글로사리 → 4차시 후반: 글로사리만 → 발표 시 제거' },
  ],
  supportPlans: [
    { support: '데이터 분석 워크시트(인쇄본+구글 시트 템플릿)', targetActivity: '데이터 비교·해석하기 (3차시)' },
    { support: '의사결정 발언 프레임 카드', targetActivity: '해결 방안 토의·결정하기 (3~4차시)' },
    { support: '제안서 예시 1편 + 핵심 어휘 글로사리', targetActivity: '시민 제안서 작성하기 (4차시)' },
  ],
} as const

function buildExampleWorkspace(): ScaffoldingWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: EXAMPLE_WORKSPACE_DATA.rows.map(row => ({
      id: makeId('ds22_row'),
      cells: {
        targetActivity: row.targetActivity,
        type: row.type,
        content: row.content,
        level: row.level,
        fadeOut: row.fadeOut,
      },
      color: '#FFFFFF',
    })),
    review: EXAMPLE_WORKSPACE_DATA.review,
    blocks: [],
  }
}

function getCell(row: ScaffoldingWorkspaceRow, columnId: string): string {
  return row.cells?.[columnId] ?? ''
}

function emptyTableRow(columns: ScaffoldingWorkspaceColumn[]): ScaffoldingWorkspaceRow {
  return {
    id: makeId('ds22_table_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function defaultBlockTable(rowCount = 2, columnCount = 2): ScaffoldingWorkspaceTableData {
  const safeRowCount = Math.max(1, Math.min(rowCount, 12))
  const safeColumnCount = Math.max(1, Math.min(columnCount, 8))
  const columns: ScaffoldingWorkspaceColumn[] = Array.from({ length: safeColumnCount }, (_, index) => ({
    id: makeId('ds22_table_col'),
    label: index === 0 ? '지원 방안' : index === 1 ? '대상 활동' : `열 ${index + 1}`,
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

function legacyTableFromContent(content: string): ScaffoldingWorkspaceTableData | null {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.includes('|'))
  if (lines.length < 2) return null
  const header = splitLegacyTableRow(lines[0]).filter(Boolean)
  if (header.length < 2) return null
  const dataLines = lines.slice(1).filter(line => {
    const cells = splitLegacyTableRow(line)
    return !cells.every(cell => /^:?-{2,}:?$/.test(cell))
  })
  const columns = header.map(label => ({ id: makeId('ds22_table_col'), label, color: '#E8F0FE' }))
  const rows = dataLines.map(line => {
    const cells = splitLegacyTableRow(line)
    return {
      id: makeId('ds22_table_row'),
      cells: Object.fromEntries(columns.map((column, index) => [column.id, cells[index] ?? ''])),
      color: '#FFFFFF',
    }
  })
  return { columns, rows: rows.length ? rows : [emptyTableRow(columns)] }
}

function getBlockTable(block: ScaffoldingWorkspaceBlock): ScaffoldingWorkspaceTableData {
  return block.table ?? legacyTableFromContent(block.content) ?? defaultBlockTable()
}

function makeDocumentBlock(
  type: ScaffoldingWorkspaceBlockType,
  table?: ScaffoldingWorkspaceTableData,
): ScaffoldingWorkspaceBlock {
  // Firestore는 nested undefined를 거부 — table은 'table' 블록에서만 키 자체를 포함시킨다.
  const block: ScaffoldingWorkspaceBlock = {
    id: makeId('ds22_block'),
    type,
    content: '',
    color: '#FFFFFF',
    checked: false,
    includeInArtifact: true,
  }
  if (type === 'table') block.table = table ?? defaultBlockTable()
  return block
}

/** artifactContent.scaffolds[] 항목 형태 */
type Ds22ScaffoldShape = {
  targetActivity?: string
  type?: string
  content?: string
  level?: string
  fadeOut?: string
}

type Ds22ArtifactShape = {
  _schema?: string
  scaffolds?: Ds22ScaffoldShape[]
  supportPlans?: Array<{ support?: string; targetActivity?: string }>
  review?: string
  manualWorkspace?: ScaffoldingWorkspace
}

/**
 * artifactContent (Ds22Structured) → workspace 자동 로드.
 * AI 산출물 초안이 있으면 스캐폴딩 표·AI 점검을 그대로 워크스페이스에 매핑한다.
 */
function workspaceFromDs22(structured: Ds22ArtifactShape): ScaffoldingWorkspace {
  if (structured.manualWorkspace) return normalizeWorkspace(structured.manualWorkspace)

  const scaffolds = Array.isArray(structured.scaffolds) ? structured.scaffolds : []
  const rows: ScaffoldingWorkspaceRow[] = scaffolds.length > 0
    ? scaffolds.map(s => ({
        id: makeId('ds22_row'),
        cells: {
          targetActivity: s.targetActivity ?? '',
          type: s.type ?? '',
          content: s.content ?? '',
          level: s.level ?? '',
          fadeOut: s.fadeOut ?? '',
        },
        color: '#FFFFFF',
      }))
    : []

  return {
    columns: DEFAULT_COLUMNS,
    rows,
    review: structured.review ?? '',
    blocks: [],
  }
}

function normalizeWorkspace(workspace?: ScaffoldingWorkspace, artifactContent?: Record<string, unknown>): ScaffoldingWorkspace {
  if (workspace && !isBlankWorkspace(workspace)) {
    const columns = workspace.columns?.length ? workspace.columns : DEFAULT_COLUMNS
    const blocks = (workspace.blocks ?? []).map(block => block.type === 'table'
      ? { ...block, table: getBlockTable(block), content: '' }
      : block)
    return {
      columns,
      rows: workspace.rows ?? [],
      review: workspace.review ?? '',
      blocks,
      updatedBy: workspace.updatedBy,
      updatedAt: workspace.updatedAt,
    }
  }

  const structured = artifactContent?._schema === 'Ds-2-2' ? artifactContent as unknown as Ds22ArtifactShape : null
  if (!structured) return emptyWorkspace()
  return workspaceFromDs22(structured)
}

function preserveEditingValue(
  next: ScaffoldingWorkspace,
  current: ScaffoldingWorkspace,
  editingKey: string | null,
  pendingDeletions: Set<string>,
): ScaffoldingWorkspace {
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
  const nextRowIds = new Set(filteredRows.map(row => row.id))
  const pendingRows = current.rows.filter(row => !nextRowIds.has(row.id) && !pendingDeletions.has(row.id))
  const nextBlockIds = new Set(filteredBlocks.map(block => block.id))
  const pendingBlocks = current.blocks.filter(block => !nextBlockIds.has(block.id) && !pendingDeletions.has(block.id))

  // Why: 변경 없을 때 동일 reference 반환 — useEffect 재실행 시 setState 폭주 방지
  let merged: ScaffoldingWorkspace
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

  if (editingKey === 'meta:review') {
    if (merged.review === current.review) return merged
    return { ...merged, review: current.review }
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

export function ScaffoldingWorkspaceModal({
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
  learningActivities,
  learnerProfile,
}: Props) {
  // supportPlans: 기존 artifactContent 보존, 없으면 scaffolds에서 도출
  function workspaceToArtifact(workspace: ScaffoldingWorkspace): Ds22Structured {
    const scaffolds = workspace.rows.map(row => ({
      targetActivity: getCell(row, 'targetActivity').trim(),
      type: getCell(row, 'type').trim(),
      content: getCell(row, 'content').trim(),
      level: getCell(row, 'level').trim(),
      fadeOut: getCell(row, 'fadeOut').trim(),
    })).filter(s => s.targetActivity || s.type || s.content)
    const prevSupport = (artifactContent?.supportPlans as Array<{ support?: string; targetActivity?: string }> | undefined)
    const supportPlans = prevSupport && prevSupport.length
      ? prevSupport.map(p => ({ support: p.support ?? '', targetActivity: p.targetActivity ?? '' }))
      : scaffolds.map(s => ({ support: [s.type, s.content].filter(Boolean).join(': ').slice(0, 120), targetActivity: s.targetActivity }))
    return { _schema: 'Ds-2-2', supportPlans, scaffolds, review: workspace.review.trim(), manualWorkspace: workspace }
  }

  const [workspace, setWorkspace] = useState<ScaffoldingWorkspace>(() => normalizeWorkspace(savedWorkspace, artifactContent))
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [tableDraft, setTableDraft] = useState({ open: false, rows: 3, columns: 2 })
  const [showExample, setShowExample] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [suggestion, setSuggestion] = useState<ScaffoldingSuggestResult | null>(null)
  // Why: 방금 삭제 요청한 id가 server stale 응답으로 부활하는 것 방지
  const pendingDeletionsRef = useRef<Set<string>>(new Set())

  // 원격 스냅숏은 들어올 때만 반영하고, 편집 중·저장 대기 중 칸은 로컬 값을 지킨다(#T7 — 칸에서 나가면 옛 저장본으로 되돌아가던 결함).
  const incomingWorkspace = useMemo(() => normalizeWorkspace(savedWorkspace, artifactContent), [artifactContent, savedWorkspace])
  const sync = useWorkspaceSync({
    open, incoming: incomingWorkspace, workspace, setWorkspace, editingKey,
    preserve: (next, current, key) => preserveEditingValue(next, current, key, pendingDeletionsRef.current),
  })

  // 마지막으로 송신한 presence를 추적해 heartbeat에서 동일 cellKey/caretPos로 갱신.
  const lastPresenceRef = useRef<{ cellKey: string; caretPos?: number }>({ cellKey: 'modal:idle' })

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
        updatedAt: Date.now(),
      })
    }
    sendCurrent()
    const t = setInterval(sendCurrent, 10000)
    return () => { clearInterval(t) }
  }, [open, currentUid, currentUserName, currentUserColor, onPresenceUpdate])

  const freshEditors = useMemo(() => {
    // 시계 차이로 host entry가 stale 판정되는 케이스 대비 60초로 확장.
    return Object.values(presence ?? {}).filter(entry => Date.now() - entry.updatedAt < 60000)
  }, [presence])

  const updatePresence = (cellKey: string | null, caretPos?: number) => {
    if (!onPresenceUpdate || !currentUid) return
    if (cellKey === null) {
      // blur: 마지막 활성 셀을 유지해 모든 동시 접속자의 chip이 계속 보이도록 한다.
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

  function trackCaret(cellKey: string) {
    return (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
      updatePresence(cellKey, event.currentTarget.selectionStart ?? 0)
    }
  }

  function editorsForCell(cellKey: string): ScaffoldingPresenceEntry[] {
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

  function setMetaLocal(value: string) {
    setWorkspace(prev => ({ ...prev, review: value }))
  }

  function setBlockLocal(block: ScaffoldingWorkspaceBlock) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(item => item.id === block.id ? block : item),
    }))
  }

  function setBlockTableLocal(blockId: string, table: ScaffoldingWorkspaceTableData) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(block => block.id === blockId ? { ...block, table, content: '' } : block),
    }))
  }

  async function commit(
    patch: ScaffoldingWorkspacePatch,
    next: ScaffoldingWorkspace,
    deletedIds?: string[],
  ) {
    setWorkspace(next)
    setMessage('')
    try {
      // Firestore는 nested undefined를 거부 — patch에 잔존하는 undefined를 송신 직전에 청소.
      const cleanPatch = stripUndefinedDeep(patch) as ScaffoldingWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (deletedIds?.length) {
        for (const id of deletedIds) pendingDeletionsRef.current.delete(id)
      }
      if (saved) sync.applySaved(normalizeWorkspace(saved))
    } catch (error) {
      console.error('[scaffoldingWorkspace patch]', error)
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
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: await sync.settledLatest(), updatedBy: currentUserName }) as ScaffoldingWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (saved) sync.applySaved(normalizeWorkspace(saved))
      setMessage('공동 편집 초안을 저장했습니다.')
    } catch (error) {
      console.error('[scaffoldingWorkspace save]', error)
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
    const column: ScaffoldingWorkspaceColumn = { id: makeId('ds22_col'), label: '새 열', color: '#E8F0FE' }
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

  async function deleteScaffoldTable() {
    const deletedIds = workspace.rows.map(row => row.id)
    const next = { ...workspace, rows: [] }
    for (const id of deletedIds) pendingDeletionsRef.current.add(id)
    await commit({ type: 'replace-all', workspace: next, updatedBy: currentUserName }, next, deletedIds)
  }

  async function updateMeta(value: string) {
    const next = { ...workspace, review: value, updatedBy: currentUserName, updatedAt: Date.now() }
    await commit({ type: 'update-meta', field: 'review', value, updatedBy: currentUserName }, next)
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

  async function addBlock(type: ScaffoldingWorkspaceBlockType) {
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

  async function updateBlock(block: ScaffoldingWorkspaceBlock) {
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

  async function addBlockTableColumn(block: ScaffoldingWorkspaceBlock) {
    const table = getBlockTable(block)
    const column = { id: makeId('ds22_table_col'), label: '새 열', color: '#E8F0FE' }
    const nextTable = {
      ...table,
      columns: [...table.columns, column],
      rows: table.rows.map(row => ({ ...row, cells: { ...row.cells, [column.id]: '' } })),
    }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableColumn(block: ScaffoldingWorkspaceBlock, columnId: string) {
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

  async function addBlockTableRow(block: ScaffoldingWorkspaceBlock) {
    const table = getBlockTable(block)
    const nextTable = { ...table, rows: [...table.rows, emptyTableRow(table.columns)] }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableRow(block: ScaffoldingWorkspaceBlock, rowId: string) {
    const table = getBlockTable(block)
    const nextRows = table.rows.filter(row => row.id !== rowId)
    const nextTable = { ...table, rows: nextRows.length ? nextRows : [emptyTableRow(table.columns)] }
    pendingDeletionsRef.current.add(rowId)
    try {
      await updateBlock({ ...block, table: nextTable, content: '' })
    } finally {
      pendingDeletionsRef.current.delete(rowId)
    }
  }

  async function requestSuggestion() {
    // AI 제안 2-mode 분기:
    //  - artifact: 채팅에서 이미 생성된 Ds-2-2 산출물 기반으로 정교화
    //  - chat:    빈 워크스페이스 — 현재 활동의 팀 채팅 메시지를 컨텍스트로 초안 작성
    const ac = (artifactContent ?? {}) as Ds22ArtifactShape
    const acScaffolds = Array.isArray(ac.scaffolds) ? ac.scaffolds : []
    const isArtifactMode = ac._schema === 'Ds-2-2' && acScaffolds.length > 0
    const mode: 'artifact' | 'chat' = isArtifactMode ? 'artifact' : 'chat'

    const hasContext = !!(
      isArtifactMode ||
      learningActivities?.trim() ||
      learnerProfile?.trim() ||
      (chatMessages && chatMessages.length > 0)
    )
    if (!hasContext) {
      setSuggestError('학습활동 표·학습자 프로필·채팅 대화 등 참고할 컨텍스트가 아직 없어 AI 제안을 만들 수 없습니다.')
      return
    }

    const existingArtifact = isArtifactMode
      ? {
          scaffolds: acScaffolds.map(s => ({
            targetActivity: s?.targetActivity ?? '',
            type: s?.type ?? '',
            content: s?.content ?? '',
            level: s?.level ?? '',
            fadeOut: s?.fadeOut ?? '',
          })),
          review: typeof ac.review === 'string' ? ac.review : undefined,
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
      const body: ScaffoldingSuggestRequest = {
        projectTitle,
        targetGradeGroup,
        targetSubjects,
        learningActivities,
        learnerProfile,
        mode,
        existingArtifact,
        chatContext,
        currentRows: workspace.rows.map(row => ({
          targetActivity: getCell(row, 'targetActivity'),
          type: getCell(row, 'type'),
          content: getCell(row, 'content'),
          level: getCell(row, 'level'),
          fadeOut: getCell(row, 'fadeOut'),
        })).filter(r => r.targetActivity || r.type || r.content || r.level || r.fadeOut),
      }
      const resp = await fetch('/api/scaffolding/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setSuggestError(data?.error ?? '제안을 가져오지 못했습니다.')
      } else {
        setSuggestion(data as ScaffoldingSuggestResult)
      }
    } catch (error) {
      console.error('[scaffolding suggest]', error)
      setSuggestError('네트워크 오류로 제안을 가져오지 못했습니다.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function applySuggestion() {
    if (!suggestion) return
    // 스캐폴딩 표 행 병합 — 3단계 우선순위: targetActivity 매칭 → 빈 행 채우기 → append.
    // review는 워크스페이스 review가 비어 있을 때만 제안값으로 채움 (기존 입력 보존).
    const mergedRows: ScaffoldingWorkspaceRow[] = workspace.rows.map(row => ({ ...row }))
    for (const s of suggestion.scaffolds) {
      const targetActivity = (s.targetActivity ?? '').trim()
      const type = (s.type ?? '').trim()
      const content = (s.content ?? '').trim()
      const level = (s.level ?? '').trim()
      const fadeOut = (s.fadeOut ?? '').trim()
      if (!targetActivity && !type && !content && !level && !fadeOut) continue

      // 1) targetActivity 매칭 — 같은 대상 활동이 있으면 그 행을 보강
      const matchIdx = targetActivity
        ? mergedRows.findIndex(row => getCell(row, 'targetActivity').trim() === targetActivity)
        : -1
      if (matchIdx >= 0) {
        mergedRows[matchIdx] = {
          ...mergedRows[matchIdx],
          cells: {
            ...mergedRows[matchIdx].cells,
            targetActivity: targetActivity || getCell(mergedRows[matchIdx], 'targetActivity'),
            type: type || getCell(mergedRows[matchIdx], 'type'),
            content: content || getCell(mergedRows[matchIdx], 'content'),
            level: level || getCell(mergedRows[matchIdx], 'level'),
            fadeOut: fadeOut || getCell(mergedRows[matchIdx], 'fadeOut'),
          },
        }
        continue
      }
      // 2) 빈 행 채우기 — 모든 셀이 빈 placeholder 행을 재사용
      const emptyIdx = mergedRows.findIndex(row =>
        !getCell(row, 'targetActivity').trim() &&
        !getCell(row, 'type').trim() &&
        !getCell(row, 'content').trim() &&
        !getCell(row, 'level').trim() &&
        !getCell(row, 'fadeOut').trim())
      if (emptyIdx >= 0) {
        mergedRows[emptyIdx] = {
          ...mergedRows[emptyIdx],
          cells: { ...mergedRows[emptyIdx].cells, targetActivity, type, content, level, fadeOut },
        }
        continue
      }
      // 3) append
      mergedRows.push({
        id: makeId('ds22_row'),
        cells: { targetActivity, type, content, level, fadeOut },
        color: '#FFFFFF',
      })
    }

    // 사용자가 컬럼을 수정했어도 산출물 형식(DEFAULT_COLUMNS)으로 복원해 제안 필드 누락 방지.
    const columnsChanged = workspace.columns.length !== DEFAULT_COLUMNS.length ||
      workspace.columns.some((c, i) => c.id !== DEFAULT_COLUMNS[i]?.id)
    const remappedRows: ScaffoldingWorkspaceRow[] = columnsChanged
      ? mergedRows.map(row => ({
          ...row,
          cells: Object.fromEntries(DEFAULT_COLUMNS.map(col => [col.id, (row.cells?.[col.id] as string | undefined) ?? ''])),
        }))
      : mergedRows

    const nextWorkspace: ScaffoldingWorkspace = {
      ...workspace,
      columns: DEFAULT_COLUMNS,
      rows: remappedRows,
      // review: 비어 있을 때만 제안값으로 채움 (기존 입력 보존)
      review: workspace.review.trim() ? workspace.review : (suggestion.review || ''),
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
      || !!workspace.review
    if (hasContent && !window.confirm('기존 내용을 예시로 교체할까요?')) return
    const example = buildExampleWorkspace()
    await commit({ type: 'replace-all', workspace: example, updatedBy: currentUserName }, example)
    setShowExample(false)
    setMessage('예시를 워크스페이스에 적용했습니다.')
  }

  async function sendArtifact() {
    if (!isHost) return
    setSending(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: await sync.settledLatest(), updatedBy: currentUserName }) as ScaffoldingWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      const finalWorkspace = normalizeWorkspace(saved ?? workspace)
      const structured = workspaceToArtifact(finalWorkspace)
      await onSendArtifact(stripUndefinedDeep(structured) as Ds22Structured)
      setMessage(`${displayActivityCode('Ds-2-2')} 산출물로 보냈습니다.`)
      onClose()
    } catch (error) {
      console.error('[scaffoldingWorkspace send]', error)
      const msg = error instanceof Error ? error.message : '알 수 없는 오류'
      setMessage(`산출물로 보내지 못했습니다: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const structuredDraft = artifactContent?._schema === 'Ds-2-2'
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
            {displayActivityCode('Ds-2-2')}
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
            title={isHost ? `현재 워크스페이스를 ${displayActivityCode('Ds-2-2')} 산출물로 보냅니다` : '방장만 산출물로 보낼 수 있습니다'}
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
                <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-5 py-2 text-[20px] font-bold text-[#1A73E8]">{displayActivityCode('Ds-2-2')}</span>
                <span className="text-[30px] font-bold tracking-[-0.02em] text-[#37352F]">스캐폴딩 설계</span>
                <span className="ml-auto hidden sm:inline-flex h-7 items-center rounded-md bg-[#F1F3F4] px-2.5 text-[12px] font-medium text-[#6B6A67]">
                  {workspace.rows.length > 0 ? `${workspace.columns.length}열 · ${workspace.rows.length}행` : '문서 편집 중'}
                </span>
              </div>

              {/* AI 점검 (단일 메타 필드) */}
              {(() => {
                const cellKey = 'meta:review'
                const editors = editorsForCell(cellKey)
                const accentColor = editors[0]?.color
                return (
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <label className="text-[15px] font-bold text-[#5F6368]">AI 점검</label>
                      <span className="text-[13px] text-[#9AA0A6]">GRR 부합·개별화 충분성·제거 시점 명확성</span>
                      {editors.map(ed => (
                        <span key={ed.uid} className="px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm" style={{ backgroundColor: ed.color }}>
                          {ed.displayName} 편집 중
                        </span>
                      ))}
                    </div>
                    <div className="relative">
                      <AutoGrowTextarea
                        value={workspace.review}
                        onChange={event => {
                          setMetaLocal(event.target.value)
                          updatePresence(cellKey, event.target.selectionStart ?? undefined)
                        }}
                        onFocus={event => focusField(cellKey, event.currentTarget.selectionStart ?? 0)}
                        onSelect={trackCaret(cellKey)}
                        onKeyUp={trackCaret(cellKey)}
                        onClick={trackCaret(cellKey)}
                        onBlur={event => {
                          updateMeta(event.target.value)
                          blurField()
                        }}
                        minRows={3}
                        placeholder="예: 제안한 스캐폴딩은 GRR 원칙에 부합하며, 정답 제공이 아닌 발판으로 설계되어 누적 차시 기준 단계적 철수가 명확하다. 학습 지원·다문화 학생에 대한 개별화도 충분하다."
                        style={accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}33` } : undefined}
                        className="relative w-full rounded-xl border border-[#E8EAED] bg-white px-4 py-3 text-[18px] leading-relaxed text-[#202124] placeholder:text-[#C4C7C5] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                      <CaretOverlay
                        text={workspace.review}
                        editors={editors}
                        className="rounded-xl border border-transparent px-4 py-3 text-[18px] leading-relaxed"
                      />
                    </div>
                  </div>
                )
              })()}

              {workspace.rows.length > 0 && (
              <section className="group relative space-y-3">
                <button
                  type="button"
                  onClick={deleteScaffoldTable}
                  className="absolute -left-9 top-10 flex h-9 w-9 items-center justify-center rounded-md text-[#9AA0A6] transition-colors hover:bg-[#FCE8E6] hover:text-[#C62828]"
                  aria-label="스캐폴딩 계획 표 삭제"
                >
                  <Trash size={16} weight="bold" />
                </button>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-semibold tracking-[-0.01em] text-[#37352F]">스캐폴딩 계획 표</p>
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
                        <th className="sticky left-0 z-20 w-[76px] border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-3 py-3 text-left text-[13px] font-semibold text-[#202124]">행</th>
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
                  <span className="text-[15px] font-semibold text-[#5F6368]">스캐폴딩 계획 표가 비어 있습니다.</span>
                  <button type="button" onClick={addRow} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#0B57D0] transition-colors hover:bg-[#D3E3FD]/50 active:bg-[#D3E3FD]">
                    <Plus size={15} weight="bold" /> 표 만들기 (첫 행 추가)
                  </button>
                </div>
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
                                  const editors = editorsForCell(cellKey)
                                  return (
                                    <td key={column.id} className="border-b border-r border-[#E9E9E7] bg-white p-2 align-top">
                                      <div className="relative">
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
                        const commitItems = (next: ChecklistItem[]) => updateBlock({ ...block, content: stringifyChecklist(next) })
                        const setLocal = (next: ChecklistItem[]) => setBlockLocal({ ...block, content: stringifyChecklist(next) })
                        const toggle = (i: number) => {
                          const next = items.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it)
                          commitItems(next)
                        }
                        const remove = (i: number) => commitItems(items.filter((_, idx) => idx !== i))
                        const add = () => commitItems([...items, { text: '', checked: false }])
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
                                    commitItems(items.map((x, i) => i === idx ? { ...x, text: event.target.value } : x))
                                    blurField()
                                  }}
                                  onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitItems([...items.slice(0, idx + 1), { text: '', checked: false }, ...items.slice(idx + 1)])
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

            {/* 우측: AI 추천 패널 — 좌측은 수동 작업, 우측은 AI 추천. */}
            <aside className="space-y-4 lg:sticky lg:top-6 self-start">
              <section className="rounded-2xl border border-[#E9E9E7] bg-[#FBFBFA] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#D3E3FD] text-[#0842A0]">
                    <Sparkle size={20} weight="fill" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-[#37352F]">추천 산출물 형식</p>
                    <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-[#5F6368]">
                      <li>· <b>❶ (교사팀·공유)</b> 활동별 예상 어려움·지원 아이디어를 실제 수업 장면 기반으로</li>
                      <li>· <b>❷ (교사팀·협의)</b> 학습목표 근거로 적절성 토론 — <b>정답이 아닌 발판</b> 제공</li>
                      <li>· <b>❸ (교사팀+AI·조정)</b> 학생 수행 장면을 상상하며 자료 보완</li>
                      <li>· <b>❹ (개인교사·점검)</b> 수정 자료 공유·재보완 (반복 검토)</li>
                      <li className="pt-1">· <b>GRR 원칙</b>: 교사 모델링 → 협력 수행 → 자율 수행. 점진적 제거는 <b>{displayActivityCode('Ds-1-3')} 누적 차시</b> 기준</li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[15px] font-bold text-[#202124]">AI 에이전트의 제안 받기</label>
                  <p className="text-[13px] leading-relaxed text-[#5F6368]"><b>직전 단계({displayActivityCode('Ds-1-3')})의 학습활동 표·누적 차시</b>와 <b>{displayActivityCode('A-2-3')} 학습자 프로필</b>, <b>팀 채팅 대화</b>를 자동으로 읽어 <b>스캐폴딩 계획 · AI 점검</b>을 한꺼번에 제안합니다. 결과는 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;하시면 됩니다.</p>
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
                      <label className="block text-[13px] font-bold text-[#5F6368] mb-1">AI 점검</label>
                      <AutoGrowTextarea
                        value={suggestion.review}
                        onChange={event => setSuggestion(prev => prev ? { ...prev, review: event.target.value } : prev)}
                        minRows={3}
                        className="w-full rounded-md border border-[#E8EAED] bg-white px-3 py-2 text-[15px] text-[#202124] focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                    </div>
                    {suggestion.scaffolds?.length > 0 && (
                      <div>
                        <label className="block text-[13px] font-bold text-[#5F6368] mb-1.5">스캐폴딩 ({suggestion.scaffolds.length}개)</label>
                        {/* 좁은 우측 패널에서 열이 많은 표는 글자 줄바꿈이 심해 카드(스택) 형태로 표시 */}
                        <div className="space-y-2.5">
                          {suggestion.scaffolds.map((s, idx) => {
                            const updateField = (field: keyof ScaffoldingSuggestResult['scaffolds'][number], value: string) =>
                              setSuggestion(prev => {
                                if (!prev) return prev
                                const next = [...prev.scaffolds]
                                next[idx] = { ...next[idx], [field]: value }
                                return { ...prev, scaffolds: next }
                              })
                            const inputCls = 'w-full rounded border border-[#E8EAED] bg-white px-2 py-1 text-[14px] text-[#3C4043] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]'
                            const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
                              <div>
                                <span className="block text-[12px] font-bold text-[#9AA0A6] mb-0.5">{label}</span>
                                {children}
                              </div>
                            )
                            return (
                              <div key={`scf-${idx}`} className="rounded-xl border border-[#DADCE0] bg-[#FAFBFC] p-2.5 space-y-2">
                                <Field label="대상 활동">
                                  <AutoGrowTextarea value={s.targetActivity} onChange={e => updateField('targetActivity', e.target.value)} minRows={1} className="w-full rounded border border-[#E8EAED] bg-white px-2 py-1 text-[15px] font-bold text-[#202124] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                                </Field>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <Field label="스캐폴딩 유형"><input value={s.type} onChange={e => updateField('type', e.target.value)} className={inputCls} /></Field>
                                  <Field label="대상 수준"><input value={s.level} onChange={e => updateField('level', e.target.value)} className={inputCls} /></Field>
                                </div>
                                <Field label="구체적 내용">
                                  <AutoGrowTextarea value={s.content} onChange={e => updateField('content', e.target.value)} minRows={2} className={inputCls} />
                                </Field>
                                <Field label="점진적 제거 계획 (누적 차시 기준)">
                                  <AutoGrowTextarea value={s.fadeOut} onChange={e => updateField('fadeOut', e.target.value)} minRows={2} className={inputCls} />
                                </Field>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {suggestion.tips && suggestion.tips.length > 0 && (
                      <ul className="space-y-1 text-[14px] italic text-[#5F6368]">
                        {suggestion.tips.map((tip, i) => (
                          <li key={i}>· {tip}</li>
                        ))}
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
              <p className="text-[14px] font-bold text-[#5F6368] mb-1.5">AI 점검</p>
              <p className="text-[16px] leading-relaxed text-[#202124]">{EXAMPLE_WORKSPACE_DATA.review}</p>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-2">스캐폴딩 계획 표</p>
              <div className="overflow-x-auto rounded-xl border border-[#DADCE0]">
                <table className="min-w-full border-collapse text-[15px]">
                  <thead>
                    <tr>
                      {DEFAULT_COLUMNS.map(column => (
                        <th key={column.id} className="border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-3 py-2 text-left text-[13px] font-semibold text-[#202124] whitespace-nowrap">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_WORKSPACE_DATA.rows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#202124] font-semibold leading-relaxed">{row.targetActivity}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.type}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.content}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.level}</td>
                        <td className="border-b border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.fadeOut}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-2">지원 방안 정리</p>
              <div className="overflow-x-auto rounded-xl border border-[#DADCE0]">
                <table className="min-w-full border-collapse text-[15px]">
                  <thead>
                    <tr>
                      <th className="border-b border-r border-[#E9E9E7] bg-[#F7F7F5] px-3 py-2 text-left text-[13px] font-semibold text-[#202124] whitespace-nowrap">지원 방안</th>
                      <th className="border-b border-[#E9E9E7] bg-[#F7F7F5] px-3 py-2 text-left text-[13px] font-semibold text-[#202124] whitespace-nowrap">대상 활동</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_WORKSPACE_DATA.supportPlans.map((p, idx) => (
                      <tr key={idx}>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{p.support}</td>
                        <td className="border-b border-[#DADCE0] px-3 py-2 align-top text-[#202124] font-semibold leading-relaxed">{p.targetActivity}</td>
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
