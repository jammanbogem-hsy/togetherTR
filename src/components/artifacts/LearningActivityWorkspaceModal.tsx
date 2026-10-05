'use client'

import { sendWorkspaceArtifact } from './workspaceArtifactRequest'
import { WorkspaceSaveStatus } from './WorkspaceSaveStatus'
import { useRealtimeWorkspace, WorkspaceRealtimeStatus } from './useRealtimeWorkspace'

import { displayActivityCode } from '@/types'

import { useEffect, useMemo, useRef, useState } from 'react'
import { isBlankWorkspace } from '@/lib/coedit/workspaceBlank'
import { createPortal } from 'react-dom'
import { CheckCircle, CheckSquare, FileText, FloppyDisk, PaperPlaneRight, Plus, Square, Sparkle, Trash, X, TextH, TextHTwo, TextAlignLeft, Quotes, ListChecks, Table as TableIcon, DotsSixVertical, type Icon } from '@phosphor-icons/react'
import type {
  LearningActivityWorkspace,
  LearningActivityWorkspaceBlock,
  LearningActivityWorkspaceBlockType,
  LearningActivityWorkspaceColumn,
  LearningActivityWorkspaceRow,
  LearningActivityWorkspaceTableData,
} from '@/types'
import type { Ds13Structured } from '@/lib/artifacts/schemas'
import type { LearningActivityWorkspacePatch, LearningActivityPresenceEntry } from '@/lib/firebase/projects'
import type { LearningActivitySuggestRequest, LearningActivitySuggestResult } from '@/app/api/learning-activity/suggest/route'
import { cn } from '@/lib/utils'
import { useWorkspaceSync } from './useWorkspaceSync'
import { PresenceAwayChips, presenceAccentStyle, presenceChipStyle, presenceTagStyle, presenceTitle, splitPresence, usePresenceClock } from './presence'
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
  workspace?: LearningActivityWorkspace
  artifactContent?: Record<string, unknown>
  projectId?: string
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, LearningActivityPresenceEntry>
  isHost: boolean
  onPatchSave: (patch: LearningActivityWorkspacePatch) => Promise<LearningActivityWorkspace | void>
  onPresenceUpdate?: (presence: LearningActivityPresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: Ds13Structured) => Promise<void>
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  chatMessages?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  /** 직전 단계(Ds-1-2) 문제 상황 */
  problemScenario?: string
  /** 직전 단계(Ds-1-2) 탐구 질문 */
  drivingQuestion?: string
  /** 직전 단계(Ds-1-1) 평가 계획 요약 */
  evaluationPlan?: string
}

const DEFAULT_COLUMNS: LearningActivityWorkspaceColumn[] = [
  { id: 'order',       label: '순서',       color: '#E8F0FE' },
  { id: 'phase',       label: '흐름 단계',  color: '#E8F0FE' },
  { id: 'name',        label: '활동명',     color: '#E8F0FE' },
  { id: 'description', label: '활동 설명',  color: '#E8F0FE' },
  { id: 'coreType',    label: '핵심/부가',  color: '#E8F0FE' },
  { id: 'subject',     label: '담당 교과',  color: '#E8F0FE' },
  { id: 'session',     label: '누적 차시',  color: '#E8F0FE' },
  { id: 'operation',   label: '차시 운영(시간·지원·자료·평가)', color: '#E8F0FE' },
]

const INSERT_BLOCK_TYPES: Array<{
  type: LearningActivityWorkspaceBlockType
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

function emptyRow(columns: LearningActivityWorkspaceColumn[]): LearningActivityWorkspaceRow {
  return {
    id: makeId('ds13_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function emptyWorkspace(): LearningActivityWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: [],
    review: '',
    blocks: [],
  }
}

const EXAMPLE_WORKSPACE_DATA = {
  review: '제안한 활동 흐름은 Ds-1-2 탐구 질문("우리 동네 미세먼지를 어떻게 줄일 수 있을까?")과 Ds-1-1 평가 계획(데이터 해석·제안서)에 정합적입니다. 문제 이해→정보 탐색→분석→의사결정→산출물 제작→공유 및 수정의 순서가 자연스럽게 이어지고, 핵심 활동(데이터 분석·제안서 작성)과 부가 활동(사전 흥미 유발)이 구분되어 있어 차시 운영 시 우선순위 판단이 용이합니다. 누적 차시(1→2→3~4차시)와 교사 지원·자료가 명시되어 실행 가능성이 높습니다.',
  rows: [
    { order: '1', phase: '문제 이해',    name: '미세먼지 문제 상황 분석하기', description: '동네 미세먼지 사진·뉴스를 보고 문제의 심각성을 토의하며 탐구 질문을 도출한다.', coreType: '핵심', subject: '사회(주)·과학(보)', session: '1차시', operation: '예상 40분 · 교사 발문 지원 · 사진/뉴스 자료 · 진단 평가' },
    { order: '2', phase: '정보 탐색',    name: '대기 오염 데이터 수집하기',   description: '공공 데이터 포털에서 지역 미세먼지 측정값을 검색·수집하고 표로 정리한다.', coreType: '핵심', subject: '과학(주)·정보(보)', session: '2차시', operation: '예상 40분 · 데이터 포털 안내 · 태블릿/스프레드시트 · 과정 관찰' },
    { order: '3', phase: '분석',          name: '데이터 비교·해석하기',        description: '수집한 데이터를 시간·지역별로 비교해 패턴과 원인을 분석한다.', coreType: '핵심', subject: '과학(주)·수학(보)', session: '3차시', operation: '예상 40분 · 그래프 작성 코칭 · 분석 워크시트 · 형성 평가' },
    { order: '4', phase: '의사결정',      name: '해결 방안 토의·결정하기',     description: '분석 결과를 토대로 실현 가능한 시민 실천·정책 제안을 모둠에서 합의한다.', coreType: '핵심', subject: '사회(주)·국어(보)', session: '3~4차시', operation: '예상 40분 · 토의 규칙 안내 · 의사결정 매트릭스 · 동료 평가' },
    { order: '5', phase: '산출물 제작',   name: '시민 제안서 작성하기',        description: '근거를 갖춘 설득적 제안서를 작성하고 시각 자료를 함께 구성한다.', coreType: '핵심', subject: '국어(주)·미술(보)', session: '4차시', operation: '예상 80분 · 글쓰기 첨삭 · 제안서 양식 · 수행 평가' },
    { order: '6', phase: '공유 및 수정', name: '제안서 발표·피드백 반영하기', description: '제안서를 발표하고 동료·교사 피드백을 받아 보완한다.', coreType: '부가', subject: '국어(주)', session: '4차시', operation: '예상 40분 · 발표 지원 · 평가 루브릭 · 자기/동료 평가' },
  ],
} as const

function buildExampleWorkspace(): LearningActivityWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: EXAMPLE_WORKSPACE_DATA.rows.map(row => ({
      id: makeId('ds13_row'),
      cells: {
        order: row.order,
        phase: row.phase,
        name: row.name,
        description: row.description,
        coreType: row.coreType,
        subject: row.subject,
        session: row.session,
        operation: row.operation,
      },
      color: '#FFFFFF',
    })),
    review: EXAMPLE_WORKSPACE_DATA.review,
    blocks: [],
  }
}

function getCell(row: LearningActivityWorkspaceRow, columnId: string): string {
  return row.cells?.[columnId] ?? ''
}

function emptyTableRow(columns: LearningActivityWorkspaceColumn[]): LearningActivityWorkspaceRow {
  return {
    id: makeId('ds13_table_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function defaultBlockTable(rowCount = 2, columnCount = 2): LearningActivityWorkspaceTableData {
  const safeRowCount = Math.max(1, Math.min(rowCount, 12))
  const safeColumnCount = Math.max(1, Math.min(columnCount, 8))
  const columns: LearningActivityWorkspaceColumn[] = Array.from({ length: safeColumnCount }, (_, index) => ({
    id: makeId('ds13_table_col'),
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

function legacyTableFromContent(content: string): LearningActivityWorkspaceTableData | null {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.includes('|'))
  if (lines.length < 2) return null
  const header = splitLegacyTableRow(lines[0]).filter(Boolean)
  if (header.length < 2) return null
  const dataLines = lines.slice(1).filter(line => {
    const cells = splitLegacyTableRow(line)
    return !cells.every(cell => /^:?-{2,}:?$/.test(cell))
  })
  const columns = header.map(label => ({ id: makeId('ds13_table_col'), label, color: '#E8F0FE' }))
  const rows = dataLines.map(line => {
    const cells = splitLegacyTableRow(line)
    return {
      id: makeId('ds13_table_row'),
      cells: Object.fromEntries(columns.map((column, index) => [column.id, cells[index] ?? ''])),
      color: '#FFFFFF',
    }
  })
  return { columns, rows: rows.length ? rows : [emptyTableRow(columns)] }
}

function getBlockTable(block: LearningActivityWorkspaceBlock): LearningActivityWorkspaceTableData {
  return block.table ?? legacyTableFromContent(block.content) ?? defaultBlockTable()
}

function makeDocumentBlock(
  type: LearningActivityWorkspaceBlockType,
  table?: LearningActivityWorkspaceTableData,
): LearningActivityWorkspaceBlock {
  // Firestore는 nested undefined를 거부 — table은 'table' 블록에서만 키 자체를 포함시킨다.
  const block: LearningActivityWorkspaceBlock = {
    id: makeId('ds13_block'),
    type,
    content: '',
    color: '#FFFFFF',
    checked: false,
    includeInArtifact: true,
  }
  if (type === 'table') block.table = table ?? defaultBlockTable()
  return block
}

/** artifactContent.activities[] 항목 형태 (route.ts 내부 타입을 인라인으로) */
type Ds13ActivityShape = {
  order?: string
  phase?: string
  name?: string
  description?: string
  coreType?: string
  subject?: string
  session?: string
  operation?: string
}

type Ds13ArtifactShape = {
  _schema?: string
  activities?: Ds13ActivityShape[]
  review?: string
  manualWorkspace?: LearningActivityWorkspace
  // 레거시 5열 매핑 대비 — activities 부재 시 이름만 다른 동일 의미 필드
  rows?: Array<{ order?: string; name?: string; description?: string; subject?: string; session?: string }>
}

/**
 * artifactContent (Ds13Structured) → workspace 자동 로드.
 * AI 산출물 초안이 있으면 활동 표·AI 점검을 그대로 워크스페이스에 매핑한다.
 * activities가 없고 레거시 5열(order/name/description/subject/session)만 있으면 그 매핑도 지원.
 */
function workspaceFromDs13(structured: Ds13ArtifactShape): LearningActivityWorkspace {
  if (structured.manualWorkspace) return normalizeWorkspace(structured.manualWorkspace)

  const activities = Array.isArray(structured.activities) ? structured.activities : []
  let rows: LearningActivityWorkspaceRow[]
  if (activities.length > 0) {
    rows = activities.map(a => ({
      id: makeId('ds13_row'),
      cells: {
        order: a.order ?? '',
        phase: a.phase ?? '',
        name: a.name ?? '',
        description: a.description ?? '',
        coreType: a.coreType ?? '',
        subject: a.subject ?? '',
        session: a.session ?? '',
        operation: a.operation ?? '',
      },
      color: '#FFFFFF',
    }))
  } else if (Array.isArray(structured.rows) && structured.rows.length > 0) {
    // 레거시 5열 — phase/coreType/operation은 빈 문자열로 매핑
    rows = structured.rows.map(r => ({
      id: makeId('ds13_row'),
      cells: {
        order: r.order ?? '',
        phase: '',
        name: r.name ?? '',
        description: r.description ?? '',
        coreType: '',
        subject: r.subject ?? '',
        session: r.session ?? '',
        operation: '',
      },
      color: '#FFFFFF',
    }))
  } else {
    rows = []
  }

  return {
    columns: DEFAULT_COLUMNS,
    rows,
    review: structured.review ?? '',
    blocks: [],
  }
}

function normalizeWorkspace(workspace?: LearningActivityWorkspace, artifactContent?: Record<string, unknown>): LearningActivityWorkspace {
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

  const structured = artifactContent?._schema === 'Ds-1-3' ? artifactContent as unknown as Ds13ArtifactShape : null
  if (!structured) return emptyWorkspace()
  return workspaceFromDs13(structured)
}

function preserveEditingValue(
  next: LearningActivityWorkspace,
  current: LearningActivityWorkspace,
  editingKey: string | null,
  pendingDeletions: Set<string>,
): LearningActivityWorkspace {
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
  let merged: LearningActivityWorkspace
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

function workspaceToArtifact(workspace: LearningActivityWorkspace): Ds13Structured {
  const activities = workspace.rows.map(row => ({
    order: getCell(row, 'order').trim(),
    phase: getCell(row, 'phase').trim(),
    name: getCell(row, 'name').trim(),
    description: getCell(row, 'description').trim(),
    coreType: getCell(row, 'coreType').trim(),
    subject: getCell(row, 'subject').trim(),
    session: getCell(row, 'session').trim(),
    operation: getCell(row, 'operation').trim(),
  })).filter(a => a.name || a.description || a.phase)
  return {
    _schema: 'Ds-1-3',
    activities,
    review: workspace.review.trim(),
    manualWorkspace: workspace,
  }
}

export function LearningActivityWorkspaceModal({
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
  problemScenario,
  drivingQuestion,
  evaluationPlan,
}: Props) {
  const [workspace, setLegacyWorkspace] = useState<LearningActivityWorkspace>(() => normalizeWorkspace(savedWorkspace, artifactContent))
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>()
  const [offerReflection, setOfferReflection] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [tableDraft, setTableDraft] = useState({ open: false, rows: 3, columns: 2 })
  const [showExample, setShowExample] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [suggestion, setSuggestion] = useState<LearningActivitySuggestResult | null>(null)
  // Why: 방금 삭제 요청한 id가 server stale 응답으로 부활하는 것 방지
  const pendingDeletionsRef = useRef<Set<string>>(new Set())

  // 원격 스냅숏은 들어올 때만 반영하고, 편집 중·저장 대기 중 칸은 로컬 값을 지킨다(#T7 — 칸에서 나가면 옛 저장본으로 되돌아가던 결함).
  const incomingWorkspace = useMemo(() => normalizeWorkspace(savedWorkspace, artifactContent), [artifactContent, savedWorkspace])
  const realtime = useRealtimeWorkspace({
    open, projectId, workspaceField: 'learningActivityWorkspace', workspace, incoming: incomingWorkspace,
    setWorkspace: setLegacyWorkspace, editingKey,
  })
  const setWorkspace = realtime.setWorkspace
  const onPatchSave: Props['onPatchSave'] = realtime.enabled ? realtime.flush : legacyPatchSave
  const sync = useWorkspaceSync({
    open, incoming: incomingWorkspace, workspace, setWorkspace: setLegacyWorkspace, editingKey, external: realtime.enabled,
    // 서버 저장본이 비어 있으면(빈 초안·산출물에서 채워 연 표) 첫 변경은 화면 표 통째로 저장 (#T7b)
    remoteBlank: isBlankWorkspace(savedWorkspace),
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

  // 참여자 표시: 시계로 다시 계산해 신호가 끊긴 사람이 남지 않게 하고, 잠시 비운 사람은 흐리게(#R2)
    // 시계 차이로 host entry가 stale 판정되는 케이스 대비 60초로 확장.
  const presenceNow = usePresenceClock()
  const { fresh: freshEditors, away: awayEditors } = useMemo(
    () => splitPresence(Object.values(presence ?? {}), presenceNow, 60000),
    [presence, presenceNow],
  )

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

  function editorsForCell(cellKey: string): LearningActivityPresenceEntry[] {
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

  function setBlockLocal(block: LearningActivityWorkspaceBlock) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(item => item.id === block.id ? block : item),
    }))
  }

  function setBlockTableLocal(blockId: string, table: LearningActivityWorkspaceTableData) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(block => block.id === blockId ? { ...block, table, content: '' } : block),
    }))
  }

  async function commit(
    patch: LearningActivityWorkspacePatch,
    next: LearningActivityWorkspace,
    deletedIds?: string[],
  ) {
    setWorkspace(next)
    setMessage('')
    try {
      // Firestore는 nested undefined를 거부 — patch에 잔존하는 undefined를 송신 직전에 청소.
      const cleanPatch = stripUndefinedDeep(sync.prepare(patch, next)) as LearningActivityWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (deletedIds?.length) {
        for (const id of deletedIds) pendingDeletionsRef.current.delete(id)
      }
      if (saved) sync.applySaved(normalizeWorkspace(saved))
      setLastSavedAt(saved?.updatedAt ?? Date.now())
    } catch (error) {
      console.error('[learningActivityWorkspace patch]', error)
      if (deletedIds?.length) {
        for (const id of deletedIds) pendingDeletionsRef.current.delete(id)
      }
      setMessage('저장하지 못했습니다. 다시 시도해주세요.')
    }
  }

  async function handleSaveAll() {
    if (saving || sending) return
    setSaving(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: await sync.settledLatest(), updatedBy: currentUserName }) as LearningActivityWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      if (saved) sync.applySaved(normalizeWorkspace(saved))
      setLastSavedAt(saved?.updatedAt ?? Date.now())
      setMessage('공동 편집 초안을 저장했습니다.')
      setOfferReflection(isHost)
    } catch (error) {
      console.error('[learningActivityWorkspace save]', error)
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
    const column: LearningActivityWorkspaceColumn = { id: makeId('ds13_col'), label: '새 열', color: '#E8F0FE' }
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

  async function deleteActivityTable() {
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

  async function addBlock(type: LearningActivityWorkspaceBlockType) {
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

  async function updateBlock(block: LearningActivityWorkspaceBlock) {
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

  async function addBlockTableColumn(block: LearningActivityWorkspaceBlock) {
    const table = getBlockTable(block)
    const column = { id: makeId('ds13_table_col'), label: '새 열', color: '#E8F0FE' }
    const nextTable = {
      ...table,
      columns: [...table.columns, column],
      rows: table.rows.map(row => ({ ...row, cells: { ...row.cells, [column.id]: '' } })),
    }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableColumn(block: LearningActivityWorkspaceBlock, columnId: string) {
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

  async function addBlockTableRow(block: LearningActivityWorkspaceBlock) {
    const table = getBlockTable(block)
    const nextTable = { ...table, rows: [...table.rows, emptyTableRow(table.columns)] }
    await updateBlock({ ...block, table: nextTable, content: '' })
  }

  async function deleteBlockTableRow(block: LearningActivityWorkspaceBlock, rowId: string) {
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
    //  - artifact: 채팅에서 이미 생성된 Ds-1-3 산출물 기반으로 정교화
    //  - chat:    빈 워크스페이스 — 현재 활동의 팀 채팅 메시지를 컨텍스트로 초안 작성
    const ac = (artifactContent ?? {}) as Ds13ArtifactShape
    const acActivities = Array.isArray(ac.activities) ? ac.activities : []
    const isArtifactMode = ac._schema === 'Ds-1-3' && acActivities.length > 0
    const mode: 'artifact' | 'chat' = isArtifactMode ? 'artifact' : 'chat'

    const hasContext = !!(
      isArtifactMode ||
      problemScenario?.trim() ||
      drivingQuestion?.trim() ||
      evaluationPlan?.trim() ||
      (chatMessages && chatMessages.length > 0)
    )
    if (!hasContext) {
      setSuggestError('문제 상황·탐구 질문·평가 계획·채팅 대화 등 참고할 컨텍스트가 아직 없어 AI 제안을 만들 수 없습니다.')
      return
    }

    const existingArtifact = isArtifactMode
      ? {
          activities: acActivities.map(a => ({
            order: a?.order ?? '',
            phase: a?.phase ?? '',
            name: a?.name ?? '',
            description: a?.description ?? '',
            coreType: a?.coreType ?? '',
            subject: a?.subject ?? '',
            session: a?.session ?? '',
            operation: a?.operation ?? '',
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
      const body: LearningActivitySuggestRequest = {
        projectTitle,
        targetGradeGroup,
        targetSubjects,
        problemScenario,
        drivingQuestion,
        evaluationPlan,
        mode,
        existingArtifact,
        chatContext,
        currentRows: workspace.rows.map(row => ({
          order: getCell(row, 'order'),
          phase: getCell(row, 'phase'),
          name: getCell(row, 'name'),
          description: getCell(row, 'description'),
          coreType: getCell(row, 'coreType'),
          subject: getCell(row, 'subject'),
          session: getCell(row, 'session'),
          operation: getCell(row, 'operation'),
        })).filter(r => r.name || r.description || r.phase || r.order),
      }
      const resp = await fetch('/api/learning-activity/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setSuggestError(data?.error ?? '제안을 가져오지 못했습니다.')
      } else {
        setSuggestion(data as LearningActivitySuggestResult)
      }
    } catch (error) {
      console.error('[learning-activity suggest]', error)
      setSuggestError('네트워크 오류로 제안을 가져오지 못했습니다.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function applySuggestion() {
    if (!suggestion) return
    // 활동 표 행 병합 — 3단계 우선순위: name 매칭 → 빈 행 채우기 → append.
    // review는 워크스페이스 review가 비어 있을 때만 제안값으로 채움 (기존 입력 보존).
    const mergedRows: LearningActivityWorkspaceRow[] = workspace.rows.map(row => ({ ...row }))
    for (const a of suggestion.activities) {
      const order = (a.order ?? '').trim()
      const phase = (a.phase ?? '').trim()
      const name = (a.name ?? '').trim()
      const description = (a.description ?? '').trim()
      const coreType = (a.coreType ?? '').trim()
      const subject = (a.subject ?? '').trim()
      const session = (a.session ?? '').trim()
      const operation = (a.operation ?? '').trim()
      if (!order && !phase && !name && !description && !coreType && !subject && !session && !operation) continue

      // 1) name 매칭 — 같은 활동명이 있으면 그 행을 보강
      const matchIdx = name
        ? mergedRows.findIndex(row => getCell(row, 'name').trim() === name)
        : -1
      if (matchIdx >= 0) {
        mergedRows[matchIdx] = {
          ...mergedRows[matchIdx],
          cells: {
            ...mergedRows[matchIdx].cells,
            order: order || getCell(mergedRows[matchIdx], 'order'),
            phase: phase || getCell(mergedRows[matchIdx], 'phase'),
            name: name || getCell(mergedRows[matchIdx], 'name'),
            description: description || getCell(mergedRows[matchIdx], 'description'),
            coreType: coreType || getCell(mergedRows[matchIdx], 'coreType'),
            subject: subject || getCell(mergedRows[matchIdx], 'subject'),
            session: session || getCell(mergedRows[matchIdx], 'session'),
            operation: operation || getCell(mergedRows[matchIdx], 'operation'),
          },
        }
        continue
      }
      // 2) 빈 행 채우기 — 모든 셀이 빈 placeholder 행을 재사용
      const emptyIdx = mergedRows.findIndex(row =>
        !getCell(row, 'order').trim() &&
        !getCell(row, 'phase').trim() &&
        !getCell(row, 'name').trim() &&
        !getCell(row, 'description').trim() &&
        !getCell(row, 'coreType').trim() &&
        !getCell(row, 'subject').trim() &&
        !getCell(row, 'session').trim() &&
        !getCell(row, 'operation').trim())
      if (emptyIdx >= 0) {
        mergedRows[emptyIdx] = {
          ...mergedRows[emptyIdx],
          cells: { ...mergedRows[emptyIdx].cells, order, phase, name, description, coreType, subject, session, operation },
        }
        continue
      }
      // 3) append
      mergedRows.push({
        id: makeId('ds13_row'),
        cells: { order, phase, name, description, coreType, subject, session, operation },
        color: '#FFFFFF',
      })
    }

    // 사용자가 컬럼을 수정했어도 산출물 형식(DEFAULT_COLUMNS)으로 복원해 제안 필드 누락 방지.
    const columnsChanged = workspace.columns.length !== DEFAULT_COLUMNS.length ||
      workspace.columns.some((c, i) => c.id !== DEFAULT_COLUMNS[i]?.id)
    const remappedRows: LearningActivityWorkspaceRow[] = columnsChanged
      ? mergedRows.map(row => ({
          ...row,
          cells: Object.fromEntries(DEFAULT_COLUMNS.map(col => [col.id, (row.cells?.[col.id] as string | undefined) ?? ''])),
        }))
      : mergedRows

    const nextWorkspace: LearningActivityWorkspace = {
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
    if (saving || sending) return
    setSending(true)
    try {
      const latestWorkspace = await sync.settledLatest()
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace: latestWorkspace, updatedBy: currentUserName }) as LearningActivityWorkspacePatch
      const saved = await sync.track(cleanPatch, onPatchSave(cleanPatch))
      const finalWorkspace = normalizeWorkspace(saved ?? latestWorkspace)
      const structured = workspaceToArtifact(finalWorkspace)
      await sendWorkspaceArtifact({ isHost, projectId, activityCode: 'Ds-1-3', currentUid, currentUserName, content: stripUndefinedDeep(structured) as Ds13Structured, onSendArtifact })
      setLastSavedAt(saved?.updatedAt ?? Date.now())
      setOfferReflection(false)
      setMessage(isHost ? `${displayActivityCode('Ds-1-3')} 산출물로 보냈습니다.` : '방장에게 반영을 요청했어요')
      if (isHost) onClose()
    } catch (error) {
      console.error('[learningActivityWorkspace send]', error)
      const msg = error instanceof Error ? error.message : '알 수 없는 오류'
      setMessage(`산출물로 보내지 못했습니다: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const structuredDraft = artifactContent?._schema === 'Ds-1-3'
  const sourceMode = savedWorkspace ? 'workspace' : structuredDraft ? 'aiDraft' : 'blank'
  const editorModeLabel = isHost ? '편집 모드' : '공동 편집'

  return createPortal(
    <>
    <div {...realtime.boundaryProps} className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <WorkspaceRealtimeStatus session={realtime} onClose={onClose} />
      <div
        className="bg-white w-full h-[94vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col"
        onClick={event => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E8EAED] bg-white flex items-center gap-3 flex-shrink-0">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C4C7C5] bg-white px-3 text-[13px] font-medium text-[#3C4043]">
            <FileText size={17} weight="bold" />
            {displayActivityCode('Ds-1-3')}
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
            disabled={sending || saving}
            title={isHost ? `현재 워크스페이스를 ${displayActivityCode('Ds-1-3')} 산출물로 보냅니다` : '편집 내용을 방장에게 반영 요청합니다'}
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
                <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-5 py-2 text-[20px] font-bold text-[#1A73E8]">{displayActivityCode('Ds-1-3')}</span>
                <span className="text-[30px] font-bold tracking-[-0.02em] text-[#37352F]">학습활동 설계</span>
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
                      <span className="text-[13px] text-[#9AA0A6]">학습 목표·평가 계획과의 정합성 및 흐름·실행 적절성</span>
                      {editors.map(ed => (
                        <span key={ed.uid} className="px-2 py-0.5 rounded-full text-[12px] font-bold text-white shadow-sm" style={presenceTagStyle(ed.color)}>
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
                        placeholder="예: 제안한 활동 흐름은 탐구 질문·평가 계획에 정합적이며, 문제 이해→정보 탐색→분석→의사결정→산출물 제작→공유 및 수정 순서가 자연스럽게 이어진다."
                        style={accentColor ? presenceAccentStyle(accentColor) : undefined}
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
                  onClick={deleteActivityTable}
                  className="absolute -left-9 top-10 flex h-9 w-9 items-center justify-center rounded-md text-[#9AA0A6] transition-colors hover:bg-[#FCE8E6] hover:text-[#C62828]"
                  aria-label="학습활동 표 삭제"
                >
                  <Trash size={16} weight="bold" />
                </button>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-semibold tracking-[-0.01em] text-[#37352F]">학습활동 표</p>
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
                                      style={{ ...presenceTagStyle(ed.color), left: `${12 + idx * 60}px` }}
                                    >
                                      {ed.displayName}
                                    </span>
                                  ))}
                                  <AutoGrowTextarea
                                    caretEditors={editors}
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
                  <span className="text-[15px] font-semibold text-[#5F6368]">학습활동 표가 비어 있습니다.</span>
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
                                            style={{ ...presenceTagStyle(ed.color), left: `${12 + idx * 60}px` }}
                                          >
                                            {ed.displayName}
                                          </span>
                                        ))}
                                        <AutoGrowTextarea
                                          caretEditors={editors}
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
                      <li>· <b>❶ 학습활동 아이디어</b>를 동사 중심으로 (&ldquo;탐색하기·비교하기·작성하기&rdquo;)</li>
                      <li>· <b>❷ 논리적 흐름으로 재배열</b> (문제 이해→정보 탐색→분석→의사결정→산출물 제작→공유 및 수정)</li>
                      <li>· <b>❸ 핵심 활동 / 부가 활동</b> 구분</li>
                      <li>· <b>❹ 누적 차시</b>(1→2→3~4차시) + <b>차시 운영</b>(예상 시간·교사 지원·필요 자료·평가 시점)</li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[15px] font-bold text-[#202124]">AI 에이전트의 제안 받기</label>
                  <p className="text-[13px] leading-relaxed text-[#5F6368]"><b>직전 단계({displayActivityCode('Ds-1-2')})의 문제 상황·탐구 질문</b>과 <b>{displayActivityCode('Ds-1-1')} 평가 계획</b>, <b>팀 채팅 대화</b>를 자동으로 읽어 <b>학습활동 표 · AI 점검</b>을 한꺼번에 제안합니다. 결과는 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;하시면 됩니다.</p>
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
                    {suggestion.activities?.length > 0 && (
                      <div>
                        <label className="block text-[13px] font-bold text-[#5F6368] mb-1.5">학습활동 ({suggestion.activities.length}개)</label>
                        {/* 좁은 우측 패널에서 열이 많은 표는 글자 줄바꿈이 심해 카드(스택) 형태로 표시 */}
                        <div className="space-y-2.5">
                          {suggestion.activities.map((a, idx) => {
                            const updateField = (field: keyof LearningActivitySuggestResult['activities'][number], value: string) =>
                              setSuggestion(prev => {
                                if (!prev) return prev
                                const next = [...prev.activities]
                                next[idx] = { ...next[idx], [field]: value }
                                return { ...prev, activities: next }
                              })
                            const inputCls = 'w-full rounded border border-[#E8EAED] bg-white px-2 py-1 text-[14px] text-[#3C4043] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]'
                            const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
                              <div>
                                <span className="block text-[12px] font-bold text-[#9AA0A6] mb-0.5">{label}</span>
                                {children}
                              </div>
                            )
                            return (
                              <div key={`act-${idx}`} className="rounded-xl border border-[#DADCE0] bg-[#FAFBFC] p-2.5 space-y-2">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    value={a.order}
                                    onChange={e => updateField('order', e.target.value)}
                                    className="w-9 rounded-full bg-[#E8F0FE] px-1 py-1 text-center text-[14px] font-semibold text-[#1A73E8] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]"
                                  />
                                  <AutoGrowTextarea
                                    value={a.name}
                                    onChange={e => updateField('name', e.target.value)}
                                    minRows={1}
                                    className="flex-1 rounded border border-[#E8EAED] bg-white px-2 py-1 text-[15px] font-bold text-[#202124] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]"
                                  />
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <Field label="흐름 단계"><input value={a.phase} onChange={e => updateField('phase', e.target.value)} className={inputCls} /></Field>
                                  <Field label="핵심/부가"><input value={a.coreType} onChange={e => updateField('coreType', e.target.value)} className={inputCls} /></Field>
                                  <Field label="차시"><input value={a.session} onChange={e => updateField('session', e.target.value)} className={inputCls} /></Field>
                                </div>
                                <Field label="교과"><input value={a.subject} onChange={e => updateField('subject', e.target.value)} className={inputCls} /></Field>
                                <Field label="설명">
                                  <AutoGrowTextarea value={a.description} onChange={e => updateField('description', e.target.value)} minRows={2} className={inputCls} />
                                </Field>
                                <Field label="차시 운영 (자료·교사 지원)">
                                  <AutoGrowTextarea value={a.operation} onChange={e => updateField('operation', e.target.value)} minRows={2} className={inputCls} />
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
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <WorkspaceSaveStatus lastSavedAt={Math.max(lastSavedAt ?? 0, savedWorkspace?.updatedAt ?? 0)} offerReflection={isHost && offerReflection} busy={saving || sending} onReflect={sendArtifact} />
              <button type="button" onClick={sendArtifact} disabled={saving || sending} className="sm:hidden rounded-full bg-[#0B57D0] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {sending ? '전송 중' : isHost ? '산출물로 보내기' : '방장에게 반영 요청'}
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
              <p className="text-[14px] font-bold text-[#5F6368] mb-1.5">AI 점검</p>
              <p className="text-[16px] leading-relaxed text-[#202124]">{EXAMPLE_WORKSPACE_DATA.review}</p>
            </div>
            <div>
              <p className="text-[14px] font-bold text-[#5F6368] mb-2">학습활동 표</p>
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
                        <td className="border-b border-r border-[#DADCE0] bg-[#E8F0FE] px-3 py-2 align-top font-semibold text-[#1A73E8]">{row.order}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#202124] leading-relaxed">{row.phase}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#202124] font-semibold leading-relaxed">{row.name}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.description}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.coreType}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.subject}</td>
                        <td className="border-b border-r border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.session}</td>
                        <td className="border-b border-[#DADCE0] px-3 py-2 align-top text-[#3C4043] leading-relaxed">{row.operation}</td>
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
