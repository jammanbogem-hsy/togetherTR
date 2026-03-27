'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, STAGES, type ActivityType, type ActivityCode } from '@/types'
import { ACTIVITY_WELCOME } from '@/lib/prompts/system'
import { saveMessage, setTeamDiscussion, setOptionVote, advanceActivity, returnToActivity, requestTeamDiscussion, clearTeamDiscussionRequest, setStreamingState, clearStreamingState, watchStreamingState, setProjectArtifact } from '@/lib/firebase/projects'
import { TeamDiscussionBanner } from './TeamDiscussionBanner'
import { TeamDiscussionProposal } from './TeamDiscussionProposal'
import { ArtifactSaveProposal } from './ArtifactSaveProposal'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ListChecks, CheckCircle, Shield, Star, ArrowBendUpLeft, Chat,
  Users, StopCircle, SpinnerGap, PaperPlaneRight, Warning, X,
} from '@phosphor-icons/react'

const STAGE_CORNER: Record<string, string> = {
  T: 'rgba(26,115,232,0.09)', A: 'rgba(123,31,162,0.08)', Ds: 'rgba(0,137,123,0.08)',
  DI: 'rgba(230,81,0,0.08)', E: 'rgba(198,40,40,0.08)',
}

// ─── 안(案) 선택지 파싱 ──────────────────────────────
interface ParsedOption { label: string; content: string }
interface ParsedOptions { pre: string; options: ParsedOption[]; post: string }

function parseOptions(text: string): ParsedOptions | null {
  // **A안:** "..." 또는 **A안**: "..." 형식 감지 (콜론이 볼드 안/밖 모두 지원)
  const regex = /\*\*([A-Za-z0-9]+안):?\*\*\s*:?\s*"([^"]+)"/g
  const options: ParsedOption[] = []
  const matches = [...text.matchAll(regex)]
  if (matches.length < 2) return null

  for (const m of matches) {
    options.push({ label: m[1], content: m[2].trim() })
  }

  const firstIdx = matches[0].index!
  const lastMatch = matches[matches.length - 1]
  const lastIdx = lastMatch.index! + lastMatch[0].length

  return {
    pre: text.slice(0, firstIdx).trim(),
    options,
    post: text.slice(lastIdx).trim(),
  }
}

// ─── 안 선택 카드 렌더러 ─────────────────────────────
const OPTION_COLORS = [
  { bg: 'bg-[#E8F0FE]', border: 'border-[#AECBFA]', badge: 'bg-[#1A73E8]', btn: 'bg-[#1A73E8] hover:bg-[#1557b0]' },
  { bg: 'bg-[#F3E5F5]', border: 'border-[#CE93D8]', badge: 'bg-[#7B1FA2]', btn: 'bg-[#7B1FA2] hover:bg-[#6a1790]' },
  { bg: 'bg-[#E0F2F1]', border: 'border-[#80CBC4]', badge: 'bg-[#00897B]', btn: 'bg-[#00897B] hover:bg-[#00746a]' },
  { bg: 'bg-[#FFF3E0]', border: 'border-[#FFCC80]', badge: 'bg-[#E65100]', btn: 'bg-[#E65100] hover:bg-[#cc4700]' },
]

type MemberInfoMap = Record<string, { displayName: string; color: string; emoji: string }>

// ─── 팀원 투표 오버레이 바 ───────────────────────────
function VoteOverlayBar({
  messageId, options, votes, memberInfo, currentUid, projectId,
}: {
  messageId: string
  options: ParsedOption[]
  votes: Record<string, string>
  memberInfo: MemberInfoMap
  currentUid: string
  projectId: string
}) {
  const myVote = votes[currentUid] ?? null

  async function handleVote(label: string) {
    const next = myVote === label ? null : label
    await setOptionVote(projectId, messageId, currentUid, next).catch(console.error)
  }

  return (
    <div className="sticky bottom-2 z-10 mx-1 bg-white border border-[#FFCC80] rounded-2xl shadow-md p-3">
      <p className="text-xs font-bold text-[#E65100] mb-2.5 flex items-center gap-1.5">
        <ListChecks size={16} weight="fill" className="text-[#E65100]" />
        어느 안을 지지하시나요? <span className="font-normal text-[#E65100] opacity-70">팀장의 최종 결정에 참고됩니다</span>
      </p>
      <div className="flex gap-2 flex-wrap">
        {options.map((opt, i) => {
          const c = OPTION_COLORS[i % OPTION_COLORS.length]
          const isVoted = myVote === opt.label
          // other voters for display
          const others = Object.entries(votes)
            .filter(([uid, v]) => uid !== currentUid && v === opt.label)
            .map(([uid]) => memberInfo[uid] ?? { displayName: uid.slice(0, 4), color: '#6B7280', emoji: '👤' })
          return (
            <button
              key={opt.label}
              onClick={() => handleVote(opt.label)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all border',
                isVoted
                  ? cn(c.badge, 'text-white border-transparent shadow-sm scale-105')
                  : cn('bg-white', c.border, 'text-[#3C4043] hover:scale-105')
              )}
            >
              <span className="text-sm font-bold">{opt.label}</span>
              {isVoted && <CheckCircle size={16} weight="fill" />}
              {others.length > 0 && (
                <span className="flex items-center gap-1 ml-1">
                  {others.slice(0, 3).map((m, j) => (
                    <span key={j} className="flex items-center gap-1">
                      <span
                        className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center text-white ring-1 ring-white flex-shrink-0"
                        style={{ backgroundColor: m.color }}
                      >
                        {m.emoji}
                      </span>
                      <span className="text-xs font-semibold text-gray-900">{m.displayName}</span>
                    </span>
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {myVote && (
        <button
          onClick={() => setOptionVote(projectId, messageId, currentUid, null).catch(console.error)}
          className="mt-2 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          지지 취소
        </button>
      )}
    </div>
  )
}

function OptionsMessage({
  messageId, pre, options, post, onSelect,
  votes, memberInfo, currentUid, isHost,
}: ParsedOptions & {
  messageId: string
  onSelect: (label: string, content: string) => void
  votes: Record<string, string>
  memberInfo: MemberInfoMap
  currentUid: string
  isHost: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const myVote = votes[currentUid] ?? null

  function handleFinalSelect(label: string, content: string) {
    if (selected) return
    setSelected(label)
    onSelect(label, content)
  }

  return (
    <div className="flex gap-2 mb-3">
      <div className="w-11 h-11 rounded-full bg-[#202124] text-white flex items-center justify-center text-sm font-extrabold flex-shrink-0 shadow-md self-start"
        style={{ animation: 'avatar-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
        AI
      </div>
      <div className="max-w-[85%] flex flex-col gap-3 flex-1">
        {pre && (
          <div className="bg-[#EAF2FF] text-[#1a2e5a] px-4 py-2.5 rounded-2xl rounded-tl-none border-l-[3px] border-[#4285F4] text-sm leading-relaxed">
            <MarkdownContent text={pre} />
          </div>
        )}

        {options.map((opt, i) => {
          const c = OPTION_COLORS[i % OPTION_COLORS.length]
          const isChosen = selected === opt.label
          const isDimmed = selected && !isChosen
          // all voters for this option (including self)
          const voters = Object.entries(votes)
            .filter(([, v]) => v === opt.label)
            .map(([uid]) => ({
              uid,
              isSelf: uid === currentUid,
              ...(memberInfo[uid] ?? { displayName: uid.slice(0, 4), color: '#6B7280', emoji: '👤' }),
            }))
          return (
            <div
              key={opt.label}
              className={cn(
                'rounded-2xl border-2 p-3 transition-all',
                c.bg, c.border,
                isDimmed && 'opacity-40',
                isChosen && 'ring-2 ring-offset-1 ring-current',
              )}
            >
              <div className="flex items-start gap-2.5">
                <span className={cn('flex-shrink-0 text-xs font-bold text-white px-2 py-0.5 rounded-full mt-0.5', c.badge)}>
                  {opt.label}
                </span>
                <p className="flex-1 text-sm text-gray-800 leading-relaxed">"{opt.content}"</p>
              </div>

              {/* 투표 현황: 이 안을 지지한 팀원들 */}
              {voters.length > 0 && (
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  {voters.map(v => (
                    <span
                      key={v.uid}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-gray-900',
                        v.isSelf ? 'bg-white ring-2 shadow-sm' : 'bg-white bg-opacity-80'
                      )}
                      style={v.isSelf ? { outline: `2px solid ${v.color}` } : undefined}
                      title={v.displayName}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] flex-shrink-0"
                        style={{ backgroundColor: v.color }}
                      >
                        {v.emoji}
                      </span>
                      {v.displayName}
                      {v.isSelf && <span className="text-[10px] text-gray-400">(나)</span>}
                    </span>
                  ))}
                </div>
              )}

              {/* 호스트만: 최종 결정 버튼 */}
              {isHost && (
                <div className="mt-2.5 flex justify-end">
                  {isChosen ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-[#34A853]">
                      <CheckCircle size={16} weight="fill" className="text-[#34A853]" /> 선택됨
                    </span>
                  ) : (
                    <button
                      onClick={() => handleFinalSelect(opt.label, opt.content)}
                      disabled={!!selected}
                      className={cn(
                        'text-xs font-bold text-white px-4 py-1.5 rounded-full transition-colors disabled:cursor-not-allowed',
                        c.btn
                      )}
                    >
                      이 안으로 결정
                    </button>
                  )}
                </div>
              )}

              {/* 팀원: 내가 지지한 안 표시 (투표는 오버레이에서) */}
              {!isHost && myVote === opt.label && (
                <div className="mt-2.5 flex justify-end">
                  <span className="flex items-center gap-1 text-xs font-semibold text-[#5F6368]">
                    <CheckCircle size={16} weight="fill" className="text-[#34A853]" /> 내가 지지
                  </span>
                </div>
              )}
            </div>
          )
        })}

        {post && (
          <div className="bg-[#EAF2FF] text-[#1a2e5a] px-4 py-2.5 rounded-2xl rounded-tl-none border-l-[3px] border-[#4285F4] text-sm leading-relaxed">
            <MarkdownContent text={post} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 마크다운 렌더러 ─────────────────────────────────
function MarkdownContent({ text, dark = false }: { text: string; dark?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => {
          const text = typeof children === 'string' ? children : String(children ?? '')
          const isPending = /미결|보류|결정 필요|추후 결정/.test(text)
          return (
            <span className={cn(
              'inline-block px-1.5 py-0.5 rounded-md text-[13px] font-semibold leading-snug mx-0.5',
              dark
                ? 'bg-white/25 text-white'
                : isPending
                  ? 'bg-[#FFF3E0] text-[#E65100]'   // 미결·보류 → 주황 파스텔
                  : 'bg-[#E8F0FE] text-[#1A73E8]'   // 일반 강조 → 파란 파스텔
            )}>
              {children}
            </span>
          )
        },
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="mt-1.5 mb-1.5 space-y-1 pl-4 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="mt-1.5 mb-1.5 space-y-1.5 pl-4 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ children }) => (
          <code className={cn('px-1.5 py-0.5 rounded text-xs font-mono', dark ? 'bg-white/20' : 'bg-gray-200 text-gray-800')}>
            {children}
          </code>
        ),
        // 테이블 렌더링
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-xl border border-[#DADCE0]">
            <table className="min-w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className={dark ? 'bg-white/20' : 'bg-[#F8F9FA]'}>{children}</thead>
        ),
        tbody: ({ children }) => <tbody className="divide-y divide-[#F1F3F4]">{children}</tbody>,
        tr: ({ children }) => <tr className="hover:bg-[#F8F9FA]/50 transition-colors">{children}</tr>,
        th: ({ children }) => (
          <th className="px-3 py-2.5 text-left text-xs font-bold text-[#5F6368] uppercase tracking-wider whitespace-nowrap border-b border-[#DADCE0]">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed">{children}</td>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

// ─── 분석 결과 → 산출물 섹션 파싱 ───────────────────
function parseAnalysisToSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = text.split('\n')
  let currentKey = ''
  let buffer: string[] = []

  const flush = () => {
    if (currentKey && buffer.length) {
      sections[currentKey] = buffer.join('\n').trim()
    }
  }

  for (const line of lines) {
    if (/^1\.|^1\./.test(line) || line.includes('합의한 핵심')) {
      flush(); currentKey = '합의 내용'; buffer = []
    } else if (/^2\./.test(line) || line.includes('결정되지 않')) {
      flush(); currentKey = '미결 사항'; buffer = []
    } else if (/^3\./.test(line) || line.includes('추천 행동') || line.includes('다음 단계')) {
      flush(); currentKey = '다음 행동'; buffer = []
    } else if (currentKey && line.trim()) {
      buffer.push(line.replace(/^[-·☐\s]+/, '').trim())
    }
  }
  flush()
  return sections
}

// ─── TEAM_DISCUSSION_READY 파싱 ──────────────────────
function parseDiscussionSignal(text: string): { topic: string; cleanText: string } | null {
  const match = text.match(/\[TEAM_DISCUSSION_READY:\s*(.+?)\]/)
  if (!match) return null
  return {
    topic: match[1].trim(),
    cleanText: text.replace(/\n*\[TEAM_DISCUSSION_READY:[^\]]+\]/, '').trimEnd(),
  }
}

// ─── ACTIVITY_ADVANCE 파싱 ───────────────────────────
function parseActivityAdvance(text: string): { nextActivity: string; cleanText: string } | null {
  const match = text.match(/\[ACTIVITY_ADVANCE:\s*([A-Za-z0-9-]+)\]/)
  if (!match) return null
  return {
    nextActivity: match[1].trim(),
    cleanText: text.replace(/\n*\[ACTIVITY_ADVANCE:[^\]]+\]/, '').trimEnd(),
  }
}

// ─── ACTIVITY_RETURN 파싱 ────────────────────────────
function parseActivityReturn(text: string): { targetActivity: string; cleanText: string } | null {
  const match = text.match(/\[ACTIVITY_RETURN:\s*([A-Za-z0-9-]+)\]/)
  if (!match) return null
  return {
    targetActivity: match[1].trim(),
    cleanText: text.replace(/\n*\[ACTIVITY_RETURN:[^\]]+\]/, '').trimEnd(),
  }
}

// ─── 저장 의도 감지 (신호 없이 "저장하겠습니다"만 있는 경우) ──
// "저장하겠습니다" 문장 주변 2문장만 스캔해서 실제 내용만 추출
function parseSaveIntent(text: string): { title: string; sections: Record<string, string> } | null {
  const savePattern = /저장하겠습니다|산출물에 저장|수정하여 저장|기록하겠습니다|저장해드리겠습니다|저장할게요|저장합니다/
  const saveMatch = savePattern.exec(text)
  if (!saveMatch) return null

  // 저장 문장 앞뒤 300자만 스캔 (전체 텍스트 스캔 시 무관한 내용 오염 방지)
  const start = Math.max(0, saveMatch.index - 300)
  const end = Math.min(text.length, saveMatch.index + 300)
  const localText = text.slice(start, end)

  const isNoise = (val: string) => [
    '저장', '보완', '유지하겠', '수정하겠', '진행하겠', '넘어가겠', '이동하겠',
    '누락된', '다음 행동', '미결 사항', '역할 확인', '배정 필요', '역할 매핑',
  ].some(w => val.includes(w))

  const sections: Record<string, string> = {}

  // 1순위: 큰따옴표 안의 핵심 문장 (비전, 합의 내용 등)
  const quotedPattern = /"([^"]{8,120})"/g
  const quoted: string[] = []
  let m: RegExpExecArray | null
  while ((m = quotedPattern.exec(localText)) !== null) {
    const val = m[1].trim()
    if (!val.includes('[') && !val.includes(']') && !isNoise(val)) {
      quoted.push(val)
    }
  }

  // 2순위: "변경 후:", "저장 내용:", "내용:" 뒤의 문장
  const labelPattern = /(?:변경\s*후|저장\s*내용|내용|합의)\s*[:：]\s*"?([^"\n]{8,120})"?/g
  const labeled: string[] = []
  while ((m = labelPattern.exec(localText)) !== null) {
    const val = m[1].trim()
    if (!isNoise(val)) labeled.push(val)
  }

  const content = quoted.length > 0
    ? quoted.join('\n')
    : labeled.length > 0
    ? labeled.join('\n')
    : null

  if (!content) return null
  sections['합의 내용'] = content
  return { title: '산출물 저장 확인', sections }
}

// ─── ARTIFACT_CONFIRM 파싱 ───────────────────────────
// [ARTIFACT_CONFIRM]        → 현재 활동 산출물 확정
// [ARTIFACT_CONFIRM@T-2-2]  → 지정 활동 산출물 확정
function parseArtifactConfirm(text: string): { codes: string[]; cleanText: string } {
  const regex = /\[ARTIFACT_CONFIRM(?:@([A-Za-z0-9-]+))?\]/g
  const codes: string[] = []
  let match
  while ((match = regex.exec(text)) !== null) {
    codes.push(match[1] ?? '') // empty string = current activity
  }
  const cleanText = codes.length > 0
    ? text.replace(/\n*\[ARTIFACT_CONFIRM(?:@[A-Za-z0-9-]+)?\]/g, '').trimEnd()
    : text
  return { codes, cleanText }
}

// ─── ARTIFACT_UPDATE 파싱 ────────────────────────────
// [ARTIFACT_UPDATE: 섹션명=내용]          → 현재 활동에 저장
// [ARTIFACT_UPDATE@T-2-2: 섹션명=내용]   → 지정 활동에 저장 (크로스 활동 수정)
const ARTIFACT_BLOCKED_KEYS = [
  '다음 행동', '다음 단계', 'next step',
  '미결 사항', '미결', '보류 사항',
  'ai 제안', '추천 사항', '참고 사항',
  '합의 내용', '논의 내용', '토론 내용', '확인 사항',
  '진행 내용', '진행 사항', '현황', '요약',
]

interface ArtifactUpdateItem {
  activityCode?: string   // undefined = 현재 활동
  sections: Record<string, string>
}

function parseArtifactUpdates(text: string): { updates: ArtifactUpdateItem[]; cleanText: string } {
  // actCode key → sections 버킷
  const buckets: Record<string, Record<string, string>> = {}
  // [ARTIFACT_UPDATE@CODE: key=val] 또는 [ARTIFACT_UPDATE: key=val]
  const regex = /\[ARTIFACT_UPDATE(?:@([A-Za-z0-9-]+))?:\s*([^=\]]+)=([^\]]+)\]/g
  let match
  let cleanText = text

  while ((match = regex.exec(text)) !== null) {
    const actKey = match[1] ?? '__current__'
    const keyRaw = match[2].trim().toLowerCase()
    if (ARTIFACT_BLOCKED_KEYS.some(k => keyRaw.includes(k))) continue
    const key = match[2].trim()
    const value = match[3].trim()
    if (!buckets[actKey]) buckets[actKey] = {}
    buckets[actKey][key] = value
  }

  const updates: ArtifactUpdateItem[] = Object.entries(buckets).map(([code, sections]) => ({
    activityCode: code === '__current__' ? undefined : code,
    sections,
  }))

  if (updates.some(u => Object.keys(u.sections).length > 0)) {
    cleanText = text.replace(/\n*\[ARTIFACT_UPDATE(?:@[A-Za-z0-9-]+)?:[^\]]+\]/g, '').trimEnd()
  }
  return { updates, cleanText }
}

// ─── 활동유형 태그 ────────────────────────────────────
const TAG_COLORS: Record<ActivityType, string> = {
  '제시':    'bg-gray-100 text-gray-600',
  '탐색':    'bg-blue-100 text-blue-700',
  '생성':    'bg-indigo-100 text-indigo-700',
  '시각화':  'bg-cyan-100 text-cyan-700',
  '공유·협의':'bg-teal-100 text-teal-700',
  '조정':    'bg-amber-100 text-amber-700',
  '점검':    'bg-yellow-100 text-yellow-700',
  '성찰':    'bg-purple-100 text-purple-700',
  '판단':    'bg-red-100 text-red-700',
  '기록':    'bg-green-100 text-green-700',
}

function ActivityTag({ type }: { type: ActivityType }) {
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', TAG_COLORS[type])}>
      {type}
    </span>
  )
}

// ─── 공통 컨텍스트 메뉴 래퍼 ────────────────────────
function ContextMenuWrapper({ children, onReply, className }: {
  children: React.ReactNode
  onReply?: () => void
  className?: string
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)

  function openMenu(clientX: number, clientY: number) {
    const x = Math.min(clientX, window.innerWidth - 148)
    const y = Math.min(clientY, window.innerHeight - 60)
    setMenuPos({ x, y })
  }
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    openMenu(e.clientX, e.clientY)
  }
  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => openMenu(touch.clientX, touch.clientY), 500)
  }
  function handleTouchEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }

  return (
    <>
      <div
        className={className}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        {children}
      </div>
      {menuPos && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setMenuPos(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenuPos(null) }}
          />
          <div
            className="fixed bg-white rounded-2xl shadow-lg border border-[#DADCE0] overflow-hidden"
            style={{ left: menuPos.x, top: menuPos.y, zIndex: 9999, minWidth: 140 }}
          >
            <button
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-[#3C4043] hover:bg-[#F1F3F4] active:bg-[#E8EAED] transition-colors"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onReply?.(); setMenuPos(null) }}
            >
              <ArrowBendUpLeft size={16} weight="regular" className="text-[#5F6368]" />
              <span>답글</span>
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  )
}

// ─── 메시지 버블 ──────────────────────────────────────
function MessageBubble({ role, content, activityType, senderName, senderColor, isSelf, replyTo, onReply }: {
  role: 'user' | 'assistant'
  content: string
  activityType?: ActivityType
  senderName?: string
  senderColor?: string
  senderEmoji?: string
  isSelf?: boolean
  replyTo?: { id: string; content: string; senderName?: string }
  onReply?: () => void
}) {
  const isUser = role === 'user'
  const alignRight = isUser && isSelf
  const avatarColor = senderColor ?? (isUser ? '#A0BCE8' : '#1F2937')
  const isLightColor = avatarColor.startsWith('#') && (() => {
    const r = parseInt(avatarColor.slice(1, 3), 16)
    const g = parseInt(avatarColor.slice(3, 5), 16)
    const b = parseInt(avatarColor.slice(5, 7), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 160
  })()
  const textOnColor = isLightColor ? '#374151' : '#ffffff'

  return (
    <ContextMenuWrapper onReply={onReply} className={cn('flex gap-2 mb-3', alignRight ? 'flex-row-reverse' : 'flex-row')}>
      {/* 아바타 — 상단 정렬, 크게 */}
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-extrabold flex-shrink-0 shadow-md self-start"
        style={{ backgroundColor: avatarColor, color: textOnColor, animation: 'avatar-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
        title={senderName}
      >
        {isUser ? (senderName?.slice(0, 1) ?? '?') : 'AI'}
      </div>

      <div className={cn('max-w-[72%] space-y-0.5', alignRight ? 'items-end' : 'items-start', 'flex flex-col')}>
        {isUser && !isSelf && senderName && (
          <span className="text-xs font-bold px-1 text-gray-700">{senderName}</span>
        )}
        {!isUser && activityType && <ActivityTag type={activityType} />}

        {/* 인용 원문 */}
        {replyTo && (
          <div className={cn(
            'text-xs px-2.5 py-1.5 rounded-xl border-l-4 bg-black/5 text-gray-500 max-w-full',
            alignRight ? 'border-r-4 border-l-0 text-right' : 'border-l-4'
          )} style={{ borderColor: avatarColor }}>
            {replyTo.senderName && (
              <span className="font-semibold text-gray-600 block mb-0.5">{replyTo.senderName}</span>
            )}
            <span className="line-clamp-2">{replyTo.content.replace(/\[.*?\]/g, '').trim().slice(0, 80)}</span>
          </div>
        )}

        <div className={cn(
          'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
          !isUser && 'bg-[#EAF2FF] text-[#1a2e5a] rounded-tl-none border-l-[3px] border-[#4285F4]',
          isUser && (alignRight ? 'rounded-tr-none' : 'rounded-tl-none'),
        )}
          style={isUser ? { backgroundColor: avatarColor, color: textOnColor, filter: 'saturate(1.2) brightness(0.95)' } : undefined}
        >
          {isUser
            ? <span className="whitespace-pre-wrap">{content}</span>
            : <MarkdownContent text={content} />
          }
        </div>
      </div>
    </ContextMenuWrapper>
  )
}

// ─── AI 분석 결과 버블 ────────────────────────────────
function AnalysisBubble({ text }: { text: string }) {
  return (
    <div className="mx-0 my-3">
      <div className="bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-[#00897B] flex items-center justify-center">
            <Users size={14} weight="fill" className="text-white" />
          </div>
          <span className="text-xs font-bold text-[#00695C]">팀 토론 분석 결과</span>
        </div>
        <div className="text-sm text-[#004D40] leading-relaxed">
          <MarkdownContent text={text} />
        </div>
      </div>
    </div>
  )
}

// ─── 스트리밍 버블 ────────────────────────────────────
function StreamingBubble({ text, isAnalysis }: { text: string; isAnalysis?: boolean }) {
  if (!text) return null
  if (isAnalysis) {
    return (
      <div className="mx-0 my-3">
        <div className="bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-[#00897B] flex items-center justify-center">
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={14} className="text-white" /></span>
            </div>
            <span className="text-xs font-bold text-[#00695C]">팀 토론 분석 중...</span>
          </div>
          <div className="text-sm text-[#004D40] leading-relaxed">
            <MarkdownContent text={text} />
            <span className="inline-block w-1 h-4 bg-[#00897B] animate-pulse ml-0.5 align-middle" />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2 mb-3">
      <div className="w-11 h-11 rounded-full bg-[#202124] text-white flex items-center justify-center text-sm font-extrabold flex-shrink-0 shadow-md self-start"
        style={{ animation: 'avatar-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
        AI
      </div>
      <div className="max-w-[75%] bg-[#EAF2FF] text-[#1a2e5a] px-4 py-2.5 rounded-2xl rounded-tl-none border-l-[3px] border-[#4285F4] text-sm leading-relaxed">
        <MarkdownContent text={text} />
        <span className="inline-block w-1 h-4 bg-[#4285F4] animate-pulse ml-0.5 align-middle" />
      </div>
    </div>
  )
}

// ─── AI 대기 애니메이션 ───────────────────────────────
function AIIdleBubble() {
  return (
    <div className="flex gap-2 items-end mb-4">
      <div className="w-8 h-8 rounded-full bg-[#202124] text-white flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ animation: 'avatar-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
        AI
      </div>
      <div className="bg-[#F1F3F4] px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2">
        <div className="flex gap-1.5 items-center">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-[#9AA0A6]"
              style={{
                animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
        <span className="text-xs text-[#9AA0A6] ml-1">대화를 기다리고 있어요</span>
      </div>
      <style jsx>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  )
}

// ─── 슬래시 커맨드 정의 ──────────────────────────────
const SLASH_COMMANDS = [
  {
    id: 'team-chat',
    label: '팀 채팅',
    desc: 'AI 없이 팀원끼리 자유 토론 시작',
    icon: '💬',
    keywords: ['팀채팅', '팀', 'team', 'chat', '토론'],
  },
  {
    id: 'artifact',
    label: '산출물 저장',
    desc: '선택한 메시지 또는 현재 대화를 산출물로 저장',
    icon: '📋',
    keywords: ['산출물', '저장', 'artifact', 'save'],
  },
  {
    id: 'briefing',
    label: '이전 단계 브리핑',
    desc: '지금까지 확정된 모든 활동 결과 요약',
    icon: '📖',
    keywords: ['브리핑', '요약', 'briefing', '이전', '결과'],
  },
  {
    id: 'next',
    label: '다음 단계로',
    desc: '현재 활동을 완료하고 다음으로 이동',
    icon: '➡️',
    keywords: ['다음', '전진', 'next', '이동', '진행'],
  },
] as const

type SlashCommandId = typeof SLASH_COMMANDS[number]['id']

// ─── 메인 ChatPanel ───────────────────────────────────
export function ChatPanel() {
  const {
    project, messages, streamingText, messagesLoaded,
    currentActivity, setCurrentActivity, appendStreamingText, clearStreamingText, addMessage,
    discussionMode, setDiscussionMode,
    pendingTeamDiscussion, setPendingTeamDiscussion,
    teamDiscussionStartIdx, setTeamDiscussionStartIdx,
    pendingArtifactSave, setPendingArtifactSave,
    currentArtifact, setCurrentArtifact,
    userProfile,
  } = useProjectStore()

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isIdle, setIsIdle] = useState(false)
  const [showDiscussionConfirm, setShowDiscussionConfirm] = useState(false)
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<{ id: string; content: string; senderName?: string } | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashCmdIdx, setSlashCmdIdx] = useState(0)
  const [remoteStreamingText, setRemoteStreamingText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const introSentRef = useRef<Partial<Record<ActivityCode, true>>>({})
  // 스트리밍 중 Firestore 동기화용 interval ref
  const streamingFlushRef = useRef<NodeJS.Timeout | null>(null)
  const streamingAccumRef = useRef('')

  // ARTIFACT_UPDATE 신호를 아티팩트 패널에 반영 + Firestore 저장
  function applyArtifactUpdates(sections: Record<string, string>, actCode?: ActivityCode) {
    if (Object.keys(sections).length === 0) return
    // actCode를 명시적으로 받아서 클로저 캡처 오류 방지
    const targetActivity = actCode ?? currentActivity
    const targetMeta = ACTIVITY_META[targetActivity]
    const existing = currentArtifact?.activityCode === targetActivity ? currentArtifact : null
    // Firestore에 저장된 기존 내용도 병합 대상
    const firestoreArtifact = project?.artifacts?.[targetActivity]
    const firestoreContent = (firestoreArtifact?.content ?? {}) as Record<string, unknown>

    // confirmed 산출물도 사용자가 명시적으로 수정 요청(A안 선택)하면 AI가 [ARTIFACT_UPDATE] 신호를 보낼 수 있음
    // 가드 없음 — 시스템 프롬프트의 A안/B안 확인 규칙이 실질적인 보호 역할을 함
    // 저장 시 status를 in_review로 리셋하므로 팀이 다시 확정해야 함

    const baseContent = existing?.aiDraft ?? firestoreContent
    const merged = { ...baseContent, ...sections }
    const newVersion = (existing?.currentVersion ?? (firestoreArtifact?.version ?? 0)) + 1
    const newArtifact = {
      id: existing?.id ?? Date.now().toString(),
      activityCode: targetActivity,
      artifactType: targetMeta.label,
      title: targetMeta.label + ' 산출물',
      status: 'in_review' as const,
      currentVersion: newVersion,
      aiDraft: merged,
      createdBy: userProfile?.uid ?? 'ai',
      meta: {
        author: 'AI 자동 기록',
        createdAt: { toDate: () => new Date() } as any,
        updatedAt: { toDate: () => new Date() } as any,
        evidence: '대화 내용 자동 추출',
        approvalStatus: 'pending' as const,
      },
    }
    setCurrentArtifact(newArtifact)
    // Firestore에도 즉시 저장 (팀원 공유 + 새로고침 대비)
    if (project?.id) {
      setProjectArtifact(project.id, targetActivity, {
        status: 'in_review',
        title: targetMeta.label + ' 산출물',
        content: merged,
        version: newVersion,
      }).catch(console.error)
    }
  }

  // ARTIFACT_CONFIRM 신호를 처리 — 현재 또는 지정 활동 산출물을 confirmed 상태로 저장
  function applyArtifactConfirm(codes: string[]) {
    if (!project?.id) return
    for (const code of codes) {
      const targetActivity = (code || currentActivity) as ActivityCode
      const firestoreArtifact = project?.artifacts?.[targetActivity]
      const local = currentArtifact?.activityCode === targetActivity ? currentArtifact : null
      const content = (
        firestoreArtifact?.content ??
        local?.aiDraft ??
        {}
      ) as Record<string, unknown>
      if (!Object.keys(content).length) continue
      const title = firestoreArtifact?.title ?? ACTIVITY_META[targetActivity].label + ' 산출물'
      const version = firestoreArtifact?.version ?? local?.currentVersion ?? 1
      setProjectArtifact(project.id, targetActivity, {
        status: 'confirmed',
        title,
        content,
        version,
        confirmedBy: userProfile?.uid ?? undefined,
        confirmedAt: Date.now(),
      }).catch(console.error)
      if (targetActivity === currentActivity && local) {
        setCurrentArtifact({ ...local, status: 'confirmed', confirmedContent: content })
      }
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, remoteStreamingText])

  // 다른 팀원의 AI 스트리밍 상태 구독
  useEffect(() => {
    if (!project?.id || !currentActivity || !userProfile?.uid) return
    const unsub = watchStreamingState(project.id, currentActivity, (state) => {
      if (state && state.senderUid !== userProfile.uid) {
        setRemoteStreamingText(state.text)
      } else {
        setRemoteStreamingText('')
      }
    })
    return () => { unsub(); setRemoteStreamingText('') }
  }, [project?.id, currentActivity, userProfile?.uid])

  if (!project) return null
  const proj = project  // non-null 확정 캡처

  const activityMeta = ACTIVITY_META[currentActivity]

  // ─── SSE 스트리밍 공통 함수 ──────────────────────────
  // 팀원 목록: AI가 누가 발언했는지 파악하기 위해 시스템 프롬프트에 주입
  const teamMembersList = proj.memberInfo
    ? Object.values(proj.memberInfo).map(m => m.displayName).join(', ')
    : undefined

  // 메시지 배열 → API 전송 형식 (user 메시지에 발신자 이름 주입)
  function buildApiMessages(msgs: Array<{ role: string; content: string; displayName?: string }>) {
    return msgs.map(m => ({
      role: m.role,
      content: m.role === 'user' && m.displayName ? `[${m.displayName}]: ${m.content}` : m.content,
    }))
  }

  async function streamFromAPI(
    msgs: Array<{ role: string; content: string; displayName?: string }>,
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
  ) {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: buildApiMessages(msgs),
        stage: activityMeta.stage,
        activityCode: currentActivity,
        actorType: '팀+AI',
        project: {
          title: proj.title,
          targetGradeGroup: proj.targetGradeGroup,
          targetSubjects: proj.targetSubjects,
          mode: proj.mode,
          isA23Completed: proj.isA23Completed,
          currentCycle: proj.currentCycle,
        },
        // 현재 활동의 기존 산출물 내용 전달 (AI가 수정 시 참조)
        currentArtifact: proj.artifacts?.[currentActivity] ?? null,
        // 전체 확정 산출물 전달 (브리핑·맥락 파악용)
        confirmedArtifacts: proj.artifacts
          ? Object.fromEntries(
              Object.entries(proj.artifacts)
                .filter(([, a]) => a.status === 'confirmed')
                .map(([code, a]) => [code, { title: a.title, content: a.content }])
            )
          : undefined,
        teamMembers: teamMembersList,
        // 현재 활동 상태 (active_return이면 AI가 확정 산출물도 수정 가능)
        activityStatus: proj.activityStatuses?.[currentActivity] ?? undefined,
      }),
    })
    if (!response.ok) throw new Error('Stream request failed')

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = JSON.parse(line.slice(6))
        if (data.type === 'text') { fullText += data.text; onChunk(data.text) }
        if (data.type === 'done') onDone(fullText)
      }
    }
  }

  // ─── 활동 전진 처리 (Firestore 동기화 포함, 크로스 스테이지 지원) ──
  async function handleActivityAdvance(nextCode: string) {
    const nextActivity = nextCode as ActivityCode
    const nextMeta = ACTIVITY_META[nextActivity]
    if (!nextMeta) return

    const currentStageInfo = STAGES.find(s => s.code === activityMeta.stage)
    const nextStageInfo = STAGES.find(s => s.code === nextMeta.stage)
    if (!currentStageInfo || !nextStageInfo) return

    const isSameStage = currentStageInfo.code === nextStageInfo.code

    if (isSameStage) {
      const allActivities = currentStageInfo.activities
      const currentIdx = allActivities.indexOf(currentActivity)
      const nextIdx = allActivities.indexOf(nextActivity)
      if (nextIdx <= currentIdx) return
      await advanceActivity(proj.id, allActivities, currentActivity, nextActivity)
        .catch(console.error)
    } else {
      // 크로스 스테이지: 현재 스테이지 나머지 + 다음 스테이지 활동을 합쳐서 처리
      const combinedActivities = [
        ...currentStageInfo.activities,
        ...nextStageInfo.activities,
      ] as ActivityCode[]
      await advanceActivity(
        proj.id,
        combinedActivities,
        currentActivity,
        nextActivity,
        nextStageInfo.code
      ).catch(console.error)
    }

    setCurrentActivity(nextActivity)
  }

  // ─── 활동 되돌아가기 처리 (Firestore 동기화 포함) ──────
  async function handleActivityReturn(targetCode: string) {
    if (!(targetCode in ACTIVITY_META)) return
    await returnToActivity(proj.id, targetCode as ActivityCode).catch(console.error)
    setCurrentActivity(targetCode as ActivityCode)
  }

  // ─── 활동 시작 환영 메시지 (API 호출 없음, 정적) ────────
  function showWelcomeMessage(welcomeText: string) {
    const msg = {
      id: 'welcome-' + currentActivity,
      role: 'assistant' as const,
      content: welcomeText,
      activityCode: currentActivity,
      activityType: '제시' as const,
      agentType: 'orchestrator' as const,
      createdAt: { toDate: () => new Date() } as any,
    }
    addMessage(msg)
    setIsIdle(true)  // 환영 후 즉시 대기 상태
    // Firestore에도 저장 (팀원 동기화)
    saveMessage(proj.id, currentActivity, {
      role: 'assistant', content: welcomeText,
      activityCode: currentActivity, activityType: '제시', agentType: 'orchestrator',
    }).catch(console.error)
  }

  // Firestore 메시지가 로드된 후에만 환영 메시지 표시
  // 방장만 저장 → 팀원은 Firestore 실시간 동기화로 수신
  useEffect(() => {
    if (!project?.started) return
    if (!messagesLoaded) return
    const welcome = ACTIVITY_WELCOME[currentActivity]
    if (!welcome) return
    // 이미 이 활동의 AI 메시지가 있으면 전송 안 함 (activityCode 무관, assistant 메시지 존재 여부)
    const hasAIMessage = messages.some(m => m.role === 'assistant')
    if (hasAIMessage) return
    // 방장만 환영 메시지 저장 (팀원은 Firestore로 받음)
    const amHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid
    if (!amHost) return
    if (introSentRef.current[currentActivity]) return
    introSentRef.current[currentActivity] = true
    showWelcomeMessage(welcome)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentActivity, project?.started, messagesLoaded])

  // ─── 산출물 저장 수락 ────────────────────────────────
  function handleAcceptArtifactSave() {
    if (!pendingArtifactSave) return
    const existing = currentArtifact?.activityCode === currentActivity ? currentArtifact : null
    const firestoreContent = (project?.artifacts?.[currentActivity]?.content ?? {}) as Record<string, unknown>
    const baseContent = existing?.aiDraft ?? firestoreContent
    const newContent = pendingArtifactSave.sections
    const merged = { ...baseContent, ...newContent }
    const newVersion = (existing?.currentVersion ?? (project?.artifacts?.[currentActivity]?.version ?? 0)) + 1

    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: currentActivity,
      artifactType: activityMeta.label,
      title: pendingArtifactSave.title,
      status: 'in_review',
      currentVersion: newVersion,
      aiDraft: merged,
      createdBy: userProfile?.uid ?? 'demo-user',
      meta: {
        author: 'AI 분석',
        createdAt: { toDate: () => new Date() } as any,
        updatedAt: { toDate: () => new Date() } as any,
        evidence: '팀 자유 토론 분석',
        approvalStatus: 'pending',
      },
    })
    // Firestore에도 저장
    if (project?.id) {
      setProjectArtifact(project.id, currentActivity, {
        status: 'in_review',
        title: pendingArtifactSave.title,
        content: merged,
        version: newVersion,
      }).catch(console.error)
    }
    setPendingArtifactSave(null)
  }

  // ─── 팀 토론 승낙 (AI 제안 카드) ────────────────────
  async function handleAcceptDiscussion() {
    setPendingTeamDiscussion(null)
    await setTeamDiscussion(proj.id, currentActivity, true, pendingTeamDiscussion?.topic).catch(console.error)
    setDiscussionMode('team_discussion')
    setTeamDiscussionStartIdx(messages.filter(m => m.role !== 'system').length)
  }

  // ─── 팀 토론 종료 → AI 분석 ──────────────────────────
  async function handleEndDiscussion() {
    setDiscussionMode('ai_facilitated')
    setIsAnalyzing(true)
    clearStreamingText()

    const visibleMessages = messages.filter(m => m.role !== 'system')
    const discussionMessages = visibleMessages.slice(teamDiscussionStartIdx)

    if (discussionMessages.length === 0) return

    const discussionSummary = discussionMessages
      .map(m => `${m.role === 'user' ? '교사' : 'AI'}: ${m.content}`)
      .join('\n\n')

    const analysisPrompt = `다음은 방금 진행된 팀 자유 토론 내용입니다. AI 개입 없이 교사들끼리 나눈 대화입니다.

---
${discussionSummary}
---

이 토론을 분석하여 다음을 제시해주세요:
1. 팀이 합의한 핵심 내용 (3줄 이내)
2. 아직 결정되지 않은 부분
3. 다음 단계를 위한 AI 추천 행동 2가지`

    try {
      await streamFromAPI(
        [...messages.map(m => ({ role: m.role, content: m.content })),
         { role: 'user', content: analysisPrompt }],
        (text) => appendStreamingText(text),
        (fullText) => {
          const signal = parseDiscussionSignal(fullText)
          let text1 = signal ? signal.cleanText : fullText
          const { codes: confirmCodes, cleanText: text1c } = parseArtifactConfirm(text1)
          const { updates: artifactUpdates, cleanText } = parseArtifactUpdates(text1c)
          const displayText = cleanText
          addMessage({
            id: Date.now().toString(),
            role: 'assistant',
            content: displayText,
            activityCode: currentActivity,
            activityType: '성찰',
            agentType: 'orchestrator',
            createdAt: { toDate: () => new Date() } as any,
          })
          clearStreamingText()
          saveMessage(proj.id, currentActivity, {
            role: 'assistant', content: displayText,
            activityCode: currentActivity, activityType: '성찰', agentType: 'orchestrator',
          }).catch(console.error)
          // ARTIFACT_UPDATE 신호가 있으면 바로 반영 (크로스 활동 포함)
          const hasSavedAnalysis = artifactUpdates.some(u => Object.keys(u.sections).length > 0)
          if (hasSavedAnalysis) {
            artifactUpdates.forEach(u => applyArtifactUpdates(u.sections, u.activityCode as ActivityCode | undefined))
          } else {
            // 없으면 분석 내용을 섹션으로 파싱하여 저장 제안
            const parsedSections = parseAnalysisToSections(displayText)
            if (Object.keys(parsedSections).length > 0) {
              setPendingArtifactSave({
                title: `${activityMeta.label} - 팀 토론 분석`,
                sections: parsedSections,
              })
            }
          }
          if (confirmCodes.length > 0) applyArtifactConfirm(confirmCodes)
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })

        }
      )
    } catch (err) { console.error('Analysis error:', err) }
    finally { setIsAnalyzing(false) }
  }

  const isTeamMode = discussionMode === 'team_discussion'
  const isHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid
  const visibleMessages = messages.filter(m => m.role !== 'system')

  // 마지막 AI 메시지에 선택지가 있으면 AI 대기 모드
  const lastAIMsg = [...visibleMessages].reverse().find(m => m.role === 'assistant')
  const isWaitingForChoice = !isTeamMode && !!lastAIMsg && !!parseOptions(lastAIMsg.content)

  // ─── 메시지 전송 ──────────────────────────────────────
  async function handleSend() {
    if (!input.trim() || (isLoading && !isTeamMode && !isWaitingForChoice) || !project) return

    const userMessage = input.trim()
    setInput('')
    setIsIdle(false)  // 사용자 입력 시 idle 해제

    const senderDisplayName = userProfile?.uid
      ? proj.memberInfo?.[userProfile.uid]?.displayName ?? userProfile.displayName
      : undefined

    const tempUserMsg = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: userMessage,
      activityCode: currentActivity,
      activityType: isTeamMode ? '공유·협의' as const : undefined,
      userId: userProfile?.uid,
      displayName: senderDisplayName,
      replyTo: replyTo ?? undefined,
      createdAt: { toDate: () => new Date() } as any,
    }
    addMessage(tempUserMsg)
    saveMessage(proj.id, currentActivity, {
      role: 'user', content: userMessage,
      activityCode: currentActivity,
      activityType: isTeamMode ? '공유·협의' : undefined,
      userId: userProfile?.uid,
      displayName: senderDisplayName,
      replyTo: replyTo ?? undefined,
    }).catch(console.error)
    setReplyTo(null)

    // 팀 토론 모드 또는 선택 대기 중: AI 호출 없이 메시지만 저장
    if (isTeamMode || isWaitingForChoice) return

    setIsLoading(true)
    clearStreamingText()
    streamingAccumRef.current = ''
    // 800ms 간격으로 스트리밍 텍스트를 Firestore에 동기화 (다른 팀원도 볼 수 있도록)
    streamingFlushRef.current = setInterval(() => {
      if (streamingAccumRef.current && userProfile?.uid) {
        setStreamingState(proj.id, currentActivity, streamingAccumRef.current, userProfile.uid).catch(() => {})
      }
    }, 800)
    try {
      await streamFromAPI(
        [...messages, tempUserMsg].map(m => ({ role: m.role, content: m.content })),
        (text) => {
          appendStreamingText(text)
          streamingAccumRef.current += text
        },
        (fullText) => {
          const signal = parseDiscussionSignal(fullText)
          let text1 = signal ? signal.cleanText : fullText
          const advance = parseActivityAdvance(text1)
          text1 = advance ? advance.cleanText : text1
          const ret = parseActivityReturn(text1)
          const text2 = ret ? ret.cleanText : text1
          const { codes: confirmCodes2, cleanText: text2c } = parseArtifactConfirm(text2)
          const { updates, cleanText } = parseArtifactUpdates(text2c)
          const displayText = cleanText
          // interval 정리 + Firestore 스트리밍 상태 삭제
          if (streamingFlushRef.current) {
            clearInterval(streamingFlushRef.current)
            streamingFlushRef.current = null
          }
          clearStreamingState(proj.id, currentActivity).catch(() => {})
          addMessage({
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: displayText,
            activityCode: currentActivity,
            activityType: '생성',
            agentType: 'orchestrator',
            createdAt: { toDate: () => new Date() } as any,
          })
          clearStreamingText()
          saveMessage(proj.id, currentActivity, {
            role: 'assistant', content: displayText,
            activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator',
          }).catch(console.error)
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })
          const hasSavedInResponse = updates.some(u => Object.keys(u.sections).length > 0)
          updates.forEach(u => applyArtifactUpdates(u.sections, u.activityCode as ActivityCode | undefined))
          if (confirmCodes2.length > 0) applyArtifactConfirm(confirmCodes2)

          // [ARTIFACT_UPDATE] 없이 저장 의도만 있으면 → save proposal 자동 생성
          if (!hasSavedInResponse) {
            const saveIntent = parseSaveIntent(fullText)
            if (saveIntent) setPendingArtifactSave(saveIntent)
          }

          if (advance) {
            // 저장 여부와 무관하게 항상 pendingAdvance 배너로 막음
            // → 사용자가 산출물을 검토·확정한 후 직접 "다음 단계로" 버튼을 눌러야 이동
            setPendingAdvance(advance.nextActivity)
          } else if (ret) handleActivityReturn(ret.targetActivity)
        }
      )
    } catch (err) {
      console.error('Chat error:', err)
      // 에러 시에도 스트리밍 상태 정리
      if (streamingFlushRef.current) {
        clearInterval(streamingFlushRef.current)
        streamingFlushRef.current = null
      }
      clearStreamingState(proj.id, currentActivity).catch(() => {})
    }
    finally { setIsLoading(false) }
  }

  // ─── 슬래시 커맨드 필터링 ──────────────────────────
  const filteredSlashCmds = slashQuery !== null
    ? SLASH_COMMANDS.filter(cmd =>
        slashQuery === '' ||
        cmd.label.includes(slashQuery) ||
        cmd.keywords.some(k => k.includes(slashQuery))
      )
    : []

  // ─── 슬래시 커맨드 실행 ─────────────────────────────
  function executeSlashCommand(cmdId: SlashCommandId) {
    // /command 텍스트 제거
    const cleanInput = input.replace(/(?:^|\n)\/([\w가-힣]*)$/, '').trim()
    setInput(cleanInput)
    setSlashQuery(null)

    if (cmdId === 'team-chat') {
      if (isHost) setShowDiscussionConfirm(true)
      else requestTeamDiscussion(proj.id, currentActivity, userProfile!.uid, userProfile!.displayName).catch(console.error)
    } else if (cmdId === 'artifact') {
      if (replyTo) {
        // 답글 대상 메시지 내용을 산출물로 저장 제안
        const content = replyTo.content.replace(/\[.*?\]/g, '').trim()
        setPendingArtifactSave({
          title: activityMeta.label + ' - 선택 저장',
          sections: { [activityMeta.label]: content },
        })
        setReplyTo(null)
      } else {
        setInput('지금까지 논의된 내용을 산출물로 정리해서 저장해주세요')
      }
    } else if (cmdId === 'briefing') {
      setInput('지금까지 완료된 모든 활동의 확정 산출물을 브리핑해주세요')
    } else if (cmdId === 'next') {
      setInput('다음 단계로 진행하겠습니다')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // 슬래시 커맨드 메뉴 키 핸들링
    if (slashQuery !== null && filteredSlashCmds.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashCmdIdx(i => Math.min(i + 1, filteredSlashCmds.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashCmdIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        executeSlashCommand(filteredSlashCmds[slashCmdIdx].id)
        return
      }
      if (e.key === 'Escape') {
        setSlashQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  // 팀 채팅 시작 확인 → Firestore 업데이트 (방장/팀원 모두)
  async function handleConfirmStartDiscussion() {
    setShowDiscussionConfirm(false)
    await setTeamDiscussion(proj.id, currentActivity, true).catch(console.error)
    // 로컬 즉시 반영 (Firestore 감지 전 UX)
    setDiscussionMode('team_discussion')
    setTeamDiscussionStartIdx(messages.filter(m => m.role !== 'system').length)
  }

  // 팀 채팅 종료 → Firestore 업데이트 후 AI 분석
  async function handleEndDiscussionAndAnalyze() {
    await setTeamDiscussion(proj.id, currentActivity, false).catch(console.error)
    setDiscussionMode('ai_facilitated')
    handleEndDiscussion()   // 기존 AI 분석 로직 호출
  }

  const cornerColor = STAGE_CORNER[project?.currentStage ?? 'T']

  return (
    <div className="flex flex-col h-full overflow-hidden corner-wrap-chat"
      style={{ '--cc': cornerColor, ...(isTeamMode ? { animation: 'teamBorderPulse 2s ease-in-out infinite', boxShadow: 'inset 0 0 0 3px rgba(0, 137, 123, 0.7)' } : {}) } as React.CSSProperties}>
      {isTeamMode && (
        <style>{`
          @keyframes teamBorderPulse {
            0%, 100% { box-shadow: inset 0 0 0 3px rgba(0, 137, 123, 0.7); }
            50%       { box-shadow: inset 0 0 0 3px rgba(0, 137, 123, 0.15); }
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      )}
      {!isTeamMode && (
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      )}

      {/* 헤더 */}
      <div className={cn('px-4 py-3 border-b flex items-center gap-2 flex-shrink-0', isTeamMode ? 'bg-[#E0F2F1] border-[#80CBC4]' : 'bg-white border-[#DADCE0]')}>
        <div className={cn('w-2 h-2 rounded-full animate-pulse', isTeamMode ? 'bg-[#00897B]' : 'bg-[#34A853]')} />
        <span className="text-sm font-semibold text-[#202124]">{activityMeta.label}</span>
        {activityMeta.isGuardrailSource && (
          <span className="flex items-center gap-1 text-[10px] bg-[#F3E5F5] text-[#7B1FA2] px-1.5 py-0.5 rounded-full">
            <Shield size={11} weight="fill" /> 가드레일 소스
          </span>
        )}
        {activityMeta.isBackwardDesignFirst && (
          <span className="flex items-center gap-1 text-[10px] bg-[#FFF3E0] text-[#E65100] px-1.5 py-0.5 rounded-full">
            <Star size={11} weight="fill" /> 평가 먼저
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {userProfile && (
            <div className="flex items-center gap-1.5">
              <div
                className="w-6 h-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
                style={{ backgroundColor: userProfile.color }}
              >
                {userProfile.displayName?.slice(0, 1) ?? '?'}
              </div>
              <span className="text-xs font-medium text-[#5F6368]">{userProfile.displayName}</span>
            </div>
          )}
          {isTeamMode && (
            <span className="text-[10px] bg-[#B2DFDB] text-[#00695C] px-2 py-0.5 rounded-full font-medium">
              팀 자유 토론 중
            </span>
          )}
        </div>
      </div>

      {/* 팀 토론 배너 */}
      {isTeamMode && (
        <TeamDiscussionBanner
          topic={project.teamDiscussions?.[currentActivity]?.topic || '팀 자유 토론'}
          onEnd={handleEndDiscussionAndAnalyze}
          isHost={isHost}
        />
      )}

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative">
        {visibleMessages.length === 0 && !streamingText && !isLoading && (
          <div className="flex items-center justify-center h-full text-[#DADCE0]">
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={28} /></span>
          </div>
        )}

        {visibleMessages.map((msg) => {
          if (msg.role === 'system') return null

          // 분석 결과 메시지 (토론 종료 후)
          if (msg.activityType === '성찰' && msg.role === 'assistant') {
            return (
              <ContextMenuWrapper key={msg.id} onReply={() => setReplyTo({ id: msg.id, content: msg.content, senderName: 'AI' })}>
                <AnalysisBubble text={msg.content} />
              </ContextMenuWrapper>
            )
          }

          // AI 메시지에서 A안/B안/C안 선택지 파싱
          if (msg.role === 'assistant') {
            const parsed = parseOptions(msg.content)
            if (parsed) {
              return (
                <ContextMenuWrapper key={msg.id} onReply={() => setReplyTo({ id: msg.id, content: msg.content, senderName: 'AI' })}>
                <OptionsMessage
                  key={msg.id}
                  messageId={msg.id}
                  {...parsed}
                  votes={proj.optionVotes?.[msg.id] ?? {}}
                  memberInfo={
                    Object.fromEntries(
                      Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => [uid, info])
                    )
                  }
                  currentUid={userProfile?.uid ?? ''}
                  isHost={isHost}
                  onSelect={(label, content) => {
                    // 이전 AI 메시지에서 현재 활동과 다른 활동 코드 언급을 추출 → 크로스 활동 힌트
                    const actCodeRegex = /\b(T-[12]-[123]|A-[12]-[123]|Ds-[12]-[123]|DI-[12]-1|E-[12]-1)\b/g
                    const mentionedCodes = [...(msg.content ?? '').matchAll(actCodeRegex)]
                      .map(m => m[1] as ActivityCode)
                      .filter(c => c !== currentActivity)
                    const uniqueOther = [...new Set(mentionedCodes)]
                    // 화면 표시용 (힌트 없음), API 전송용 (힌트 포함)
                    const displayReply = `${label}을 선택하겠습니다. "${content}"`
                    const apiReply = uniqueOther.length > 0
                      ? `${displayReply} (수정/확정 대상 활동: ${uniqueOther[0]} — 반드시 [ARTIFACT_UPDATE@${uniqueOther[0]}:] 신호 사용)`
                      : displayReply
                    setInput(displayReply)
                    // 바로 전송
                    setTimeout(() => {
                      const el = document.querySelector<HTMLTextAreaElement>('textarea')
                      if (el) el.form?.requestSubmit()
                    }, 0)
                    // 직접 handleSend 호출
                    const userMsg = {
                      id: Date.now().toString(),
                      role: 'user' as const,
                      content: displayReply, // 저장·표시에는 깔끔한 버전
                      activityCode: currentActivity,
                      userId: userProfile?.uid,
                      createdAt: { toDate: () => new Date() } as any,
                    }
                    addMessage(userMsg)
                    saveMessage(proj.id, currentActivity, {
                      role: 'user', content: displayReply,
                      activityCode: currentActivity,
                      userId: userProfile?.uid,
                    }).catch(console.error)
                    setIsLoading(true)
                    clearStreamingText()
                    // API에는 힌트 포함 버전으로 전송
                    const apiMsg = { ...userMsg, content: apiReply }
                    streamFromAPI(
                      [...messages, apiMsg].map(m => ({ role: m.role, content: m.content })),
                      (text) => appendStreamingText(text),
                      (fullText) => {
                        const sig = parseDiscussionSignal(fullText)
                        const t1 = sig ? sig.cleanText : fullText
                        const adv = parseActivityAdvance(t1)
                        const t2 = adv ? adv.cleanText : t1
                        const { codes: selConfirmCodes, cleanText: t2c } = parseArtifactConfirm(t2)
                        const { updates: selUpdates, cleanText } = parseArtifactUpdates(t2c)
                        addMessage({
                          id: (Date.now() + 1).toString(),
                          role: 'assistant', content: cleanText,
                          activityCode: currentActivity, activityType: '판단',
                          agentType: 'orchestrator',
                          createdAt: { toDate: () => new Date() } as any,
                        })
                        clearStreamingText()
                        saveMessage(proj.id, currentActivity, {
                          role: 'assistant', content: cleanText,
                          activityCode: currentActivity, activityType: '판단', agentType: 'orchestrator',
                        }).catch(console.error)
                        if (sig) setPendingTeamDiscussion({ topic: sig.topic })
                        selUpdates.forEach(u => applyArtifactUpdates(u.sections, u.activityCode as ActivityCode | undefined))
                        if (selConfirmCodes.length > 0) applyArtifactConfirm(selConfirmCodes)
                        if (adv) handleActivityAdvance(adv.nextActivity)
                      }
                    ).catch(console.error).finally(() => setIsLoading(false))
                  }}
                />
                </ContextMenuWrapper>
              )
            }
          }

          // 발신자 정보 결정
          const isSelf = msg.role === 'user' && msg.userId === userProfile?.uid
          let senderName: string | undefined
          let senderColor: string | undefined
          let senderEmoji: string | undefined

          if (msg.role === 'user') {
            if (isSelf) {
              senderName = userProfile?.displayName
              senderColor = userProfile?.color
              senderEmoji = userProfile?.emoji
            } else {
              const info = msg.userId ? project.memberInfo?.[msg.userId] : undefined
              senderName = info?.displayName ?? msg.userId?.slice(0, 6) ?? '팀원'
              senderColor = info?.color ?? '#6B7280'
              senderEmoji = info?.emoji ?? '👤'
            }
          }

          return (
            <MessageBubble
              key={msg.id}
              role={msg.role as 'user' | 'assistant'}
              content={msg.content}
              activityType={msg.activityType}
              senderName={senderName}
              senderColor={senderColor}
              senderEmoji={senderEmoji}
              isSelf={isSelf}
              replyTo={msg.replyTo}
              onReply={() => setReplyTo({
                id: msg.id,
                content: msg.content,
                senderName: msg.role === 'user' ? senderName : 'AI',
              })}
            />
          )
        })}

        {/* 팀 채팅 시작 확인 카드 */}
        {showDiscussionConfirm && !isTeamMode && (
          <div className="mx-0 my-3 bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-[#00897B] flex items-center justify-center flex-shrink-0">
                <Users size={18} weight="fill" className="text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#004D40] mb-1">팀 채팅을 시작할까요?</p>
                <p className="text-xs text-[#00695C] mb-3 leading-relaxed">
                  AI 없이 팀원끼리 자유롭게 대화하는 시간입니다.<br />
                  토론이 끝나면 AI가 내용을 분석해 드립니다.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmStartDiscussion}
                    className="flex-1 py-2 rounded-full bg-[#00897B] text-white text-sm font-bold hover:bg-[#00746a] transition-colors"
                  >
                    시작하기
                  </button>
                  <button
                    onClick={() => setShowDiscussionConfirm(false)}
                    className="squid-btn px-4 py-2 rounded-full bg-[rgba(0,137,123,0.10)] hover:bg-[rgba(0,137,123,0.20)] text-[#00695C] text-sm transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 팀 채팅 요청 알림 카드 (방장에게만 표시) */}
        {isHost && proj.teamDiscussionRequests?.[currentActivity]?.pending && !isTeamMode && !showDiscussionConfirm && (
          <div className="mx-0 my-3 rounded-2xl overflow-hidden border border-[#80CBC4]"
            style={{ background: 'linear-gradient(135deg, #E0F2F1 0%, #F1F8F7 100%)' }}>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-9 h-9 bg-[#00897B] flex items-center justify-center flex-shrink-0"
                style={{ animation: 'morph-shape 7s ease-in-out infinite', boxShadow: '0 3px 10px rgba(0,137,123,0.35)' }}>
                <Chat size={16} weight="fill" className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-[#004D40]">팀 채팅 요청이 왔어요</p>
                <p className="text-[11px] text-[#00695C]">
                  <span className="font-semibold">{proj.teamDiscussionRequests[currentActivity].displayName}</span>님이 제안했습니다
                </p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <button
                  onClick={async () => {
                    await Promise.all([
                      setTeamDiscussion(proj.id, currentActivity, true),
                      clearTeamDiscussionRequest(proj.id, currentActivity),
                    ]).catch(console.error)
                  }}
                  className="morph-btn px-3 py-1.5 bg-[#00897B] text-white text-[12px] font-bold hover:bg-[#00746a] transition-colors"
                  style={{ filter: 'drop-shadow(0 2px 6px rgba(0,137,123,0.4))' }}
                >
                  수락
                </button>
                <button
                  onClick={async () => { await clearTeamDiscussionRequest(proj.id, currentActivity).catch(console.error) }}
                  className="morph-btn px-3 py-1.5 bg-white text-[#00695C] text-[12px] font-medium border border-[#80CBC4] hover:bg-[#E0F2F1] transition-colors"
                >
                  거절
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 팀 토론 제안 카드 (AI가 제안한 경우) */}
        {pendingTeamDiscussion && !isTeamMode && !showDiscussionConfirm && (
          <TeamDiscussionProposal
            topic={pendingTeamDiscussion.topic}
            onAccept={handleAcceptDiscussion}
            onDecline={() => setPendingTeamDiscussion(null)}
          />
        )}

        {/* 산출물 저장 제안 카드 (방장에게만 표시) */}
        {pendingArtifactSave && isHost && (
          <ArtifactSaveProposal
            title={pendingArtifactSave.title}
            sections={pendingArtifactSave.sections}
            onAccept={handleAcceptArtifactSave}
            onDecline={() => setPendingArtifactSave(null)}
          />
        )}

        {/* 다음 단계 이동 확인 배너 */}
        {pendingAdvance && (() => {
          const isSaved = !!(project?.artifacts?.[currentActivity])
          return isSaved ? (
            // 산출물 저장된 경우 → 초록 배너 (검토 후 이동 유도)
            <div className="mx-4 mb-2 rounded-2xl border border-[#81C995] bg-[#E6F4EA] p-3.5 flex flex-col gap-2.5">
              <div className="flex items-start gap-2">
                <CheckCircle size={18} weight="fill" className="text-[#34A853] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-[#1E4620]">산출물이 저장되었습니다</p>
                  <p className="text-xs text-[#1E8C3A] mt-0.5">우측 산출물을 확인하고 확정한 후 다음 단계로 넘어가세요. 수정이 필요하면 계속 대화할 수 있습니다.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingAdvance(null)}
                  className="squid-btn flex-1 py-2 rounded-full bg-[rgba(52,168,83,0.12)] hover:bg-[rgba(52,168,83,0.24)] text-[#1E8C3A] text-xs font-semibold transition-colors"
                >
                  계속 수정하기
                </button>
                <button
                  onClick={async () => {
                    // Firestore snapshot 우선, 없으면 Zustand 로컬 상태 사용
                    // (snapshot 전파 전에 버튼을 누를 경우 fsArtifact가 null일 수 있음)
                    const fsArtifact = project?.artifacts?.[currentActivity]
                    const localArtifact = currentArtifact?.activityCode === currentActivity ? currentArtifact : null
                    const activityMeta = ACTIVITY_META[currentActivity]

                    const sourceContent = (fsArtifact?.content ?? localArtifact?.aiDraft ?? {}) as Record<string, unknown>
                    const sourceTitle = fsArtifact?.title ?? localArtifact?.title ?? (activityMeta.label + ' 산출물')
                    const sourceVersion = fsArtifact?.version ?? localArtifact?.currentVersion ?? 1
                    const alreadyConfirmed = fsArtifact?.status === 'confirmed'

                    if (!alreadyConfirmed && proj.id) {
                      try {
                        await setProjectArtifact(proj.id, currentActivity, {
                          status: 'confirmed',
                          title: sourceTitle,
                          content: sourceContent,
                          version: sourceVersion,
                          confirmedBy: userProfile?.uid ?? undefined,
                          confirmedAt: Date.now(),
                        })
                        if (currentArtifact) {
                          setCurrentArtifact({ ...currentArtifact, status: 'confirmed' })
                        }
                      } catch (err) {
                        console.error('확정 저장 실패:', err)
                      }
                    }
                    handleActivityAdvance(pendingAdvance)
                    setPendingAdvance(null)
                  }}
                  className="flex-1 py-2 rounded-full bg-[#34A853] text-white text-xs font-bold hover:bg-[#2d9248] transition-colors"
                >
                  확정 후 다음 단계로 →
                </button>
              </div>
            </div>
          ) : (
            // 산출물 미저장 경우 → 주황 배너 (저장 촉구)
            <div className="mx-4 mb-2 rounded-2xl border border-[#FFCC80] bg-[#FFF3E0] p-3.5 flex flex-col gap-2.5">
              <div className="flex items-start gap-2">
                <Warning size={18} weight="fill" className="text-[#E65100] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-[#BF360C]">산출물이 저장되지 않았습니다</p>
                  <p className="text-xs text-[#E65100] mt-0.5">저장 없이 넘어가면 이 활동 내용이 기록되지 않습니다. AI에게 저장을 요청하거나 직접 입력할 수 있습니다.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    handleActivityAdvance(pendingAdvance)
                    setPendingAdvance(null)
                  }}
                  className="squid-btn flex-1 py-2 rounded-full bg-[rgba(230,81,0,0.10)] hover:bg-[rgba(230,81,0,0.20)] text-[#E65100] text-xs font-semibold transition-colors"
                >
                  저장 없이 넘어가기
                </button>
                <button
                  onClick={() => setPendingAdvance(null)}
                  className="flex-1 py-2 rounded-full bg-[#E65100] text-white text-xs font-bold hover:bg-[#cc4700] transition-colors"
                >
                  취소 (저장 먼저)
                </button>
              </div>
            </div>
          )
        })()}

        {/* AI 대기 애니메이션 (로딩 아닐 때, 소개 후) */}
        {isIdle && !isLoading && !isAnalyzing && !streamingText && !isTeamMode && !isWaitingForChoice && (
          <AIIdleBubble />
        )}

        {/* 팀원 투표 오버레이 바 (선택 대기 중 & 팀원) */}
        {isWaitingForChoice && !isHost && lastAIMsg && (() => {
          const parsed = parseOptions(lastAIMsg.content)
          if (!parsed) return null
          return (
            <VoteOverlayBar
              messageId={lastAIMsg.id}
              options={parsed.options}
              votes={proj.optionVotes?.[lastAIMsg.id] ?? {}}
              memberInfo={Object.fromEntries(
                Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => [uid, info])
              )}
              currentUid={userProfile?.uid ?? ''}
              projectId={proj.id}
            />
          )
        })()}

        {/* 스트리밍 - 내가 보낸 경우 (로컬) */}
        <StreamingBubble text={streamingText} isAnalysis={isAnalyzing} />
        {/* 스트리밍 - 다른 팀원이 보낸 경우 (Firestore 공유) */}
        {remoteStreamingText && !isLoading && (
          <StreamingBubble text={remoteStreamingText} isAnalysis={false} />
        )}
        {(isLoading || isAnalyzing) && !streamingText && (
          <div className="flex gap-2 mb-3">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center',
              isAnalyzing ? 'bg-[#00897B]' : 'bg-[#202124]'
            )}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={16} className="text-white" /></span>
            </div>
            <div className={cn('px-4 py-3 rounded-2xl rounded-tl-sm', isAnalyzing ? 'bg-[#E0F2F1]' : 'bg-[#F1F3F4]')}>
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <div key={i}
                    className={cn('w-1.5 h-1.5 rounded-full animate-bounce', isAnalyzing ? 'bg-[#00897B]' : 'bg-[#9AA0A6]')}
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 팀 채팅 진행 중 스트립 */}
      {isTeamMode && (
        <div
          className="flex-shrink-0 px-4 py-2 border-t border-[#80CBC4] flex items-center gap-2"
          style={{ background: 'linear-gradient(90deg, #E0F2F1 0%, #F1F8F7 100%)' }}
        >
          {[0,1,2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#00897B] flex-shrink-0"
              style={{ animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite` }} />
          ))}
          <span className="text-[11px] text-[#00695C] font-semibold truncate">
            팀 채팅 진행 중{!isHost && ' · 방장이 종료할 수 있어요'}
          </span>
        </div>
      )}

      {/* 입력창 */}
      <div className="px-4 py-3 border-t"
        style={isTeamMode
          ? { background: 'linear-gradient(90deg, #E0F2F1 0%, #F1F8F7 100%)', borderColor: '#80CBC4' }
          : { background: '#F8F9FA', borderColor: '#DADCE0' }}
      >
        {/* 팀 채팅 컨트롤 바 */}
        <div className="flex items-center justify-between mb-2">
          {isTeamMode ? (
            <span className="text-[11px] text-[#00695C] font-medium">팀원끼리 자유롭게 대화하세요 · AI는 잠시 대기 중</span>
          ) : isWaitingForChoice ? (
            <span className="text-[11px] text-[#E65100] font-medium flex items-center gap-1">
              <Chat size={16} weight="regular" className="text-[#E65100]" />
              안을 선택하거나 팀원과 의논해보세요 · AI는 선택 후 응답합니다
            </span>
          ) : (
            <>
              <span className="text-[11px] text-[#9AA0A6]">
                {isHost ? '방장' : '팀원'}
              </span>
              {isHost ? (
                <button
                  onClick={() => setShowDiscussionConfirm(true)}
                  disabled={isLoading}
                  className="squid-btn morph-btn text-[11px] font-semibold text-[#00897B] bg-[rgba(0,137,123,0.12)] hover:bg-[rgba(0,137,123,0.22)] px-3 py-1.5 transition-colors flex items-center gap-1 disabled:opacity-40"
                >
                  <Users size={13} weight="fill" />
                  팀 채팅 시작
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!userProfile) return
                    await requestTeamDiscussion(proj.id, currentActivity, userProfile.uid, userProfile.displayName).catch(console.error)
                  }}
                  disabled={isLoading || !!proj.teamDiscussionRequests?.[currentActivity]?.pending}
                  className="squid-btn morph-btn text-[11px] font-semibold text-[#00897B] bg-[rgba(0,137,123,0.12)] hover:bg-[rgba(0,137,123,0.22)] px-3 py-1.5 transition-colors flex items-center gap-1 disabled:opacity-40"
                >
                  <Users size={13} weight="fill" />
                  {proj.teamDiscussionRequests?.[currentActivity]?.pending ? '제안 대기 중...' : '팀 채팅 제안'}
                </button>
              )}
            </>
          )}
        </div>
        {/* 답글 미리보기 배너 */}
        {replyTo && (
          <div className="flex items-center gap-2 mb-1.5 px-2 py-1.5 rounded-xl bg-[#E8F0FE] border-l-4 border-[#1A73E8]">
            <div className="flex-1 min-w-0">
              {replyTo.senderName && (
                <span className="text-[11px] font-bold text-[#1A73E8] block">{replyTo.senderName}에게 답글</span>
              )}
              <span className="text-[11px] text-[#1557b0] line-clamp-1 block truncate">
                {replyTo.content.replace(/\[.*?\]/g, '').trim().slice(0, 80)}
              </span>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="text-[#9AA0A6] hover:text-[#5F6368] leading-none flex-shrink-0 px-1"
            >
              <X size={16} weight="regular" />
            </button>
          </div>
        )}

        {/* 슬래시 커맨드 팔레트 */}
        {slashQuery !== null && filteredSlashCmds.length > 0 && (
          <div className="mb-2 bg-white rounded-2xl shadow-md border border-[#DADCE0] overflow-hidden">
            <div className="px-3 pt-2.5 pb-1.5 border-b border-[#F1F3F4] flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-[#9AA0A6] uppercase tracking-wider">커맨드</span>
              {replyTo && (
                <span className="text-[11px] text-[#1A73E8] font-semibold bg-[#E8F0FE] px-1.5 py-0.5 rounded-full">
                  선택된 메시지에 적용
                </span>
              )}
            </div>
            {filteredSlashCmds.map((cmd, i) => (
              <button
                key={cmd.id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-[#F1F3F4] last:border-0',
                  i === slashCmdIdx ? 'bg-[#E8F0FE]' : 'hover:bg-[#F8F9FA]'
                )}
                onMouseDown={(e) => { e.preventDefault(); executeSlashCommand(cmd.id) }}
                onMouseEnter={() => setSlashCmdIdx(i)}
              >
                <span className="text-xl flex-shrink-0">{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#202124]">{cmd.label}</p>
                  <p className="text-xs text-[#9AA0A6]">{cmd.desc}</p>
                </div>
                <span className="text-[11px] text-[#DADCE0] font-mono flex-shrink-0">/{cmd.keywords[0]}</span>
              </button>
            ))}
            <p className="px-4 py-2 text-[11px] text-[#DADCE0]">↑↓ 이동 · Enter 실행 · Esc 닫기</p>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className={cn('chat-input-wrap flex-1', isTeamMode && 'chat-input-wrap-team')}>
            <div className={cn('chat-input-inner', isTeamMode ? 'bg-[#E0F2F1]' : 'bg-white')}>
              <textarea
                value={input}
                onChange={(e) => {
                  const val = e.target.value
                  setInput(val)
                  // 슬래시 커맨드 감지: 줄 끝이 /로 시작하는 단어
                  const match = val.match(/(?:^|\n)\/([\w가-힣]*)$/)
                  if (match) {
                    setSlashQuery(match[1])
                    setSlashCmdIdx(0)
                  } else {
                    setSlashQuery(null)
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder={isTeamMode ? '팀원에게 의견을 전달하세요...' : isWaitingForChoice ? '안을 선택 전 팀원과 의논해보세요...' : '메시지를 입력하세요... (/ 로 커맨드 · Shift+Enter: 줄바꿈)'}
                rows={3}
                disabled={isLoading && !isTeamMode && !isWaitingForChoice}
                className={cn(
                  'w-full resize-none border-0 rounded-[18px] px-3 py-2 text-sm',
                  'focus:outline-none disabled:opacity-50 text-[#202124]',
                  isTeamMode ? 'bg-[#E0F2F1]' : 'bg-white'
                )}
              />
            </div>
          </div>
          {/* 전송 버튼 — morph-shape 일렁임 */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || (isLoading && !isTeamMode && !isWaitingForChoice)}
            className={cn(
              'w-12 h-[70px] text-white flex items-center justify-center flex-shrink-0',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              isTeamMode ? 'bg-[#00897B]'
                : isWaitingForChoice ? 'bg-[#E65100]'
                : 'bg-[#1A73E8]'
            )}
            style={{
              animation: 'morph-shape 6s ease-in-out infinite, stage-bounce 3.5s ease-in-out infinite',
              filter: isTeamMode
                ? 'drop-shadow(0 4px 12px rgba(0,137,123,0.45))'
                : isWaitingForChoice
                  ? 'drop-shadow(0 4px 12px rgba(230,81,0,0.45))'
                  : 'drop-shadow(0 4px 12px rgba(26,115,232,0.45))',
            }}
          >
            {isLoading && !isTeamMode && !isWaitingForChoice
              ? <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={20} /></span>
              : <PaperPlaneRight size={20} weight="fill" />
            }
          </button>
        </div>
      </div>

    </div>
  )
}
