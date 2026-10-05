'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDebouncedPatchQueue, createPendingLedger, mergeCoeditIncoming } from './useWorkspaceSync'
import { WorkspaceSaveStatus } from './WorkspaceSaveStatus'
import { createPortal } from 'react-dom'
import { FloppyDisk, PaperPlaneRight, Plus, Sparkle, Trash, X } from '@phosphor-icons/react'
import type {
  CoeditWorkspace,
  CoeditWorkspaceBlock,
  CoeditWorkspaceColumn,
  CoeditWorkspaceRow,
} from '@/types'
import type { CoeditPresenceEntry, CoeditWorkspacePatch } from '@/lib/firebase/projects'
import { AutoGrowTextarea } from './workspaceHelpers'
import { MD3Button, MD3_ICON } from '@/components/ui/MD3Button'
import { Avatar } from '@/components/ui/Avatar'

// ─── DI·E 공동 편집 공용 모달 ────────────────────────────────────────
// 기존 12개 모달은 활동마다 전체를 복제했지만(각 1300~1600줄), 신규 4종은
// 표 구성과 산출물 매핑만 다르므로 설정(config)을 주입받는 단일 컴포넌트로 만든다.
// ⚠️ 기존 12개 모달은 건드리지 않는다 — 팀 모드 동작 불변이 최우선.

export interface CoeditModalConfig {
  /** 모달 제목 */
  title: string
  /** 제목 아래 한 줄 안내 — 가이드가 요구하는 활동의 초점 */
  subtitle: string
  /** 주 표 위에 붙는 소제목 */
  tableTitle: string
  /** AI 제안 요청에 쓰는 활동 코드 */
  activityCode: 'DI-1-1' | 'DI-2-1' | 'E-1-1' | 'E-2-1'
  /** true면 AI가 새 행을 추가하지 않고 기존 행의 빈 칸만 채운다 (E-2-1 합의 대조판) */
  fillExistingRowsOnly?: boolean
  /** 워크스페이스 → 산출물 섹션 매핑 */
  toArtifact: (ws: CoeditWorkspace) => Record<string, string>
}

/** AI 제안 요청에 함께 보낼 맥락 — ChatPanel이 프로젝트/산출물에서 구성 */
export interface CoeditSuggestContext {
  projectTitle?: string
  targetGradeGroup?: string
  targetSubjects?: string[]
  teamMembers?: string[]
  priorArtifacts?: Array<{ label: string; text: string }>
  chatContext?: Array<{ role: string; content: string; displayName?: string }>
}

interface Props {
  open: boolean
  onClose: () => void
  config: CoeditModalConfig
  workspace?: CoeditWorkspace
  /** 저장된 워크스페이스가 없을 때 주입할 초기값 */
  emptyWorkspace: () => CoeditWorkspace
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  presence?: Record<string, CoeditPresenceEntry>
  isHost: boolean
  onPatchSave: (patch: CoeditWorkspacePatch) => Promise<CoeditWorkspace | void>
  onPresenceUpdate?: (presence: CoeditPresenceEntry | null) => void | Promise<void>
  onSendArtifact: (content: Record<string, string>) => Promise<void>
  /** AI 제안 맥락 — 없으면 AI 제안 버튼을 숨긴다 */
  suggestContext?: CoeditSuggestContext
}

// 순수 변환 함수는 lib/artifacts/coeditSerialize에 두고 여기서 재수출한다 (테스트 가능성)
export { tableToMarkdown, columnToList } from '@/lib/artifacts/coeditSerialize'

/** 블록 배열에서 특정 id의 표 블록을 찾는다 (보조 표) */
export function findTableBlock(blocks: CoeditWorkspaceBlock[], blockId: string) {
  const b = blocks.find(x => x.id === blockId)
  return b?.table
}

export function CoeditWorkspaceModal({
  open,
  onClose,
  config,
  workspace,
  emptyWorkspace,
  currentUid,
  currentUserName,
  currentUserColor,
  presence,
  isHost,
  onPatchSave,
  onPresenceUpdate,
  onSendArtifact,
  suggestContext,
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>()
  const [offerReflection, setOfferReflection] = useState(false)
  const [notice, setNotice] = useState('')
  const [saveLedger] = useState(createPendingLedger)
  const [suggesting, setSuggesting] = useState(false)
  const [rationale, setRationale] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seededRef = useRef(false)

  useEffect(() => setMounted(true), [])

  // 로컬 상태(낙관적 업데이트)가 필수다. prop을 그대로 렌더하면 Firestore 왕복을 기다리는 동안
  // 타이핑한 글자가 매 keystroke마다 옛 값으로 덮여 마지막 한 글자만 남는다.
  // 기존 12개 모달과 동일하게 "즉시 로컬 반영 → 원격 저장" 순서로 처리한다.
  const [ws, setWs] = useState<CoeditWorkspace>(() => workspace ?? emptyWorkspace())
  const latestWsRef = useRef(ws)
  useEffect(() => { latestWsRef.current = ws }, [ws])
  // 지금 편집 중인 셀 — 원격 스냅샷이 이 셀만은 덮어쓰지 않도록 보호한다
  const editingKeyRef = useRef<string | null>(null)
  // 칸별 지연 저장(#T7): 칸마다 타이머를 따로 둬서 400ms 안에 다른 칸으로 옮겨도 앞 칸 저장이 취소되지 않는다.
  // 보내는 중인 칸도 응답이 올 때까지 원격 스냅샷이 덮지 않게 센다.
  const onPatchSaveRef = useRef(onPatchSave)
  useEffect(() => { onPatchSaveRef.current = onPatchSave })
  const inflightKeysRef = useRef(new Map<string, number>())
  const [cellQueue] = useState(() => createDebouncedPatchQueue<CoeditWorkspacePatch>((p, key) => {
    const inflight = inflightKeysRef.current
    inflight.set(key, (inflight.get(key) ?? 0) + 1)
    return saveLedger.track(p, onPatchSaveRef.current(p))
      .then(saved => { setLastSavedAt(saved?.updatedAt ?? Date.now()) })
      .catch(() => setError('저장에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.'))
      .finally(() => {
        const left = (inflight.get(key) ?? 1) - 1
        if (left > 0) inflight.set(key, left)
        else inflight.delete(key)
      })
  }))

  useEffect(() => {
    if (!workspace) return
    // 편집 중 칸·대기 중 칸·보내는 중인 칸은 로컬 값을 지킨다(늦게 온 옛 스냅샷이 새 입력을 덮지 않게).
    setWs(prev => mergeCoeditIncoming(workspace, prev, [
      ...cellQueue.keys(),
      ...inflightKeysRef.current.keys(),
      ...(editingKeyRef.current ? [editingKeyRef.current] : []),
    ]))
  }, [workspace, cellQueue])

  // 닫힐 때(언마운트) 대기 중인 저장은 취소하지 않고 바로 보낸다 (마지막 타이핑 유실 방지)
  useEffect(() => () => { void cellQueue.flushAll() }, [cellQueue])

  // 최초 진입 시 기본 컬럼·보조 표를 한 번 저장해 둔다 (호스트만 — 동시 시드 충돌 방지)
  useEffect(() => {
    if (!open || workspace || seededRef.current || !isHost) return
    seededRef.current = true
    void onPatchSave({ type: 'replace-all', workspace: emptyWorkspace(), updatedBy: currentUid })
      .catch(() => { seededRef.current = false })
  }, [open, workspace, isHost, emptyWorkspace, onPatchSave, currentUid])

  // 모달을 닫으면 presence 해제 — 다른 팀원 화면에 유령 커서가 남지 않도록
  useEffect(() => {
    if (open) return
    void onPresenceUpdate?.(null)
  }, [open, onPresenceUpdate])

  const reportPresence = useCallback((cellKey: string) => {
    if (!currentUid || !onPresenceUpdate) return
    void onPresenceUpdate({
      uid: currentUid,
      displayName: currentUserName ?? '팀원',
      color: currentUserColor ?? '#A0BCE8',
      cellKey,
      updatedAt: Date.now(),
    })
  }, [currentUid, currentUserName, currentUserColor, onPresenceUpdate])

  /** 구조 변경(줄 추가·삭제 등) — 로컬 즉시 반영 후 바로 저장. 대기 중인 칸 저장을 먼저 보내 순서를 지킨다. */
  const patch = useCallback(async (p: CoeditWorkspacePatch, next: CoeditWorkspace) => {
    latestWsRef.current = next
    setWs(next)
    setError(null)
    try {
      await cellQueue.flushAll()
      const saved = await saveLedger.track(p, onPatchSave(p))
      setLastSavedAt(saved?.updatedAt ?? Date.now())
    } catch {
      setError('저장에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.')
    }
  }, [onPatchSave, cellQueue, saveLedger])

  /** 셀 타이핑 — 로컬은 즉시, 원격 저장은 칸별 400ms 디바운스 (keystroke마다 쓰지 않는다) */
  const patchCellDebounced = useCallback((p: CoeditWorkspacePatch, next: CoeditWorkspace) => {
    latestWsRef.current = next
    setWs(next)
    setError(null)
    // 주 표 칸은 칸 단위, 보조 표는 표 단위(upsert-block)로 대기한다 — 같은 키의 더 새 저장만 앞의 것을 대체한다.
    const key = p.type === 'update-cell' ? `main:${p.rowId}:${p.columnId}` : p.type === 'upsert-block' ? p.block.id : 'structure'
    cellQueue.schedule(key, p)
  }, [cellQueue])

  const newRowId = () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  /**
   * AI 제안 — 주 표의 컬럼 정의를 그대로 보내 응답 키가 컬럼 id와 일치하게 한다.
   * fillExistingRowsOnly면 새 행을 만들지 않고 기존 행의 **빈 칸만** 채운다
   * (E-2-1 합의 대조판: 초기 합의 5행은 T단계 산출물에서 온 것이라 늘리면 안 된다).
   */
  async function handleSuggest() {
    if (!suggestContext) return
    setSuggesting(true)
    setError(null)
    setRationale(null)
    try {
      const res = await fetch('/api/coedit/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityCode: config.activityCode,
          columns: ws.columns.map(c => ({ id: c.id, label: c.label })),
          existingRows: ws.rows.map(r => r.cells ?? {}),
          ...suggestContext,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'AI 제안을 받지 못했습니다. 다시 시도해 주세요.')
        return
      }
      const suggested: Array<Record<string, string>> = data.rows ?? []
      if (suggested.length === 0) {
        setError('AI가 제안할 내용을 찾지 못했습니다. 이전 단계 산출물을 먼저 채워 주세요.')
        return
      }
      const next = config.fillExistingRowsOnly
        ? {
            ...ws,
            rows: ws.rows.map((r, i) => {
              const s = suggested[i]
              if (!s) return r
              const cells = { ...r.cells }
              // 사람이 이미 쓴 값은 절대 덮지 않는다
              for (const [k, v] of Object.entries(s)) {
                if (!(cells[k] ?? '').trim() && v.trim()) cells[k] = v
              }
              return { ...r, cells }
            }),
          }
        : {
            ...ws,
            rows: [
              ...ws.rows,
              ...suggested.map(cells => ({ id: newRowId(), cells } as CoeditWorkspaceRow)),
            ],
          }
      setRationale(typeof data.rationale === 'string' ? data.rationale : null)
      await patch({ type: 'replace-all', workspace: next, updatedBy: currentUid }, next)
    } catch {
      setError('AI 제안 요청에 실패했습니다. 네트워크를 확인해 주세요.')
    } finally {
      setSuggesting(false)
    }
  }

  async function saveLatestDraft() {
    await cellQueue.flushAll()
    await saveLedger.settle()
    const latest = latestWsRef.current
    const saved = await saveLedger.track({ type: 'replace-all' }, onPatchSave({ type: 'replace-all', workspace: latest, updatedBy: currentUid }))
    setLastSavedAt(saved?.updatedAt ?? Date.now())
    return saved ?? latest
  }

  async function handleSaveAll() {
    if (saving || sending) return
    setSaving(true)
    setError(null)
    setNotice('')
    try {
      await saveLatestDraft()
      setNotice('공동 편집 초안을 저장했습니다.')
      setOfferReflection(isHost)
    } catch {
      setError('저장에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSendArtifact() {
    if (saving || sending) return
    setSending(true)
    setError(null)
    setNotice('')
    try {
      const content = config.toArtifact(await saveLatestDraft())
      const hasContent = Object.values(content).some(v => (v ?? '').trim())
      if (!hasContent) {
        setError('산출물로 보낼 내용이 없습니다. 표를 먼저 채워 주세요.')
        return
      }
      await onSendArtifact(content)
      setOfferReflection(false)
      if (isHost) onClose()
      else setNotice('방장에게 반영을 요청했어요')
    } catch {
      setError('산출물 저장에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setSending(false)
    }
  }

  // 셀에 머무는 다른 팀원 표시
  const editorsByCell = useMemo(() => {
    const map: Record<string, CoeditPresenceEntry[]> = {}
    for (const p of Object.values(presence ?? {})) {
      if (!p || p.uid === currentUid) continue
      if (Date.now() - (p.updatedAt ?? 0) > 60_000) continue
      ;(map[p.cellKey] ??= []).push(p)
    }
    return map
  }, [presence, currentUid])

  if (!open || !mounted) return null

  const tableBlocks = ws.blocks.filter(b => b.type === 'table')
  const headingBlocks = ws.blocks.filter(b => b.type === 'subheading' || b.type === 'heading')

  function renderTable(
    columns: CoeditWorkspaceColumn[],
    rows: CoeditWorkspaceRow[],
    keyPrefix: string,
    onCell: (rowId: string, columnId: string, value: string) => void,
    onAddRow: () => void,
    onDeleteRow: (rowId: string) => void,
  ) {
    return (
      <div className="rounded-lg border border-[#E9E9E7] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm [word-break:keep-all]">
            <thead>
              {/* Notion식 머리행 — 색 밴드 대신 옅은 회색 + 헤어라인.
                  컬럼 구분은 셀 상단의 얇은 색 라인으로만 남긴다(의미는 유지, 소음은 제거). */}
              <tr>
                {columns.map(c => (
                  <th
                    key={c.id}
                    className="px-3 py-2 text-left text-[13px] font-semibold text-[#202124] bg-[#F7F7F5] border-b border-r border-[#E9E9E7] whitespace-nowrap"
                    style={{ boxShadow: c.color ? `inset 0 2px 0 0 ${c.color}` : undefined }}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="w-10 bg-[#F7F7F5] border-b border-[#E9E9E7]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9E9E7]">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-[14px] text-[#9B9A97]">
                    아직 입력된 줄이 없습니다 — 아래 &lsquo;줄 추가&rsquo;로 시작하세요
                  </td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="group align-top hover:bg-[#FBFBFA]">
                  {columns.map(c => {
                    const cellKey = `${keyPrefix}:${row.id}:${c.id}`
                    const others = editorsByCell[cellKey] ?? []
                    return (
                      <td key={c.id} className="px-2 py-1.5 relative">
                        <AutoGrowTextarea
                          value={row.cells?.[c.id] ?? ''}
                          onChange={e => onCell(row.id, c.id, e.target.value)}
                          onFocus={() => { editingKeyRef.current = cellKey; reportPresence(cellKey) }}
                          onBlur={() => { if (editingKeyRef.current === cellKey) editingKeyRef.current = null }}
                          minRows={1}
                          className="w-full min-h-[34px] rounded-md border border-transparent hover:bg-[#F7F7F5] focus:border-[#0B57D0] focus:bg-white focus:outline-none px-2 py-1.5 text-[14px] leading-[1.6] text-[#37352F] bg-transparent"
                        />
                        {others.length > 0 && (
                          <span className="absolute -top-1 right-1 flex gap-0.5">
                            {others.slice(0, 3).map(o => (
                              <Avatar key={o.uid} name={o.displayName} color={o.color} size={18} />
                            ))}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => onDeleteRow(row.id)}
                      title="줄 삭제"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 text-[#9B9A97] hover:bg-[#FCE8E6] hover:text-[#C5221F]"
                    >
                      <Trash size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Notion식 블록 추가 — 평소엔 옅게, hover에서 또렷해진다 */}
        <div className="px-2 py-1 border-t border-[#E9E9E7]">
          <button
            type="button"
            onClick={onAddRow}
            className="inline-flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[14px] font-normal text-[#9B9A97] transition-colors hover:bg-[#EFEFEE] hover:text-[#37352F]"
          >
            <Plus size={15} weight="bold" />
            줄 추가
          </button>
        </div>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={config.title}>
      <div className="w-full max-w-[1100px] max-h-[92vh] flex flex-col rounded-[28px] bg-white shadow-[0_8px_12px_6px_rgba(60,64,67,0.15),0_4px_4px_rgba(60,64,67,0.3)] overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-start gap-3 px-7 py-4 border-b border-[#E9E9E7] bg-white">
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[#37352F] truncate">{config.title}</h2>
            <p className="text-[13px] leading-[1.6] text-[#6B6A67] mt-1">{config.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full text-[#5F6368] hover:bg-black/[0.06] transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto panel-scroll px-7 py-7 space-y-7">
          {error && (
            <div className="rounded-xl bg-[#FCE8E6] text-[#C5221F] text-[13px] font-medium px-4 py-2.5">
              {error}
            </div>
          )}

          {rationale && (
            <div className="rounded-xl bg-[#E8F0FE] border border-[#D3E3FD] px-4 py-3">
              <p className="text-[12px] font-bold text-[#0B57D0] mb-1 flex items-center gap-1.5">
                <Sparkle size={14} weight="fill" /> AI 제안 근거
              </p>
              <p className="text-[13px] text-[#3C4043] leading-relaxed">{rationale}</p>
              <p className="text-[11px] text-[#5F6368] mt-1.5">
                제안은 초안입니다 — 팀이 확인하고 고쳐 주세요.
              </p>
            </div>
          )}

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[#37352F]">{config.tableTitle}</h3>
              {suggestContext && (
                <MD3Button
                  size="xs"
                  variant="tonal"
                  tone="blue"
                  className="ml-auto"
                  onClick={handleSuggest}
                  disabled={suggesting}
                  icon={<Sparkle size={MD3_ICON.xs} weight="fill" />}
                  title={config.fillExistingRowsOnly
                    ? 'AI가 빈 칸을 채워 초안을 제안합니다 (이미 쓴 내용은 그대로)'
                    : 'AI가 이전 단계 산출물을 근거로 행을 제안합니다'}
                >
                  {suggesting ? 'AI 제안 받는 중…' : 'AI 제안'}
                </MD3Button>
              )}
            </div>
            {renderTable(
              ws.columns,
              ws.rows,
              'main',
              (rowId, columnId, value) => patchCellDebounced(
                { type: 'update-cell', rowId, columnId, value, updatedBy: currentUid },
                { ...ws, rows: ws.rows.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [columnId]: value } } : r) },
              ),
              () => {
                const row = { id: newRowId(), cells: {} } as CoeditWorkspaceRow
                void patch({ type: 'add-row', row, updatedBy: currentUid }, { ...ws, rows: [...ws.rows, row] })
              },
              (rowId) => void patch({ type: 'delete-row', rowId }, { ...ws, rows: ws.rows.filter(r => r.id !== rowId) }),
            )}
          </section>

          {/* 보조 표 (실행 계획·개선안 등) */}
          {tableBlocks.map(block => {
            const heading = headingBlocks.find(h => h.id === block.id.replace('-table', '-heading'))
            const cols = block.table?.columns ?? []
            const rows = block.table?.rows ?? []
            const buildWrite = (nextRows: CoeditWorkspaceRow[]) => {
              const nextBlock = { ...block, table: { columns: cols, rows: nextRows } }
              return {
                patch: { type: 'upsert-block' as const, block: nextBlock, updatedBy: currentUid },
                next: { ...ws, blocks: ws.blocks.map(b => b.id === block.id ? nextBlock : b) },
              }
            }
            return (
              <section key={block.id} className="space-y-2">
                <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[#37352F]">{heading?.content ?? '보조 표'}</h3>
                {renderTable(
                  cols,
                  rows,
                  block.id,
                  (rowId, columnId, value) => {
                    const { patch: p, next } = buildWrite(
                      rows.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [columnId]: value } } : r)
                    )
                    patchCellDebounced(p, next)
                  },
                  () => {
                    const { patch: p, next } = buildWrite([...rows, { id: newRowId(), cells: {} } as CoeditWorkspaceRow])
                    void patch(p, next)
                  },
                  (rowId) => {
                    const { patch: p, next } = buildWrite(rows.filter(r => r.id !== rowId))
                    void patch(p, next)
                  },
                )}
              </section>
            )
          })}
        </div>

        {/* 푸터 */}
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-7 py-4 border-t border-[#E9E9E7] bg-white">
          <div className="mr-auto min-w-0">
            <WorkspaceSaveStatus lastSavedAt={Math.max(lastSavedAt ?? 0, workspace?.updatedAt ?? 0)} offerReflection={isHost && offerReflection} busy={saving || sending} onReflect={handleSendArtifact} />
            {notice && <p role="status" className="mt-1 text-sm text-[#137333]">{notice}</p>}
          </div>
          <MD3Button variant="tonal" tone="blue" onClick={handleSaveAll} disabled={saving || sending} icon={<FloppyDisk size={MD3_ICON.sm} />}>
            {saving ? '저장 중…' : '초안 저장'}
          </MD3Button>
          <MD3Button variant="text" tone="neutral" onClick={onClose}>
            닫기
          </MD3Button>
          <MD3Button
            variant="filled"
            tone="blue"
            onClick={handleSendArtifact}
            disabled={sending || saving}
            icon={sending ? <FloppyDisk size={MD3_ICON.sm} /> : <PaperPlaneRight size={MD3_ICON.sm} weight="fill" />}
          >
            {sending ? '보내는 중…' : isHost ? '산출물로 보내기' : '방장에게 반영 요청'}
          </MD3Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export { type CoeditWorkspace }
