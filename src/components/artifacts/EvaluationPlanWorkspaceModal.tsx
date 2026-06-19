'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, ChatCircleDots, CheckSquare, FileText, FloppyDisk, PaperPlaneRight, Plus, Square, Sparkle, Trash, X, TextH, TextHTwo, TextAlignLeft, Quotes, ListChecks, Table as TableIcon, DotsSixVertical, type Icon } from '@phosphor-icons/react'
import { CollaborativePromptModal } from './CollaborativePromptModal'
import type {
  EvaluationPlanWorkspace,
  EvaluationPlanWorkspaceBlock,
  EvaluationPlanWorkspaceBlockType,
  EvaluationPlanWorkspaceColumn,
  EvaluationPlanWorkspaceRow,
  EvaluationPlanWorkspaceTableData,
} from '@/types'
import type { Ds11Structured, Ds11RubricRow } from '@/lib/artifacts/schemas'
import type { EvaluationPlanWorkspacePatch } from '@/lib/firebase/projects'
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
import type { EvaluationPlanSuggestRequest, EvaluationPlanSuggestResult } from '@/app/api/evaluation-plan/suggest/route'

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
  workspace?: EvaluationPlanWorkspace
  artifactContent?: Record<string, unknown>
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, PresenceEntry>
  isHost: boolean
  onPatchSave: (patch: EvaluationPlanWorkspacePatch) => Promise<EvaluationPlanWorkspace | void>
  onPresenceUpdate?: (presence: PresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: Ds11Structured) => Promise<void>
  /** 프로젝트 메타 — AI 제안 요청에 함께 전달 */
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  /** 이전 단계(A-2-2 통합 목표 / A-2-3 학습자) 산출물 — AI 제안 보강용 */
  integratedGoal?: string
  subjectGoals?: Array<{ subject: string; goal: string }>
  learnerProfile?: string
  /** AI 제안 chat-mode에서 사용할 현재 활동의 채팅 메시지 (시간순, 최근 N개 권장) */
  chatMessages?: Array<{ role: 'user' | 'assistant' | string; content: string; displayName?: string }>
  /** 협업 프롬프트 모달용 */
  projectId?: string
  collaborativeMembers?: Array<{ uid: string; displayName: string; color?: string }>
}

const DEFAULT_COLUMNS: EvaluationPlanWorkspaceColumn[] = [
  { id: 'item',   label: '평가 항목', color: '#E8F0FE' },
  { id: 'method', label: '평가 방법', color: '#E8F0FE' },
  { id: 'timing', label: '평가 시점', color: '#E8F0FE' },
  { id: 'high',   label: '상',        color: '#E6F4EA' },
  { id: 'mid',    label: '중',        color: '#FEF7E0' },
  { id: 'low',    label: '하',        color: '#FCE8E6' },
]

const INSERT_BLOCK_TYPES: Array<{
  type: EvaluationPlanWorkspaceBlockType
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

function emptyRow(columns: EvaluationPlanWorkspaceColumn[]): EvaluationPlanWorkspaceRow {
  return {
    id: makeId('evp_row'),
    cells: Object.fromEntries(columns.map(column => [column.id, ''])),
    color: '#FFFFFF',
  }
}

function emptyWorkspace(): EvaluationPlanWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: [],
    blocks: [],
  }
}

// Ds-1-1 평가 계획(루브릭) 산출물 예시. 사용자가 "예시" 버튼으로 미리보기 → 워크스페이스 채우기.
const EXAMPLE_EVP_DATA = {
  rows: [
    {
      item: '데이터 기반 문제 해결 보고서(최종 산출물)', method: '교사평가 · 서논술형(보고서)', timing: '결과',
      high: '실제 데이터를 정확히 해석하고 근거를 들어 해결 방안을 논리적으로 제안한다',
      mid: '데이터를 대체로 해석하나 해결 방안의 근거가 일부 부족하다',
      low: '데이터 해석 또는 해결 방안 제시에 추가 지원이 필요하다',
    },
    {
      item: '협력적 탐구 과정(과정 평가)', method: '자기평가 + 교사평가 · 프로젝트(수행 과정)', timing: '과정',
      high: '역할을 수행하고 진행 상황을 공유하며 동료 의견에 근거 있게 반응한다',
      mid: '역할을 수행하나 진행 공유·상호작용이 간헐적이다',
      low: '역할 수행과 협력 참여에 교사의 안내가 필요하다',
    },
    {
      item: '발표·표현(과정 평가)', method: '동료평가 + 교사평가 · 구술발표', timing: '과정',
      high: '핵심 메시지를 청중에 맞게 구조화하여 명확히 전달한다',
      mid: '내용은 전달되나 구조·전달 방식에 보완이 필요하다',
      low: '핵심 전달에 추가 연습·지원이 필요하다',
    },
  ],
} as const

function buildExampleWorkspace(): EvaluationPlanWorkspace {
  return {
    columns: DEFAULT_COLUMNS,
    rows: EXAMPLE_EVP_DATA.rows.map((row, idx) => ({
      id: `evp_row_example_${idx}`,
      cells: { item: row.item, method: row.method, timing: row.timing, high: row.high, mid: row.mid, low: row.low },
      color: '#FFFFFF',
    })),
    blocks: [],
  }
}

function normalizeWorkspace(saved?: EvaluationPlanWorkspace, artifactContent?: Record<string, unknown>): EvaluationPlanWorkspace {
  if (saved && saved.columns && saved.columns.length > 0) {
    return {
      columns: saved.columns,
      rows: saved.rows ?? [],
      blocks: saved.blocks ?? [],
      updatedBy: saved.updatedBy,
      updatedAt: saved.updatedAt,
    }
  }
  // artifactContent가 Ds-1-1 structured면 rubric → 행으로 자동 로드 (AI 초안 모드)
  const structured = artifactContent?._schema === 'Ds-1-1' ? artifactContent as unknown as Ds11Structured : null
  if (structured) {
    if (structured.manualWorkspace) return normalizeWorkspace(structured.manualWorkspace)
    // ⚠️ row.id는 stable해야 한다 (useEffect 재실행 시 preserveEditingValue가 row를 찾도록).
    const rows: EvaluationPlanWorkspaceRow[] = (structured.rubric ?? []).map((r, idx) => ({
      id: `evp_row_seed_${idx}`,
      cells: { item: r.item ?? '', method: r.method ?? '', timing: r.timing ?? '', high: r.high ?? '', mid: r.mid ?? '', low: r.low ?? '' },
      color: '#FFFFFF',
    }))
    return { columns: DEFAULT_COLUMNS, rows, blocks: [] }
  }
  return emptyWorkspace()
}

function getCell(row: EvaluationPlanWorkspaceRow, columnId: string): string {
  return (row.cells?.[columnId] ?? '') as string
}

function defaultBlockTable(rowCount = 2, columnCount = 2): EvaluationPlanWorkspaceTableData {
  const columns: EvaluationPlanWorkspaceColumn[] = Array.from({ length: columnCount }, (_, i) => ({
    id: makeId(`col_${i}`),
    label: `열 ${i + 1}`,
    color: '#E8F0FE',
  }))
  const rows: EvaluationPlanWorkspaceRow[] = Array.from({ length: rowCount }, () => ({
    id: makeId('blockrow'),
    cells: Object.fromEntries(columns.map(c => [c.id, ''])),
    color: '#FFFFFF',
  }))
  return { columns, rows }
}

function getBlockTable(block: EvaluationPlanWorkspaceBlock): EvaluationPlanWorkspaceTableData {
  return block.table ?? defaultBlockTable()
}

function makeDocumentBlock(
  type: EvaluationPlanWorkspaceBlockType,
  table?: EvaluationPlanWorkspaceTableData,
): EvaluationPlanWorkspaceBlock {
  const block: EvaluationPlanWorkspaceBlock = {
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

function workspaceToArtifact(workspace: EvaluationPlanWorkspace): Ds11Structured {
  const rubric: Ds11RubricRow[] = workspace.rows
    .map(row => ({
      item: getCell(row, 'item').trim(),
      method: getCell(row, 'method').trim(),
      timing: getCell(row, 'timing').trim(),
      high: getCell(row, 'high').trim(),
      mid: getCell(row, 'mid').trim(),
      low: getCell(row, 'low').trim(),
    }))
    .filter(r => r.item || r.method || r.high || r.mid || r.low)
  return {
    _schema: 'Ds-1-1',
    rubric,
    manualWorkspace: workspace,
  }
}

function preserveEditingValue(
  next: EvaluationPlanWorkspace,
  current: EvaluationPlanWorkspace,
  editingKey: string | null,
): EvaluationPlanWorkspace {
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

export function EvaluationPlanWorkspaceModal({
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
  chatMessages,
  projectId,
  collaborativeMembers,
}: Props) {
  const [workspace, setWorkspace] = useState<EvaluationPlanWorkspace>(() => normalizeWorkspace(savedWorkspace, artifactContent))
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [tableDraft, setTableDraft] = useState({ open: false, rows: 3, columns: 2 })
  const [showExample, setShowExample] = useState(false)
  const [showCollaborativePrompt, setShowCollaborativePrompt] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  const [suggestion, setSuggestion] = useState<EvaluationPlanSuggestResult | null>(null)
  const pendingDeletionsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    const next = normalizeWorkspace(savedWorkspace, artifactContent)
    setWorkspace(current => preserveEditingValue(next, current, editingKey))
  }, [artifactContent, editingKey, open, savedWorkspace])

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

  function setBlockLocal(block: EvaluationPlanWorkspaceBlock) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(item => item.id === block.id ? block : item),
    }))
  }

  function setBlockTableLocal(blockId: string, table: EvaluationPlanWorkspaceTableData) {
    setWorkspace(prev => ({
      ...prev,
      blocks: prev.blocks.map(block => block.id === blockId ? { ...block, table } : block),
    }))
  }

  async function commit(patch: EvaluationPlanWorkspacePatch, next: EvaluationPlanWorkspace) {
    setWorkspace(next)
    setMessage('')
    try {
      const cleanPatch = stripUndefinedDeep(patch) as EvaluationPlanWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      if (saved) setWorkspace(normalizeWorkspace(saved))
    } catch (error) {
      console.error('[evaluationPlanWorkspace patch]', error)
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
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace, updatedBy: currentUserName }) as EvaluationPlanWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      if (saved) setWorkspace(normalizeWorkspace(saved))
      setMessage('공동 편집 초안을 저장했습니다.')
    } catch (error) {
      console.error('[evaluationPlanWorkspace save]', error)
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
    const column: EvaluationPlanWorkspaceColumn = {
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

  async function addBlock(type: EvaluationPlanWorkspaceBlockType) {
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

  async function updateBlock(block: EvaluationPlanWorkspaceBlock) {
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

  async function requestSuggestion(customPrompts?: Array<{ teacherName: string; text: string }>) {
    const hasContext = !!integratedGoal?.trim() || !!(subjectGoals && subjectGoals.length > 0)
    if (!hasContext) {
      setSuggestError('이전 단계(A-2-2) 통합 수업목표가 아직 준비되지 않아 AI 제안을 만들 수 없습니다.')
      return
    }

    // AI 제안 2-mode 분기:
    //  - artifact: 채팅에서 이미 생성된 Ds-1-1 산출물(artifactContent._schema 일치) 기반으로 정교화
    //  - chat:    빈 워크스페이스 — 현재 활동의 팀 채팅 메시지를 컨텍스트로 초안 작성
    const artifactRubric = Array.isArray((artifactContent as { rubric?: unknown })?.rubric)
      ? ((artifactContent as { rubric?: Array<Partial<Ds11RubricRow>> }).rubric ?? [])
      : []
    const isArtifactMode = artifactContent?._schema === 'Ds-1-1' && artifactRubric.length > 0
    const mode: 'artifact' | 'chat' = isArtifactMode ? 'artifact' : 'chat'
    const existingArtifact = isArtifactMode ? { rubric: artifactRubric } : undefined
    const chatContext = mode === 'chat'
      ? (chatMessages ?? []).slice(-40).map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))
      : undefined

    setSuggestError('')
    setSuggestLoading(true)
    setSuggestion(null)
    try {
      const body: EvaluationPlanSuggestRequest = {
        projectTitle,
        targetGradeGroup,
        targetSubjects,
        integratedGoal,
        subjectGoals,
        learnerProfile,
        currentDraft: {
          rubric: workspace.rows.map(row => ({
            item: getCell(row, 'item'),
            method: getCell(row, 'method'),
            timing: getCell(row, 'timing'),
            high: getCell(row, 'high'),
            mid: getCell(row, 'mid'),
            low: getCell(row, 'low'),
          })).filter(r => r.item || r.method || r.high || r.mid || r.low),
        },
        mode,
        existingArtifact,
        chatContext,
        customPrompts,
      }
      const res = await fetch('/api/evaluation-plan/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(errBody?.error ?? `요청 실패 (${res.status})`)
      }
      const result = await res.json() as EvaluationPlanSuggestResult
      setSuggestion(result)
    } catch (err) {
      console.error('[evaluationPlanWorkspace suggest]', err)
      setSuggestError(err instanceof Error ? err.message : '제안을 받지 못했습니다.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function applySuggestion() {
    if (!suggestion) return
    // 사용자가 컬럼 구조를 수정했어도 산출물 형식(DEFAULT_COLUMNS — 6열 루브릭)으로 재구조화한다.
    const newRows: EvaluationPlanWorkspaceRow[] = (suggestion.rubric ?? []).map((r, idx) => ({
      id: `evp_row_applied_${idx}`,
      cells: { item: r.item ?? '', method: r.method ?? '', timing: r.timing ?? '', high: r.high ?? '', mid: r.mid ?? '', low: r.low ?? '' },
      color: '#FFFFFF',
    }))
    const nextWorkspace: EvaluationPlanWorkspace = {
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
    if (!isHost) return
    setSending(true)
    try {
      const cleanPatch = stripUndefinedDeep({ type: 'replace-all', workspace, updatedBy: currentUserName }) as EvaluationPlanWorkspacePatch
      const saved = await onPatchSave(cleanPatch)
      const finalWorkspace = saved ?? workspace
      const structured = workspaceToArtifact(finalWorkspace)
      await onSendArtifact(stripUndefinedDeep(structured) as Ds11Structured)
      setMessage('Ds-1-1 산출물로 보냈습니다.')
      onClose()
    } catch (error) {
      console.error('[evaluationPlanWorkspace send]', error)
      const msg = error instanceof Error ? error.message : '알 수 없는 오류'
      setMessage(`산출물로 보내지 못했습니다: ${msg}`)
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const structuredDraft = artifactContent?._schema === 'Ds-1-1'
  const sourceMode = savedWorkspace ? 'workspace' : structuredDraft ? 'aiDraft' : 'blank'
  const editorModeLabel = isHost ? '편집 모드' : '공동 편집'

  // 키워드만 안 쓰는 빈 변수 lint 경고 제거용
  void pendingDeletionsRef

  return createPortal(
    <>
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white w-full max-w-[1480px] h-[94vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[#DADCE0] bg-white">
          <span className="inline-flex items-center gap-1 rounded-full border border-[#E8EAED] bg-white px-3 py-2 text-[14px] font-extrabold text-[#3C4043] shadow-sm">
            <FileText size={17} weight="bold" />
            Ds-1-1
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
            title={isHost ? '현재 워크스페이스를 Ds-1-1 산출물로 보냅니다' : '방장만 산출물로 보낼 수 있습니다'}
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
                <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-4 py-2 text-[17px] font-black text-[#1A73E8]">Ds-1-1</span>
                <span className="text-[20px] font-extrabold text-[#202124]">평가 계획 수립</span>
                <span className="ml-auto hidden sm:inline-flex rounded-full border border-[#E8EAED] bg-white px-3 py-1.5 text-[14px] font-bold text-[#5F6368]">
                  {workspace.rows.length > 0 ? `${workspace.columns.length}열 · ${workspace.rows.length}행` : '문서 편집 중'}
                </span>
              </div>

              <p className="text-[14px] font-semibold leading-relaxed text-[#5F6368]">
                {sourceMode === 'aiDraft'
                  ? 'AI가 만든 산출물 초안을 불러왔습니다. 직접 수정하거나 우측에서 AI 제안을 추가로 받을 수 있습니다.'
                  : sourceMode === 'workspace'
                    ? '저장된 공동 초안을 이어서 편집 중입니다. 우측에서 AI 제안을 받아 보강할 수 있습니다.'
                    : '빈 문서에서 시작합니다. 직접 작성하거나 우측에서 AI 제안을 받아 시작할 수 있습니다.'}
              </p>

              {/* 설계 원칙·근거 표 */}
              <section className="group relative space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[20px] font-extrabold text-[#202124]">평가 루브릭 (항목·방법·시점·상·중·하)</p>
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
                        <th className="w-12 border-b border-r border-[#1557B0] bg-[#1A73E8] px-2 py-2 text-left text-[14px] font-extrabold text-white">행</th>
                        {workspace.columns.map(column => (
                          <th key={column.id} className="min-w-[220px] border-b border-r border-[#1557B0] bg-[#1A73E8] px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={column.label}
                                onChange={event => setColumnLabelLocal(column.id, event.target.value)}
                                onFocus={() => focusField(`column:${column.id}`)}
                                onBlur={event => {
                                  updateColumnLabel(column.id, event.target.value)
                                  blurField()
                                }}
                                className="w-full rounded-md border border-transparent bg-white/10 px-2 py-1 text-[14px] font-extrabold text-white hover:bg-white/15 focus:border-white focus:bg-white focus:text-[#202124] focus:outline-none"
                              />
                              <button type="button" onClick={() => deleteColumn(column.id)} className="flex h-9 w-9 items-center justify-center rounded-md text-white/75 hover:bg-white/15 hover:text-white" aria-label="열 삭제">
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
                          <td colSpan={workspace.columns.length + 1} className="border border-[#DADCE0] bg-[#F8F9FA] px-4 py-6 text-center text-sm text-[#9AA0A6]">
                            아직 설계 원칙이 없습니다. &lsquo;+ 행&rsquo;을 눌러 추가하거나 우측 AI 제안을 받아보세요.
                          </td>
                        </tr>
                      ) : workspace.rows.map((row, rowIndex) => (
                        <tr key={row.id}>
                          <td className="w-12 border-b border-r border-[#DADCE0] bg-[#F8F9FA] px-2 py-2 align-top">
                            <div className="flex items-center gap-1">
                              <span className="text-[13px] font-bold text-[#1A73E8]">{rowIndex + 1}</span>
                              <button type="button" onClick={() => deleteRow(row.id)} className="flex h-7 w-7 items-center justify-center rounded text-[#9AA0A6] hover:bg-[#FCE8E6] hover:text-[#C62828]" aria-label="행 삭제">
                                <Trash size={13} weight="bold" />
                              </button>
                            </div>
                          </td>
                          {workspace.columns.map(column => {
                            const cellKey = `${row.id}:${column.id}`
                            const editor = editorForCell(cellKey)
                            return (
                              <td key={column.id} className="border-b border-r border-[#DADCE0] bg-white p-2 align-top">
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
                                    className="w-full min-h-[58px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-[#202124] hover:bg-[#F8F9FA] focus:border-[#1A73E8] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
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
                          <div className="relative overflow-x-auto rounded-xl border border-[#DADCE0] bg-white">
                            <table className="min-w-full border-collapse text-sm">
                              <thead>
                                <tr>
                                  {table.columns.map(column => (
                                    <th key={column.id} className="min-w-[180px] border-b border-r border-[#1557B0] bg-[#1A73E8] px-2 py-2 text-left text-[14px] font-extrabold text-white">
                                      {column.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {table.rows.map(row => (
                                  <tr key={row.id}>
                                    {table.columns.map(column => (
                                      <td key={column.id} className="border-b border-r border-[#DADCE0] bg-white p-2 align-top">
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
                                          className="w-full min-h-[58px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-[#202124] hover:bg-[#F8F9FA] focus:border-[#1A73E8] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
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
            </article>

            {/* 우측: AI 추천 패널 */}
            <aside className="space-y-4 lg:sticky lg:top-6 self-start">
              <section className="rounded-2xl border border-[#E8EAED] bg-[#FAFBFC] p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1A73E8] to-[#7B2FF7] text-white">
                    <Sparkle size={20} weight="fill" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-extrabold text-[#202124]">추천 산출물 형식</p>
                    <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-[#5F6368]">
                      <li>· <b>평가 항목</b>: A-2-2 수업목표와 1:1 대응, 결과+과정 평가 포함</li>
                      <li>· <b>방법</b>: (평가자) 교사·동료·자기 + (과제유형) 포트폴리오·서논술형·구술발표·토의토론·프로젝트·실험실습</li>
                      <li>· <b>상·중·하</b>: 인지 수준이 아닌 <b>수행 정도</b>를 관찰 가능한 행동으로 기술</li>
                      <li className="text-[#9AA0A6]">※ 루브릭은 평가 방법이 아니라 채점 기준표(이 상/중/하 표 자체)입니다</li>
                    </ul>
                  </div>
                </div>

                {/* 수업목표 참조 — 평가가 무엇을 달성해야 하는지 화면에 함께 보여줌 */}
                {(integratedGoal?.trim() || (subjectGoals && subjectGoals.length > 0)) && (
                  <div className="rounded-xl border border-[#FDE293] bg-[#FEF7E0] px-3 py-2.5 space-y-1.5">
                    <p className="text-[13px] font-extrabold text-[#E37400] inline-flex items-center gap-1">
                      <ListChecks size={14} weight="fill" /> 이 평가가 달성해야 할 수업목표
                    </p>
                    {integratedGoal?.trim() && (
                      <p className="text-[14px] leading-relaxed text-[#3C4043]"><b className="text-[#202124]">통합목표</b> · {integratedGoal}</p>
                    )}
                    {subjectGoals && subjectGoals.length > 0 && (
                      <ul className="space-y-0.5">
                        {subjectGoals.map((g, i) => (
                          <li key={i} className="text-[13px] leading-relaxed text-[#3C4043]"><b className="text-[#1967D2]">{g.subject}</b> · {g.goal}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-[15px] font-bold text-[#202124]">AI 에이전트의 제안 받기</label>
                  <p className="text-[13px] leading-relaxed text-[#5F6368]">이전 단계(A-2-2) <b>통합 수업목표</b>와 학습자 맥락을 자동으로 읽어 <b>상/중/하 루브릭 표</b>를 한꺼번에 제안합니다. 결과는 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;하시면 됩니다.</p>
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
                    <p className="text-[13px] font-semibold text-[#5F6368]">아래 내용을 직접 수정한 뒤 &ldquo;워크스페이스에 적용&rdquo;을 누르면 표가 교체됩니다.</p>
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
                    {(suggestion.rubric ?? []).map((r, idx) => {
                      const patch = (field: keyof typeof r, value: string) => setSuggestion(prev => {
                        if (!prev) return prev
                        const next = [...prev.rubric]
                        next[idx] = { ...next[idx], [field]: value }
                        return { ...prev, rubric: next }
                      })
                      return (
                        <div key={idx} className="rounded-md border border-[#E8EAED] bg-white p-2 space-y-1">
                          <AutoGrowTextarea value={r.item} onChange={e => patch('item', e.target.value)} minRows={1} placeholder="평가 항목 (수업목표 연결)" className="w-full rounded border-0 bg-transparent px-1.5 py-1 text-[14px] font-bold text-[#202124] focus:bg-[#F8F9FA] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                          <div className="flex gap-1">
                            <AutoGrowTextarea value={r.method} onChange={e => patch('method', e.target.value)} minRows={1} placeholder="평가 방법" className="flex-1 rounded border-0 bg-transparent px-1.5 py-1 text-[13px] text-[#3C4043] focus:bg-[#F8F9FA] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                            <AutoGrowTextarea value={r.timing} onChange={e => patch('timing', e.target.value)} minRows={1} placeholder="시점" className="w-20 rounded border-0 bg-transparent px-1.5 py-1 text-[13px] text-[#3C4043] focus:bg-[#F8F9FA] focus:outline-none focus:ring-1 focus:ring-[#1A73E8]" />
                          </div>
                          <AutoGrowTextarea value={r.high} onChange={e => patch('high', e.target.value)} minRows={1} placeholder="상" className="w-full rounded border-0 bg-[#E6F4EA]/40 px-1.5 py-1 text-[13px] text-[#202124] focus:bg-[#E6F4EA] focus:outline-none focus:ring-1 focus:ring-[#34A853]" />
                          <AutoGrowTextarea value={r.mid} onChange={e => patch('mid', e.target.value)} minRows={1} placeholder="중" className="w-full rounded border-0 bg-[#FEF7E0]/50 px-1.5 py-1 text-[13px] text-[#202124] focus:bg-[#FEF7E0] focus:outline-none focus:ring-1 focus:ring-[#F9AB00]" />
                          <AutoGrowTextarea value={r.low} onChange={e => patch('low', e.target.value)} minRows={1} placeholder="하" className="w-full rounded border-0 bg-[#FCE8E6]/50 px-1.5 py-1 text-[13px] text-[#202124] focus:bg-[#FCE8E6] focus:outline-none focus:ring-1 focus:ring-[#C5221F]" />
                        </div>
                      )
                    })}
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
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1 text-[14px] font-bold text-[#5F6368]">
                <CheckCircle size={17} weight="fill" className="text-[#9AA0A6]" />
                {isHost ? '저장 가능' : '편집 중'}
              </span>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={!isHost || saving}
                className="inline-flex items-center gap-1.5 rounded-full bg-black text-white px-4 py-2 text-[14px] font-bold transition-colors hover:bg-[#202124] disabled:opacity-50 disabled:hover:bg-black"
              >
                <FloppyDisk size={17} weight="fill" />
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

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            <p className="text-[14px] font-bold text-[#5F6368]">평가 계획(Ds-1-1) 확정안 — 상/중/하 루브릭</p>
            <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-[14px]">
                  <thead className="bg-[#1A73E8]">
                    <tr>
                      {['평가 항목', '평가 방법', '시점', '상', '중', '하'].map(h => (
                        <th key={h} className="border border-[#1557B0] px-2 py-2 text-left font-extrabold text-white">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_EVP_DATA.rows.map((row, idx) => (
                      <tr key={idx} className="align-top">
                        <td className="border border-[#DADCE0] px-2 py-2 font-bold text-[#202124]">{row.item}</td>
                        <td className="border border-[#DADCE0] px-2 py-2 text-[#3C4043]">{row.method}</td>
                        <td className="border border-[#DADCE0] px-2 py-2 text-[#3C4043] whitespace-nowrap">{row.timing}</td>
                        <td className="border border-[#DADCE0] px-2 py-2 bg-[#E6F4EA]/40 text-[#202124]">{row.high}</td>
                        <td className="border border-[#DADCE0] px-2 py-2 bg-[#FEF7E0]/50 text-[#202124]">{row.mid}</td>
                        <td className="border border-[#DADCE0] px-2 py-2 bg-[#FCE8E6]/50 text-[#202124]">{row.low}</td>
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
        scope="evaluationPlan"
        currentUid={currentUid}
        currentUserName={currentUserName}
        currentUserColor={currentUserColor}
        members={collaborativeMembers ?? []}
        title="평가 계획 AI에게 구체적으로 요청"
        subtitle="Ds-1-1 — 각자 자기 행에 추가 요청을 적은 뒤 AI 제안 받기"
        onSubmit={async (prompts) => { await requestSuggestion(prompts) }}
      />
    )}
    </>,
    document.body,
  )
}
