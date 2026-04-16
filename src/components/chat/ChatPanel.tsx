'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, STAGES, type ActivityType, type ActivityCode, type ActionCard, type SkippedActionCard, type Message } from '@/types'
import { ACTIVITY_WELCOME } from '@/lib/prompts/system'
import { saveMessage, generateMessageId, setTeamDiscussion, setOptionVote, advanceActivity, returnToActivity, setActivityStatus, requestTeamDiscussion, clearTeamDiscussionRequest, setStreamingState, clearStreamingState, watchStreamingState, setProjectArtifact, setGraphOpen, recommendGraphCenter, setGraphCenter, saveGraphData, setGraphSelectionState, proposeArtifactToHost, clearArtifactProposal, recordActionCardSkip, updateMessageActionCardState } from '@/lib/firebase/projects'
import { Timestamp } from 'firebase/firestore'
import type { GraphPinnedStandard, GraphSavedData } from '@/lib/knowledge-graph/domain'
import { TeamDiscussionBanner } from './TeamDiscussionBanner'
import { TeamDiscussionProposal } from './TeamDiscussionProposal'
import { HelpCard } from './HelpCard'
import { ArtifactSaveProposal } from './ArtifactSaveProposal'
import { ActionCard as ActionCardComponent } from './ActionCard'
import { ChatFontScaleControl, useChatFontScale } from '@/components/accessibility/FontScaleControl'
import { StandardsFinderModal } from './StandardsFinderModal'
import { KeyNotesModal, MessageContextMenu } from './KeyNotesModal'
import { addKeyNote } from '@/lib/firebase/projects'
import type { KeyNote } from '@/types'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ListChecks, CheckCircle, Shield, Star, ArrowBendUpLeft, Chat,
  Users, StopCircle, SpinnerGap, PaperPlaneRight, Warning, X, TreeStructure, PencilRuler,
} from '@phosphor-icons/react'
import dynamic from 'next/dynamic'

const KnowledgeGraphViewer = dynamic(
  () => import('@/components/knowledge-graph/KnowledgeGraphViewer'),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-[#9AA0A6] text-sm">그래프 로딩 중…</div> },
)

const ProblemSituationDesigner = dynamic(
  () => import('@/components/problem-situation/ProblemSituationDesigner'),
  { ssr: false },
)

const GRAPH_ACTIVITIES: ActivityCode[] = ['A-2-1']

function buildGraphSelectionFromSavedData(savedData?: GraphSavedData | null): {
  pinnedStandards: GraphPinnedStandard[]
  checkedStandardIds: string[]
} {
  if (!savedData) {
    return { pinnedStandards: [], checkedStandardIds: [] }
  }

  const centerId = savedData.centerNode?.id
  const pinnedStandards = savedData.selectedStandards
    .filter((standard) => standard.id !== centerId)
    .map((standard) => ({
      stdId: standard.id,
      addedBy: '저장됨',
      source: 'manual' as const,
    }))

  const checkedStandardIds = [
    ...(centerId ? [centerId] : []),
    ...savedData.selectedStandards.map((standard) => standard.id),
  ]

  return { pinnedStandards, checkedStandardIds: [...new Set(checkedStandardIds)] }
}

const STAGE_CORNER: Record<string, string> = {
  T: 'rgba(26,115,232,0.09)', A: 'rgba(123,31,162,0.08)', Ds: 'rgba(0,137,123,0.08)',
  DI: 'rgba(230,81,0,0.08)', E: 'rgba(198,40,40,0.08)',
}

// 단계별 AI 말풍선 색상
const STAGE_BUBBLE: Record<string, { bg: string; border: string; text: string }> = {
  T:  { bg: '#EAF2FF', border: '#4285F4', text: '#1a2e5a' },
  A:  { bg: '#F3E5F5', border: '#7B1FA2', text: '#2d0045' },
  Ds: { bg: '#E0F2F1', border: '#00897B', text: '#003d38' },
  DI: { bg: '#FBE9E7', border: '#E65100', text: '#4a1a00' },
  E:  { bg: '#FFEBEE', border: '#C62828', text: '#4a0000' },
}

// ─── 안(案) 선택지 파싱 ──────────────────────────────
interface ParsedOption { label: string; content: string }
interface ParsedOptions { pre: string; options: ParsedOption[]; post: string }

function parseOptions(text: string): ParsedOptions | null {
  // **A안:** "..." 또는 A안: "..." 형식 감지 (볼드 유무 모두 지원)
  const regex = /(?:\*\*([A-Za-z0-9]+안):?\*\*|^([A-Za-z0-9]+안):)\s*:?\s*"([^"]+)"/gm
  const matches = [...text.matchAll(regex)]
  if (matches.length < 2) return null

  // 캡처 그룹 정규화: bold(m[1]) 또는 non-bold(m[2]) 중 존재하는 것이 label, m[3]이 content
  const normalized = matches.map(m => ({ label: m[1] || m[2], content: m[3], index: m.index!, raw: m[0] }))

  // A안부터 시작하는 첫 번째 연속 그룹만 캡처
  const aIdx = normalized.findIndex(m => m.label === 'A안')
  if (aIdx === -1) return null

  const ORDER = ['A안', 'B안', 'C안', 'D안', 'E안']
  const group = [normalized[aIdx]]
  for (let i = aIdx + 1; i < normalized.length; i++) {
    const expected = ORDER[group.length]
    if (normalized[i].label === expected) group.push(normalized[i])
    else break
  }
  if (group.length < 2) return null

  const options: ParsedOption[] = group.map(m => ({
    label: m.label,
    content: m.content.trim().replace(/\*\*/g, ''),
  }))

  const firstIdx = group[0].index
  const lastItem = group[group.length - 1]
  const lastIdx = lastItem.index + lastItem.raw.length

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

        {/* 이 중에는 없다 — 재논의 버튼 (호스트만, 선택 전) */}
        {isHost && !selected && (
          <button
            onClick={() => handleFinalSelect('재논의', '이 중에 마음에 드는 안이 없어요. 다시 논의하고 싶습니다.')}
            className="self-start text-[11px] text-[#5F6368] hover:text-[#C62828] underline underline-offset-2 transition-colors"
          >
            이 중에는 없다 — 다시 논의하기
          </button>
        )}

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
// 가이드 카드 이모지 항목을 별도 블록으로 분리
function splitGuideLines(text: string): { before: string; lines: string[]; after: string } | null {
  const GUIDE_EMOJIS: string[] = [] // 이모지 카드 형식 미사용 — 섹션형 마크다운으로 전환
  const hasGuide = GUIDE_EMOJIS.some(e => text.includes(e))
  if (!hasGuide) return null

  // 이모지가 시작되는 위치 찾기
  const firstIdx = Math.min(...GUIDE_EMOJIS.map(e => {
    const i = text.indexOf(e); return i === -1 ? Infinity : i
  }))
  if (firstIdx === Infinity) return null

  const before = text.slice(0, firstIdx).trim()
  const rest = text.slice(firstIdx)

  // 이모지 기준으로 분리
  const lines: string[] = []
  let current = ''
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    const isEmoji = GUIDE_EMOJIS.some(e => rest.startsWith(e, i))
    if (isEmoji && current.trim()) {
      lines.push(current.trim())
      current = ch
    } else {
      current += ch
    }
  }
  if (current.trim()) lines.push(current.trim())

  // 마지막 가이드 항목 이후 텍스트 분리
  const lastGuideIdx = Math.max(...GUIDE_EMOJIS.map(e => {
    const idx = rest.lastIndexOf(e); return idx === -1 ? -1 : idx
  }))
  if (lastGuideIdx === -1) return null

  // 마지막 가이드 줄이 끝나는 위치 찾기 (다음 빈 줄 또는 텍스트)
  const afterGuide = (() => {
    const guideLines = lines.filter(l => GUIDE_EMOJIS.some(e => l.startsWith(e)))
    const nonGuide = lines.filter(l => !GUIDE_EMOJIS.some(e => l.startsWith(e)))
    return { guide: guideLines, after: nonGuide.join('\n').trim() }
  })()

  return { before, lines: afterGuide.guide, after: afterGuide.after }
}

// 성취기준 코드 툴팁용 — React 노드에서 텍스트 추출
function childrenToText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (React.isValidElement(children)) return childrenToText((children.props as { children?: React.ReactNode }).children)
  return ''
}

function MarkdownContent({ text, dark = false, standardTextMap }: { text: string; dark?: boolean; standardTextMap?: Record<string, string> }) {
  // AI가 <br> 태그를 생성하는 경우 줄바꿈으로 치환
  // AI가 첫 줄에 [탐색] [팀+AI] 같은 활동유형/행위주체 태그를 출력하는 경우 제거
  // 표 셀 안의 <br/>은 ', '로, 표 밖은 줄바꿈으로
  const sanitized = text
    .replace(/(\|[^|\n]*)<br\s*\/?>/gi, '$1, ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/^(\s*\[[^\]\n]{1,20}\]\s*){1,4}\n/u, '')
    // CommonMark 한계: **'text'**한국어 패턴에서 ' 뒤 ** 가 닫힘 기호로 인식 안 됨
    // → **'text'** 를 **text** 로 정규화
    .replace(/\*\*'([^'*\n]+)'\*\*/g, '**$1**')
    // CommonMark 우측 플랭킹 규칙 한계: )**한국어 or 한국어**한국어 패턴
    // → closing ** 뒤에 NBSP 삽입으로 강제 bold 닫힘 처리
    .replace(/([)'"'"」』】）\uAC00-\uD7A3\d])\*\*([\uAC00-\uD7A3])/g, '$1**\u00A0$2')

  const guide = splitGuideLines(sanitized)

  if (guide) {
    const strongComp = (isDark: boolean) => ({
      p: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 leading-relaxed">{children}</p>,
      strong: ({ children }: { children?: React.ReactNode }) => (
        <span className={cn('inline-block px-1.5 py-0.5 rounded-md text-[13px] font-semibold leading-snug mx-0.5', isDark ? 'bg-white/25 text-white' : 'bg-[#E8F0FE] text-[#1A73E8]')}>{children}</span>
      ),
    })
    return (
      <div>
        {guide.before && (
          <div className="mb-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={strongComp(dark)}>
              {guide.before}
            </ReactMarkdown>
          </div>
        )}
        <div className={cn('rounded-xl overflow-hidden', dark ? 'border border-white/20' : 'border border-current/10')}>
          {guide.lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'px-3 py-2 w-full',
                i !== 0 && (dark ? 'border-t border-white/15' : 'border-t border-current/10'),
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={strongComp(dark)}>
                {line}
              </ReactMarkdown>
            </div>
          ))}
        </div>
        {guide.after && (
          <div className="mt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={strongComp(dark)}>
              {guide.after}
            </ReactMarkdown>
          </div>
        )}
      </div>
    )
  }

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
        // 테이블 렌더링 — 내부 셀은 자연스럽게 wrap, 정말 넓을 때만 overflow-x 스크롤 (말풍선 밖으로 흐르지 않도록)
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-xl border border-[#DADCE0] max-w-full">
            <table className="w-full text-sm border-collapse table-auto">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className={dark ? 'bg-white/20' : 'bg-[#F8F9FA]'}>{children}</thead>
        ),
        tbody: ({ children }) => <tbody className="divide-y divide-[#F1F3F4]">{children}</tbody>,
        tr: ({ children }) => <tr className="hover:bg-[#F8F9FA]/50 transition-colors">{children}</tr>,
        th: ({ children }) => (
          <th className="px-3 py-2.5 text-left text-xs font-bold text-[#5F6368] uppercase tracking-wider border-b border-[#DADCE0] align-top">
            {children}
          </th>
        ),
        td: ({ children }) => {
          // 셀은 기본적으로 wrap (break-words + word-break: keep-all로 한국어 자연 줄바꿈)
          // [성취기준 코드]만 whitespace-nowrap — 코드는 중간에 끊기면 안 되므로 코드 감지 시에도 셀 자체는 wrap
          if (standardTextMap) {
            const cellText = childrenToText(children)
            const codeMatch = /\[(\d[가-힣]{1,4}\d{2}-\d{2})\]/.exec(cellText)
            const tooltipText = codeMatch ? standardTextMap[codeMatch[1]] : undefined
            if (tooltipText) {
              return (
                <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed break-words cursor-help align-top"
                    style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}
                    title={tooltipText}>
                  {children}
                </td>
              )
            }
          }
          return (
            <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed break-words align-top"
                style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
              {children}
            </td>
          )
        },
      }}
    >
      {sanitized}
    </ReactMarkdown>
  )
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

// ─── HELP_CARD 신호 파싱 ──────────────────────────
function parseHelpCard(text: string): { cleanText: string; helpMessage: string | null } {
  const match = text.match(/\[HELP_CARD:\s*([^\]]+)\]/)
  if (!match) return { cleanText: text, helpMessage: null }
  return {
    cleanText: text.replace(/\[HELP_CARD:\s*[^\]]+\]\n?/, '').trim(),
    helpMessage: match[1].trim(),
  }
}

// ─── ACTION_CARD 신호 파싱 (Phase 1-b) ──────────────────
// 포맷: [ACTION_CARD: intent=... | primary=... | secondary=... | skip=...]
// intent/primary/skip 필수. secondary 선택. 필수 키 누락 시 null 반환(조용한 실패 + dev warn).
// 본 파서는 상호배제 규칙(§12-4)을 모름 — 호출 쪽에서 다른 신호 존재 여부를 체크한 뒤에 호출해야 함.
function parseActionCard(text: string): { card: ActionCard; cleanText: string } | null {
  const match = text.match(/\[ACTION_CARD:\s*([^\]]+)\]/)
  if (!match) return null
  const body = match[1]
  const parts = body.split('|').map(s => s.trim()).filter(Boolean)
  const fields: Record<string, string> = {}
  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx <= 0) continue
    const key = part.slice(0, eqIdx).trim().toLowerCase()
    const value = part.slice(eqIdx + 1).trim()
    if (key && value) fields[key] = value
  }
  const { intent, primary, secondary, skip } = fields
  if (!intent || !primary || !skip) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[ACTION_CARD] 필수 키 누락으로 무시됨. 원본:', match[0], '파싱된 필드:', fields)
    }
    return null
  }
  const cleanText = text.replace(/\n*\[ACTION_CARD:[^\]]+\]\n?/, '').trimEnd()
  return {
    card: { intent, primary, secondary: secondary || undefined, skip },
    cleanText,
  }
}

// ─── 저장 의도 감지 (신호 없이 "저장하겠습니다"만 있는 경우) ──
// "저장하겠습니다" 문장 주변 2문장만 스캔해서 실제 내용만 추출
// ─── A-2-1 마크다운 표 자동 추출 ─────────────────────
// AI 응답에서 마크다운 표를 찾아 산출물 저장 제안 데이터로 변환
function extractA21TableForSave(text: string): { title: string; sections: Record<string, string> } | null {
  const lines = text.split('\n')

  // 1. 핵심아이디어 블록 추출 (> ★ 또는 > ** 형식 blockquote)
  const coreIdeaLines: string[] = []
  let inCoreIdea = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('>') && (trimmed.includes('핵심아이디어') || trimmed.includes('★') || inCoreIdea)) {
      inCoreIdea = true
      coreIdeaLines.push(line)
    } else if (inCoreIdea && trimmed === '') {
      // 빈 줄 하나는 허용
      coreIdeaLines.push(line)
    } else if (inCoreIdea && !trimmed.startsWith('>')) {
      inCoreIdea = false
    }
  }

  // 2. 성취기준 분석표 추출 (첫 번째 마크다운 표)
  const tableLines: string[] = []
  let inTable = false
  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      inTable = true
      tableLines.push(line)
    } else if (inTable) {
      break
    }
  }

  // 헤더 + 구분선 + 최소 1행 이상
  if (tableLines.length < 3) return null

  // 3. 표 아래 융합 분석 섹션 추출
  const tableStr = tableLines.join('\n')
  const tableEnd = text.indexOf(tableLines[tableLines.length - 1]) + tableLines[tableLines.length - 1].length
  const afterTable = text.slice(tableEnd).trim()
  const fusionMatch = /(?:공통|융합|루브릭)[^\n]{0,20}\n[\s\S]{1,500}?(?=\n\n\n|$)/.exec(afterTable)

  // 4. 전체 조합
  const parts: string[] = []
  if (coreIdeaLines.length > 0) parts.push(coreIdeaLines.join('\n').trim())
  parts.push(tableStr)
  if (fusionMatch) parts.push(fusionMatch[0].trim())
  const fullContent = parts.join('\n\n')

  return {
    title: '핵심아이디어 및 성취기준 분석표',
    sections: { '성취기준분석표': fullContent },
  }
}

// ─── ARTIFACT_UPDATE 값 보강 ─────────────────────────
// AI가 [ARTIFACT_UPDATE: 섹션=모든 수정 및 보완된 내용 포함] 처럼 요약 플레이스홀더를 쓰는 경우,
// 최근 assistant 메시지에서 실제 콘텐츠(표·리스트·프로필 등)를 추출하여 대체한다.
function isPlaceholderValue(value: string, recentMessages: Array<{ role: string; content: string }>): boolean {
  if (value.length > 200) return false
  // 100자 이하이면서 최근 채팅에 더 풍부한 콘텐츠가 있으면 플레이스홀더로 간주
  if (value.length <= 100) {
    const hasRichChat = recentMessages
      .filter(m => m.role === 'assistant')
      .slice(-5)
      .some(m => m.content.length > value.length * 3)
    if (hasRichChat) return true
  }
  return false
}

function extractSubstantiveContent(recentMessages: Array<{ role: string; content: string }>): string | null {
  // 최근 assistant 메시지에서 표·리스트가 있는 가장 긴 콘텐츠 블록을 찾는다
  const assistantMsgs = recentMessages
    .filter(m => m.role === 'assistant')
    .slice(-5)
    .reverse()

  for (const msg of assistantMsgs) {
    const content = msg.content
      .replace(/\[ARTIFACT_UPDATE[^\]]*\]/g, '')
      .replace(/\[ARTIFACT_CONFIRM[^\]]*\]/g, '')
      .replace(/\[ACTION_CARD:[^\]]*\]/g, '')
      .trim()
    // 표가 있는 메시지 우선
    if (content.includes('|') && content.split('\n').filter(l => l.trim().startsWith('|')).length >= 3) {
      return content
    }
    // 마크다운 리스트가 풍부한 메시지
    const listLines = content.split('\n').filter(l => /^\s*[-•*]\s/.test(l) || /^\s*\d+\.\s/.test(l))
    if (listLines.length >= 3 && content.length >= 100) {
      return content
    }
  }
  // 가장 긴 assistant 메시지 (100자 이상)
  const longest = assistantMsgs.sort((a, b) => b.content.length - a.content.length)[0]
  if (longest && longest.content.length >= 100) {
    return longest.content
      .replace(/\[ARTIFACT_UPDATE[^\]]*\]/g, '')
      .replace(/\[ARTIFACT_CONFIRM[^\]]*\]/g, '')
      .replace(/\[ACTION_CARD:[^\]]*\]/g, '')
      .trim()
  }
  return null
}

function enrichArtifactSections(
  sections: Record<string, string>,
  recentMessages: Array<{ role: string; content: string }>,
): Record<string, string> {
  const enriched = { ...sections }
  for (const [key, value] of Object.entries(enriched)) {
    if (isPlaceholderValue(value, recentMessages)) {
      const realContent = extractSubstantiveContent(recentMessages)
      if (realContent) {
        enriched[key] = realContent
      }
    }
  }
  return enriched
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
  '합의 내용', '논의 내용', '토론 내용', '토의 내용', '확인 사항',
  '진행 내용', '진행 사항', '현황', '요약',
]

interface ArtifactUpdateItem {
  activityCode?: string   // undefined = 현재 활동
  sections: Record<string, string>
}

function parseArtifactUpdates(text: string): { updates: ArtifactUpdateItem[]; cleanText: string } {
  // actCode key → sections 버킷
  const buckets: Record<string, Record<string, string>> = {}
  // 신호 위치 목록 (cleanText에서 제거용)
  const signalRanges: Array<[number, number]> = []

  // 브라켓 카운팅 파서: 내부에 [성취기준코드] 등이 있어도 올바르게 파싱
  // [ARTIFACT_UPDATE@CODE: key=value] — value 내부의 ] 는 depth > 0 이므로 통과
  const PREFIX = '[ARTIFACT_UPDATE'
  let i = 0

  while (i < text.length) {
    const start = text.indexOf(PREFIX, i)
    if (start === -1) break

    let j = start + PREFIX.length
    let actKey = '__current__'

    // 선택적 @코드
    if (text[j] === '@') {
      j++
      const codeStart = j
      while (j < text.length && text[j] !== ':' && text[j] !== ']') j++
      if (text[j] === ':') actKey = text.slice(codeStart, j)
    }

    // ':' 필수
    if (text[j] !== ':') { i = start + 1; continue }
    j++ // skip ':'

    // 공백 건너뜀
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++

    // 키 파싱 (= 이전까지)
    const keyStart = j
    while (j < text.length && text[j] !== '=' && text[j] !== ']' && text[j] !== '\n') j++
    if (text[j] !== '=') { i = start + 1; continue }
    const key = text.slice(keyStart, j).trim()
    j++ // skip '='

    // 값 파싱: 브라켓 depth=1에서 시작, depth=0이 되는 ] 에서 종료
    const valueStart = j
    let depth = 1
    while (j < text.length) {
      if (text[j] === '[') depth++
      else if (text[j] === ']') {
        depth--
        if (depth === 0) break
      }
      j++
    }
    // depth > 0: 스트림이 ] 전에 끊긴 경우 — 텍스트 끝까지를 값으로 best-effort 파싱
    const incomplete = depth !== 0
    if (incomplete) j = text.length
    const value = text.slice(valueStart, j).trim()
    const end = incomplete ? text.length : j + 1  // closing ] 포함 (incomplete면 텍스트 끝)

    const keyRaw = key.toLowerCase()
    if (!ARTIFACT_BLOCKED_KEYS.some(k => keyRaw.includes(k)) && key && value) {
      if (!buckets[actKey]) buckets[actKey] = {}
      buckets[actKey][key] = value
      signalRanges.push([start, end])
    }

    i = end
  }

  const updates: ArtifactUpdateItem[] = Object.entries(buckets).map(([code, sections]) => ({
    activityCode: code === '__current__' ? undefined : code,
    sections,
  }))

  let cleanText = text
  if (signalRanges.length > 0) {
    // 뒤에서부터 제거 (인덱스 보정 불필요)
    const sorted = [...signalRanges].sort((a, b) => b[0] - a[0])
    for (const [s, e] of sorted) {
      cleanText = cleanText.slice(0, s).trimEnd() + cleanText.slice(e)
    }
    cleanText = cleanText.trimEnd()
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

// ─── 공통 컨텍스트 메뉴 래퍼 (passthrough — 실제 컨텍스트 메뉴는 상위 Level(3101)에서 통합 처리) ──
// 과거에는 여기서 "답글만" 메뉴를 띄웠으나, 현재는 MessageBubble 바깥 래퍼가
// 답장/중요저장/복사 통합 메뉴를 제공하므로 이중 메뉴 충돌을 막기 위해 passthrough로 유지.
function ContextMenuWrapper({ children, className }: {
  children: React.ReactNode
  onReply?: () => void     // 시그니처 호환성만 유지 (미사용)
  className?: string
}) {
  return <div className={className}>{children}</div>
}

// ─── 메시지 버블 ──────────────────────────────────────
function MessageBubble({ role, content, activityType, senderName, senderColor, isSelf, replyTo, onReply, stage, standardTextMap }: {
  role: 'user' | 'assistant'
  content: string
  activityType?: ActivityType
  senderName?: string
  senderColor?: string
  senderEmoji?: string
  isSelf?: boolean
  replyTo?: { id: string; content: string; senderName?: string }
  onReply?: () => void
  stage?: string
  standardTextMap?: Record<string, string>
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

      <div className={cn('max-w-[72%] min-w-0 space-y-0.5', alignRight ? 'items-end' : 'items-start', 'flex flex-col')}>
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
          !isUser && 'rounded-tl-none border-l-[3px]',
          isUser && (alignRight ? 'rounded-tr-none' : 'rounded-tl-none'),
        )}
          style={isUser
            ? { backgroundColor: avatarColor, color: textOnColor, filter: 'saturate(1.2) brightness(0.95)' }
            : (() => {
                const s = STAGE_BUBBLE[stage ?? 'T'] ?? STAGE_BUBBLE['T']
                return { backgroundColor: s.bg, color: s.text, borderColor: s.border }
              })()
          }
        >
          {isUser
            ? <span className="whitespace-pre-wrap">{content}</span>
            : <MarkdownContent text={content} standardTextMap={standardTextMap} />
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
          <span className="text-xs font-bold text-[#00695C]">팀 토의 분석 결과</span>
        </div>
        <div className="text-sm text-[#004D40] leading-relaxed">
          <MarkdownContent text={text} />
        </div>
      </div>
    </div>
  )
}

// ─── 스트리밍 버블 ────────────────────────────────────
function StreamingBubble({ text, isAnalysis, stage }: { text: string; isAnalysis?: boolean; stage?: string }) {
  if (!text) return null
  if (isAnalysis) {
    return (
      <div className="mx-0 my-3">
        <div className="bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-[#00897B] flex items-center justify-center">
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={14} className="text-white" /></span>
            </div>
            <span className="text-xs font-bold text-[#00695C]">팀 토의 분석 중...</span>
          </div>
          <div className="text-sm text-[#004D40] leading-relaxed">
            <MarkdownContent text={text} />
            <span className="inline-block w-1 h-4 bg-[#00897B] animate-pulse ml-0.5 align-middle" />
          </div>
        </div>
      </div>
    )
  }
  const s = STAGE_BUBBLE[stage ?? 'T'] ?? STAGE_BUBBLE['T']
  return (
    <div className="flex gap-2 mb-3">
      <div className="w-11 h-11 rounded-full bg-[#202124] text-white flex items-center justify-center text-sm font-extrabold flex-shrink-0 shadow-md self-start"
        style={{ animation: 'avatar-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
        AI
      </div>
      <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tl-none border-l-[3px] text-sm leading-relaxed"
        style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border }}>
        <MarkdownContent text={text} />
        <span className="inline-block w-1 h-4 animate-pulse ml-0.5 align-middle" style={{ backgroundColor: s.border }} />
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
// hostOnly=true 인 항목은 호스트(방장)에게만 노출. 팀원은 /브리핑만 보게 됨.
const SLASH_COMMANDS = [
  {
    id: 'team-chat',
    label: '팀 채팅',
    desc: 'AI 없이 팀원끼리 자유 토의 시작',
    keywords: ['팀채팅', '팀', 'team', 'chat', '토의', '토론'],
    hostOnly: true,
  },
  {
    id: 'artifact',
    label: '산출물 저장',
    desc: '선택한 메시지 또는 현재 대화를 바로 산출물 저장 흐름으로 실행',
    keywords: ['산출물', '저장', 'artifact', 'save'],
    hostOnly: true,
  },
  {
    id: 'standards',
    label: '성취기준 찾기',
    desc: '교과·학년군으로 필터해 성취기준을 검색·선택 후 채팅에 인용',
    keywords: ['성취기준', '성취', '기준', 'standards', '교과', '학년'],
    hostOnly: false,   // 팀원도 참고용으로 조회·공유 가능
  },
  {
    id: 'briefing',
    label: '이전 단계 브리핑',
    desc: '지금까지 확정된 모든 활동 결과 요약을 즉시 요청',
    keywords: ['브리핑', '요약', 'briefing', '이전', '결과'],
    hostOnly: false,
  },
  {
    id: 'next',
    label: '다음 단계로',
    desc: '저장·확정 후 이동할지 확인 창을 바로 띄움',
    keywords: ['다음', '전진', 'next', '이동', '진행'],
    hostOnly: true,
  },
] as const

type SlashCommandId = typeof SLASH_COMMANDS[number]['id']

// ─── 메인 ChatPanel ───────────────────────────────────
export function ChatPanel() {
  const chatFontScale = useChatFontScale()
  const {
    project, messages, streamingText, messagesLoaded,
    currentActivity, setCurrentActivity, appendStreamingText, clearStreamingText, addMessage, replaceMessage,
    discussionMode, setDiscussionMode,
    pendingTeamDiscussion, setPendingTeamDiscussion,
    teamDiscussionStartIdx, setTeamDiscussionStartIdx,
    pendingArtifactSave, setPendingArtifactSave,
    currentArtifact, setCurrentArtifact,
    setViewingActivity,
    userProfile,
    setPendingStageMove,
    chatInputRequest, setChatInputRequest,
  } = useProjectStore()

  const [input, setInput] = useState('')

  // 외부(ArtifactPanel 등)에서 "이 문구 채팅에 채워 주세요" 요청하면 수신·소비
  useEffect(() => {
    if (chatInputRequest) {
      setInput(chatInputRequest)
      setChatInputRequest(null)
      // 입력창에 포커스
      setTimeout(() => {
        const el = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement | null
        el?.focus()
        if (el) { el.selectionStart = el.value.length; el.selectionEnd = el.value.length }
      }, 30)
    }
  }, [chatInputRequest, setChatInputRequest])
  const [isLoading, setIsLoading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isIdle, setIsIdle] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [showDiscussionConfirm, setShowDiscussionConfirm] = useState(false)
  const [showStandardsBrowser, setShowStandardsBrowser] = useState(false)
  const [showKeyNotes, setShowKeyNotes] = useState(false)
  // 우클릭 컨텍스트 메뉴 상태
  const [ctxMenu, setCtxMenu] = useState<null | {
    x: number; y: number
    message: { id: string; content: string; role: 'user' | 'assistant'; senderName?: string; activityCode?: string }
  }>(null)
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<{ id: string; content: string; senderName?: string } | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashCmdIdx, setSlashCmdIdx] = useState(0)
  const [remoteStreamingText, setRemoteStreamingText] = useState('')
  const [isRemoteLoading, setIsRemoteLoading] = useState(false) // 다른 팀원이 AI 요청 중
  // HELP_CARD: 마지막 AI 응답에 대한 도움 메시지 (messageId → helpMessage)
  const [helpCardMap, setHelpCardMap] = useState<Record<string, string>>({})
  const [showGraphPanel, setShowGraphPanel] = useState(false)
  const [showProblemSituationDesigner, setShowProblemSituationDesigner] = useState(false)
  // 지식 그래프에 추가된 성취기준 (채팅 언급 + 수동 추가)
  const [pinnedStandards, setPinnedStandards] = useState<GraphPinnedStandard[]>([])
  const [checkedGraphStandardIds, setCheckedGraphStandardIds] = useState<string[]>([])
  const lastGraphSelectionMutationAtRef = useRef(0)
  const pinnedStandardsRef = useRef<GraphPinnedStandard[]>([])
  const checkedGraphStandardIdsRef = useRef<string[]>([])

  // ── 공유 그래프 키워드 (버튼 핸들러에서 사용) ─────────────────────────────
  const graphKeywordForShare = useMemo(() => {
    // 1순위: 산출물에서 주제 추출
    let kw = ''
    const artifacts = project?.artifacts ?? {}
    for (const art of Object.values(artifacts)) {
      const c = art.content as Record<string, unknown>
      const topic = (c['선택 주제'] || c['주제'] || c['수업 목표']) as string | undefined
      if (topic) { kw = topic.slice(0, 60); break }
    }
    // 2순위: 유저 메시지 중 주제 관련 내용 (짧은 메시지, 그래프/메타 관련 메시지 제외)
    if (!kw) {
      const SKIP_PATTERNS = /지식\s*그래프|확인해|넘어가|다음|ㅇㅇ|ㅎㅎ|네|좋아|감사|확인|저장/
      const recentUser = [...messages].reverse().find(m =>
        m.role === 'user' && m.content.length >= 8 && !SKIP_PATTERNS.test(m.content)
      )
      if (recentUser) {
        kw = recentUser.content.replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, ' ').trim().slice(0, 60)
      }
    }
    // 3순위: 프로젝트 제목
    if (!kw) kw = project?.title ?? ''
    return kw
  }, [project?.artifacts, messages, project?.title])

  // 그래프가 열린 동안 keyword를 고정 — 채팅/산출물 업데이트에 의한 재fetch 방지
  const [stableGraphKeyword, setStableGraphKeyword] = useState('')
  const stableGraphKeywordRef = useRef('')

  // ── 팀원: 방장이 문제상황 디자이너를 열면 자동으로 오픈 ──────────────────
  useEffect(() => {
    if (!project || !userProfile) return
    const amHost = project.hostUid === userProfile.uid || project.createdBy === userProfile.uid
    if (amHost) return
    if (project.problemSituationOpen && currentActivity === 'Ds-1-2') {
      setShowProblemSituationDesigner(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.problemSituationOpen])

  // ── 팀원: 방장이 그래프를 열면 자동으로 오픈 ─────────────────────────────
  useEffect(() => {
    if (!project || !userProfile) return
    const amHost = project.hostUid === userProfile.uid || project.createdBy === userProfile.uid
    if (amHost) return  // 방장은 직접 제어
    if (project.graphOpen && GRAPH_ACTIVITIES.includes(currentActivity)) {
      setShowGraphPanel(true)
      if (!stableGraphKeywordRef.current) {
        const kw = project.graphKeyword || graphKeywordForShare
        stableGraphKeywordRef.current = kw
        setStableGraphKeyword(kw)
      }
      if (project.graphSelectionState) {
        setPinnedStandards(project.graphSelectionState.pinnedStandards ?? [])
        setCheckedGraphStandardIds(project.graphSelectionState.checkedStandardIds ?? [])
      } else if (project.graphSavedData && pinnedStandards.length === 0 && checkedGraphStandardIds.length === 0) {
        const restored = buildGraphSelectionFromSavedData(project.graphSavedData)
        if (restored.pinnedStandards.length > 0) setPinnedStandards(restored.pinnedStandards)
        if (restored.checkedStandardIds.length > 0) setCheckedGraphStandardIds(restored.checkedStandardIds)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.graphOpen])

  useEffect(() => {
    if (!project?.graphSelectionState) return
    const shared = project.graphSelectionState
    const amHost = project.hostUid === userProfile?.uid || project.createdBy === userProfile?.uid
    const incomingUpdatedAt = shared.updatedAt ?? 0
    if (amHost && incomingUpdatedAt < lastGraphSelectionMutationAtRef.current) return
    setPinnedStandards(shared.pinnedStandards ?? [])
    setCheckedGraphStandardIds(shared.checkedStandardIds ?? [])
  }, [project?.graphSelectionState, project?.hostUid, project?.createdBy, userProfile?.uid])

  useEffect(() => {
    pinnedStandardsRef.current = pinnedStandards
  }, [pinnedStandards])

  useEffect(() => {
    checkedGraphStandardIdsRef.current = checkedGraphStandardIds
  }, [checkedGraphStandardIds])

  // 채팅 메시지에서 성취기준 코드 파싱
  const STD_CODE_RE = /\[(\d[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2})\]/g

  // "반영하기" 버튼 클릭 시 해당 메시지의 코드만 저장
  const [activeGraphCodes, setActiveGraphCodes] = useState<Array<{code: string; addedBy: string}>>([])

  // 그래프에 전달할 코드: 버튼 클릭으로 지정된 코드 우선, 없으면 빈 배열
  const chatMentionedStds = useMemo(() => {
    return activeGraphCodes.map(c => ({ ...c, source: 'chat' as const }))
  }, [activeGraphCodes])
  const bottomRef = useRef<HTMLDivElement>(null)

  // 스트리밍 중 Firestore 동기화용 interval ref
  const streamingFlushRef = useRef<NodeJS.Timeout | null>(null)
  const streamingAccumRef = useRef('')

  // 활동 전환 시 해당 활동에만 속하는 로컬 UI 상태 초기화
  useEffect(() => {
    setPendingAdvance(null)
    setChatError(null)
    setIsIdle(false)
    setHelpCardMap({})
    setReplyTo(null)
  }, [currentActivity])

  // ARTIFACT_UPDATE 신호를 아티팩트 패널에 반영 + Firestore 저장
  // latestText: 현재 턴의 assistant 응답 원문 (Zustand에 아직 반영 안 됐을 수 있어 직접 전달)
  function applyArtifactUpdates(rawSections: Record<string, string>, actCode?: ActivityCode, latestText?: string) {
    // AI가 요약 플레이스홀더를 넣은 경우 최근 채팅에서 실제 콘텐츠를 추출
    const contextMsgs = latestText
      ? [...messages, { role: 'assistant' as const, content: latestText }]
      : messages
    const sections = enrichArtifactSections(rawSections, contextMsgs)
    if (Object.keys(sections).length === 0) return

    // 협업 모드에서 팀원 → 방장에게 저장 제안으로 전달 (직접 저장 금지)
    if (project?.mode === 'collaborative' && !isHost) {
      proposeArtifactToHost(
        proj.id,
        actCode ?? currentActivity,
        sections,
        userProfile?.uid ?? '',
        userProfile?.displayName ?? '팀원'
      ).catch(console.error)
      return
    }

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
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
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
      // 산출물 확정 → activityStatuses도 completed로 업데이트 (StageMoveModal 미완료 체크 정합성)
      setActivityStatus(project.id, targetActivity, 'completed').catch(console.error)
      if (targetActivity === currentActivity && local) {
        setCurrentArtifact({ ...local, status: 'confirmed', confirmedContent: content })
      }
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, remoteStreamingText])

  // 다른 팀원의 AI 스트리밍 상태 구독 (사용자별 개별 문서 — 동시 스트리밍 충돌 없음)
  useEffect(() => {
    if (!project?.id || !currentActivity || !userProfile?.uid) return
    const unsub = watchStreamingState(project.id, currentActivity, userProfile.uid, (states) => {
      const active = states.length > 0
      setIsRemoteLoading(active)
      setRemoteStreamingText(active ? states[0].text : '')
    })
    return () => { unsub(); setRemoteStreamingText(''); setIsRemoteLoading(false) }
  }, [project?.id, currentActivity, userProfile?.uid])

  if (!project) return null
  const proj = project  // non-null 확정 캡처

  const activityMeta = ACTIVITY_META[currentActivity]
  const hasA23Guardrail = Object.keys(
    ((proj.artifacts?.['A-2-3']?.content ?? {}) as Record<string, unknown>)
  ).length > 0

  // ─── SSE 스트리밍 공통 함수 ──────────────────────────
  // 팀원 목록: AI가 누가 발언했는지 파악하기 위해 시스템 프롬프트에 주입
  const teamMembersList = proj.memberInfo
    ? Object.values(proj.memberInfo).map(m => m.displayName).join(', ')
    : undefined

  // 메시지 배열 → API 전송 형식 (user 메시지에 발신자 이름 주입)
  function buildApiMessages(msgs: Array<{ role: string; content: string; displayName?: string }>) {
    const mapped = msgs.map(m => ({
      role: m.role,
      content: m.role === 'user' && m.displayName ? `[${m.displayName}]: ${m.content}` : m.content,
    }))
    // 마지막 user 메시지 앞에 현재 활동 위치 리마인더를 삽입
    // → 대화가 길어져도 AI가 현재 활동 코드를 잊지 않도록 강제
    const actMeta = ACTIVITY_META[currentActivity]
    const reminder = {
      role: 'user' as const,
      content: `[시스템 리마인더] 현재 활동: ${currentActivity} (${actMeta?.label}). 이 활동에서의 대화를 수행 중이며, [ACTIVITY_ADVANCE] 신호 없이는 아직 이동하지 않은 상태입니다.`,
    }
    // 마지막 user 메시지 바로 앞에 삽입
    const lastUserIdx = mapped.map(m => m.role).lastIndexOf('user')
    if (lastUserIdx >= 0) {
      mapped.splice(lastUserIdx, 0, reminder)
    }
    return mapped
  }

  async function streamFromAPI(
    msgs: Array<{ role: string; content: string; displayName?: string }>,
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
  ) {
    // 스마트 "청크 간 공백" 타임아웃 — 60초 동안 새 청크가 오지 않으면 abort.
    // 정상적으로 길게 생성되는 응답(여러 분)은 청크 도착마다 타이머 리셋 → 끊기지 않음.
    const INACTIVITY_MS = 60_000
    const controller = new AbortController()
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null
    const armTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => { controller.abort() }, INACTIVITY_MS)
    }
    const disarmTimer = () => {
      if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null }
    }

    armTimer()
    let response: Response
    try {
      response = await fetch('/api/chat/stream', {
        signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: buildApiMessages(msgs),
        projectId: proj.id,
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
          // P1-I: 이전 주기 E 개선안 (T-1-1 시스템 프롬프트 주입용, 없으면 undefined)
          previousCycleImprovements: proj.previousCycleImprovements,
        },
        // 현재 활동의 기존 산출물 내용 전달 (AI가 수정 시 참조)
        currentArtifact: proj.artifacts?.[currentActivity] ?? null,
        // 이전 단계 산출물 전달: Ds/DI/E 단계에서는 A단계 산출물을 확정 여부와 무관하게 포함
        // (확정을 안 했더라도 내용이 있으면 설계 근거로 전달, 미래 활동 산출물은 제외)
        confirmedArtifacts: proj.artifacts
          ? (() => {
              const allActivities = STAGES.flatMap(s => s.activities)
              const currentIdx = allActivities.indexOf(currentActivity)
              const curStage = activityMeta.stage
              return Object.fromEntries(
                Object.entries(proj.artifacts)
                  .filter(([code, a]) => {
                    const idx = allActivities.indexOf(code as ActivityCode)
                    if (idx >= currentIdx) return false
                    // Ds/DI/E 단계: A단계 산출물은 내용만 있으면 확정 여부 무관하게 포함
                    const codeStage = ACTIVITY_META[code as ActivityCode]?.stage
                    if (['Ds', 'DI', 'E'].includes(curStage) && codeStage === 'A') {
                      return Object.keys((a.content as Record<string, unknown>) ?? {}).length > 0
                    }
                    return a.status === 'confirmed'
                  })
                  .map(([code, a]) => [code, { title: a.title, content: a.content }])
              )
            })()
          : undefined,
        // A-2-3 학습자 프로필을 별도 가드레일로 전달 (확정 여부 무관)
        learnerProfileSummary: (() => {
          const a23 = proj.artifacts?.['A-2-3']
          if (!a23 || !Object.keys((a23.content as Record<string, unknown>) ?? {}).length) return undefined
          return Object.entries(a23.content as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join('\n')
        })(),
        teamMembers: teamMembersList,
        // 현재 활동 상태 (active_return이면 AI가 확정 산출물도 수정 가능)
        activityStatus: proj.activityStatuses?.[currentActivity] ?? undefined,
        // 중요 노트 — 팀이 채팅에서 저장한 활동 경계 초월 맥락.
        // 이전 활동 비공식 대화의 핵심 발언이 여기 담김 (확정 산출물과 별도).
        keyNotes: proj.keyNotes ?? undefined,
        // A-2-1 및 Ds 단계: 지식 그래프 저장 데이터 전달 (설계 단계에서도 성취기준 구조 참조)
        graphSavedData: (currentActivity === 'A-2-1' || activityMeta.stage === 'Ds') ? (proj.graphSavedData ?? null) : undefined,
      }),
    })
    } catch (err) {
      disarmTimer()
      if (controller.signal.aborted) {
        throw new Error('AI 응답이 시작되지 않아 연결을 종료했습니다. 재시도 버튼을 눌러주세요.')
      }
      throw err
    }

    if (!response.ok) {
      disarmTimer()
      const errBody = await response.json().catch(() => ({ error: 'unknown' }))
      throw new Error(`Stream request failed: ${errBody?.error ?? response.status}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buf = ''
    // SSE 'error' 신호 도달 시 부분 누적 폐기 + 호출자 catch로 throw
    let serverError: string | null = null

    try {
      while (true) {
        armTimer() // 매 read()마다 타이머 리셋 — 청크 1개만 와도 타임아웃 갱신
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let data: { type?: string; text?: string; message?: string }
          try {
            data = JSON.parse(line.slice(6))
          } catch {
            continue  // 잘못된 SSE 라인 무시
          }
          if (data.type === 'text') { fullText += data.text ?? ''; onChunk(data.text ?? '') }
          else if (data.type === 'done') { disarmTimer(); onDone(fullText); return }
          else if (data.type === 'error') {
            // 서버 측 OpenAI 호출 실패 등 — 부분 누적은 폐기하고 호출자에게 위임
            serverError = data.message ?? 'AI 응답 중 오류가 발생했습니다.'
            break
          }
        }
        if (serverError) break
      }
    } catch (err) {
      disarmTimer()
      // 청크 간 공백 타임아웃에 의한 abort
      if (controller.signal.aborted) {
        if (fullText.trim().length > 0) {
          // 부분 응답이 있으면 보존 — assistant 메시지로 커밋 + 꼬리표
          onDone(fullText + '\n\n_[응답이 중간에 끊겼습니다 — 재시도 버튼으로 이어서 받아주세요]_')
          return
        }
        throw new Error('AI 응답이 60초 이상 멈춰 연결을 종료했습니다. 재시도 버튼을 눌러주세요.')
      }
      throw err
    } finally {
      disarmTimer()
    }

    if (serverError) {
      // 빈 메시지가 Firestore에 저장되지 않도록 onDone 호출하지 않음
      throw new Error(serverError)
    }
    if (fullText) onDone(fullText)
  }

  // ─── 활동 전진 처리 (Firestore 동기화 포함, 크로스 스테이지 지원) ──
  async function handleActivityAdvance(nextCode: string) {
    if (!isHost) return
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
        .catch((err) => { console.error(err); setChatError('다음 활동으로 이동하지 못했습니다. 다시 시도해주세요.') })
      setCurrentActivity(nextActivity)
    } else {
      // 크로스 스테이지: StageMoveModal을 통해 이동 (단계 분석 기회 제공)
      setPendingStageMove(nextStageInfo.code as import('@/types').StageCode)
      setPendingAdvance(null)
    }
  }

  // ─── 활동 되돌아가기 처리 (Firestore 동기화 포함) ──────
  async function handleActivityReturn(targetCode: string) {
    if (!(targetCode in ACTIVITY_META)) return
    const code = targetCode as ActivityCode
    await returnToActivity(proj.id, code)
      .catch((err) => { console.error(err); setChatError('이전 활동으로 돌아가지 못했습니다. 다시 시도해주세요.') })
    await setActivityStatus(proj.id, code, 'active_return').catch(console.error)
    setCurrentActivity(code)
  }

  function getNextActivityCode(code: ActivityCode): ActivityCode | null {
    const allActivities = STAGES.flatMap(stage => stage.activities)
    const idx = allActivities.indexOf(code)
    if (idx === -1 || idx >= allActivities.length - 1) return null
    return allActivities[idx + 1] ?? null
  }

  async function ensureCurrentArtifactSavedAndConfirmed(): Promise<boolean> {
    const fsArtifact = proj.artifacts?.[currentActivity]
    const localArtifact = currentArtifact?.activityCode === currentActivity ? currentArtifact : null
    const currentMeta = ACTIVITY_META[currentActivity]
    const pendingForCurrent = pendingArtifactSave
      && (((pendingArtifactSave.activityCode as ActivityCode | undefined) ?? currentActivity) === currentActivity)
      ? pendingArtifactSave
      : null

    let sourceContent = (fsArtifact?.content ?? localArtifact?.aiDraft ?? {}) as Record<string, unknown>
    let sourceTitle = fsArtifact?.title ?? localArtifact?.title ?? (currentMeta.label + ' 산출물')
    let sourceVersion = fsArtifact?.version ?? localArtifact?.currentVersion ?? 1
    let currentStatus = fsArtifact?.status ?? localArtifact?.status

    if (pendingForCurrent) {
      sourceContent = { ...sourceContent, ...pendingForCurrent.sections }
      sourceVersion = (fsArtifact?.version ?? localArtifact?.currentVersion ?? 0) + 1
      currentStatus = 'in_review'

      await setProjectArtifact(proj.id, currentActivity, {
        status: 'in_review',
        title: sourceTitle,
        content: sourceContent,
        version: sourceVersion,
      }).catch((err) => {
        console.error('산출물 저장 실패:', err)
        throw err
      })

      setCurrentArtifact({
        id: localArtifact?.id ?? Date.now().toString(),
        activityCode: currentActivity,
        artifactType: currentMeta.label,
        title: sourceTitle,
        status: 'in_review',
        currentVersion: sourceVersion,
        aiDraft: sourceContent,
        createdBy: localArtifact?.createdBy ?? userProfile?.uid ?? 'demo-user',
        meta: {
          author: pendingForCurrent.proposerName ? `${pendingForCurrent.proposerName} 제안` : 'AI 분석',
          createdAt: localArtifact?.meta?.createdAt ?? Timestamp.now(),
          updatedAt: Timestamp.now(),
          evidence: localArtifact?.meta?.evidence ?? '팀 자유 토의 분석',
          approvalStatus: 'pending',
        },
      })

      if (project?.id && project.artifactProposal) {
        clearArtifactProposal(project.id).catch(console.error)
      }
      setPendingArtifactSave(null)
    }

    if (!Object.keys(sourceContent).length) {
      setChatError('현재 활동에 저장할 산출물이 없습니다. /산출물로 먼저 저장하거나 우측 패널에 직접 입력해주세요.')
      return false
    }

    if (currentStatus !== 'confirmed') {
      await setProjectArtifact(proj.id, currentActivity, {
        status: 'confirmed',
        title: sourceTitle,
        content: sourceContent,
        version: sourceVersion,
        confirmedBy: userProfile?.uid ?? undefined,
        confirmedAt: Date.now(),
      }).catch((err) => {
        console.error('산출물 확정 저장 실패:', err)
        throw err
      })

      if (currentArtifact?.activityCode === currentActivity) {
        setCurrentArtifact({
          ...currentArtifact,
          status: 'confirmed',
          confirmedContent: sourceContent,
          aiDraft: sourceContent,
          currentVersion: sourceVersion,
          title: sourceTitle,
        })
      }
    }

    return true
  }

  function handlePromptNextCommand() {
    if (!isHost) {
      setChatError('다음 단계 이동은 방장만 실행할 수 있습니다.')
      return
    }

    const nextActivity = getNextActivityCode(currentActivity)
    if (!nextActivity) {
      setChatError('현재 활동이 마지막 단계입니다. 더 이상 이동할 다음 활동이 없습니다.')
      return
    }

    setPendingAdvance(nextActivity)
  }

  // ─── 활동 시작 환영 메시지 (API 호출 없음, 정적) ────────
  function showWelcomeMessage(welcomeText: string) {
    // 고정 ID로 저장: Firestore 콜백이 재호출돼도 같은 ID로 dedup 됨
    const msgId = 'welcome-' + currentActivity
    const msg = {
      id: msgId,
      role: 'assistant' as const,
      content: welcomeText,
      activityCode: currentActivity,
      activityType: '제시' as const,
      agentType: 'orchestrator' as const,
      createdAt: Timestamp.now(),
    }
    addMessage(msg)
    setIsIdle(true)  // 환영 후 즉시 대기 상태
    // Firestore에도 동일 ID로 저장 → 중복 방지, 콜백 재진입 시 동일 문서 반환
    saveMessage(proj.id, currentActivity, {
      role: 'assistant', content: welcomeText,
      activityCode: currentActivity, activityType: '제시', agentType: 'orchestrator',
    }, msgId).catch(console.error)
  }

  // Firestore 메시지가 로드된 후에만 환영 메시지 표시
  // 방장만 저장 → 팀원은 Firestore 실시간 동기화로 수신
  // messages를 dep에 포함: stale closure 방지 + Firestore 재응답 시 재평가
  useEffect(() => {
    if (!project?.started) return
    if (!messagesLoaded) return
    const welcome = ACTIVITY_WELCOME[currentActivity]
    if (!welcome) return
    // 이미 AI 메시지가 있으면 전송 안 함
    const hasAIMessage = messages.some(m => m.role === 'assistant')
    if (hasAIMessage) return
    // 방장만 환영 메시지 저장 (팀원은 Firestore로 받음)
    const amHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid
    if (!amHost) return
    // 로컬에 이미 같은 ID의 메시지가 있으면 중복 방지
    // (introSentRef 대신 실제 messages 상태를 사용해 stale 방지)
    const welcomeId = 'welcome-' + currentActivity
    if (messages.some(m => m.id === welcomeId)) return
    showWelcomeMessage(welcome)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentActivity, project?.started, messagesLoaded, messages])

  // ─── 산출물 저장 수락 ────────────────────────────────
  function handleAcceptArtifactSave() {
    if (!pendingArtifactSave) return
    const targetActivity = (pendingArtifactSave.activityCode as ActivityCode | undefined) ?? currentActivity
    const targetMeta = ACTIVITY_META[targetActivity]
    const existing = currentArtifact?.activityCode === targetActivity ? currentArtifact : null
    const firestoreContent = (project?.artifacts?.[targetActivity]?.content ?? {}) as Record<string, unknown>
    const baseContent = existing?.aiDraft ?? firestoreContent
    // 플레이스홀더 보강
    const enrichedSections = enrichArtifactSections(pendingArtifactSave.sections, messages)
    const merged = { ...baseContent, ...enrichedSections }
    const newVersion = (existing?.currentVersion ?? (project?.artifacts?.[targetActivity]?.version ?? 0)) + 1

    // 우측 패널을 대상 활동으로 먼저 전환
    setViewingActivity(targetActivity)
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: targetActivity,
      artifactType: targetMeta.label,
      title: targetMeta.label + ' 산출물',
      status: 'in_review',
      currentVersion: newVersion,
      aiDraft: merged,
      createdBy: userProfile?.uid ?? 'demo-user',
      meta: {
        author: pendingArtifactSave.proposerName ? `${pendingArtifactSave.proposerName} 제안` : 'AI 분석',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '팀 자유 토의 분석',
        approvalStatus: 'pending',
      },
    })
    if (project?.id) {
      setProjectArtifact(project.id, targetActivity, {
        status: 'in_review',
        title: targetMeta.label + ' 산출물',
        content: merged,
        version: newVersion,
      }).catch(console.error)
    }
    // Firestore 제안도 함께 정리
    if (project?.id && project.artifactProposal) {
      clearArtifactProposal(project.id).catch(console.error)
    }
    setPendingArtifactSave(null)
  }

  // ─── 팀 토의 승낙 (AI 제안 카드) ────────────────────
  async function handleAcceptDiscussion() {
    setPendingTeamDiscussion(null)
    await setTeamDiscussion(proj.id, currentActivity, true, pendingTeamDiscussion?.topic).catch(console.error)
    setDiscussionMode('team_discussion')
    setTeamDiscussionStartIdx(messages.filter(m => m.role !== 'system').length)
  }

  // ─── 팀 토의 종료 → AI 분석 ──────────────────────────
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

    // P0-phil1 (Task #27): 산출물 쓰기는 교사 명시적 허락 필요.
    // 분석 응답에서 [ARTIFACT_UPDATE] 직접 방출 금지 → ACTION_CARD로 저장 제안만.
    // 교사가 primary "산출물에 저장" 클릭 시 다음 턴에서 AI가 신호 방출.
    const activityAnalysisPrompt: Partial<Record<ActivityCode, string>> = {
      'T-1-1': `다음 토의를 분석하여 합의된 팀 비전을 정리해주세요.

---
${discussionSummary}
---

출력 형식:
1. 팀이 합의한 핵심 내용 (3줄 이내, 비전 문장 초안 포함)
2. 보완이 필요한 부분 (없으면 생략)

충분히 저장 가능한 합의가 보이면 응답 맨 끝에 ACTION_CARD로 교사 팀의 허락을 구한다:
[ACTION_CARD: intent=팀 비전 저장 제안 | primary=산출물에 저장 | secondary=조금 더 다듬기 | skip=지금은 넘기기]

합의가 아직 부족하면 ACTION_CARD 없이 보완 방향만 제시한다.
⚠️ [ARTIFACT_UPDATE] 신호를 이 응답에 직접 출력하는 것 금지 — 교사가 primary 버튼을 눌러야만 다음 턴에서 방출한다.`,

      'T-1-2': `다음 토의를 분석하여 합의된 교수학습 방향을 정리해주세요.

---
${discussionSummary}
---

출력 형식:
1. 팀이 합의한 핵심 내용 (3줄 이내, 키워드 + 통합 방향 문장 초안 포함)
2. 보완이 필요한 부분 (없으면 생략)

충분히 저장 가능한 합의가 보이면 응답 맨 끝에 ACTION_CARD로 교사 팀의 허락을 구한다:
[ACTION_CARD: intent=교수학습 방향 저장 제안 | primary=산출물에 저장 | secondary=조금 더 다듬기 | skip=지금은 넘기기]

합의가 아직 부족하면 ACTION_CARD 없이 보완 방향만 제시한다.
⚠️ [ARTIFACT_UPDATE] 신호를 이 응답에 직접 출력하는 것 금지 — 교사가 primary 버튼을 눌러야만 다음 턴에서 방출한다.`,

      'T-2-1': `다음 토의를 분석하여 합의된 역할 배분을 정리해주세요.

---
${discussionSummary}
---

출력 형식:
1. 팀이 합의한 핵심 내용 (역할별 담당자 명시)
2. 보완이 필요한 부분 (없으면 생략)

역할 배분이 충분히 합의되면 응답 맨 끝에 ACTION_CARD로 교사 팀의 허락을 구한다:
[ACTION_CARD: intent=역할 배분 저장 제안 | primary=산출물에 저장 | secondary=조금 더 다듬기 | skip=지금은 넘기기]

합의가 아직 부족하면 ACTION_CARD 없이 보완 방향만 제시한다.
⚠️ [ARTIFACT_UPDATE] 신호를 이 응답에 직접 출력하는 것 금지 — 교사가 primary 버튼을 눌러야만 다음 턴에서 방출한다.`,

      'T-2-2': `다음 토의를 분석하여 합의된 팀 규칙을 정리해주세요.

---
${discussionSummary}
---

출력 형식:
1. 팀이 합의한 규칙 목록 (규칙명 + 구체적 내용 + 위반 시 조치 포함)
2. 보완이 필요한 부분 (없으면 생략)

⚠️ 키워드 나열 금지. 규칙 설명과 위반 시 조치를 빠짐없이 포함한다.

규칙이 충분히 합의되면 응답 맨 끝에 ACTION_CARD로 교사 팀의 허락을 구한다:
[ACTION_CARD: intent=팀 규칙 저장 제안 | primary=산출물에 저장 | secondary=조금 더 다듬기 | skip=지금은 넘기기]

합의가 아직 부족하면 ACTION_CARD 없이 보완 방향만 제시한다.
⚠️ [ARTIFACT_UPDATE] 신호를 이 응답에 직접 출력하는 것 금지 — 교사가 primary 버튼을 눌러야만 다음 턴에서 방출한다.`,
    }

    const analysisPrompt = activityAnalysisPrompt[currentActivity] ?? `다음은 방금 진행된 팀 자유 토의 내용입니다. AI 개입 없이 교사들끼리 나눈 대화입니다.

---
${discussionSummary}
---

이 토의를 분석하여 다음을 제시해주세요:
1. 팀이 합의한 핵심 내용 (3줄 이내)
2. 보완이 필요한 부분 (없으면 생략)

충분히 저장 가능한 합의가 보이면 응답 맨 끝에 ACTION_CARD로 교사 팀의 허락을 구한다:
[ACTION_CARD: intent=분석 내용 저장 제안 | primary=산출물에 저장 | secondary=조금 더 다듬기 | skip=지금은 넘기기]

⚠️ [ARTIFACT_UPDATE] 신호를 이 응답에 직접 출력하는 것 금지 — 교사가 primary 버튼을 눌러야만 다음 턴에서 방출한다.`

    try {
      await streamFromAPI(
        [...messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName })),
         { role: 'user', content: analysisPrompt }],
        (text) => appendStreamingText(text),
        (fullText) => {
          const signal = parseDiscussionSignal(fullText)
          let text1 = signal ? signal.cleanText : fullText
          // P0-phil1 (Task #27): 분석 응답은 ACTION_CARD 저장 제안 경로만 허용.
          // 모델이 규칙 0-2를 위반하고 ARTIFACT_UPDATE/CONFIRM을 방출해도 구조적으로 버림.
          const { codes: confirmCodes, cleanText: text1c } = parseArtifactConfirm(text1)
          const { updates: artifactUpdates, cleanText: text1d } = parseArtifactUpdates(text1c)
          if (artifactUpdates.length > 0) {
            console.warn('[handleEndDiscussion] 규칙 0-2 위반: 분석 응답에 ARTIFACT_UPDATE 방출됨. 무시하고 ACTION_CARD 경로만 채택.', artifactUpdates)
          }
          if (confirmCodes.length > 0) {
            console.warn('[handleEndDiscussion] 규칙 0-2 위반: 분석 응답에 ARTIFACT_CONFIRM 방출됨. 무시.', confirmCodes)
          }
          // P0-phil2 (Task #30): 분석 응답에서도 ACTION_CARD 파싱 → Message.actionCard 필드.
          // 신호 블록은 displayText에서 strip (raw 텍스트 노출 방지) — Phase 1-b 메인 파서와 동일 처리.
          const parsedActionCardAnalysis = parseActionCard(text1d)
          const displayText = (parsedActionCardAnalysis ? parsedActionCardAnalysis.cleanText : text1d).trimEnd()
          const newMsgIdAnalysis = Date.now().toString()
          addMessage({
            id: newMsgIdAnalysis,
            role: 'assistant',
            content: displayText,
            activityCode: currentActivity,
            activityType: '성찰',
            agentType: 'orchestrator',
            createdAt: Timestamp.now(),
            ...(parsedActionCardAnalysis ? { actionCard: parsedActionCardAnalysis.card, actionCardState: 'pending' as const } : {}),
          })
          clearStreamingText()
          saveMessage(proj.id, currentActivity, {
            role: 'assistant', content: displayText,
            activityCode: currentActivity, activityType: '성찰', agentType: 'orchestrator',
            ...(parsedActionCardAnalysis ? { actionCard: parsedActionCardAnalysis.card, actionCardState: 'pending' as const } : {}),
          }, newMsgIdAnalysis).catch(console.error)
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })

        }
      )
    } catch (err) {
      console.error('Analysis error:', err)
      setChatError('팀 토의 분석 중 오류가 발생했습니다. 다시 시도해 주세요.')
      clearStreamingText()
    }
    finally { setIsAnalyzing(false) }
  }

  const isTeamMode = discussionMode === 'team_discussion'
  const isHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid

  function pushGraphSelectionState(nextPinnedStandards: GraphPinnedStandard[], nextCheckedStandardIds: string[]) {
    if (!project?.id || !isHost) return
    lastGraphSelectionMutationAtRef.current = Date.now()
    setGraphSelectionState(project.id, {
      pinnedStandards: nextPinnedStandards,
      checkedStandardIds: nextCheckedStandardIds,
      updatedByUid: userProfile?.uid ?? null,
    }).catch((err) => {
      console.error('[setGraphSelectionState] 동기화 실패:', err)
    })
  }

  function restoreGraphSelection(savedData?: GraphSavedData | null) {
    const restored = buildGraphSelectionFromSavedData(savedData)
    pinnedStandardsRef.current = restored.pinnedStandards
    checkedGraphStandardIdsRef.current = restored.checkedStandardIds
    setPinnedStandards(restored.pinnedStandards)
    setCheckedGraphStandardIds(restored.checkedStandardIds)
    return restored
  }

  // ─── Firestore 팀원 산출물 제안 → 방장 확인 카드 ────
  const lastProposalAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isHost) return
    const proposal = proj.artifactProposal
    if (!proposal) return
    if (lastProposalAtRef.current === proposal.proposedAt) return
    lastProposalAtRef.current = proposal.proposedAt
    setPendingArtifactSave({
      title: `${proposal.proposedByName}의 산출물 저장 제안`,
      sections: proposal.sections,
      activityCode: proposal.activityCode,
      proposerName: proposal.proposedByName,
    })
  }, [isHost, proj.artifactProposal])

  const visibleMessages = useMemo(
    () => messages.filter(m => m.role !== 'system'),
    [messages]
  )

  // 마지막 AI 메시지에 선택지가 있으면 AI 대기 모드
  const lastAIMsg = useMemo(
    () => [...visibleMessages].reverse().find(m => m.role === 'assistant'),
    [visibleMessages]
  )
  const isWaitingForChoice = useMemo(
    () => !isTeamMode && !!lastAIMsg
      && lastAIMsg.activityCode === currentActivity
      && !!parseOptions(lastAIMsg.content),
    [isTeamMode, lastAIMsg, currentActivity]
  )

  // ─── 직접 메시지 전송 (HelpCard 등 버튼에서 호출) ──────
  async function sendMessageDirectly(text: string) {
    if (!text.trim() || isLoading || !project) return
    setIsIdle(false)
    setChatError(null)
    const senderDisplayName = userProfile?.displayName
    const tempUserMsg = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: text,
      activityCode: currentActivity,
      activityType: undefined,
      userId: userProfile?.uid,
      displayName: senderDisplayName,
      createdAt: Timestamp.now(),
    }
    addMessage(tempUserMsg)
    saveMessage(proj.id, currentActivity, {
      role: 'user', content: text,
      activityCode: currentActivity,
      userId: userProfile?.uid,
      displayName: senderDisplayName,
    }).catch(console.error)
    setIsLoading(true)
    clearStreamingText()
    streamingAccumRef.current = ''
    streamingFlushRef.current = setInterval(() => {
      if (streamingAccumRef.current && userProfile?.uid) {
        setStreamingState(proj.id, currentActivity, streamingAccumRef.current, userProfile.uid).catch(() => {})
      }
    }, 800)
    try {
      await streamFromAPI(
        [...messages, tempUserMsg].map(m => ({ role: m.role, content: m.content, displayName: m.displayName })),
        (chunk) => { appendStreamingText(chunk); streamingAccumRef.current += chunk },
        (fullText) => {
          const signal = parseDiscussionSignal(fullText)
          let t1 = signal ? signal.cleanText : fullText
          const advance = parseActivityAdvance(t1)
          t1 = advance ? advance.cleanText : t1
          const ret = parseActivityReturn(t1)
          const t2 = ret ? ret.cleanText : t1
          const { codes: cCodes, cleanText: t2c } = parseArtifactConfirm(t2)
          const { updates: upd, cleanText: t2d } = parseArtifactUpdates(t2c)
          const { cleanText: t2e, helpMessage: hm } = parseHelpCard(t2d)
          // Phase 1-b: ACTION_CARD 파싱 (§12-4 상호배제 규칙)
          const optionsPresentD = !!parseOptions(t2e)
          const conflictingD =
            signal ? 'TEAM_DISCUSSION_READY' :
            advance ? 'ACTIVITY_ADVANCE' :
            ret ? 'ACTIVITY_RETURN' :
            hm ? 'HELP_CARD' :
            optionsPresentD ? 'A안/B안' :
            null
          let parsedActionCardD: { card: ActionCard; cleanText: string } | null = null
          if (conflictingD) {
            if (process.env.NODE_ENV === 'development' && /\[ACTION_CARD:/.test(t2e)) {
              console.warn('[ACTION_CARD] 상호배제 규칙 위반 — 무시.', { conflictingWith: conflictingD })
            }
          } else {
            parsedActionCardD = parseActionCard(t2e)
          }
          const finalText = parsedActionCardD ? parsedActionCardD.cleanText : t2e.replace(/\n*\[ACTION_CARD:[^\]]+\]\n?/, '').trimEnd()
          if (streamingFlushRef.current) { clearInterval(streamingFlushRef.current); streamingFlushRef.current = null }
          const newMsgId = generateMessageId(proj.id, currentActivity)
          addMessage({ id: newMsgId, role: 'assistant', content: finalText, activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator', createdAt: Timestamp.now(),
            ...(parsedActionCardD ? { actionCard: parsedActionCardD.card, actionCardState: 'pending' as const } : {}),
          })
          if (hm) setHelpCardMap(prev => ({ ...prev, [newMsgId]: hm }))
          clearStreamingText()
          // 메시지 저장 완료 후 streaming 상태 삭제 → B 화면에서 공백 없이 메시지로 전환
          saveMessage(proj.id, currentActivity, {
            role: 'assistant', content: finalText, activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator',
            ...(parsedActionCardD ? { actionCard: parsedActionCardD.card, actionCardState: 'pending' as const } : {}),
          }, newMsgId)
            .then(() => clearStreamingState(proj.id, currentActivity, userProfile?.uid ?? ''))
            .catch(console.error)
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })
          upd.forEach(u => applyArtifactUpdates(u.sections, u.activityCode as ActivityCode | undefined, finalText))
          if (cCodes.length > 0) applyArtifactConfirm(cCodes)
          // P0-phil2 (Task #30): parseSaveIntent fallback 제거.
          // A안/B안 OptionsMessage가 이미 저장 결정을 묻는 중에 텍스트 패턴 매칭으로
          // "산출물 초안으로 저장할까요?" 카드를 또 띄우는 중복 UI 발생. 규칙 0-2/A안 게이트와 충돌.
          // 저장은 (a) A안/B안 명시 선택 또는 (b) ACTION_CARD primary 클릭 후 ARTIFACT_UPDATE 신호 경로만 허용.
          if (advance) setPendingAdvance(advance.nextActivity)
          else if (ret) handleActivityReturn(ret.targetActivity)
        }
      )
    } catch (err) {
      console.error('Chat error:', err)
      setChatError('AI 응답 중 오류가 발생했습니다. 다시 시도해주세요.')
      if (streamingFlushRef.current) { clearInterval(streamingFlushRef.current); streamingFlushRef.current = null }
      clearStreamingState(proj.id, currentActivity, userProfile?.uid ?? '').catch(() => {})
    } finally { setIsLoading(false) }
  }

  // ─── Phase 1-b: ACTION_CARD 버튼 핸들러 ──────────────────
  // primary/secondary: 라벨을 AI 채팅으로 전송 (방장만). skip: Firestore에 기록하고 메시지 상태 갱신 (모두 가능).
  async function handleActionCardClick(
    msg: Message,
    selection: 'primary' | 'secondary' | 'skip',
    label: string
  ) {
    if (!project || !msg.actionCard) return
    // 메시지 상태 갱신 — Firestore 업데이트 실패해도 낙관적 UI는 ActionCard 내부 clicked 플래그로 처리
    const state: 'selected' | 'skipped' = selection === 'skip' ? 'skipped' : 'selected'
    updateMessageActionCardState(proj.id, msg.activityCode, msg.id, state, selection).catch(console.error)

    if (selection === 'skip') {
      // 가치중립 skip — Firestore skippedActionCards 배열에 익명 기록 (재오픈 방지는 renderer가 담당)
      const entry: SkippedActionCard = {
        cardId: msg.id,
        activityCode: msg.activityCode,
        intent: msg.actionCard.intent,
        primary: msg.actionCard.primary,
        dismissedBy: userProfile?.uid ?? 'unknown',
        displayName: userProfile?.displayName ?? '팀원',
        dismissedAt: Date.now(),
      }
      recordActionCardSkip(proj.id, entry).catch(console.error)
      return
    }

    // primary/secondary — 방장만 도달. 라벨을 직접 채팅에 전송 (sendMessageDirectly 재사용)
    await sendMessageDirectly(label)
  }

  // ─── 메시지 전송 ──────────────────────────────────────
  async function handleSend() {
    if (!input.trim() || (isLoading && !isTeamMode && !isWaitingForChoice) || !project) return

    const userMessage = input.trim()
    setInput('')
    setIsIdle(false)  // 사용자 입력 시 idle 해제
    setChatError(null)  // 새 메시지 전송 시 이전 에러 초기화

    // memberInfo 캐시 대신 현재 프로필 이름을 직접 사용 (이름 변경 시 불일치 방지)
    const senderDisplayName = userProfile?.displayName

    // P3: Firestore ID 미리 생성 → 로컬 메시지와 Firestore 메시지 ID 동일
    const userMsgId = generateMessageId(proj.id, currentActivity)
    const tempUserMsg = {
      id: userMsgId,
      role: 'user' as const,
      content: userMessage,
      activityCode: currentActivity,
      activityType: isTeamMode ? '공유·협의' as const : undefined,
      userId: userProfile?.uid,
      displayName: senderDisplayName,
      replyTo: replyTo ?? undefined,
      createdAt: Timestamp.now(),
    }
    addMessage(tempUserMsg)
    saveMessage(proj.id, currentActivity, {
      role: 'user', content: userMessage,
      activityCode: currentActivity,
      activityType: isTeamMode ? '공유·협의' : undefined,
      userId: userProfile?.uid,
      displayName: senderDisplayName,
      replyTo: replyTo ?? undefined,
    }, userMsgId).catch(console.error)
    setReplyTo(null)

    // 팀 토의 모드 또는 선택 대기 중: AI 호출 없이 메시지만 저장
    if (isTeamMode || isWaitingForChoice) return

    setIsLoading(true)
    clearStreamingText()
    streamingAccumRef.current = ''
    // 즉시 빈 텍스트로 상태 전송 → 팀원 화면에 "대화를 기다리고 있어요" 즉시 표시
    if (userProfile?.uid) {
      setStreamingState(proj.id, currentActivity, '', userProfile.uid).catch(() => {})
    }
    // 800ms 간격으로 스트리밍 텍스트를 Firestore에 동기화 (다른 팀원도 볼 수 있도록)
    streamingFlushRef.current = setInterval(() => {
      if (userProfile?.uid) {
        setStreamingState(proj.id, currentActivity, streamingAccumRef.current, userProfile.uid).catch(() => {})
      }
    }, 800)
    try {
      await streamFromAPI(
        [...messages, tempUserMsg].map(m => ({ role: m.role, content: m.content, displayName: m.displayName })),
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
          const { updates, cleanText: text2d } = parseArtifactUpdates(text2c)
          const { cleanText: text2e, helpMessage } = parseHelpCard(text2d)
          // ─ Phase 1-b: ACTION_CARD 파싱 (상호배제 규칙 §12-4 준수) ─
          // 상위 체인에서 발견된 다른 신호(ADVANCE/RETURN/DISCUSSION_READY/HELP_CARD/A안·B안)가 있으면 ACTION_CARD 무시.
          // ARTIFACT_UPDATE/CONFIRM과는 공존 허용(§12-2).
          const optionsPresent = !!parseOptions(text2e)
          const conflictingWith =
            signal ? 'TEAM_DISCUSSION_READY' :
            advance ? 'ACTIVITY_ADVANCE' :
            ret ? 'ACTIVITY_RETURN' :
            helpMessage ? 'HELP_CARD' :
            optionsPresent ? 'A안/B안' :
            null
          let parsedActionCard: { card: ActionCard; cleanText: string } | null = null
          if (conflictingWith) {
            // ACTION_CARD 블록이 존재하더라도 drop. cleanText에서 제거만 수행.
            if (/\[ACTION_CARD:/.test(text2e)) {
              if (process.env.NODE_ENV === 'development') {
                console.warn('[ACTION_CARD] 상호배제 규칙 위반 — 다른 신호와 동시 사용. ACTION_CARD 무시.', { conflictingWith })
              }
            }
          } else {
            parsedActionCard = parseActionCard(text2e)
          }
          const cleanText = parsedActionCard ? parsedActionCard.cleanText : text2e.replace(/\n*\[ACTION_CARD:[^\]]+\]\n?/, '').trimEnd()
          const displayText = cleanText
          // interval 정리 + Firestore 스트리밍 상태 삭제
          if (streamingFlushRef.current) {
            clearInterval(streamingFlushRef.current)
            streamingFlushRef.current = null
          }
          const newMsgId = generateMessageId(proj.id, currentActivity)
          addMessage({
            id: newMsgId,
            role: 'assistant',
            content: displayText,
            activityCode: currentActivity,
            activityType: '생성',
            agentType: 'orchestrator',
            ...(parsedActionCard ? { actionCard: parsedActionCard.card, actionCardState: 'pending' as const } : {}),
            createdAt: Timestamp.now(),
          })
          if (helpMessage) setHelpCardMap(prev => ({ ...prev, [newMsgId]: helpMessage }))
          clearStreamingText()
          // 메시지 저장 완료 후 streaming 상태 삭제 → B 화면에서 공백 없이 메시지로 전환
          saveMessage(proj.id, currentActivity, {
            role: 'assistant', content: displayText,
            activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator',
            ...(parsedActionCard ? { actionCard: parsedActionCard.card, actionCardState: 'pending' as const } : {}),
          }, newMsgId)
            .then(() => clearStreamingState(proj.id, currentActivity, userProfile?.uid ?? ''))
            .catch((err) => { console.error(err); setChatError('메시지 저장에 실패했습니다. 내용은 화면에 표시되지만 새로고침 시 사라질 수 있습니다.') })
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })
          const hasSavedInResponse = updates.some(u => Object.keys(u.sections).length > 0)
          updates.forEach(u => applyArtifactUpdates(u.sections, u.activityCode as ActivityCode | undefined, displayText))
          if (confirmCodes2.length > 0) applyArtifactConfirm(confirmCodes2)

          // [ARTIFACT_UPDATE] 없이 저장 처리
          // P0-phil2 (Task #30): A-2-1 외 활동의 parseSaveIntent fallback 제거.
          // 일반 활동의 저장 경로는 (a) A안/B안 명시 선택 → ARTIFACT_UPDATE,
          // (b) ACTION_CARD primary 클릭 → 다음 턴 ARTIFACT_UPDATE 둘만 허용.
          // A-2-1은 마크다운 표 패턴 매칭으로 자동 산출물 추출하는 특수 경로 — 유지.
          if (!hasSavedInResponse && currentActivity === 'A-2-1') {
            const tableProposal = extractA21TableForSave(displayText)
            if (tableProposal) {
              setPendingArtifactSave({ ...tableProposal, activityCode: 'A-2-1' })
            }
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
      setChatError('AI 응답 중 오류가 발생했습니다. 다시 시도해주세요.')
      // 에러 시에도 스트리밍 상태 정리
      if (streamingFlushRef.current) {
        clearInterval(streamingFlushRef.current)
        streamingFlushRef.current = null
      }
      clearStreamingState(proj.id, currentActivity, userProfile?.uid ?? '').catch(() => {})
    }
    finally { setIsLoading(false) }
  }

  // ─── 슬래시 커맨드 필터링 ──────────────────────────
  // 팀원(!isHost)은 hostOnly=false 인 커맨드만 사용 가능. 현재는 /브리핑 단 하나.
  const filteredSlashCmds = slashQuery !== null
    ? SLASH_COMMANDS.filter(cmd => {
        if (cmd.hostOnly && !isHost) return false
        return slashQuery === '' ||
          cmd.label.includes(slashQuery) ||
          cmd.keywords.some(k => k.includes(slashQuery))
      })
    : []

  // ─── 슬래시 커맨드 실행 ─────────────────────────────
  async function executeSlashCommand(cmdId: SlashCommandId) {
    // 끝에 붙은 `/커맨드` 구문 제거. 앞부분 텍스트·공백은 보존 → 같은 메시지에서 추가 / 입력 가능.
    const cleanInput = input.replace(/(?:^|\s)\/([\w가-힣]*)$/, '').trimEnd()
    setInput(cleanInput)
    setSlashQuery(null)

    if ((isLoading || isAnalyzing) && cmdId !== 'team-chat') {
      setChatError('AI 응답이 진행 중입니다. 완료 후 다시 커맨드를 실행해주세요.')
      return
    }

    if (cmdId === 'team-chat') {
      if (isHost) setShowDiscussionConfirm(true)
      else await requestTeamDiscussion(proj.id, currentActivity, userProfile!.uid, userProfile!.displayName).catch(console.error)
    } else if (cmdId === 'artifact') {
      if (replyTo) {
        // 답글 대상 메시지 내용을 산출물로 저장 제안
        const content = replyTo.content.replace(/\[.*?\]/g, '').trim()
        applyArtifactUpdates({ [activityMeta.label]: content })
        setReplyTo(null)
      } else {
        await sendMessageDirectly('지금까지 논의된 내용을 산출물로 정리해서 저장해주세요')
      }
    } else if (cmdId === 'briefing') {
      await sendMessageDirectly('지금까지 완료된 모든 활동의 확정 산출물을 브리핑해주세요')
    } else if (cmdId === 'next') {
      handlePromptNextCommand()
    } else if (cmdId === 'standards') {
      setShowStandardsBrowser(true)
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
        void executeSlashCommand(filteredSlashCmds[slashCmdIdx].id)
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
          <ChatFontScaleControl />
          {/* 중요 노트 버튼 — 저장된 노트 카운트 표시, 클릭 시 모달 */}
          <button
            type="button"
            onClick={() => setShowKeyNotes(true)}
            title="저장된 중요 노트 보기"
            aria-label="중요 노트 보기"
            className="flex items-center gap-1 text-[11px] bg-[#FEF7E0] text-[#B06000]
              px-2 py-1.5 rounded-full font-semibold hover:bg-[#FDECC4] transition-colors flex-shrink-0 whitespace-nowrap"
          >
            <span aria-hidden>📌</span>
            <span className="tabular-nums">{proj.keyNotes?.length ?? 0}</span>
          </button>
          {/* 끊긴 대화 재시도 버튼: 마지막 메시지가 user이고 로딩 중이 아닐 때 */}
          {(() => {
            const lastMsg = messages[messages.length - 1]
            const canRetry = !isLoading && lastMsg && lastMsg.role === 'user'
            if (!canRetry) return null
            const retryContent = lastMsg.content
            return (
              <button
                onClick={() => sendMessageDirectly(retryContent)}
                className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border border-[#F28B82] bg-[#FCE8E6] text-[#C5221F] hover:bg-[#f9d2cf] transition-colors"
                title="AI 응답이 끊겼습니다. 다시 시도합니다"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.76-4.24L9 6h6V0l-1.35 2.35z"/>
                </svg>
                재시도
              </button>
            )
          })()}
          {/* 지식 그래프 토글 버튼 (A단계 활동에서만 표시) */}
          {GRAPH_ACTIVITIES.includes(currentActivity) && (
            <button
              onClick={() => {
                const next = !showGraphPanel
                setShowGraphPanel(next)
                if (next) {
                  // 헤더 버튼: 저장된 그래프가 있으면 복원, 없으면 빈 상태
                  // 키워드 검색 안 함 (사용자가 검색바에서 직접 입력)
                  setActiveGraphCodes([])  // 반영하기 코드 초기화
                  stableGraphKeywordRef.current = ' '
                  setStableGraphKeyword(' ')
                } else {
                  stableGraphKeywordRef.current = ''
                  setStableGraphKeyword('')
                }
                let selectionToShare = {
                  pinnedStandards,
                  checkedStandardIds: checkedGraphStandardIds,
                }

                if (next && !proj.graphSelectionState && proj.graphSavedData && pinnedStandards.length === 0 && checkedGraphStandardIds.length === 0) {
                  selectionToShare = restoreGraphSelection(proj.graphSavedData)
                }

                if (isHost) {
                  setGraphOpen(proj.id, next, next ? ' ' : undefined).catch(console.error)
                  if (next) {
                    pushGraphSelectionState(selectionToShare.pinnedStandards, selectionToShare.checkedStandardIds)
                  }
                }
              }}
              className={cn(
                'flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-full transition-colors',
                showGraphPanel
                  ? 'bg-[#7B1FA2] text-white border-2 border-[#7B1FA2] shadow-md'
                  : 'bg-white text-[#7B1FA2] border-2 border-[#CE93D8] hover:bg-[#F3E5F5] shadow-sm kg-graph-btn-rainbow',
              )}
              title="교육과정 지식 그래프"
            >
              <TreeStructure size={15} weight={showGraphPanel ? 'fill' : 'bold'} />
              지식 그래프 확인
              {isHost && <span className="text-[8px] opacity-70 ml-0.5">{showGraphPanel ? '공유중' : ''}</span>}
            </button>
          )}
          {/* 문제상황 개발 워크숍 버튼 (Ds-1-2 활동에서만 표시) */}
          {currentActivity === 'Ds-1-2' && (
            <button
              onClick={() => {
                const next = !showProblemSituationDesigner
                setShowProblemSituationDesigner(next)
                if (isHost) {
                  import('@/lib/firebase/projects').then(m =>
                    m.setProblemSituationOpen(proj.id, next).catch(console.error)
                  )
                }
              }}
              className={cn(
                'flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors',
                showProblemSituationDesigner
                  ? 'bg-[#00897B] text-white border-[#00897B]'
                  : 'bg-white text-[#00897B] border-[#80CBC4] hover:bg-[#E0F2F1]',
              )}
              title="문제상황 개발 워크숍"
            >
              <PencilRuler size={13} weight={showProblemSituationDesigner ? 'fill' : 'regular'} />
              문제상황 워크숍
              {isHost && <span className="text-[8px] opacity-70 ml-0.5">{showProblemSituationDesigner ? '공유중' : ''}</span>}
            </button>
          )}
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
              팀 자유 토의 중
            </span>
          )}
        </div>
      </div>

      {/* 팀 토의 배너 */}
      {isTeamMode && (
        <TeamDiscussionBanner
          topic={project.teamDiscussions?.[currentActivity]?.topic || '팀 자유 토의'}
          onEnd={handleEndDiscussionAndAnalyze}
          isHost={isHost}
        />
      )}

      {/* 가드레일 경고 배너: A-2-3 미완성 시 Ds 설계 활동에서 표시 */}
      {ACTIVITY_META[currentActivity]?.isGuardrailTarget && !hasA23Guardrail && (
        <div className="mx-4 mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#FFF8E1] border border-[#FFD54F]">
          <Warning size={16} weight="fill" className="text-[#F9A825] flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-[#795548] leading-snug">
            <span className="font-bold">A-2-3 학습자·맥락 분석</span>이 아직 완성되지 않았습니다.
            학습자 특성을 반영한 설계를 위해 A-2-3를 먼저 완료하는 것을 권장합니다.
          </p>
        </div>
      )}

      {/* 문제상황 디자이너 — Portal로 document.body에 렌더링 */}
      {/* currentActivity 조건 제거: Firestore 동기화로 currentActivity가 바뀌면 포털이 언마운트되어 상태가 초기화되는 버그 방지 */}
      {showProblemSituationDesigner && typeof document !== 'undefined' && (() => {
        const evalArtifact = proj.artifacts?.['Ds-1-1']
        const evaluationPlan = evalArtifact
          ? Object.entries(evalArtifact.content as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${v}`).join('\n')
          : undefined
        const a21Artifact = proj.artifacts?.['A-2-1']
        const achievementStandardsAnalysis = a21Artifact
          ? Object.entries(a21Artifact.content as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${v}`).join('\n')
          : undefined
        const a22Artifact = proj.artifacts?.['A-2-2']
        const learningObjective = a22Artifact
          ? Object.entries(a22Artifact.content as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${v}`).join('\n')
          : undefined
        const a23Artifact = proj.artifacts?.['A-2-3']
        const learnerProfile = a23Artifact
          ? Object.entries(a23Artifact.content as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${v}`).join('\n')
          : undefined

        return createPortal(
          <ProblemSituationDesigner
            projectId={proj.id}
            projectTitle={proj.title}
            targetGradeGroup={proj.targetGradeGroup}
            targetSubjects={proj.targetSubjects}
            graphSavedData={proj.graphSavedData as never}
            achievementStandardsAnalysis={achievementStandardsAnalysis}
            evaluationPlan={evaluationPlan}
            learningObjective={learningObjective}
            learnerProfile={learnerProfile}
            savedData={proj.problemSituationData ?? null}
            isLeader={isHost}
            onSave={async (data) => {
              const { saveProblemSituationData, setProjectArtifact } = await import('@/lib/firebase/projects')
              await saveProblemSituationData(proj.id, {
                scenario: data.scenario,
                drivingQuestion: data.drivingQuestion,
                essentialQuestions: data.essentialQuestions,
                fullResult: data.fullResult as Record<string, unknown> | undefined,
              })

              // 산출물(artifacts['Ds-1-2'])에 워크숍 결과 구조 그대로 저장
              const fr = data.fullResult as import('@/app/api/problem-situation/generate/route').ProblemSituationResult | undefined
              if (fr) {
                const artifactContent: Record<string, unknown> = {
                  '문제상황 후보': fr.candidates.map((c, i) => ({
                    번호: i + 1,
                    제목: c.title,
                    문제상황: c.scenario,
                    데이터출처: c.dataSources,
                    선정: fr.recommended.index === i,
                  })),
                  '선정 문제상황': {
                    제목: fr.recommended.title,
                    문제상황: fr.recommended.fullScenario,
                    성취기준연결: fr.recommended.standardsAlignment,
                    데이터출처: fr.recommended.realData,
                    교과별학습내용: fr.recommended.learningContent,
                    산출물: fr.recommended.artifacts,
                    AI점검: fr.recommended.alignmentCheck,
                  },
                  '핵심 질문': fr.drivingQuestion,
                  '탐구 질문': fr.essentialQuestions,
                }
                await setProjectArtifact(proj.id, 'Ds-1-2', {
                  status: 'confirmed',
                  title: fr.recommended.title,
                  content: artifactContent,
                  version: (proj.artifacts?.['Ds-1-2']?.version ?? 0) + 1,
                  confirmedBy: userProfile?.uid,
                  confirmedAt: Date.now(),
                }).catch(console.error)
              } else {
                // fallback: fullResult 없는 경우 (기존 저장 데이터 로드 후 저장)
                const eqList = data.essentialQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
                await setProjectArtifact(proj.id, 'Ds-1-2', {
                  status: 'confirmed',
                  title: data.scenario.title,
                  content: {
                    '문제상황': data.scenario.row1,
                    '교과별 학습 내용 및 산출물': data.scenario.row2,
                    '데이터 출처': data.scenario.row3,
                    '핵심 질문': data.drivingQuestion,
                    '탐구 질문': eqList,
                  },
                  version: (proj.artifacts?.['Ds-1-2']?.version ?? 0) + 1,
                  confirmedBy: userProfile?.uid,
                  confirmedAt: Date.now(),
                }).catch(console.error)
              }

              setShowProblemSituationDesigner(false)
              // 확정된 문제상황을 채팅 메시지로 주입
              const eqList = data.essentialQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
              const chatContent = [
                `✅ **문제상황이 확정 저장되었습니다**`,
                ``,
                `## 📋 ${data.scenario.title}`,
                ``,
                `**문제 상황**`,
                data.scenario.row1,
                ``,
                `**교과별 학습 내용 및 산출물**`,
                data.scenario.row2,
                ``,
                `**데이터 출처**`,
                data.scenario.row3,
                ``,
                `---`,
                ``,
                `## 🎯 핵심 질문`,
                data.drivingQuestion,
                ``,
                `## 🔍 탐구 질문`,
                eqList,
                ``,
                `---`,
                ``,
                `수정하거나 보완할 내용이 있으면 여기서 바로 말씀해 주세요.`,
              ].join('\n')
              const newMsgId = generateMessageId(proj.id, 'Ds-1-2')
              addMessage({ id: newMsgId, role: 'assistant', content: chatContent, activityCode: 'Ds-1-2', activityType: '제시', agentType: 'orchestrator', createdAt: Timestamp.now() })
              saveMessage(proj.id, 'Ds-1-2', { role: 'assistant', content: chatContent, activityCode: 'Ds-1-2', activityType: '제시', agentType: 'orchestrator' }, newMsgId).catch(console.error)
            }}
            onClose={() => {
              setShowProblemSituationDesigner(false)
              if (isHost) {
                import('@/lib/firebase/projects').then(m =>
                  m.setProblemSituationOpen(proj.id, false).catch(console.error)
                )
              }
            }}
          />,
          document.body,
        )
      })()}

      {/* 지식 그래프 모달 — Portal로 document.body에 렌더링 */}
      {showGraphPanel && GRAPH_ACTIVITIES.includes(currentActivity) && typeof document !== 'undefined' && (() => {
        // 그래프가 열린 시점의 keyword 사용 (채팅/산출물 업데이트로 인한 재fetch 방지)
        const graphKeyword = stableGraphKeyword || graphKeywordForShare

        return createPortal(
          <div
            className="fixed inset-0 z-[9000] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => {
              setShowGraphPanel(false)
              stableGraphKeywordRef.current = ''
              setStableGraphKeyword('')
              if (isHost) setGraphOpen(proj.id, false).catch(console.error)
            }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
              style={{ width: '94vw', maxWidth: 1400, height: '88vh' }}
              onClick={e => e.stopPropagation()}
            >
              {/* 모달 헤더 */}
              <div className="flex items-center justify-between px-5 py-3 bg-[#F3E5F5] border-b border-[#CE93D8] shrink-0">
                <span className="text-sm font-semibold text-[#7B1FA2] flex items-center gap-2 flex-1 min-w-0">
                  <TreeStructure size={16} weight="fill" className="shrink-0" />
                  <span className="shrink-0">교육과정 융합 지식 그래프</span>
                  {isHost && <span className="text-[9px] text-[#9C27B0] bg-white/70 px-1.5 py-0.5 rounded-full shrink-0">팀 공유 중</span>}
                  <div className="flex-1 min-w-0 flex items-center gap-1">
                    <input
                      id="graph-topic-input"
                      type="text"
                      defaultValue={graphKeyword.trim() || ''}
                      placeholder="수업 주제를 입력하고 검색을 누르면 관련 성취기준을 찾습니다"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim()
                          if (val && val !== stableGraphKeywordRef.current) {
                            stableGraphKeywordRef.current = val
                            setStableGraphKeyword(val)
                            if (isHost) setGraphOpen(proj.id, true, val).catch(console.error)
                          }
                        }
                      }}
                      className="flex-1 min-w-0 text-[12px] font-normal text-[#3D1C72] bg-white/80 border border-[#CE93D8] rounded-lg px-2.5 py-1 outline-none focus:border-[#7B1FA2] focus:ring-1 focus:ring-[#7B1FA2]/30 placeholder:text-[#CE93D8]/60"
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById('graph-topic-input') as HTMLInputElement | null
                        const val = input?.value.trim()
                        if (val && val !== stableGraphKeywordRef.current) {
                          stableGraphKeywordRef.current = val
                          setStableGraphKeyword(val)
                          if (isHost) setGraphOpen(proj.id, true, val).catch(console.error)
                        }
                      }}
                      className="shrink-0 px-2.5 py-1 bg-[#7B1FA2] hover:bg-[#6A1B9A] text-white text-[11px] font-bold rounded-lg transition-colors"
                    >
                      검색
                    </button>
                  </div>
                </span>
                <button
                  onClick={() => {
                    setShowGraphPanel(false)
                    stableGraphKeywordRef.current = ''
                    setStableGraphKeyword('')
                    if (isHost) setGraphOpen(proj.id, false).catch(console.error)
                  }}
                  className="text-[#9E9E9E] hover:text-[#7B1FA2] transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              {/* 그래프 본문 */}
              <div className="flex-1 min-h-0">
                <KnowledgeGraphViewer
                  keyword={graphKeyword}
                  gradeGroup={proj.targetGradeGroup}
                  height={undefined}
                  currentUserName={userProfile?.displayName ?? '나'}
                  currentUserUid={userProfile?.uid}
                  isLeader={isHost}
                  chatMentionedCodes={chatMentionedStds}
                  pinnedStandards={pinnedStandards}
                  onPinChange={(nextPins) => {
                    pinnedStandardsRef.current = nextPins
                    setPinnedStandards(nextPins)
                    if (isHost) pushGraphSelectionState(nextPins, checkedGraphStandardIdsRef.current)
                  }}
                  externalCheckedStandardIds={checkedGraphStandardIds}
                  onCheckedStandardsChange={(ids) => {
                    checkedGraphStandardIdsRef.current = ids
                    setCheckedGraphStandardIds(ids)
                    if (isHost) pushGraphSelectionState(pinnedStandardsRef.current, ids)
                  }}
                  onClose={() => { setShowGraphPanel(false); stableGraphKeywordRef.current = ''; setStableGraphKeyword('') }}
                  externalRecommendations={Object.values(proj.graphCenterRecommendations ?? {}).map(r => ({
                    nodeId: r.nodeId,
                    recommenderName: r.recommenderName,
                    recommenderUid: r.recommenderUid ?? undefined,
                  }))}
                  externalCenterNodeId={proj.graphCenterNodeId}
                  savedData={proj.graphSavedData ?? null}
                  artifactContext={(() => {
                    const parts: string[] = []
                    if (proj.targetGradeGroup) parts.push(`학년군: ${proj.targetGradeGroup}`)
                    if (proj.title) parts.push(`프로젝트: ${proj.title}`)
                    const arts = proj.artifacts ?? {}
                    for (const [code, art] of Object.entries(arts)) {
                      const c = art.content as Record<string, unknown>
                      const topic = (c['선택 주제'] || c['주제'] || c['수업 목표']) as string | undefined
                      if (topic) parts.push(`${code} 산출물 — ${topic}`)
                    }
                    return parts.join('\n') || undefined
                  })()}
                  onSetCenter={(nodeId) => {
                    setGraphCenter(proj.id, nodeId)
                  }}
                  onRecommendCenter={(nodeId) => {
                    recommendGraphCenter(proj.id, nodeId, userProfile?.displayName ?? '팀원', userProfile?.uid)
                  }}
                  onSaveGraph={isHost ? async (data) => {
                    // 방장만 저장 가능 — 상태/내용 저장만 (채팅 전송 없음)
                    try {
                      await saveGraphData(proj.id, data)
                      setShowGraphPanel(false)
                    } catch (e) {
                      console.error('[saveGraphData] 저장 실패:', e)
                    }
                  } : undefined}
                  onSendToChat={isHost ? async (data) => {
                    // 저장 + 채팅으로 분석 전송
                    saveGraphData(proj.id, data).catch(e => console.error('[saveGraphData] 저장 실패:', e))
                    setShowGraphPanel(false)

                    // 기본 정보 라인 구성
                    const lines: string[] = ['[지식 그래프 저장]']
                    if (data.centerNode) {
                      lines.push(`중심 성취기준: ${data.centerNode.label} — ${data.centerNode.text}`)
                    }
                    if (data.selectedStandards.length > 0) {
                      lines.push(`\n선택된 성취기준 (${data.selectedStandards.length}개):`)
                      data.selectedStandards.forEach(s => {
                        const rel = s.relationType ? ` | ${s.relationType}` : ''
                        const pct = s.score ? ` (${Math.round(s.score)}%)` : ''
                        lines.push(`• ${s.label} ${s.text}${rel}${pct}`)
                      })
                    }
                    if (data.agentNotes.length > 0) {
                      lines.push(`\nAgent 분석:`)
                      data.agentNotes.forEach(n => {
                        lines.push(`• ${n.explanation}${n.teachingNote ? ' → ' + n.teachingNote : ''}`)
                      })
                    }

                    // 즉시 사용자 메시지 + "분석 중…" 로딩 메시지를 먼저 표시
                    const userTriggerContent = lines.join('\n')
                    const userTriggerMsgId = generateMessageId(proj.id, currentActivity)
                    addMessage({ id: userTriggerMsgId, role: 'user', content: userTriggerContent, activityCode: currentActivity, userId: userProfile?.uid, displayName: userProfile?.displayName, createdAt: Timestamp.now() })
                    saveMessage(proj.id, currentActivity, { role: 'user', content: userTriggerContent, activityCode: currentActivity, userId: userProfile?.uid, displayName: userProfile?.displayName }, userTriggerMsgId).catch(console.error)

                    const loadingMsgId = generateMessageId(proj.id, currentActivity)
                    addMessage({ id: loadingMsgId, role: 'assistant', content: '성취기준 분석표를 생성하고 있습니다…', activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator', createdAt: Timestamp.now() })

                    // A-2-1: 표를 로컬에서 직접 생성 → AI 메시지로 직접 주입 (비동기)
                    ;(async () => {
                      try {
                        const a21Res = await fetch('/api/analyze/a21', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            centerNode: data.centerNode,
                            selectedStandards: data.selectedStandards,
                          }),
                        })
                        type A21Result = {
                          coreIdeas?: Array<{ subjectId: string; subjectName: string; selectedIdea: string; justification: string }>
                          standardAnalyses?: Array<{ standardId: string; standardLabel: string; subjectName: string; isCenterStandard: boolean; coreIdea: string; knowledgeUnderstanding: string[]; processFunction: string[]; valueAttitude: string[]; relationType?: string }>
                        }
                        const a21: A21Result = a21Res.ok ? await a21Res.json() : {}

                        if (a21.standardAnalyses && a21.standardAnalyses.length > 0) {
                          const tableLines: string[] = []
                          if (a21.coreIdeas && a21.coreIdeas.length > 0) {
                            tableLines.push('## 성취기준 분석\n')
                            a21.coreIdeas.forEach(ci => {
                              const isCenterSubj = ci.subjectId === data.centerNode?.subjectId
                              tableLines.push(`> ${isCenterSubj ? '★ ' : ''}**[${ci.subjectName}] 핵심아이디어**: ${ci.selectedIdea}`)
                            })
                            tableLines.push('')
                          }
                          tableLines.push('| 교과 | 성취기준 코드 | 핵심아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 비고 |')
                          tableLines.push('|------|:----------:|-----------|---------|---------|---------|:----:|')
                          a21.standardAnalyses.forEach(sa => {
                            const centerMark = sa.isCenterStandard ? '★ ' : ''
                            const bigo = sa.isCenterStandard ? '중심' : (sa.relationType ?? '연계')
                            tableLines.push(`| ${sa.subjectName} | ${centerMark}[${sa.standardLabel}] | ${sa.coreIdea} | ${sa.knowledgeUnderstanding.join(', ')} | ${sa.processFunction.join(', ')} | ${sa.valueAttitude.join(', ')} | ${bigo} |`)
                          })
                          tableLines.push('')
                          tableLines.push('**교과 간 융합 분석**\n')
                          const centerIdea = a21.coreIdeas?.find(ci => ci.subjectId === data.centerNode?.subjectId)
                          if (centerIdea) tableLines.push(`- **공통 핵심 개념**: ${centerIdea.selectedIdea}`)
                          const allPF = a21.standardAnalyses.flatMap(sa => sa.processFunction)
                          const pfFreq = new Map<string, number>()
                          allPF.forEach(p => pfFreq.set(p, (pfFreq.get(p) ?? 0) + 1))
                          const commonPF = [...pfFreq.entries()].filter(([, n]) => n > 1).map(([v]) => v).slice(0, 3)
                          if (commonPF.length > 0) tableLines.push(`- **공통 수행 기능**: ${commonPF.join(', ')}`)
                          const allKU = a21.standardAnalyses.flatMap(sa => sa.knowledgeUnderstanding)
                          const centerSa = a21.standardAnalyses.find(sa => sa.isCenterStandard)
                          tableLines.push(`- **루브릭 연계 핵심 지표**: ① ${allKU[0] ?? ''} ② ${centerSa?.processFunction[0] ?? ''} ③ ${centerSa?.valueAttitude[0] ?? ''}`)
                          tableLines.push('\n분석표를 확인하신 후, 우측에 나타나는 저장 버튼으로 산출물에 저장하실 수 있습니다. 수정이 필요하시면 말씀해 주세요.')

                          const localContent = tableLines.join('\n')
                          // 로딩 메시지를 실제 분석 결과로 교체
                          replaceMessage(loadingMsgId, localContent)
                          saveMessage(proj.id, currentActivity, { role: 'assistant', content: localContent, activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator' }, loadingMsgId).catch(console.error)
                          const tableProposal = extractA21TableForSave(localContent)
                          if (tableProposal) setPendingArtifactSave({ ...tableProposal, activityCode: 'A-2-1' })
                          return
                        }
                      } catch (e) {
                        console.error('[a21 API]', e)
                      }
                      // API 실패 폴백 — 로딩 메시지를 AI 요청으로 교체
                      const fallbackContent = lines.join('\n') + '\n위 성취기준을 바탕으로 아래 형식으로 분석표를 즉시 작성해 주세요:\n\n① 각 교과 핵심아이디어를 blockquote(>) 형식으로 먼저 제시 (중심 성취기준 교과에 ★)\n\n② 아래 7열 표 (성취기준 내용 열 없음, 반드시 이 열 구조 유지):\n| 교과 | 성취기준 코드 | 핵심아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 비고 |\n|------|:----------:|-----------|---------|---------|---------|:----:|\n\n③ 교과 간 융합 분석 (공통 개념 / 공통 기능 / 루브릭 연계 지표)'
                      replaceMessage(loadingMsgId, fallbackContent)
                      sendMessageDirectly(fallbackContent)
                    })()
                  } : undefined}
                />
              </div>
            </div>
          </div>,
          document.body
        )
      })()}

      {/* 메시지 목록 — chatFontScale로 메시지 영역만 독립 zoom */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative" style={{ zoom: chatFontScale }}>
        {visibleMessages.length === 0 && !streamingText && !isLoading && !messagesLoaded && (
          <div className="flex items-center justify-center h-full text-[#DADCE0]">
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={28} /></span>
          </div>
        )}

        {visibleMessages.map((msg) => {
          if (msg.role === 'system') return null

          // 분석 결과 메시지 (토의 종료 후)
          // P0-phil3 (Task #32): AnalysisBubble 포맷은 유지하면서 msg.actionCard가 있으면 ActionCard 3버튼을 바로 아래 렌더.
          //   (공통 L3047 분기는 MessageBubble 경로라 AnalysisBubble 포맷이 사라지므로, 이 분기 내부에서 처리.)
          if (msg.activityType === '성찰' && msg.role === 'assistant') {
            const stage = ACTIVITY_META[msg.activityCode]?.stage
            const isSelected = msg.actionCardState === 'selected' || msg.actionCardState === 'skipped'
            const selectedLabel = msg.actionCard
              ? (msg.actionCardSelection === 'primary' ? msg.actionCard.primary :
                 msg.actionCardSelection === 'secondary' ? (msg.actionCard.secondary ?? undefined) :
                 msg.actionCardSelection === 'skip' ? msg.actionCard.skip :
                 undefined)
              : undefined
            return (
              <ContextMenuWrapper key={msg.id} onReply={() => setReplyTo({ id: msg.id, content: msg.content, senderName: 'AI' })}>
                <AnalysisBubble text={msg.content} />
                {msg.actionCard && stage && (
                  <ActionCardComponent
                    card={msg.actionCard}
                    stage={stage}
                    isHost={isHost}
                    isSelected={isSelected}
                    selectedLabel={selectedLabel}
                    onPrimary={() => handleActionCardClick(msg, 'primary', msg.actionCard!.primary)}
                    onSecondary={msg.actionCard.secondary
                      ? () => handleActionCardClick(msg, 'secondary', msg.actionCard!.secondary!)
                      : undefined}
                    onSkip={() => handleActionCardClick(msg, 'skip', msg.actionCard!.skip)}
                  />
                )}
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
                    setInput('')
                    // 직접 handleSend 호출
                    const userMsg = {
                      id: Date.now().toString(),
                      role: 'user' as const,
                      content: displayReply, // 저장·표시에는 깔끔한 버전
                      activityCode: currentActivity,
                      userId: userProfile?.uid,
                      displayName: userProfile?.displayName,
                      createdAt: Timestamp.now(),
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
                      [...messages, apiMsg].map(m => ({ role: m.role, content: m.content, displayName: m.displayName })),
                      (text) => appendStreamingText(text),
                      (fullText) => {
                        const sig = parseDiscussionSignal(fullText)
                        const t1 = sig ? sig.cleanText : fullText
                        const adv = parseActivityAdvance(t1)
                        const t2 = adv ? adv.cleanText : t1
                        const { codes: selConfirmCodes, cleanText: t2c } = parseArtifactConfirm(t2)
                        const { updates: selUpdates, cleanText: t2d } = parseArtifactUpdates(t2c)
                        // Phase 1-b: 옵션 선택 응답에 ACTION_CARD는 의미 없음 — stray 블록 제거
                        const cleanText = t2d.replace(/\n*\[ACTION_CARD:[^\]]+\]\n?/, '').trimEnd()
                        addMessage({
                          id: (Date.now() + 1).toString(),
                          role: 'assistant', content: cleanText,
                          activityCode: currentActivity, activityType: '판단',
                          agentType: 'orchestrator',
                          createdAt: Timestamp.now(),
                        })
                        clearStreamingText()
                        saveMessage(proj.id, currentActivity, {
                          role: 'assistant', content: cleanText,
                          activityCode: currentActivity, activityType: '판단', agentType: 'orchestrator',
                        }).catch(console.error)
                        if (sig) setPendingTeamDiscussion({ topic: sig.topic })
                        const hasArtifactSave = selUpdates.some(u => Object.keys(u.sections).length > 0)
                        selUpdates.forEach(u => applyArtifactUpdates(u.sections, u.activityCode as ActivityCode | undefined, cleanText))
                        // [ARTIFACT_UPDATE]가 있는 응답에서는 [ARTIFACT_CONFIRM]과 [ACTIVITY_ADVANCE]를 무시
                        // → 팀장이 우측 패널에서 직접 확정해야 하고, 전진도 별도 메시지로만 가능
                        if (!hasArtifactSave) {
                          if (selConfirmCodes.length > 0) applyArtifactConfirm(selConfirmCodes)
                          if (adv) handleActivityAdvance(adv.nextActivity)
                        }
                      }
                    ).catch((err) => {
                      console.error('Option-select chat error:', err)
                      const msg = err instanceof Error ? err.message : 'AI 응답 중 오류가 발생했습니다.'
                      setChatError(`${msg} 다시 시도해주세요.`)
                      clearStreamingText()
                    }).finally(() => setIsLoading(false))
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

          // AI 메시지에 성취기준 코드가 2개 이상 포함됐는지 감지
          // — "[6사03-01]" 형태 코드가 2개 이상이면 (표/번호목록/불릿 모두 포함)
          const msgStdCodes = msg.role === 'assistant'
            ? (msg.content.match(/\[\d[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2}\]/g) ?? []).map(s => s.slice(1, -1))
            : []
          const hasStandardsTable = msgStdCodes.length >= 2

          // A-2-1: 산출물 저장 버튼 표시 조건
          // — A-2-1 AI 메시지에 핵심아이디어+성취기준 분석표가 있고 방장인 경우
          const isA21TableMsg = msg.role === 'assistant' && msg.activityCode === 'A-2-1' && !!extractA21TableForSave(msg.content)
          const a21ArtifactSaved = !!(proj.artifacts?.['A-2-1'])

          // A-2-1: 성취기준 코드 → 내용 툴팁 맵 (graphSavedData 기반)
          const stdTooltipMap: Record<string, string> | undefined =
            msg.role === 'assistant' && msg.activityCode === 'A-2-1' && proj.graphSavedData
              ? (() => {
                  const map: Record<string, string> = {}
                  const gd = proj.graphSavedData!
                  if (gd.centerNode) map[gd.centerNode.label] = gd.centerNode.text
                  gd.selectedStandards.forEach(s => { map[s.label] = s.text })
                  return map
                })()
              : undefined

          return (
            <div
              key={msg.id}
              onContextMenu={(e) => {
                e.preventDefault()
                setCtxMenu({
                  x: e.clientX, y: e.clientY,
                  message: {
                    id: msg.id,
                    content: msg.content,
                    role: msg.role as 'user' | 'assistant',
                    senderName: msg.role === 'user' ? senderName : undefined,
                    activityCode: msg.activityCode,
                  },
                })
              }}
            >
              <MessageBubble
                role={msg.role as 'user' | 'assistant'}
                content={msg.content}
                activityType={msg.activityType}
                senderName={senderName}
                senderColor={senderColor}
                senderEmoji={senderEmoji}
                isSelf={isSelf}
                replyTo={msg.replyTo}
                stage={ACTIVITY_META[msg.activityCode]?.stage}
                standardTextMap={stdTooltipMap}
                onReply={() => setReplyTo({
                  id: msg.id,
                  content: msg.content,
                  senderName: msg.role === 'user' ? senderName : 'AI',
                })}
              />
              {/* 성취기준 코드가 2개 이상인 AI 메시지 → 지식 그래프 반영 + 산출물 저장 버튼 */}
              {(hasStandardsTable && GRAPH_ACTIVITIES.includes(currentActivity) && isHost) || (isA21TableMsg && isHost) ? (
                <div className="flex justify-start pl-10 -mt-1 mb-2 gap-2 flex-wrap">
                  {hasStandardsTable && GRAPH_ACTIVITIES.includes(currentActivity) && isHost && (
                    <button
                      onClick={() => {
                        // 이 메시지의 성취기준 코드만 그래프에 전달 — 완전 초기화
                        setActiveGraphCodes(msgStdCodes.map(code => ({ code, addedBy: 'AI 추천' })))
                        setPinnedStandards([])  // 이전 수동 추가 초기화
                        pinnedStandardsRef.current = []
                        setCheckedGraphStandardIds([])  // 이전 토글 초기화
                        checkedGraphStandardIdsRef.current = []
                        setShowGraphPanel(true)
                        stableGraphKeywordRef.current = ' '
                        setStableGraphKeyword(' ')
                        if (isHost) {
                          setGraphOpen(proj.id, true, ' ').catch(console.error)
                          pushGraphSelectionState([], [])
                        }
                      }}
                      className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl border-2 border-[#7B1FA2] text-[#7B1FA2] bg-[#F3E5F5] hover:bg-[#E8CEF0] transition-colors shadow-sm"
                    >
                      <TreeStructure size={13} weight="fill" />
                      성취기준 {msgStdCodes.length}개를 지식 그래프에 반영하기
                    </button>
                  )}
                  {isA21TableMsg && isHost && (
                    a21ArtifactSaved ? (
                      <button
                        onClick={() => {
                          const proposal = extractA21TableForSave(msg.content)
                          if (proposal) setPendingArtifactSave({ ...proposal, activityCode: 'A-2-1' })
                        }}
                        className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border border-[#81C995] text-[#1E8C3A] bg-[#E6F4EA] hover:bg-[#CEEAD6] transition-colors shadow-sm"
                      >
                        <CheckCircle size={12} weight="fill" />
                        산출물 저장됨 · 다시 저장
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          const proposal = extractA21TableForSave(msg.content)
                          if (proposal) setPendingArtifactSave({ ...proposal, activityCode: 'A-2-1' })
                        }}
                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border border-[#AECBFA] text-[#1A73E8] bg-[#E8F0FE] hover:bg-[#C9DAF8] transition-colors shadow-sm"
                      >
                        <CheckCircle size={12} weight="fill" />
                        산출물에 저장
                      </button>
                    )
                  )}
                </div>
              ) : null}
              {/* HELP_CARD 렌더링 */}
              {msg.role === 'assistant' && helpCardMap[msg.id] && (
                <HelpCard
                  message={helpCardMap[msg.id]}
                  onSearchStandards={() => sendMessageDirectly('현재 활동에 맞는 성취기준을 찾아주세요')}
                  onShowExample={() => sendMessageDirectly('현재 활동의 다른 팀 사례나 예시를 보여주세요')}
                  onShowGuide={() => sendMessageDirectly('현재 위치와 앞으로 해야 할 일을 안내해주세요')}
                  onStartTeamDiscussion={() => {
                    requestTeamDiscussion(proj.id, currentActivity, userProfile?.uid ?? '', userProfile?.displayName ?? '').catch(console.error)
                  }}
                />
              )}
              {/* ACTION_CARD 렌더링 — Phase 1-b (flow-integrator) + Phase 1-c (ux-frontend-reviewer) */}
              {msg.role === 'assistant' && msg.actionCard && (() => {
                const stage = ACTIVITY_META[msg.activityCode]?.stage
                if (!stage) return null
                const isSelected = msg.actionCardState === 'selected' || msg.actionCardState === 'skipped'
                const selectedLabel =
                  msg.actionCardSelection === 'primary' ? msg.actionCard.primary :
                  msg.actionCardSelection === 'secondary' ? (msg.actionCard.secondary ?? undefined) :
                  msg.actionCardSelection === 'skip' ? msg.actionCard.skip :
                  undefined
                return (
                  <ActionCardComponent
                    card={msg.actionCard}
                    stage={stage}
                    isHost={isHost}
                    isSelected={isSelected}
                    selectedLabel={selectedLabel}
                    onPrimary={() => handleActionCardClick(msg, 'primary', msg.actionCard!.primary)}
                    onSecondary={msg.actionCard.secondary
                      ? () => handleActionCardClick(msg, 'secondary', msg.actionCard!.secondary!)
                      : undefined}
                    onSkip={() => handleActionCardClick(msg, 'skip', msg.actionCard!.skip)}
                  />
                )
              })()}
            </div>
          )
        })}

        {/* 성취기준 찾기 모달 — 선택한 성취기준을 채팅 입력창에 삽입 */}
        <StandardsFinderModal
          open={showStandardsBrowser}
          onClose={() => setShowStandardsBrowser(false)}
          onInsert={(md) => setInput(prev => (prev ? prev + '\n\n' : '') + md)}
        />

        {/* 중요 노트 모달 — 불러오기 버튼은 `@노트#N` 짧은 토큰만 삽입.
            실제 노트 내용은 서버에서 시스템 프롬프트의 "팀 중요 노트" 블록으로 AI에 전달되므로
            AI가 `@노트#N` 참조를 보고 올바른 내용을 연결. */}
        <KeyNotesModal
          open={showKeyNotes}
          onClose={() => setShowKeyNotes(false)}
          projectId={proj.id}
          notes={proj.keyNotes ?? []}
          currentUid={userProfile?.uid ?? ''}
          onInsertReference={(_note, number) => {
            const token = `@노트#${number} `
            setInput(prev => (prev ? prev + (prev.endsWith(' ') ? '' : ' ') : '') + token)
            setTimeout(() => {
              const el = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement | null
              el?.focus()
              if (el) { el.selectionStart = el.value.length; el.selectionEnd = el.value.length }
            }, 30)
          }}
        />

        {/* 채팅 메시지 우클릭 메뉴 */}
        <MessageContextMenu
          open={ctxMenu !== null}
          x={ctxMenu?.x ?? 0}
          y={ctxMenu?.y ?? 0}
          onClose={() => setCtxMenu(null)}
          onReply={ctxMenu ? () => setReplyTo({
            id: ctxMenu.message.id,
            content: ctxMenu.message.content,
            senderName: ctxMenu.message.role === 'user' ? ctxMenu.message.senderName : 'AI',
          }) : undefined}
          onSaveKeyNote={() => {
            if (!ctxMenu || !userProfile) return
            // AI 신호(대괄호 블록 등) 제거 후 저장
            const cleaned = ctxMenu.message.content
              .replace(/\[(?:ARTIFACT_UPDATE|ARTIFACT_CONFIRM|ACTION_CARD|ACTIVITY_ADVANCE|ACTIVITY_RETURN|HELP_CARD|TEAM_DISCUSSION_READY|STANDARD_SEARCH)[\s\S]*?\]/g, '')
              .trim()
            if (!cleaned) return
            const note: KeyNote = {
              id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              // 충분한 길이 허용 — 표·다단 구조를 온전히 보존. Firestore 문서 1MB 한도에 여유.
              content: cleaned.slice(0, 6000),
              sourceActivityCode: (ctxMenu.message.activityCode as KeyNote['sourceActivityCode']) || undefined,
              sourceRole: ctxMenu.message.role,
              sourceDisplayName: ctxMenu.message.senderName,
              savedBy: userProfile.uid,
              savedByName: userProfile.displayName,
              savedAt: Date.now(),
            }
            addKeyNote(proj.id, note).catch(err => {
              console.error('[keyNotes] save failed', err)
              setChatError('중요 노트 저장에 실패했습니다. 다시 시도해주세요.')
            })
          }}
          onCopy={() => {
            if (!ctxMenu) return
            navigator.clipboard.writeText(ctxMenu.message.content).catch(() => {})
          }}
        />

        {/* 팀 채팅 시작 확인 카드 */}
        {isHost && showDiscussionConfirm && !isTeamMode && (
          <div className="mx-0 my-3 bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-[#00897B] flex items-center justify-center flex-shrink-0">
                <Users size={18} weight="fill" className="text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#004D40] mb-1">팀 채팅을 시작할까요?</p>
                <p className="text-xs text-[#00695C] mb-3 leading-relaxed">
                  AI 없이 팀원끼리 자유롭게 대화하는 시간입니다.<br />
                  토의가 끝나면 AI가 내용을 분석해 드립니다.
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

        {/* 팀 토의 제안 카드 (AI가 제안한 경우) */}
        {isHost && pendingTeamDiscussion && !isTeamMode && !showDiscussionConfirm && (
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
            onDecline={() => {
              setPendingArtifactSave(null)
              if (project?.id && project.artifactProposal) {
                clearArtifactProposal(project.id).catch(console.error)
              }
            }}
          />
        )}

        {/* 다음 단계 이동 확인 배너 — 팀장만 */}
        {pendingAdvance && isHost && (() => {
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
                    try {
                      const ready = await ensureCurrentArtifactSavedAndConfirmed()
                      if (!ready) return
                      await handleActivityAdvance(pendingAdvance)
                      setPendingAdvance(null)
                    } catch {
                      setChatError('산출물 확정 저장에 실패했습니다. 다시 시도해주세요.')
                    }
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
        <StreamingBubble text={streamingText} isAnalysis={isAnalyzing} stage={ACTIVITY_META[currentActivity]?.stage} />
        {/* 스트리밍 - 다른 팀원이 보낸 경우 (Firestore 공유) */}
        {!isLoading && isRemoteLoading && !remoteStreamingText && <AIIdleBubble />}
        {!isLoading && remoteStreamingText && (
          <StreamingBubble text={remoteStreamingText} isAnalysis={false} stage={ACTIVITY_META[currentActivity]?.stage} />
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
        {/* 채팅 에러 배너 */}
        {chatError && (
          <div className="flex items-center gap-2 mb-1.5 px-3 py-2 rounded-xl bg-[#FCE8E6] border border-[#F28B82]">
            <Warning size={16} weight="fill" className="text-[#C5221F] flex-shrink-0" />
            <span className="text-[12px] text-[#C5221F] flex-1">{chatError}</span>
            <button
              onClick={() => setChatError(null)}
              className="text-[#C5221F] hover:text-[#a51c19] leading-none flex-shrink-0"
            >
              <X size={14} weight="regular" />
            </button>
          </div>
        )}

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
                onMouseDown={(e) => { e.preventDefault(); void executeSlashCommand(cmd.id) }}
                onMouseEnter={() => setSlashCmdIdx(i)}
              >
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

        {/* 저장된 지식 그래프 확인 바 */}
        {proj.graphSavedData && GRAPH_ACTIVITIES.includes(currentActivity) && !showGraphPanel && (
          <button
            onClick={() => {
              setActiveGraphCodes([])
              stableGraphKeywordRef.current = ' '
              setStableGraphKeyword(' ')
              setShowGraphPanel(true)
              if (isHost) setGraphOpen(proj.id, true, ' ').catch(console.error)
              // 저장된 선택 상태 복원 (호스트 포함)
              if (proj.graphSelectionState) {
                setPinnedStandards(proj.graphSelectionState.pinnedStandards ?? [])
                setCheckedGraphStandardIds(proj.graphSelectionState.checkedStandardIds ?? [])
              } else if (proj.graphSavedData) {
                const restored = buildGraphSelectionFromSavedData(proj.graphSavedData)
                if (restored.pinnedStandards.length > 0) setPinnedStandards(restored.pinnedStandards)
                if (restored.checkedStandardIds.length > 0) setCheckedGraphStandardIds(restored.checkedStandardIds)
              }
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 mb-2 rounded-xl bg-[#F3E5F5] border border-[#CE93D8] text-[#7B1FA2] text-[12px] font-semibold hover:bg-[#E8CEF0] transition-colors"
          >
            <TreeStructure size={14} weight="fill" />
            저장된 지식 그래프 확인하기
            {proj.graphSavedData.centerNode && (
              <span className="text-[10px] font-normal text-[#9C27B0]">
                (중심: {proj.graphSavedData.centerNode.label})
              </span>
            )}
          </button>
        )}

        <div className="flex gap-2 items-end">
          <div className={cn('chat-input-wrap flex-1', isTeamMode && 'chat-input-wrap-team')}>
            <div className={cn('chat-input-inner', isTeamMode ? 'bg-[#E0F2F1]' : 'bg-white')}>
              <textarea
                data-chat-input=""
                value={input}
                onChange={(e) => {
                  const val = e.target.value
                  setInput(val)
                  // 슬래시 커맨드 감지: `/` 가 입력 시작·공백·줄바꿈 뒤에 위치하고 끝에 있으면 팔레트 열림.
                  // 한 메시지 안에서 여러 번 사용 가능 (성취기준 2개 연속 삽입 등).
                  const match = val.match(/(?:^|\s)\/([\w가-힣]*)$/)
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
