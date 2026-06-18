'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkle, X, ChatCircleDots } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import {
  setCollaborativePromptDraft,
  watchCollaborativePromptDraft,
  clearCollaborativePromptDraft,
  type CollaborativePromptScope,
  type CollaborativePromptEntry,
} from '@/lib/firebase/projects'
import { AutoGrowTextarea } from './workspaceHelpers'

export interface CollaborativePromptMember {
  uid: string
  displayName: string
  color?: string
}

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  scope: CollaborativePromptScope
  currentUid?: string
  currentUserName?: string
  currentUserColor?: string
  /** 팀원 명단. 자기 자신도 포함해 전체가 표시된다(자기 행은 본인이 편집, 나머지는 read-only). */
  members: CollaborativePromptMember[]
  /** 모달 제목 (예: "AI에게 구체적으로 요청하기"). */
  title?: string
  /** 부제 — 어떤 산출물 단계에 대한 요청인지 짧게. */
  subtitle?: string
  /** AI 제안 받기 호출 — 입력값 배열을 받는다. 호출 성공 시 모달 자동 닫기 + draft clear. */
  onSubmit: (prompts: Array<{ uid: string; teacherName: string; text: string }>) => Promise<void> | void
}

/**
 * 협업 프롬프트 모달.
 * - 팀원 수만큼 행 (이름 + textarea + 작성자 색상)
 * - 자기 행만 본인 편집 가능 (다른 팀원 행은 read-only, 실시간 갱신)
 * - 모든 입력이 firestore subcollection `<scope>PromptDraft`에 실시간 동기화
 * - 하단 "AI 제안 받기" 버튼으로 모든 행을 합쳐 호출
 */
export function CollaborativePromptModal({
  open,
  onClose,
  projectId,
  scope,
  currentUid,
  currentUserName,
  currentUserColor,
  members,
  title = 'AI에게 구체적으로 요청하기',
  subtitle,
  onSubmit,
}: Props) {
  const [entries, setEntries] = useState<Record<string, CollaborativePromptEntry>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // 체크된 멤버 uid 집합 — 이 멤버들의 프롬프트만 AI에 전송한다.
  // 사용자가 직접 토글하지 않은 경우 "텍스트가 비어있지 않은 행"을 자동 체크 (편의).
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())
  // 사용자가 명시적으로 토글한 uid — 자동 체크 갱신 시 이 집합의 uid는 사용자 결정 존중
  const [manualUids, setManualUids] = useState<Set<string>>(new Set())

  // 실시간 구독
  useEffect(() => {
    if (!open || !projectId) return
    const unsub = watchCollaborativePromptDraft(projectId, scope, (next) => {
      setEntries(next)
    })
    return () => { unsub() }
  }, [open, projectId, scope])

  // 모달 닫힐 때 (자기 행 비어있으면 자동 삭제) — 다른 팀원 행은 보존
  useEffect(() => {
    if (open) return
    setError('')
  }, [open])

  // 자기 행 로컬 상태 — onSnapshot이 있지만 본인 타이핑 latency 줄이려 별도 관리
  const myUid = currentUid ?? ''
  const myEntry = entries[myUid]
  const [myText, setMyText] = useState(myEntry?.text ?? '')

  // text가 있는 멤버는 자동으로 체크 (사용자가 manual로 토글한 멤버는 그 결정 존중)
  useEffect(() => {
    setSelectedUids(prev => {
      const next = new Set(prev)
      for (const m of members) {
        if (manualUids.has(m.uid)) continue // 사용자가 직접 토글한 건 그대로
        const isMe = m.uid === myUid
        const text = isMe ? myText : (entries[m.uid]?.text ?? '')
        if (text.trim().length > 0) next.add(m.uid)
        else next.delete(m.uid)
      }
      return next
    })
  }, [entries, members, myUid, myText, manualUids])

  function toggleSelect(uid: string) {
    setManualUids(prev => new Set(prev).add(uid))
    setSelectedUids(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  // 원격 entry가 갱신되면 (다른 기기에서 본인이 수정) local에 동기화. 단 본인이 편집 중일 때는 보존.
  useEffect(() => {
    if (myEntry?.text !== undefined && myText === '' && myEntry.text !== '') {
      setMyText(myEntry.text)
    }
  }, [myEntry?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  const persistMyText = (text: string) => {
    if (!projectId || !myUid) return
    setCollaborativePromptDraft(projectId, scope, myUid, {
      uid: myUid,
      displayName: currentUserName ?? '나',
      color: currentUserColor ?? '#1A73E8',
      text,
      updatedAt: Date.now(),
    }).catch(console.error)
  }

  const handleSubmit = async () => {
    setError('')
    // members 순서대로 합치되 자기 행은 localText 최신값 사용. 체크된 멤버만 포함.
    const prompts = members.map(m => {
      const isMe = m.uid === myUid
      const text = isMe ? myText.trim() : (entries[m.uid]?.text ?? '').trim()
      return {
        uid: m.uid,
        teacherName: (m.displayName || '팀원').trim(),
        text,
      }
    }).filter(p => selectedUids.has(p.uid) && p.text.length > 0)

    if (prompts.length === 0) {
      setError('체크된 행 중에 입력된 요청 내용이 없습니다. 최소 한 명 이상의 행을 체크하고 내용을 입력해주세요.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(prompts)
      // 성공 시 draft 일괄 삭제 (다음 사용을 위해)
      await clearCollaborativePromptDraft(projectId, scope).catch(() => {})
      setMyText('')
      onClose()
    } catch (err) {
      console.error('[CollaborativePromptModal submit]', err)
      setError(err instanceof Error ? err.message : '요청을 보내지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const sortedMembers = useMemo(() => {
    // 자기 자신을 맨 위로
    const me = members.find(m => m.uid === myUid)
    const others = members.filter(m => m.uid !== myUid)
    return me ? [me, ...others] : others
  }, [members, myUid])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[9400] flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div
        className="bg-white w-full max-w-[720px] max-h-[88vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col"
        onClick={event => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E8EAED] bg-white flex items-center gap-3 flex-shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#1A73E8] to-[#7B2FF7] px-3 py-1.5 text-[12px] font-extrabold text-white">
            <ChatCircleDots size={14} weight="fill" />
            협업 프롬프트
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-extrabold text-[#202124] truncate">{title}</p>
            {subtitle && <p className="text-[11px] text-[#5F6368] truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] flex items-center justify-center transition-colors"
            aria-label="닫기"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-[12px] text-[#5F6368] leading-relaxed">
            각자 자기 행에 AI에게 전달할 추가 요청을 적어주세요. 다른 팀원의 입력은 실시간으로 보입니다.
            각 행 왼쪽 <b>체크박스</b>로 AI에 보낼 의견을 선택할 수 있습니다 — 텍스트가 입력되면 자동 체크되며, 수동으로 토글할 수 있습니다.
          </p>

          {sortedMembers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#DADCE0] px-4 py-6 text-center text-[12px] text-[#9AA0A6]">
              팀원 정보가 아직 로드되지 않았습니다.
            </div>
          ) : sortedMembers.map(m => {
            const isMe = m.uid === myUid
            const entry = entries[m.uid]
            const color = entry?.color ?? m.color ?? '#9AA0A6'
            const isSelected = selectedUids.has(m.uid)
            const hasText = isMe ? myText.trim().length > 0 : (entry?.text ?? '').trim().length > 0
            return (
              <div key={m.uid} className={cn(
                'rounded-xl border px-3 py-2.5 transition-colors',
                isSelected ? 'border-[#1A73E8]/40 bg-[#F8FBFF]' : 'border-[#E8EAED] bg-white',
              )}>
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    onClick={() => toggleSelect(m.uid)}
                    aria-label={isSelected ? '선택 해제' : '선택'}
                    title={hasText ? '체크 시 이 의견을 AI에 함께 전달' : '내용이 비어 있어 체크해도 무시됩니다'}
                    className={cn(
                      'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors',
                      isSelected ? 'bg-[#1A73E8] text-white border border-[#1A73E8]' : 'bg-white text-transparent border border-[#9AA0A6] hover:border-[#1A73E8]',
                    )}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm"
                        style={{ color, backgroundColor: `${color}18` }}
                      >
                        {m.displayName || '팀원'} {isMe && <span className="ml-1 text-[10px] text-[#1A73E8]">· 나</span>}
                      </span>
                      {!isMe && entry?.updatedAt && (
                        <span className="text-[10px] text-[#9AA0A6]">{new Date(entry.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 업데이트</span>
                      )}
                      {!isSelected && hasText && (
                        <span className="text-[10px] font-semibold text-[#9AA0A6]">· 미선택(전송 제외)</span>
                      )}
                    </div>
                    {isMe ? (
                      <AutoGrowTextarea
                        value={myText}
                        onChange={event => {
                          setMyText(event.target.value)
                          persistMyText(event.target.value)
                        }}
                        minRows={2}
                        placeholder="예: 학생 주도성을 더 강조해주세요 / 평가는 형성평가 중심으로 / ..."
                        className="w-full rounded-md border border-[#E8EAED] bg-white px-3 py-2 text-[13px] text-[#202124] leading-relaxed focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/20"
                      />
                    ) : (
                      <div className={cn(
                        'min-h-[44px] rounded-md border border-[#E8EAED] bg-[#F8F9FA] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                        entry?.text ? 'text-[#3C4043]' : 'text-[#9AA0A6] italic'
                      )}>
                        {entry?.text || '(아직 입력하지 않았습니다)'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {error && (
            <p className="text-[12px] font-semibold text-[#C5221F]">{error}</p>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-[#E8EAED] bg-white px-6 py-3 flex items-center gap-2">
          {(() => {
            const checkedWithText = members.filter(m => {
              if (!selectedUids.has(m.uid)) return false
              const isMe = m.uid === myUid
              const t = isMe ? myText : (entries[m.uid]?.text ?? '')
              return t.trim().length > 0
            })
            return (
              <span className="text-[12px] font-bold text-[#5F6368]">
                선택 {checkedWithText.length}<span className="text-[#9AA0A6]">/{members.length}</span>명
                <span className="ml-2 text-[10px] font-semibold text-[#9AA0A6]">체크된 의견만 AI에 전달됩니다</span>
              </span>
            )
          })()}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#DADCE0] bg-white px-4 py-2 text-[12px] font-bold text-[#5F6368] hover:bg-[#F1F3F4]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#1A73E8] to-[#7B2FF7] px-4 py-2 text-[12px] font-extrabold text-white shadow-sm transition-opacity disabled:opacity-50"
          >
            <Sparkle size={14} weight="fill" />
            {submitting ? '제안 받는 중...' : '이 요청으로 AI 제안 받기'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
