'use client'

// #S1: 공동 편집 창을 열 때 저장된 산출물과 공동 초안을 맞춘다(12개 전용 창 공용).
// - 산출물이 더 새로우면 산출물 기준으로, 초안이 더 새로우면 초안의 빈 칸만 산출물로 채운다.
// - 다른 선생님이 같은 창을 편집 중이면 자동으로 바꾸지 않고 배너로 고르게 한다.
// - 초안을 산출물로 바꾸기 전에 이전 초안을 프로젝트에 보관한다(손실 0). 실시간 표는 commit 의 CRDT diff 로 바뀐다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useProjectStore } from '@/store/project'
import { backupWorkspaceDraft } from '@/lib/firebase/projects'
import { artifactSavedAt, decideArtifactDraft, stabilizeRowIds, structuredArtifactContent, type DraftAction } from '@/lib/coedit/artifactDraft'
import { isBlankWorkspace } from '@/lib/coedit/workspaceBlank'
import { MD3Button } from '@/components/ui/MD3Button'

/** 자동 판단 전 presence 가 도착할 시간을 준다(혼자인지 확인). */
export const ARTIFACT_DRAFT_SETTLE_MS = 1200

type Pending<W> = { kind: DraftAction | 'offer'; target: W; error?: string }

export function useArtifactDraftSync<W>({
  open, projectId, activityCode, workspaceField, workspace, incoming, savedWorkspace, artifactContent,
  normalize, realtime, othersEditing, currentUid, apply,
}: {
  open: boolean
  projectId?: string
  activityCode: string
  workspaceField: string
  /** 화면의 현재 초안(실시간이면 CRDT 내용) */
  workspace: W
  /** 서버 초안 기준 화면 상태(일반 저장 경로) */
  incoming: W
  savedWorkspace?: { updatedAt?: number } | null
  artifactContent?: Record<string, unknown>
  normalize: (workspace?: W, artifactContent?: Record<string, unknown>) => W
  realtime: { enabled: boolean; ready: boolean }
  othersEditing: boolean
  currentUid?: string
  /** 통째 교체 저장(창의 commit replace-all) */
  apply: (next: W) => Promise<void>
}): { banner: ReactNode } {
  const project = useProjectStore(state => state.project)
  const meta = project?.artifacts?.[activityCode]
  const crdt = ((project as unknown as Record<string, unknown> | null)?.coeditWorkspaceCrdt as Record<string, { savedAt?: number }> | undefined)?.[workspaceField]
  const [pending, setPending] = useState<Pending<W> | null>(null)
  const [busy, setBusy] = useState(false)
  const decidedRef = useRef(false)
  const latest = useRef({ workspace, incoming, savedWorkspace, artifactContent, meta, crdt, normalize, othersEditing, apply, realtime, projectId, currentUid })
  useEffect(() => {
    latest.current = { workspace, incoming, savedWorkspace, artifactContent, meta, crdt, normalize, othersEditing, apply, realtime, projectId, currentUid }
  })

  async function run(target: W, action: DraftAction | 'offer', draft: W): Promise<boolean> {
    const L = latest.current
    if ((action === 'replace' || action === 'offer') && !isBlankWorkspace(draft) && L.projectId) {
      try {
        const result = await backupWorkspaceDraft(L.projectId, workspaceField, draft, `artifact-${action}`, L.currentUid)
        if (result === 'too-large') {
          try { localStorage.setItem(`tcid:draft-backup:${L.projectId}:${workspaceField}:${Date.now()}`, JSON.stringify(draft)) } catch { /* 보관 실패면 아래에서 중단 */ return false }
        }
      } catch (error) {
        console.warn('[artifact-draft] backup failed', error)
        return false
      }
    }
    await L.apply(target)
    return true
  }

  useEffect(() => {
    if (!open) { decidedRef.current = false; setPending(null); return }
    if (decidedRef.current || (realtime.enabled && !realtime.ready)) return
    const timer = setTimeout(() => {
      const L = latest.current
      decidedRef.current = true
      const draft = L.realtime.enabled ? L.workspace : L.incoming
      const structured = structuredArtifactContent(activityCode, L.artifactContent ?? L.meta?.content ?? undefined)
      const artifactAt = artifactSavedAt(L.meta)
      const artifactWorkspace = structured ? stabilizeRowIds(L.normalize(undefined, structured), draft, String(artifactAt ?? activityCode)) : undefined
      const draftAt = L.realtime.enabled ? (L.crdt?.savedAt ?? undefined) : L.savedWorkspace?.updatedAt
      const decision = decideArtifactDraft({ draft, artifactWorkspace, draftAt, artifactAt })
      const offer = decision.offer ? { kind: 'offer' as const, target: decision.offer } : null
      if (decision.action === 'keep') { setPending(offer); return }
      if (L.othersEditing) { setPending({ kind: decision.action, target: decision.target }); return }
      void run(decision.target, decision.action, draft).then(ok => {
        setPending(ok ? offer : { kind: decision.action, target: decision.target, error: '이전 초안을 보관하지 못해 바꾸지 않았어요.' })
      })
    }, ARTIFACT_DRAFT_SETTLE_MS)
    return () => clearTimeout(timer)
    // 열 때 한 번만 판단한다(실시간은 연결이 준비된 뒤).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, realtime.enabled, realtime.ready, activityCode, workspaceField])

  if (!pending) return { banner: null }
  const copy = pending.kind === 'replace'
    ? { text: '저장된 산출물이 공동 초안보다 최신이에요. 다른 선생님이 편집 중이라 자동으로 바꾸지 않았어요.', action: '산출물 최신 내용 불러오기', dismiss: '지금 초안 유지' }
    : pending.kind === 'fill'
      ? { text: '공동 초안의 빈 칸을 저장된 산출물 내용으로 채울 수 있어요.', action: '빈 칸 채우기', dismiss: '닫기' }
      : { text: '저장된 산출물과 공동 초안 내용이 달라요. 산출물 내용으로 바꿀 수 있어요.', action: '산출물 내용 불러오기', dismiss: '초안 유지' }
  const banner = (
    <div role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#F9AB00]/50 bg-[#FEF7E0] px-4 py-2.5 text-[14px] text-[#3C4043]">
      <span className="min-w-0 flex-1">{copy.text} 바꾸기 전 초안은 보관돼요.</span>
      <MD3Button variant="filled" size="xs" disabled={busy} onClick={async () => {
        setBusy(true)
        const ok = await run(pending.target, pending.kind, latest.current.workspace).catch(() => false)
        setBusy(false)
        setPending(ok ? null : { ...pending, error: '이전 초안을 보관하지 못해 바꾸지 않았어요. 잠시 후 다시 시도해 주세요.' })
      }}>{busy ? '불러오는 중…' : copy.action}</MD3Button>
      <MD3Button variant="text" tone="neutral" size="xs" disabled={busy} onClick={() => setPending(null)}>{copy.dismiss}</MD3Button>
      {pending.error && <span role="alert" className="w-full text-[13px] text-[#C5221F]">{pending.error}</span>}
    </div>
  )
  return { banner }
}
