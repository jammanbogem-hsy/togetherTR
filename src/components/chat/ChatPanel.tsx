'use client'

import { ModalLoading } from '@/components/ui/ModalLoading'
const StandardsFinderModal = dynamic(() => import('./StandardsFinderModal').then(module => module.StandardsFinderModal), { ssr: false, loading: ModalLoading })
const CoreIdeaFinderModal = dynamic(() => import('./CoreIdeaFinderModal').then(module => module.CoreIdeaFinderModal), { ssr: false, loading: ModalLoading })
const CurriculumWorkspaceModal = dynamic(() => import('./CurriculumWorkspaceModal').then(module => module.CurriculumWorkspaceModal), { ssr: false, loading: ModalLoading })
const TeamVisionWorkspaceModal = dynamic(() => import('@/components/artifacts/TeamVisionWorkspaceModal').then(module => module.TeamVisionWorkspaceModal), { ssr: false, loading: ModalLoading })
const LessonDesignDirectionWorkspaceModal = dynamic(() => import('@/components/artifacts/LessonDesignDirectionWorkspaceModal').then(module => module.LessonDesignDirectionWorkspaceModal), { ssr: false, loading: ModalLoading })
const EvaluationPlanWorkspaceModal = dynamic(() => import('@/components/artifacts/EvaluationPlanWorkspaceModal').then(module => module.EvaluationPlanWorkspaceModal), { ssr: false, loading: ModalLoading })
const ProblemSituationWorkspaceModal = dynamic(() => import('@/components/artifacts/ProblemSituationWorkspaceModal').then(module => module.ProblemSituationWorkspaceModal), { ssr: false, loading: ModalLoading })
const SupportToolWorkspaceModal = dynamic(() => import('@/components/artifacts/SupportToolWorkspaceModal').then(module => module.SupportToolWorkspaceModal), { ssr: false, loading: ModalLoading })
const IntegratedGoalWorkspaceModal = dynamic(() => import('@/components/artifacts/IntegratedGoalWorkspaceModal').then(module => module.IntegratedGoalWorkspaceModal), { ssr: false, loading: ModalLoading })
const CoeditWorkspaceModal = dynamic(() => import('@/components/artifacts/CoeditWorkspaceModal').then(module => module.CoeditWorkspaceModal), { ssr: false, loading: ModalLoading })
const RoleDistributionWorkspaceModal = dynamic(() => import('@/components/artifacts/RoleDistributionWorkspaceModal').then(module => module.RoleDistributionWorkspaceModal), { ssr: false, loading: ModalLoading })
const TeamRulesWorkspaceModal = dynamic(() => import('@/components/artifacts/TeamRulesWorkspaceModal').then(module => module.TeamRulesWorkspaceModal), { ssr: false, loading: ModalLoading })
const TeamScheduleWorkspaceModal = dynamic(() => import('@/components/artifacts/TeamScheduleWorkspaceModal').then(module => module.TeamScheduleWorkspaceModal), { ssr: false, loading: ModalLoading })
const TopicSelectionWorkspaceModal = dynamic(() => import('@/components/artifacts/TopicSelectionWorkspaceModal').then(module => module.TopicSelectionWorkspaceModal), { ssr: false, loading: ModalLoading })
const LearningActivityWorkspaceModal = dynamic(() => import('@/components/artifacts/LearningActivityWorkspaceModal').then(module => module.LearningActivityWorkspaceModal), { ssr: false, loading: ModalLoading })
const ScaffoldingWorkspaceModal = dynamic(() => import('@/components/artifacts/ScaffoldingWorkspaceModal').then(module => module.ScaffoldingWorkspaceModal), { ssr: false, loading: ModalLoading })


import { navigateOptimistically } from '@/lib/activity/optimisticNavigation'
import { createChatDraft } from '@/lib/chat/chatDraft'
import { ChatDraftBoundary, MessageList, useStableCallback, markChatInput } from './ChatRenderBoundary'
import { samePresenceEntry } from '@/lib/coedit/presenceThrottle'

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/store/project'
import { isDemoObservationOnly } from '@/lib/demo/observer'
import { hasDeferredDecision, deferredResponse, discussionContributions } from '@/lib/activity/conversation-flow'
import { DemoObserverChat } from '@/components/demo/DemoObserverPanels'
import { ACTIVITY_META, STAGES, displayActivityCode, type ActivityType, type ActivityCode, type ActionCard, type SkippedActionCard, type Message } from '@/types'
import { ACTIVITY_WELCOME, SOLO_ACTIVITY_WELCOME } from '@/lib/prompts/system'
import { serializeArtifactForPrompt } from '@/lib/artifacts/serializeArtifactForPrompt'
import { removeMember, syncProjectModeIfNeeded, saveMessage, saveMessageIfAbsent, generateMessageId, setTeamDiscussion, setOptionVote, closeOptionChoice, advanceActivity, returnToActivity, setActivityStatus, requestTeamDiscussion, clearTeamDiscussionRequest, setStreamingState, clearStreamingState, watchStreamingState, setProjectArtifact, setGraphOpen, recommendGraphCenter, setGraphCenter, saveGraphData, setGraphSelectionState, proposeArtifactToHost, clearArtifactProposal, recordActionCardSkip, updateMessageActionCardState, patchCurriculumSheet, updateCurriculumSheetSettings, patchTeamVisionWorkspace, setTeamVisionWorkspacePresence, watchTeamVisionWorkspacePresence, patchIntegratedGoalWorkspace, setIntegratedGoalWorkspacePresence, watchIntegratedGoalWorkspacePresence, patchLessonDesignDirectionWorkspace, setLessonDesignDirectionWorkspacePresence, watchLessonDesignDirectionWorkspacePresence, patchRoleDistributionWorkspace, setRoleDistributionWorkspacePresence, watchRoleDistributionWorkspacePresence, patchTeamRulesWorkspace, setTeamRulesWorkspacePresence, watchTeamRulesWorkspacePresence, patchTeamScheduleWorkspace, setTeamScheduleWorkspacePresence, watchTeamScheduleWorkspacePresence, patchTopicSelectionWorkspace, setTopicSelectionWorkspacePresence, watchTopicSelectionWorkspacePresence, patchEvaluationPlanWorkspace, setEvaluationPlanWorkspacePresence, watchEvaluationPlanWorkspacePresence, patchProblemSituationWorkspace, setProblemSituationWorkspacePresence, watchProblemSituationWorkspacePresence, patchLearningActivityWorkspace, setLearningActivityWorkspacePresence, watchLearningActivityWorkspacePresence, patchSupportToolWorkspace, setSupportToolWorkspacePresence, watchSupportToolWorkspacePresence, patchScaffoldingWorkspace, setScaffoldingWorkspacePresence, watchScaffoldingWorkspacePresence, patchMaterialDevWorkspace, setMaterialDevWorkspacePresence, watchMaterialDevWorkspacePresence, emptyMaterialDevWorkspace, patchLessonRecordWorkspace, setLessonRecordWorkspacePresence, watchLessonRecordWorkspacePresence, emptyLessonRecordWorkspace, patchLessonReflectionWorkspace, setLessonReflectionWorkspacePresence, watchLessonReflectionWorkspacePresence, emptyLessonReflectionWorkspace, patchCollaborationReflectionWorkspace, setCollaborationReflectionWorkspacePresence, watchCollaborationReflectionWorkspacePresence, emptyCollaborationReflectionWorkspace, buildCollaborationAgreementRows, updateTeamGradeBands, proposeTeamGradeBands, resolveTeamGradeBandProposal } from '@/lib/firebase/projects'
import type { IntegratedGoalPresenceEntry, TeamVisionPresenceEntry, LessonDesignDirectionPresenceEntry, LessonDesignDirectionWorkspacePatch, RoleDistributionPresenceEntry, RoleDistributionWorkspacePatch, TeamRulesPresenceEntry, TeamRulesWorkspacePatch, TeamSchedulePresenceEntry, TeamScheduleWorkspacePatch, TopicSelectionPresenceEntry, TopicSelectionWorkspacePatch, EvaluationPlanPresenceEntry, EvaluationPlanWorkspacePatch, ProblemSituationPresenceEntry, ProblemSituationWorkspacePatch, LearningActivityPresenceEntry, LearningActivityWorkspacePatch, SupportToolPresenceEntry, SupportToolWorkspacePatch, ScaffoldingPresenceEntry, ScaffoldingWorkspacePatch, CoeditPresenceEntry, CoeditWorkspacePatch } from '@/lib/firebase/projects'
import type { TeamVisionWorkspacePatch, IntegratedGoalWorkspacePatch } from '@/lib/firebase/projects'
import { Timestamp } from 'firebase/firestore'
import type { GraphPinnedStandard, GraphSavedData } from '@/lib/knowledge-graph/domain'
import { TeamDiscussionBanner } from './TeamDiscussionBanner'
import { TeamDiscussionProposal } from './TeamDiscussionProposal'
import { HelpCard } from './HelpCard'
import { ArtifactSaveProposal } from './ArtifactSaveProposal'
import { ActionCard as ActionCardComponent } from './ActionCard'
import { useChatFontScale } from '@/components/accessibility/FontScaleControl'
import { ChatPanelHeader } from '@/components/chat/ChatPanelHeader'
import { useProblemSituationOpen } from './useProblemSituationOpen'


import { KeyNotesModal, MessageContextMenu } from './KeyNotesModal'





import { WorkshopErrorBoundary } from '@/components/problem-situation/WorkshopErrorBoundary'


import { type CoeditSuggestContext } from '@/components/artifacts/CoeditWorkspaceModal'
import { MATERIAL_DEV_CONFIG, LESSON_RECORD_CONFIG, LESSON_REFLECTION_CONFIG, COLLABORATION_REFLECTION_CONFIG } from '@/components/artifacts/coeditConfigs'






import type { T11Structured, T12Structured, T21Structured, T22Structured, T23Structured, A12Structured, A22Structured, Ds11Structured, Ds12Structured, Ds13Structured, Ds21Structured, Ds22Structured } from '@/lib/artifacts/schemas'
import {
  SANITIZE_EXEMPT_KEYS,
  buildA12Structured,
  buildA21Structured,
  buildA22Structured,
  buildA23Structured,
  buildDs11Structured,
  buildDs12Structured,
  buildDs21Structured,
  buildT11Structured,
  buildT12Structured,
  buildT21Structured,
  buildT22Structured,
  buildT23Structured,
  detectMissingFields,
  sanitizeArtifactSections,
  sanitizeChatForExtraction,
  stripNonContentLines,
} from '@/lib/artifacts/schemas'
import { addKeyNote, setMessageChecklistItem } from '@/lib/firebase/projects'
import { buildCurriculumSheetArtifactProposal, mergeGraphAgentExamplesIntoRows } from '@/lib/curriculum/graphSheetBridge'
import { defaultGradeMode, effectiveRowGradeBand, resolveSheetGradeBand, toGradeBandLabel } from '@/lib/curriculum/sheetGradeBands'
import { parseTeamGradeBandsSignal, normalizeTeamGradeBands, formatGradeBandList } from '@/lib/curriculum/teamGradeBands'
import { designStandardSources, extractStandardCodes } from '@/lib/curriculum/standardCodes'
import { appendSaveGateNotice } from '@/lib/chat/evidenceCodeGate'
import { gateArtifactSave, previousSectionText } from '@/lib/chat/artifactSaveGate'
import { CHECKLIST_ALL_DONE_NOTE, checklistProgress, parseChecklistMark, prepareChecklistMarkdown, type ChecklistState } from '@/lib/chat/checklist'
import { buildTrainingWelcome, displayedMessageContent, isTrainingActivity, shouldReplyTrainingQuietly, trainingMessageChip, trainingSaveNoticeChip, TRAINING_QUIET_REPLY, TRAINING_SEND_EVENT } from '@/lib/training/trainingMode'
import { TrainingModeBar } from '@/components/training/TrainingModeBar'
import { needsMultiBandModeRepair } from '@/lib/curriculum/teamGradeBandState'
import type { CurriculumSheetRow, KeyNote } from '@/types'
import { cn } from '@/lib/utils'
import { GraphWorkspaceHeader } from '@/components/knowledge-graph/GraphWorkspaceHeader'
import { MD3Button, MD3_ICON } from '@/components/ui/MD3Button'
import { Avatar, AvatarChip } from '@/components/ui/Avatar'
import ReactMarkdown, { type Components } from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { remarkShortColumns } from '@/lib/markdown/tableColumnWidth'
import {
  ListChecks, CheckCircle, Shield, Star, ArrowBendUpLeft, ArrowDown, Chat,
  Users, StopCircle, SpinnerGap, PaperPlaneRight, Warning, X, TreeStructure, PencilRuler, PencilSimple,
} from '@phosphor-icons/react'
import dynamic from 'next/dynamic'
import {
  parseActivityAdvance,
  parseActivityReturn,
  parseArtifactConfirm,
  parseArtifactUpdates,
} from '@/lib/chat/signals'
import { applyArtifactSignalBatch, artifactContentEquals } from '@/lib/chat/artifactSignalBatch'
import { isStaleActivityResponse } from '@/lib/chat/responseContext'
import { chatSendBlockReason } from '@/lib/chat/sendReadiness'
import { sanitizeAssistantText } from '@/lib/chat/sanitizeAssistantText'
import { shouldCreateWelcomeMessage } from '@/lib/activity/navigationDecisions'
import { validateRequiredSections } from '@/lib/activity/completion'
import { effectiveProjectMode, isSoloProject, needsProjectModeSync } from '@/lib/project/projectMode'
import { classifyMemberCommand, MEMBER_ADMIN_ERROR_COPY, type MemberAdminError, type MemberRef } from '@/lib/project/memberAdmin'
import { MemberCommandPanel, type MemberCommandState } from './MemberCommandPanel'

const KnowledgeGraphViewer = dynamic(
  () => import('@/components/knowledge-graph/KnowledgeGraphViewer'),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-[#9AA0A6] text-sm">그래프 로딩 중…</div> },
)

const ProblemSituationDesigner = dynamic(
  () => import('@/components/problem-situation/ProblemSituationDesigner'),
  { ssr: false },
)

const GRAPH_ACTIVITIES: ActivityCode[] = ['A-2-1']

const artifactSchemas = {
  buildA12Structured,
  buildA21Structured,
  buildA22Structured,
  buildA23Structured,
  buildDs11Structured,
  buildDs12Structured,
  buildDs21Structured,
  buildT11Structured,
  buildT12Structured,
  buildT21Structured,
  buildT22Structured,
  buildT23Structured,
}

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

const INTERNAL_ACTIVITY_CODE_RE = /\b(?:T|A|Ds|DI|E)-[12]-[123]\b/g

function displayActivityCodesInText(text: string): string {
  return text.replace(INTERNAL_ACTIVITY_CODE_RE, code => displayActivityCode(code))
}

function parseOptions(text: string): ParsedOptions | null {
  // ⚠️ schemas.ts의 CHOICE_LABEL_RE(산출물 오염 필터)와 짝 규칙:
  // 여기서 선택지 카드로 렌더링되는 라벨 패턴은 반드시 CHOICE_LABEL_RE가 걸러낼 수 있어야 한다.
  // 라벨 문법을 넓힐 때는 CHOICE_LABEL_RE도 함께 넓힐 것.
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
// @MX:NOTE: Keep team option voting dormant until the shared choice flow is reintroduced.
const TEAM_OPTION_VOTING_ENABLED = false

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
                        {m.displayName?.[0] || '?'}
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
  messageId, pre, options, post, onSelect, onDiscuss,
  votes, memberInfo, currentUid, isHost, isClosed,
}: ParsedOptions & {
  messageId: string
  onSelect: (label: string, content: string) => Promise<void>
  onDiscuss: () => Promise<void>
  votes: Record<string, string>
  memberInfo: MemberInfoMap
  currentUid: string
  isHost: boolean
  isClosed: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const myVote = votes[currentUid] ?? null

  function handleFinalSelect(label: string, content: string) {
    if (selected) return
    setSelected(label)
    void onSelect(label, content).catch(() => setSelected(null))
  }

  function handleDiscuss() {
    if (selected) return
    setSelected('재논의')
    void onDiscuss().catch(() => setSelected(null))
  }

  return (
    <article className="flex gap-2 mb-3" aria-label="AI 공동설계자의 선택지 제안">
      <Avatar className="chat-avatar-animated self-start" ai size={40} />
      <div className="max-w-[min(88%,46rem)] flex flex-col gap-3 flex-1">
        {pre && (
          <div className="bg-[#EAF2FF] text-[#1a2e5a] px-4 py-2.5 rounded-2xl rounded-tl-none border-l-[3px] border-[#4285F4] text-sm leading-relaxed">
            <MemoMarkdownContent text={pre} />
          </div>
        )}

        {options.map((opt, i) => {
          const c = OPTION_COLORS[i % OPTION_COLORS.length]
          const isChosen = selected === opt.label
          const isDimmed = isClosed || (!!selected && !isChosen)
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
                <p className="flex-1 text-sm text-gray-800 leading-relaxed">&ldquo;{displayActivityCodesInText(opt.content)}&rdquo;</p>
              </div>

              {/* 투표 현황: 이 안을 지지한 팀원들 */}
              {TEAM_OPTION_VOTING_ENABLED && voters.length > 0 && (
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
                        {v.displayName?.[0] || '?'}
                      </span>
                      {v.displayName}
                      {v.isSelf && <span className="text-[10px] text-gray-400">(나)</span>}
                    </span>
                  ))}
                </div>
              )}

              {/* 호스트만: 최종 결정 버튼 */}
              {isHost && !isClosed && (
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
              {TEAM_OPTION_VOTING_ENABLED && !isHost && myVote === opt.label && (
                <div className="mt-2.5 flex justify-end">
                  <span className="flex items-center gap-1 text-xs font-semibold text-[#5F6368]">
                    <CheckCircle size={16} weight="fill" className="text-[#34A853]" /> 내가 지지
                  </span>
                </div>
              )}
            </div>
          )
        })}

        {/* 이 중에는 없다 — 선택 대기를 종료하고 기본 AI 대화로 복귀 */}
        {isHost && !selected && !isClosed && (
          <button
            onClick={handleDiscuss}
            className="self-start text-[11px] text-[#5F6368] hover:text-[#C62828] underline underline-offset-2 transition-colors"
          >
            이 중에는 없다 — 다시 논의하기
          </button>
        )}
        {isClosed && (
          <p className="self-start rounded-full bg-[#F1F3F4] px-3 py-1.5 text-[11px] font-semibold text-[#5F6368]">
            기존 안 선택 종료 · 기본 대화로 전환됨
          </p>
        )}

        {post && (
          <div className="bg-[#EAF2FF] text-[#1a2e5a] px-4 py-2.5 rounded-2xl rounded-tl-none border-l-[3px] border-[#4285F4] text-sm leading-relaxed">
            <MemoMarkdownContent text={post} />
          </div>
        )}
      </div>
    </article>
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

const markdownHeadingComponents: Pick<Components, 'h1' | 'h2' | 'h3'> = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-[17px] font-extrabold leading-snug tracking-[-0.01em] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3.5 mb-1.5 text-base font-extrabold leading-snug first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 text-[15px] font-bold leading-snug first:mt-0">
      {children}
    </h3>
  ),
}

function HighlightedStrong({ children, dark, pendingAware = false }: {
  children?: React.ReactNode
  dark: boolean
  pendingAware?: boolean
}) {
  const text = childrenToText(children)
  const isPending = pendingAware && /미결|보류|결정 필요|추후 결정/.test(text)
  return (
    <strong className={cn(
      'box-decoration-clone rounded-md px-1.5 py-0.5 font-bold leading-relaxed',
      dark
        ? 'bg-white/25 text-white'
        : isPending
          ? 'bg-[#FFF3E0] text-[#C2410C]'
          : 'bg-[#E8F0FE] text-[#1557B0]',
    )}>
      {children}
    </strong>
  )
}

/** AI 답변 속 체크리스트 — 상태는 메시지 문서(checklistState)에 저장. canEdit=false 면 읽기 전용(관찰자 대비). */
export interface MessageChecklistProps {
  state?: ChecklistState | null
  canEdit: boolean
  onToggle: (index: number, checked: boolean) => void
}

const CHECKER_COLORS = ['#1A73E8', '#188038', '#E37400', '#A142F4', '#D93025', '#007B83', '#B06000', '#3949AB']

/** 체크한 사람 이름 → 고정 색(같은 이름은 늘 같은 색) */
function checkerColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return CHECKER_COLORS[hash % CHECKER_COLORS.length]
}

function checkedAtText(at: unknown): string {
  const date = at && typeof at === 'object' && 'toDate' in at && typeof (at as { toDate: unknown }).toDate === 'function'
    ? (at as { toDate: () => Date }).toDate()
    : typeof at === 'number' ? new Date(at) : null
  return date ? date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/** 체크 칸 — 체크박스 + 체크한 사람 이름 첫 글자 원형 배지를 한 줄로. 전체 이름·시각은 마우스 올림/포커스 툴팁. */
function ChecklistBox({ index, defaultChecked, checklist, dark }: { index: number; defaultChecked: boolean; checklist: MessageChecklistProps; dark: boolean }) {
  const saved = checklist.state?.[String(index)]
  const checked = saved ? saved.checked : defaultChecked
  const by = checked ? saved?.by?.trim() : ''
  const when = by ? checkedAtText(saved?.at) : ''
  const label = by ? `${by}${when ? ` · ${when}` : ''} 확인` : ''
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle" data-testid="message-checklist-item">
      <input
        type="checkbox"
        checked={checked}
        disabled={!checklist.canEdit}
        onChange={event => checklist.onToggle(index, event.target.checked)}
        aria-label={`확인 항목 ${index + 1}${by ? ` — ${label}` : ''}`}
        className={cn('h-4 w-4 shrink-0 cursor-pointer rounded accent-[#1A73E8] disabled:cursor-default', dark && 'accent-white')}
      />
      {by && (
        <span className="group relative inline-flex shrink-0" data-testid="checker-badge">
          <span
            tabIndex={0}
            title={label}
            aria-label={label}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold leading-none text-white outline-none focus-visible:ring-2 focus-visible:ring-[#1A73E8]"
            style={{ backgroundColor: checkerColor(by) }}
          >
            {Array.from(by)[0]}
          </span>
          <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#202124] px-2 py-1 text-[11px] text-white shadow group-hover:block group-focus-within:block">
            {label}
          </span>
        </span>
      )}
    </span>
  )
}

/** remarkShortColumns 가 붙인 data-min-ch 가 있으면 nowrap + 최소 폭 스타일 */
function shortCellStyle(node: unknown): React.CSSProperties | undefined {
  const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties
  const minCh = Number(properties?.dataMinCh ?? properties?.['data-min-ch'])
  return minCh > 0 ? { minWidth: `${minCh}ch`, whiteSpace: 'nowrap', wordBreak: 'keep-all', overflowWrap: 'normal' } : undefined
}

// 채팅 표: 짧은 열(단계·팀 확인 등)은 줄바꿈 없이 최소 폭 — 보고서와 같은 규칙(lib/markdown/tableColumnWidth)
const CHAT_REMARK_PLUGINS = [...REMARK_PLUGINS, remarkShortColumns]

function MarkdownContent({ text, dark = false, standardTextMap, checklist }: { text: string; dark?: boolean; standardTextMap?: Record<string, string>; checklist?: MessageChecklistProps }) {
  // AI가 <br> 태그를 생성하는 경우 줄바꿈으로 치환
  // AI가 첫 줄에 [탐색] [팀+AI] 같은 활동유형/행위주체 태그를 출력하는 경우 제거
  // 표 셀 안의 <br/>은 ', '로, 표 밖은 줄바꿈으로
  const sanitized = text
    .replace(/\[(?:ARTIFACT_UPDATE|ARTIFACT_CONFIRM|ACTION_CARD|ACTIVITY_ADVANCE|ACTIVITY_RETURN|HELP_CARD|TEAM_DISCUSSION_READY|TEAM_GRADE_BANDS|STANDARD_SEARCH)[^\]]*\]/g, '')
    .replace(/\[ARTIFACT_UPDATE\]/g, '')
    .replace(/(\|[^|\n]*)<br\s*\/?>/gi, '$1, ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(INTERNAL_ACTIVITY_CODE_RE, code => displayActivityCode(code))
    .replace(/^(\s*\[[^\]\n]{1,20}\]\s*){1,4}\n/u, '')
    // CommonMark 한계: **'text'**한국어 패턴에서 ' 뒤 ** 가 닫힘 기호로 인식 안 됨
    // → **'text'** 를 **text** 로 정규화
    .replace(/\*\*'([^'*\n]+)'\*\*/g, '**$1**')
    // CommonMark 우측 플랭킹 규칙 한계: )**한국어 or 한국어**한국어 패턴
    // → closing ** 뒤에 NBSP 삽입으로 강제 bold 닫힘 처리
    .replace(/([)'"'"」』】）\uAC00-\uD7A3\d])\*\*([\uAC00-\uD7A3])/g, '$1**\u00A0$2')

  // 체크리스트가 연결된 AI 답변이면 ☐·[ ] 자리를 체크박스 표식으로 바꿔 그린다(순번은 글 순서).
  const rendered = checklist ? prepareChecklistMarkdown(sanitized).markdown : sanitized
  const guide = splitGuideLines(rendered)

  if (guide) {
    const strongComp = (isDark: boolean): Components => ({
      ...markdownHeadingComponents,
      p: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 leading-relaxed">{children}</p>,
      strong: ({ children }: { children?: React.ReactNode }) => (
        <HighlightedStrong dark={isDark}>{children}</HighlightedStrong>
      ),
    })
    return (
      <div>
        {guide.before && (
          <div className="mb-2">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={strongComp(dark)}>
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
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={strongComp(dark)}>
                {line}
              </ReactMarkdown>
            </div>
          ))}
        </div>
        {guide.after && (
          <div className="mt-2">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={strongComp(dark)}>
              {guide.after}
            </ReactMarkdown>
          </div>
        )}
      </div>
    )
  }

  return (
    <ReactMarkdown
      remarkPlugins={CHAT_REMARK_PLUGINS}
      components={{
        ...markdownHeadingComponents,
        p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
        strong: ({ children }) => (
          <HighlightedStrong dark={dark} pendingAware>{children}</HighlightedStrong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="mt-1.5 mb-1.5 space-y-1 pl-4 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="mt-1.5 mb-1.5 space-y-1.5 pl-4 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ children }) => {
          const checkMark = checklist && typeof children === 'string' ? parseChecklistMark(children) : null
          if (checkMark && checklist) return <ChecklistBox index={checkMark.index} defaultChecked={checkMark.defaultChecked} checklist={checklist} dark={dark} />
          return (
            <code className={cn('px-1.5 py-0.5 rounded text-xs font-mono', dark ? 'bg-white/20' : 'bg-gray-200 text-gray-800')}>
              {children}
            </code>
          )
        },
        blockquote: ({ children }) => (
          <aside
            role="note"
            aria-label="핵심 안내"
            className={cn(
              'my-3 rounded-xl border-l-4 px-4 py-3 shadow-sm [&>p:last-child]:mb-0',
              dark
                ? 'border-white/70 bg-white/15 text-white'
                : 'border-[#1A73E8] bg-white/75 text-[#1A2E5A]',
            )}
          >
            {children}
          </aside>
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
        th: ({ children, node }) => (
          <th className="px-3 py-2.5 text-left text-xs font-bold text-[#5F6368] uppercase tracking-wider border-b border-[#DADCE0] align-top"
              style={shortCellStyle(node)}>
            {children}
          </th>
        ),
        td: ({ children, node }) => {
          // 짧은 열(단계·팀 확인 등)은 줄바꿈 없이 최소 폭 — 이름·코드가 글자 단위로 세로로 쪼개지지 않게
          const short = shortCellStyle(node)
          if (short) {
            return (
              <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed align-top" style={short}>
                {children}
              </td>
            )
          }
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
      {rendered}
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
    title: '성취기준 재구조화 분석표',
    sections: { '성취기준분석표': fullContent },
  }
}

// ─── ARTIFACT_UPDATE 값 보강 ─────────────────────────
// AI가 [ARTIFACT_UPDATE: 섹션=모든 수정 및 보완된 내용 포함] 처럼 요약 플레이스홀더를 쓰는 경우,
// 최근 assistant 메시지에서 실제 콘텐츠(표·리스트·프로필 등)를 추출하여 대체한다.
function isPlaceholderValue(value: string, recentMessages: Array<{ role: string; content: string }>): boolean {
  if (typeof value !== 'string') return false
  if (value.length > 80) return false
  // 실제 콘텐츠로 보이는 패턴은 절대 플레이스홀더로 취급하지 않음
  const v = value.trim()
  if (/[,·]/.test(v) && v.length >= 8) return false  // 쉼표/점 구분 키워드 목록
  if (/[""]/.test(v)) return false                     // 인용문 포함
  if (/[가-힣]{6,}/.test(v)) return false              // 6자 이상 한글 연속 (문장)
  // 30자 이하의 매우 짧은 값 + 최근 채팅에 10배 이상 긴 내용이 있으면 플레이스홀더 의심
  if (v.length <= 30) {
    const hasRichChat = recentMessages
      .filter(m => m.role === 'assistant')
      .slice(-5)
      .some(m => m.content.length > v.length * 10)
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
    // "다음 주기 선택" 등 짧은 값이 정상인 섹션은 placeholder 치환 대상이 아님
    if (SANITIZE_EXEMPT_KEYS.includes(key.trim())) continue
    if (isPlaceholderValue(value, recentMessages)) {
      const realContent = extractSubstantiveContent(recentMessages)
      if (realContent) {
        enriched[key] = realContent
      }
    }
  }
  return enriched
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
function ContextMenuWrapper({ children, className, asArticle = false, ariaLabel }: {
  children: React.ReactNode
  onReply?: () => void     // 시그니처 호환성만 유지 (미사용)
  className?: string
  asArticle?: boolean
  ariaLabel?: string
}) {
  if (asArticle) {
    return <article className={className} aria-label={ariaLabel}>{children}</article>
  }
  return <div className={className}>{children}</div>
}

// ─── 메시지 버블 ──────────────────────────────────────
export function MessageBubble({ role, content, activityType, senderName, senderColor, isSelf, replyTo, onReply, stage, standardTextMap, simulated = false, checklist }: {
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
  simulated?: boolean
  /** AI 답변 속 체크리스트(없으면 일반 렌더) */
  checklist?: MessageChecklistProps
}) {
  const isUser = role === 'user'
  const checklistDone = !isUser && checklist ? checklistProgress(content, checklist.state).allChecked : false
  const alignRight = isUser && isSelf
  const avatarColor = senderColor ?? (isUser ? '#A0BCE8' : '#1F2937')
  const isLightColor = avatarColor.startsWith('#') && (() => {
    const r = parseInt(avatarColor.slice(1, 3), 16)
    const g = parseInt(avatarColor.slice(3, 5), 16)
    const b = parseInt(avatarColor.slice(5, 7), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 160
  })()
  const textOnColor = isLightColor ? '#374151' : '#ffffff'
  const accessibleSender = isUser ? (senderName ?? '팀원') : 'AI 공동설계자'
  const messageAriaLabel = `${accessibleSender}의 메시지${!isUser && activityType ? ` · ${activityType}` : ''}`

  return (
    <ContextMenuWrapper
      asArticle
      ariaLabel={messageAriaLabel}
      onReply={onReply}
      className={cn('flex gap-2 mb-3', alignRight ? 'flex-row-reverse' : 'flex-row')}
    >
      {/* 아바타 — 상단 정렬, Google 프로필 스타일(플랫 원형) */}
      <Avatar
        className="chat-avatar-animated self-start"
        name={senderName}
        color={avatarColor}
        size={40}
        ai={!isUser}
        title={senderName}
      />

      <div className={cn(
        'min-w-0 space-y-0.5',
        isUser ? 'max-w-[72%]' : 'w-fit max-w-[min(88%,46rem)]',
        alignRight ? 'items-end' : 'items-start',
        'flex flex-col',
      )}>
        {isUser && !isSelf && senderName && (
          <span className="text-xs font-bold px-1 text-gray-700">{senderName}{simulated && ' · 교사 AI'}</span>
        )}
        {!isUser && (
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-xs font-bold text-[#3C4043]">{simulated ? '총괄 AI' : 'AI 공동설계자'}</span>
            {activityType && <ActivityTag type={activityType} />}
          </div>
        )}

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
          'max-w-full px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
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
          {isUser && !simulated
            ? <span className="whitespace-pre-wrap">{content}</span>
            : <MemoMarkdownContent text={content} standardTextMap={standardTextMap} checklist={isUser ? undefined : checklist} />
          }
          {checklistDone && (
            <p className="mt-2 rounded-lg bg-white/70 px-3 py-1.5 text-[12px] font-medium text-[#137333]" data-testid="checklist-all-done" role="status">
              ✓ {CHECKLIST_ALL_DONE_NOTE}
            </p>
          )}
        </div>
      </div>
    </ContextMenuWrapper>
  )
}

const MemoMarkdownContent = React.memo(MarkdownContent)
const MemoMessageBubble = React.memo(MessageBubble)

// ─── AI 분석 결과 버블 ────────────────────────────────
function AnalysisBubble({ text }: { text: string }) {
  return (
    <article className="mx-0 my-3" aria-label="AI 공동설계자의 팀 토의 분석 결과">
      <div className="bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-[#00897B] flex items-center justify-center">
            <Users size={14} weight="fill" className="text-white" />
          </div>
          <span className="text-xs font-bold text-[#00695C]">팀 토의 분석 결과</span>
        </div>
        <div className="text-sm text-[#004D40] leading-relaxed">
          <MemoMarkdownContent text={text} />
        </div>
      </div>
    </article>
  )
}

// ─── 스트리밍 버블 ────────────────────────────────────
function StreamingBubble({ text, isAnalysis, stage }: { text: string; isAnalysis?: boolean; stage?: string }) {
  if (!text) return null
  if (isAnalysis) {
    return (
      <article className="mx-0 my-3" aria-label="AI 공동설계자가 팀 토의를 분석하는 중" aria-busy="true" aria-live="off">
        <div className="bg-[#E0F2F1] border border-[#80CBC4] rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-[#00897B] flex items-center justify-center">
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={14} className="text-white" /></span>
            </div>
            <span className="text-xs font-bold text-[#00695C]">팀 토의 분석 중...</span>
          </div>
          <div className="text-sm text-[#004D40] leading-relaxed">
            <MemoMarkdownContent text={text} />
            <span className="inline-block w-1 h-4 bg-[#00897B] animate-pulse ml-0.5 align-middle" />
          </div>
        </div>
      </article>
    )
  }
  const s = STAGE_BUBBLE[stage ?? 'T'] ?? STAGE_BUBBLE['T']
  return (
    <article className="flex gap-2 mb-3" aria-label="AI 공동설계자가 응답하는 중" aria-busy="true" aria-live="off">
      <Avatar className="chat-avatar-animated self-start" ai size={40} />
      <div className="w-fit max-w-[min(88%,46rem)] px-4 py-2.5 rounded-2xl rounded-tl-none border-l-[3px] text-sm leading-relaxed"
        style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border }}>
        <MemoMarkdownContent text={text} />
        <span className="inline-block w-1 h-4 animate-pulse ml-0.5 align-middle" style={{ backgroundColor: s.border }} />
      </div>
    </article>
  )
}

// ─── AI 대기 애니메이션 ───────────────────────────────
function AIIdleBubble() {
  return (
    <div className="flex gap-2 items-end mb-4">
      <Avatar className="chat-avatar-animated" ai size={32} />
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
    hostOnly: false,
  },
  {
    id: 'coreidea',
    label: '핵심아이디어 찾기',
    desc: '교과·영역별 핵심아이디어 + 지식·이해·과정·기능을 검색·선택',
    keywords: ['핵심아이디어', '핵심', '아이디어', '내용체계', 'coreidea', '지식', '과정'],
    hostOnly: false,
  },
  {
    id: 'briefing',
    label: '이전 단계 브리핑',
    desc: '지금까지 확정된 모든 활동 결과 요약을 즉시 요청',
    keywords: ['브리핑', '요약', 'briefing', '이전', '결과'],
    hostOnly: false,
  },
  {
    id: 'reset-chat',
    label: '현재 단계 초기화',
    desc: '현재 활동의 채팅을 모두 삭제하고 처음부터 다시 시작',
    keywords: ['초기화', '리셋', 'reset', '삭제', '다시'],
    hostOnly: true,
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

// ─── 공동 편집 버튼 (활동별 공통) ──────────────────────
// 12개 활동의 "OOO 공동 편집" 버튼은 라벨/onClick만 다른 동일 패턴이라 하나로 통일.
// showHint=true면 버튼 아래에 말풍선 안내(산출물이 방금 입력됨 → 함께 편집 가능)를 띄운다.
function CoeditButton({ label, title, onClick, showHint }: {
  label: string
  title: string
  onClick: () => void
  showHint: boolean
}) {
  return (
    <div className="relative flex items-center">
      {showHint && (
        <div className="pointer-events-none absolute top-full mt-2 right-0 z-[60] w-max max-w-[280px]
          rounded-2xl border border-white/80 bg-[#1A73E8] px-3 py-2 text-center text-[12px]
          font-bold leading-snug text-white shadow-[0_8px_24px_rgba(26,115,232,0.35)]">
          AI가 산출물을 입력했어요. 여기서 팀원과 함께 공동 편집할 수 있어요.
          <span className="absolute -top-1.5 right-8 h-3 w-3 rotate-45 border-l border-t border-white/80 bg-[#1A73E8]" />
        </div>
      )}
      <MD3Button
        onClick={onClick}
        title={title}
        variant="filled"
        tone="blue"
        icon={<PencilSimple size={MD3_ICON.sm} weight="bold" />}
      >
        {label}
      </MD3Button>
    </div>
  )
}

// ─── 메인 ChatPanel ───────────────────────────────────
export function ChatPanel() {
  const project = useProjectStore(state => state.project)
  return isDemoObservationOnly(project) ? <DemoObserverChat /> : <InteractiveChatPanel />
}

function InteractiveChatPanel() {
  const project = useProjectStore(state => state.project)
  if (!project) return null
  return <ChatPanelContent />
}

function ChatPanelContent() {
  const chatFontScale = useChatFontScale()
  const {
    project: projectState, messages, streamingText, messagesLoaded, messagesLoadedByFallback,
    currentActivity, appendStreamingText, clearStreamingText, addMessage, replaceMessage,
    discussionMode, setDiscussionMode,
    pendingTeamDiscussion, setPendingTeamDiscussion,
    teamDiscussionStartIdx, setTeamDiscussionStartIdx,
    pendingArtifactSave, setPendingArtifactSave,
    currentArtifact, setCurrentArtifact,
    setViewingActivity,
    userProfile,
    setPendingStageMove,
    chatInputRequest, setChatInputRequest, pendingNavigation,
  } = useProjectStore()
  const project = projectState!

  const chatDraft = useMemo(createChatDraft, [])
  const { setInput, setSlashQuery, setSlashCmdIdx } = chatDraft

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
  }, [chatInputRequest, setChatInputRequest, setInput])
  const [isLoading, setIsLoading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isIdle, setIsIdle] = useState(false)
  const [flowNotice, setFlowNotice] = useState<string | null>(null)
  // 채팅 '팀원 내보내기' 명령 — 방장 화면 로컬 카드, 저장하지 않음
  const [memberCommand, setMemberCommand] = useState<MemberCommandState | null>(null)
  const modeSyncedRef = useRef<string | null>(null)
  // 저장값만 solo 인 팀원 있는 레거시 방을 방장이 열면 mode 를 한 번 맞춘다(화면은 이미 effectiveProjectMode 기준)
  useEffect(() => {
    if (!project?.id || modeSyncedRef.current === project.id || !needsProjectModeSync(project, userProfile?.uid)) return
    modeSyncedRef.current = project.id
    void syncProjectModeIfNeeded(project, userProfile?.uid).catch(error => console.warn('[mode-sync] failed:', error))
  }, [project, userProfile?.uid])
  useEffect(() => { setIsIdle(false) }, [discussionMode])
  const [chatError, setChatError] = useState<string | null>(null)
  const [failedChatRequest, setFailedChatRequest] = useState<{
    activityCode: ActivityCode
    userId?: string
    assistantMessageId?: string
    messages: Array<{ role: string; content: string; displayName?: string }>
  } | null>(null)
  const [showDiscussionConfirm, setShowDiscussionConfirm] = useState(false)
  const [showStandardsBrowser, setShowStandardsBrowser] = useState(false)
  const [showCoreIdeaBrowser, setShowCoreIdeaBrowser] = useState(false)
  const [showKeyNotes, setShowKeyNotes] = useState(false)
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [showTeamVisionWorkspace, setShowTeamVisionWorkspace] = useState(false)
  // AI 대화로 산출물이 방금 입력된 활동 코드 — 해당 활동 공동 편집 버튼에 안내 말풍선을 띄움
  const [coeditHintActivity, setCoeditHintActivity] = useState<string | null>(null)
  const coeditHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 산출물 입력 감지 시 호출: 안내 말풍선을 띄우고 일정 시간 후 자동 해제
  function flashCoeditHint(activityCode: string) {
    setCoeditHintActivity(activityCode)
    if (coeditHintTimerRef.current) clearTimeout(coeditHintTimerRef.current)
    coeditHintTimerRef.current = setTimeout(() => setCoeditHintActivity(null), 15000)
  }
  const [showIntegratedGoalWorkspace, setShowIntegratedGoalWorkspace] = useState(false)
  const [showLessonDesignDirectionWorkspace, setShowLessonDesignDirectionWorkspace] = useState(false)
  const [showRoleDistributionWorkspace, setShowRoleDistributionWorkspace] = useState(false)
  const [showTeamRulesWorkspace, setShowTeamRulesWorkspace] = useState(false)
  const [showTeamScheduleWorkspace, setShowTeamScheduleWorkspace] = useState(false)
  const [showTopicSelectionWorkspace, setShowTopicSelectionWorkspace] = useState(false)
  const [showEvaluationPlanWorkspace, setShowEvaluationPlanWorkspace] = useState(false)
  const [showProblemSituationWorkspace, setShowProblemSituationWorkspace] = useState(false)
  const [showSupportToolWorkspace, setShowSupportToolWorkspace] = useState(false)
  const [showLearningActivityWorkspace, setShowLearningActivityWorkspace] = useState(false)
  const [showScaffoldingWorkspace, setShowScaffoldingWorkspace] = useState(false)
  const [integratedGoalPresence, setIntegratedGoalPresence] = useState<Record<string, IntegratedGoalPresenceEntry>>({})
  const [teamVisionPresence, setTeamVisionPresence] = useState<Record<string, TeamVisionPresenceEntry>>({})
  const [lessonDesignDirectionPresence, setLessonDesignDirectionPresence] = useState<Record<string, LessonDesignDirectionPresenceEntry>>({})
  const [roleDistributionPresence, setRoleDistributionPresence] = useState<Record<string, RoleDistributionPresenceEntry>>({})
  const [teamRulesPresence, setTeamRulesPresence] = useState<Record<string, TeamRulesPresenceEntry>>({})
  const [teamSchedulePresence, setTeamSchedulePresence] = useState<Record<string, TeamSchedulePresenceEntry>>({})
  const [topicSelectionPresence, setTopicSelectionPresence] = useState<Record<string, TopicSelectionPresenceEntry>>({})
  const [evaluationPlanPresence, setEvaluationPlanPresence] = useState<Record<string, EvaluationPlanPresenceEntry>>({})
  const [problemSituationPresence, setProblemSituationPresence] = useState<Record<string, ProblemSituationPresenceEntry>>({})
  const [supportToolPresence, setSupportToolPresence] = useState<Record<string, SupportToolPresenceEntry>>({})
  const [learningActivityPresence, setLearningActivityPresence] = useState<Record<string, LearningActivityPresenceEntry>>({})
  const [scaffoldingPresence, setScaffoldingPresence] = useState<Record<string, ScaffoldingPresenceEntry>>({})
  // ── DI·E 공동 편집 세션 (가이드 20260804 §4·§5) ──
  const [showMaterialDevWorkspace, setShowMaterialDevWorkspace] = useState(false)
  const [showLessonRecordWorkspace, setShowLessonRecordWorkspace] = useState(false)
  const [showLessonReflectionWorkspace, setShowLessonReflectionWorkspace] = useState(false)
  const [showCollaborationReflectionWorkspace, setShowCollaborationReflectionWorkspace] = useState(false)
  const [materialDevPresence, setMaterialDevPresence] = useState<Record<string, CoeditPresenceEntry>>({})
  const [lessonRecordPresence, setLessonRecordPresence] = useState<Record<string, CoeditPresenceEntry>>({})
  const [lessonReflectionPresence, setLessonReflectionPresence] = useState<Record<string, CoeditPresenceEntry>>({})
  const [collaborationReflectionPresence, setCollaborationReflectionPresence] = useState<Record<string, CoeditPresenceEntry>>({})
  const [workspaceInitialView, setWorkspaceInitialView] = useState<'sheet' | 'graph'>('sheet')
  const [noteTooltip, setNoteTooltip] = useState<{ num: number; preview: string; x: number; y: number } | null>(null)
  // 우클릭 컨텍스트 메뉴 상태
  const [ctxMenu, setCtxMenu] = useState<null | {
    x: number; y: number
    message: { id: string; content: string; role: 'user' | 'assistant'; senderName?: string; activityCode?: string }
  }>(null)
  const [pendingAdvance, setPendingAdvance] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<{ id: string; content: string; senderName?: string } | null>(null)
  const [remoteStreamingText, setRemoteStreamingText] = useState('')
  const [isRemoteLoading, setIsRemoteLoading] = useState(false) // 다른 팀원이 AI 요청 중
  // HELP_CARD: 마지막 AI 응답에 대한 도움 메시지 (messageId → helpMessage)
  const [helpCardMap, setHelpCardMap] = useState<Record<string, string>>({})
  const [showGraphPanel, setShowGraphPanel] = useState(false)
  const [showProblemSituationDesigner, setShowProblemSituationDesigner] = useProblemSituationOpen({
    projectId: project.id,
    userUid: userProfile?.uid,
    isHost: project.hostUid === userProfile?.uid || project.createdBy === userProfile?.uid,
    sharedOpen: project.problemSituationOpen,
    currentActivity,
  })
  // 지식 그래프에 추가된 성취기준 (채팅 언급 + 수동 추가)
  const [pinnedStandards, setPinnedStandards] = useState<GraphPinnedStandard[]>([])
  const [checkedGraphStandardIds, setCheckedGraphStandardIds] = useState<string[]>([])
  const lastGraphSelectionMutationAtRef = useRef(0)
  const pinnedStandardsRef = useRef<GraphPinnedStandard[]>([])
  const checkedGraphStandardIdsRef = useRef<string[]>([])
  const latestSheetRowsRef = useRef<CurriculumSheetRow[]>([])

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

  // ── 팀원: 방장이 그래프를 열면 자동으로 오픈 ─────────────────────────────
  useEffect(() => {
    if (!project || !userProfile) return
    const amHost = project.hostUid === userProfile.uid || project.createdBy === userProfile.uid
    if (amHost) return  // 방장은 직접 제어
    if (!project.graphOpen) {
      setShowWorkspace(false)
      setShowGraphPanel(false)
      setWorkspaceInitialView('sheet')
      return
    }
    if (GRAPH_ACTIVITIES.includes(currentActivity)) {
      const sharedView = project.graphView ?? 'graph'
      setWorkspaceInitialView(sharedView)
      setShowWorkspace(true)
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
  }, [project?.graphOpen, project?.graphView, project?.graphKeyword])

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

  useEffect(() => {
    latestSheetRowsRef.current = project?.curriculumSheet ?? []
  }, [project?.curriculumSheet])

  // 채팅 메시지에서 성취기준 코드 파싱
  const STD_CODE_RE = /\[(\d[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2})\]/g

  // "반영하기" 버튼 클릭 시 해당 메시지의 코드만 저장
  const [activeGraphCodes, setActiveGraphCodes] = useState<Array<{code: string; addedBy: string}>>([])
  const [sheetPreferredCenterCode, setSheetPreferredCenterCode] = useState('')

  // 그래프에 전달할 코드: 버튼 클릭으로 지정된 코드 우선, 없으면 빈 배열
  const chatMentionedStds = useMemo(() => {
    return activeGraphCodes.map(c => ({ ...c, source: 'chat' as const }))
  }, [activeGraphCodes])
  const messagesViewportRef = useRef<HTMLDivElement>(null)
  const shouldFollowLatestRef = useRef(true)
  const latestAssistantMessageIdRef = useRef<string | null>(null)
  const [hasNewAIResponse, setHasNewAIResponse] = useState(false)

  // 스트리밍 중 Firestore 동기화용 interval ref
  const streamingFlushRef = useRef<NodeJS.Timeout | null>(null)
  const streamingAccumRef = useRef('')

  // 활동 전환 시 해당 활동에만 속하는 로컬 UI 상태 초기화
  useEffect(() => {
    setPendingAdvance(null)
    setFlowNotice(null)
    setChatError(null)
    setIsIdle(false)
    setHelpCardMap({})
    setReplyTo(null)
    setCoeditHintActivity(null)  // 활동 전환 시 이전 활동의 공동편집 안내 말풍선 해제
    shouldFollowLatestRef.current = true
    latestAssistantMessageIdRef.current = null
    setHasNewAIResponse(false)
    return () => { if (coeditHintTimerRef.current) clearTimeout(coeditHintTimerRef.current) }
  }, [currentActivity])

  // 개인 설계(solo)에서만 T-1-1 빌더에 1인 파싱 경로를 연다.
  // 협력 모드에서는 undefined를 넘겨 팀 파싱 동작을 그대로 유지한다.
  function soloT11Opts(): { teacherName?: string } | undefined {
    return isSoloProject(proj) ? { teacherName: userProfile?.displayName } : undefined
  }


  // ARTIFACT_UPDATE 신호를 아티팩트 패널에 반영 + Firestore 저장
  // latestText: 현재 턴의 assistant 응답 원문 (Zustand에 아직 반영 안 됐을 수 있어 직접 전달)
  async function applyArtifactUpdates(
    rawSections: Record<string, string>,
    actCode?: ActivityCode,
    latestText?: string,
    origin: 'ai' | 'manual' = 'ai',
    confirmAfter = false,
  ): Promise<boolean> {
    // AI가 요약 플레이스홀더를 넣은 경우 최근 채팅에서 실제 콘텐츠를 추출.
    // A안/B안 선택지·절차 확정 문구는 추출 전에 제거 — 모든 build*Structured/enrich가 같은 ctx를 공유하므로 단일 차단점.
    const contextMsgs = sanitizeChatForExtraction(
      latestText
        ? [...messages, { role: 'assistant' as const, content: latestText }]
        : messages,
    )
    // 신호 값 자체 정화 — builder가 없는 Ds/DI/E 활동은 이 값이 그대로 저장되므로
    // 선택지·절차·상태 라인을 여기서 제거해야 한다 (전 경로 공통 단일 관문).
    const cleanedSections = sanitizeArtifactSections(rawSections)
    let sections = enrichArtifactSections(cleanedSections, contextMsgs)
    if (Object.keys(sections).length === 0) return false

    // T-1-1: 구조화된 산출물로 변환 — AI 자유 형식 대신 스키마가 구조를 강제
    const targetAct = actCode ?? currentActivity
    // 연수용 활동은 교사 원문을 양식과 같은 섹션 키 문자열로 둔다(구조화 빌더로 바꾸면 양식 원문이 사라진다).
    if (isTrainingActivity(proj, targetAct)) {
      // 원문 그대로 저장
    } else if (targetAct === 'T-1-1') {
      const structured = buildT11Structured(sections, contextMsgs, soloT11Opts())
      sections = structured as unknown as Record<string, string>
    } else if (targetAct === 'T-1-2') {
      sections = buildT12Structured(sections, contextMsgs) as unknown as Record<string, string>
    } else if (targetAct === 'T-2-1') {
      sections = buildT21Structured(sections, contextMsgs) as unknown as Record<string, string>
    } else if (targetAct === 'T-2-2') {
      sections = buildT22Structured(sections, contextMsgs) as unknown as Record<string, string>
    } else if (targetAct === 'T-2-3') {
      sections = buildT23Structured(sections, contextMsgs) as unknown as Record<string, string>
    } else if (targetAct === 'A-1-2') {
      sections = buildA12Structured(sections, contextMsgs) as unknown as Record<string, string>
    } else if (targetAct === 'A-2-1') {
      sections = buildA21Structured(sections, contextMsgs) as unknown as Record<string, string>
    } else if (targetAct === 'A-2-2') {
      sections = buildA22Structured(sections, contextMsgs) as unknown as Record<string, string>
    } else if (targetAct === 'A-2-3') {
      sections = buildA23Structured(sections, contextMsgs) as unknown as Record<string, string>
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
    // 내용이 바뀐 저장만 status를 in_review로 리셋하므로 팀이 다시 확정해야 함

    const baseContent = existing?.aiDraft ?? firestoreContent
    // 구조화 산출물: 새 데이터의 빈 필드는 기존 값 유지, 채워진 필드만 업데이트
    let merged: Record<string, unknown>
    if ((sections as Record<string, unknown>)._schema && (baseContent as Record<string, unknown>)._schema === (sections as Record<string, unknown>)._schema) {
      // 같은 스키마끼리 → 빈 필드는 기존 유지
      merged = { ...baseContent }
      for (const [k, v] of Object.entries(sections)) {
        if (k === '_schema') { merged[k] = v; continue }
        // 새 값이 비어있으면(빈 배열, 빈 문자열) 기존 값 유지
        const isEmpty = v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0)
        if (!isEmpty) merged[k] = v
      }
    } else if ((sections as Record<string, unknown>)._schema) {
      // 새로운 스키마 → 완전 교체
      merged = { ...sections }
    } else {
      merged = { ...baseContent, ...sections }
    }
    // 같은 내용의 재방출은 버전·확정 상태·Firestore를 그대로 둔다.
    if ((existing || firestoreArtifact) && artifactContentEquals(
      sanitizeArtifactSections(baseContent, { dropEmptied: false }),
      sanitizeArtifactSections(merged, { dropEmptied: false }),
    )) {
      // 내용 업데이트와 별개의 명시적 확정 요청은 기존 확정 경로로 처리한다.
      if (confirmAfter && (existing?.status ?? firestoreArtifact?.status) !== 'confirmed') {
        await applyArtifactConfirm(targetActivity)
      }
      return targetActivity === currentActivity
        && (existing?.status ?? firestoreArtifact?.status) === 'confirmed'
    }
    // AI가 실제 변경을 입력한 경우에만 안내하고, manual 저장은 제외한다.
    if (origin === 'ai') flashCoeditHint(targetAct)
    // 협업 모드에서 팀원 → 방장에게 저장 제안으로 전달 (직접 저장 금지)
    if (effectiveProjectMode(project) === 'collaborative' && !isHost) {
      await proposeArtifactToHost(
        proj.id, targetActivity, sections,
        userProfile?.uid ?? '', userProfile?.displayName ?? '팀원',
      )
      return false
    }
    const canConfirm = !confirmAfter
      || !targetMeta.requiredSections?.length
      || validateRequiredSections(merged, targetMeta.requiredSections)
    const finalStatus = confirmAfter && canConfirm ? 'confirmed' as const : 'in_review' as const
    if (confirmAfter && !canConfirm) {
      setChatError(`${displayActivityCode(targetActivity)} 산출물의 필수 항목을 모두 채운 뒤 확정해 주세요.`)
    }
    const newVersion = (existing?.currentVersion ?? (firestoreArtifact?.version ?? 0)) + 1
    const newArtifact = {
      id: existing?.id ?? Date.now().toString(),
      activityCode: targetActivity,
      artifactType: targetMeta.label,
      title: targetMeta.label + ' 산출물',
      status: finalStatus,
      currentVersion: newVersion,
      aiDraft: merged,
      ...(finalStatus === 'confirmed' ? { confirmedContent: merged } : {}),
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
    await setProjectArtifact(project.id, targetActivity, {
      status: finalStatus,
      title: targetMeta.label + ' 산출물',
      content: merged,
      version: newVersion,
      ...(finalStatus === 'confirmed'
        ? { confirmedBy: userProfile?.uid, confirmedAt: Date.now() }
        : {}),
    })
    if (finalStatus === 'confirmed') {
      await setActivityStatus(project.id, targetActivity, 'completed')
    }

    // 구조화 산출물 빈 필드 감지 → 격려 메시지 자동 삽입
    if (merged._schema) {
      try {
        const missing = detectMissingFields(merged as Record<string, unknown>)
        if (missing.length > 0) {
          const missingList = missing.map(m => `  - **${m.label}**: ${m.hint}`).join('\n')
          const encourageMsg = `산출물이 저장되었어요! 다만 아래 항목이 아직 비어 있습니다. 지금 바로 채워주셔도 좋고, 나중에 돌아와서 추가하셔도 괜찮아요.\n\n${missingList}\n\n채워주시면 제가 산출물에 반영해 드릴게요. "나중에 할게요"라고 하셔도 됩니다.`
          const encourageId = `encourage_${Date.now()}`
          // 약간의 지연 후 삽입 (저장 완료 체감 후 안내)
          setTimeout(() => {
            addMessage({
              id: encourageId,
              role: 'assistant',
              content: encourageMsg,
              activityCode: targetActivity,
              activityType: '점검',
              agentType: 'orchestrator',
              createdAt: Timestamp.now(),
            })
          }, 800)
        }
      } catch { /* 감지 실패는 무시 */ }
    }
    return false
  }

  // ARTIFACT_CONFIRM 신호를 처리 — 현재 또는 지정 활동 산출물을 confirmed 상태로 저장
  async function applyArtifactConfirm(targetActivity: ActivityCode): Promise<void> {
    if (!isHost) return
    const firestoreArtifact = project.artifacts?.[targetActivity]
    const local = currentArtifact?.activityCode === targetActivity ? currentArtifact : null
    const content = (
      local?.aiDraft
      ?? firestoreArtifact?.content
      ?? {}
    ) as Record<string, unknown>
    if (!Object.keys(content).length) return
    const targetMeta = ACTIVITY_META[targetActivity]
    if (
      targetMeta.requiredSections?.length
      && !validateRequiredSections(content, targetMeta.requiredSections)
    ) {
      setChatError(`${displayActivityCode(targetActivity)} 산출물의 필수 항목을 모두 채운 뒤 확정해 주세요.`)
      return
    }
    const title = firestoreArtifact?.title ?? targetMeta.label + ' 산출물'
    const version = local?.currentVersion ?? firestoreArtifact?.version ?? 1
    await setProjectArtifact(project.id, targetActivity, {
      status: 'confirmed',
      title,
      content,
      version,
      confirmedBy: userProfile?.uid,
      confirmedAt: Date.now(),
    })
    await setActivityStatus(project.id, targetActivity, 'completed')
    if (targetActivity === currentActivity && local) {
      setCurrentArtifact({ ...local, status: 'confirmed', confirmedContent: content })
    }
  }

  // 저장 관문(#39·#40): Ds-1-1 평가 계획·Ds-1-3 학습 활동만 대상.
  //  - '(근거: …)'에서 A-2-1 분석표·분석시트 밖 코드를 뺀다.
  //  - 이전 표의 행이 빠졌는데 사용자가 지우라고 하지 않았으면 그 섹션 저장·확정을 보류한다.
  // 두 응답 경로(일반 채팅·선택 후 응답)가 메시지 저장 전에 같이 부른다. 다른 활동·섹션은 그대로 통과.
  function gateArtifactUpdates(
    updates: Array<{ activityCode?: string; sections: Record<string, string> }>,
    confirmCodes: string[],
    userText: string,
  ) {
    const latest = useProjectStore.getState()
    const artifacts = proj.artifacts
    return gateArtifactSave({
      updates,
      confirmCodes,
      currentActivity,
      allowedCodes: extractStandardCodes(designStandardSources(artifacts, proj.curriculumSheet).join('\n')),
      previousSection: (activityCode, key) => {
        const draft = latest.currentArtifact?.activityCode === activityCode ? latest.currentArtifact.aiDraft : null
        return previousSectionText(draft ?? artifacts?.[activityCode as ActivityCode]?.content, activityCode, key)
      },
      recentUserTexts: [
        ...messages.filter(m => m.role === 'user' && m.activityCode === currentActivity).slice(-2).map(m => m.content),
        userText,
      ],
    })
  }

  async function processArtifactSignals(
    updates: Array<{ activityCode?: string; sections: Record<string, string> }>,
    confirmCodes: string[],
    latestText: string,
  ): Promise<boolean> {
    let onlyConfirmedNoops = updates.length > 0
    const commitUpdate = async (activityCode: string, sections: Record<string, string>, confirm = false) => {
      const unchanged = await applyArtifactUpdates(sections, activityCode as ActivityCode, latestText, 'ai', confirm)
      onlyConfirmedNoops = onlyConfirmedNoops && unchanged
    }
    if (!isHost && effectiveProjectMode(project) === 'collaborative') {
      for (const update of updates) {
        await commitUpdate(update.activityCode || currentActivity, update.sections)
      }
      return onlyConfirmedNoops
    }
    await applyArtifactSignalBatch({
      currentActivity,
      updates,
      confirmCodes,
      commitUpdate,
      confirmExisting: async activityCode => {
        onlyConfirmedNoops = false
        await applyArtifactConfirm(activityCode as ActivityCode)
      },
    })
    return onlyConfirmedNoops
  }

  const scrollToLatestAIResponse = useCallback(() => {
    shouldFollowLatestRef.current = true
    setHasNewAIResponse(false)
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
  }, [])

  const handleMessageListCommit = useCallback(() => {
    if (shouldFollowLatestRef.current) scrollToLatestAIResponse()
  }, [scrollToLatestAIResponse])

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const isNearBottom = distanceFromBottom <= 96
    shouldFollowLatestRef.current = isNearBottom
    if (isNearBottom) setHasNewAIResponse(false)
  }, [])

  useEffect(() => {
    const latestAssistantMessage = [...messages].reverse().find(message => message.role === 'assistant')
    const latestAssistantId = latestAssistantMessage?.id ?? null
    const hasCompletedAIResponse = latestAssistantId !== null
      && latestAssistantId !== latestAssistantMessageIdRef.current
    latestAssistantMessageIdRef.current = latestAssistantId

    const hasIncomingAIUpdate = Boolean(
      streamingText || remoteStreamingText || hasCompletedAIResponse,
    )

    if (shouldFollowLatestRef.current) {
      scrollToLatestAIResponse()
    } else if (hasIncomingAIUpdate) {
      setHasNewAIResponse(true)
    }
  }, [messages, streamingText, remoteStreamingText, scrollToLatestAIResponse])

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

  // A-2-2 통합 수업목표 워크스페이스 presence subcollection 구독 — IGW와 TVW 동일 패턴.
  // 부모 projects 문서를 건드리지 않으므로 cascade·트랜잭션 충돌 없음.
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchIntegratedGoalWorkspacePresence(project.id, (next) => {
      setIntegratedGoalPresence((prev) => {
        // [2026-05-15] cellKey + caretPos 비교 — updatedAt 변화만으로 인한 깜빡임은 무시,
        // 위치/caret 변경은 즉시 반영.
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setIntegratedGoalPresence({}) }
  }, [project?.id])

  // T-1-1 팀 비전 워크스페이스 presence subcollection 구독 — IGW와 동일 패턴
  // 부모 projects 문서를 건드리지 않으므로 트랜잭션과 충돌 없음.
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchTeamVisionWorkspacePresence(project.id, (next) => {
      setTeamVisionPresence((prev) => {
        // [2026-05-15] cellKey + caretPos 비교 — updatedAt만 변하는 noise는 무시(깜빡임 방지),
        // 위치/caret 변경은 즉시 반영(타이핑 위치 실시간 표시).
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setTeamVisionPresence({}) }
  }, [project?.id])

  // T-1-2 수업설계 방향 워크스페이스 presence subcollection 구독 — IGW/TVW와 동일 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchLessonDesignDirectionWorkspacePresence(project.id, (next) => {
      setLessonDesignDirectionPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setLessonDesignDirectionPresence({}) }
  }, [project?.id])

  // Ds-1-1 평가 계획 워크스페이스 presence subcollection 구독 — 동일 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchEvaluationPlanWorkspacePresence(project.id, (next) => {
      setEvaluationPlanPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setEvaluationPlanPresence({}) }
  }, [project?.id])

  // Ds-1-2 문제상황 워크스페이스 presence subcollection 구독 — 동일 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchProblemSituationWorkspacePresence(project.id, (next) => {
      setProblemSituationPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setProblemSituationPresence({}) }
  }, [project?.id])

  // Ds-2-1 지원 도구 워크스페이스 presence subcollection 구독 — 동일 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchSupportToolWorkspacePresence(project.id, (next) => {
      setSupportToolPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setSupportToolPresence({}) }
  }, [project?.id])

  // Ds-1-3 학습활동 설계 워크스페이스 presence subcollection 구독 — 동일 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchLearningActivityWorkspacePresence(project.id, (next) => {
      setLearningActivityPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setLearningActivityPresence({}) }
  }, [project?.id])

  // Ds-2-2 스캐폴딩 설계 워크스페이스 presence subcollection 구독 — 동일 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchScaffoldingWorkspacePresence(project.id, (next) => {
      setScaffoldingPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setScaffoldingPresence({}) }
  }, [project?.id])

  // DI·E 공동 편집 4종 presence 구독 — 동일 패턴을 한 effect로 묶는다
  useEffect(() => {
    if (!project?.id) return
    const id = project.id
    const unsubs = [
      watchMaterialDevWorkspacePresence(id, setMaterialDevPresence),
      watchLessonRecordWorkspacePresence(id, setLessonRecordPresence),
      watchLessonReflectionWorkspacePresence(id, setLessonReflectionPresence),
      watchCollaborationReflectionWorkspacePresence(id, setCollaborationReflectionPresence),
    ]
    return () => {
      unsubs.forEach(u => u())
      setMaterialDevPresence({})
      setLessonRecordPresence({})
      setLessonReflectionPresence({})
      setCollaborationReflectionPresence({})
    }
  }, [project?.id])

  // T-2-1 역할 배분 워크스페이스 presence subcollection 구독 — 같은 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchRoleDistributionWorkspacePresence(project.id, (next) => {
      setRoleDistributionPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setRoleDistributionPresence({}) }
  }, [project?.id])

  // T-2-2 팀 규칙 워크스페이스 presence subcollection 구독 — 같은 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchTeamRulesWorkspacePresence(project.id, (next) => {
      setTeamRulesPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setTeamRulesPresence({}) }
  }, [project?.id])

  // T-2-3 팀 일정 워크스페이스 presence subcollection 구독 — 같은 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchTeamScheduleWorkspacePresence(project.id, (next) => {
      setTeamSchedulePresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setTeamSchedulePresence({}) }
  }, [project?.id])

  // A-1-2 주제 선정 워크스페이스 presence subcollection 구독 — 같은 패턴
  useEffect(() => {
    if (!project?.id) return
    const unsub = watchTopicSelectionWorkspacePresence(project.id, (next) => {
      setTopicSelectionPresence((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          const a = prev[k]
          const b = next[k]
          if (!samePresenceEntry(a, b)) return next
        }
        return prev
      })
    })
    return () => { unsub(); setTopicSelectionPresence({}) }
  }, [project?.id])

  // Why: 모달 prop으로 넘기는 콜백/객체 reference를 안정화 → 모달 내부 useEffect dependency 폭주 방지.
  //      early return 이전에 호출해 Rules of Hooks 위반 회피.
  const projectId = project?.id
  const projectArtifacts = project?.artifacts
  const projectMemberInfo = project?.memberInfo
  const presenceColor = userProfile?.uid ? projectMemberInfo?.[userProfile.uid]?.color : undefined
  const projectHostUid = project?.hostUid
  const projectCreatedBy = project?.createdBy

  const handleIntegratedGoalWorkspacePatch = useCallback(async (patch: IntegratedGoalWorkspacePatch) => {
    if (!projectId) return undefined
    return patchIntegratedGoalWorkspace(projectId, patch)
  }, [projectId])

  const handleIntegratedGoalPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setIntegratedGoalWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  const handleIntegratedGoalSendArtifact = useCallback(async (content: A22Structured) => {
    if (!projectId) return
    const hostNow = projectHostUid === userProfile?.uid || projectCreatedBy === userProfile?.uid
    if (!hostNow) return
    const firestoreArtifact = projectArtifacts?.['A-2-2']
    const existing = currentArtifact?.activityCode === 'A-2-2' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(projectId, 'A-2-2', {
      status: 'in_review',
      title: '통합 수업목표 진술 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('A-2-2')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'A-2-2',
      artifactType: '통합 수업목표 진술',
      title: '통합 수업목표 진술 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '통합 수업목표 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }, [projectId, projectArtifacts, projectHostUid, projectCreatedBy, currentArtifact, userProfile?.uid, setViewingActivity, setCurrentArtifact])

  // Why: 모달 prop으로 매번 새 reference 전달 시 모달 내부 useEffect가 매 render fire → setWorkspace 폭주.
  //      projectArtifacts reference가 안정적인 동안 캐스팅 결과도 동일 reference로 유지.
  const integratedGoalArtifactContent = useMemo(
    () => projectArtifacts?.['A-2-2']?.content as Record<string, unknown> | undefined,
    [projectArtifacts],
  )
  const integratedGoalExistingCoreIdea = useMemo(
    () => (projectArtifacts?.['A-2-2']?.content as { commonCoreIdea?: string } | undefined)?.commonCoreIdea,
    [projectArtifacts],
  )
  const integratedGoalCurrentUserColor = useMemo(
    () => (userProfile?.uid ? (projectMemberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color),
    [projectMemberInfo, userProfile?.uid, userProfile?.color],
  )

  const proj = project  // non-null 확정 캡처

  const activityMeta = ACTIVITY_META[currentActivity]
  const hasA23Guardrail = Object.keys(
    ((proj.artifacts?.['A-2-3']?.content ?? {}) as Record<string, unknown>)
  ).length > 0

  // ─── SSE 스트리밍 공통 함수 ──────────────────────────
  // 팀원 목록: AI가 누가 발언했는지 파악하기 위해 시스템 프롬프트에 주입
  const teamLeaderUid = proj.hostUid ?? proj.createdBy
  const teamMembersList = proj.memberInfo
    ? Object.entries(proj.memberInfo).map(([uid, m]) => (
        !isSoloProject(proj) && uid === teamLeaderUid && m.displayName
          ? `${m.displayName}(팀장)`
          : m.displayName
      )).join(', ')
    : undefined

  // 메시지 배열 → API 전송 형식 (user 메시지에 발신자 이름 주입)
  function confirmedArtifactReminder() {
    const local = currentArtifact?.activityCode === currentActivity ? currentArtifact : null
    const status = local?.status ?? proj.artifacts?.[currentActivity]?.status
    const nextCode = getNextActivityCode(currentActivity)
    return status === 'confirmed' && nextCode
      ? `\n현재 활동 산출물은 이미 확정됨. 사용자가 이동 의사만 밝히면 재저장하지 말고 [ACTIVITY_ADVANCE: ${nextCode}]만 보낸다.`
      : ''
  }

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
      content: `[시스템 리마인더] 현재 활동: ${displayActivityCode(currentActivity)} (${actMeta?.label}), 내부 코드: ${currentActivity}. 사용자에게 보이는 머리말은 "${displayActivityCode(currentActivity)}: ${actMeta?.label}"로 씁니다. 이 활동에서의 대화를 수행 중이며, [ACTIVITY_ADVANCE] 신호 없이는 아직 이동하지 않은 상태입니다.${confirmedArtifactReminder()}`,
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
    onDone: (fullText: string) => string | void | Promise<string | void>,
  ) {
    const decisionDeferred = hasDeferredDecision(msgs)
    if (decisionDeferred) onChunk = () => {} // Validate deferred responses before displaying gates.
    const commitResponse = onDone
    // 완료 시점에 한 번 정리해 화면 메시지와 Firestore 저장이 같은 본문이 되게 한다(#27 끝 깨진 외국 문자 제거).
    onDone = (text) => {
      const cleaned = sanitizeAssistantText(text)
      return commitResponse(decisionDeferred ? deferredResponse(cleaned) : cleaned)
    }
    if (decisionDeferred) msgs = [...msgs, { role: 'user', content: '현재 결정은 보류 중입니다. 같은 선택지나 저장 확인을 다시 제시하지 말고 자유 대화를 이어가세요. 산출물 저장·확정·활동 이동 신호를 출력하지 마세요. 교사가 명시적으로 결정 또는 저장을 요청하기 전까지 유지하세요.' }]
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
          schoolLevel: proj.schoolLevel,
          curriculumSheet: proj.curriculumSheet,
          targetGradeGroup: proj.targetGradeGroup,
          // 여러 학년 담임이 한 팀인 경우 — 학년군별 성취기준·활동 수준 판단의 근거
          teamGradeBands: proj.teamGradeBands,
          targetSubjects: proj.targetSubjects,
          // 저장값이 solo 여도 팀원이 있는 레거시 방은 협력 프롬프트(서버는 memberUids 를 받지 않는다)
          mode: effectiveProjectMode(proj),
          isA23Completed: proj.isA23Completed,
          currentCycle: proj.currentCycle,
          // P1-I: 이전 주기 E 개선안 (T-1-1 시스템 프롬프트 주입용, 없으면 undefined)
          previousCycleImprovements: proj.previousCycleImprovements,
          // 연수용 모드(없으면 undefined → 일반 프롬프트 그대로)
          trainingMode: proj.trainingMode,
        },
        // 현재 활동의 기존 산출물 내용 전달 (AI가 수정 시 참조)
        currentArtifact: proj.artifacts?.[currentActivity] ?? null,
        // 이전 활동 산출물 전달: 내용이 있는 모든 과거 활동을 status와 함께 포함.
        // 같은 단계 내 진행(A-2-1 → A-2-2 등)에서도 in_review 초안을 다음 활동의 입력으로 사용해야 함.
        // AI는 함께 전달된 status('confirmed'/'in_review'/'ai_draft' 등)로 확정/검토중을 구분한다.
        confirmedArtifacts: proj.artifacts
          ? (() => {
              const allActivities = STAGES.flatMap(s => s.activities)
              const currentIdx = allActivities.indexOf(currentActivity)
              return Object.fromEntries(
                Object.entries(proj.artifacts)
                  .filter(([code, a]) => {
                    const idx = allActivities.indexOf(code as ActivityCode)
                    if (idx < 0 || idx >= currentIdx) return false
                    return Object.keys((a.content as Record<string, unknown>) ?? {}).length > 0
                  })
                  .map(([code, a]) => [code, { title: a.title, content: a.content, status: a.status }])
              )
            })()
          : undefined,
        // A-2-3 학습자 프로필을 별도 가드레일로 전달 (확정 여부 무관)
        learnerProfileSummary: (() => {
          const a23 = proj.artifacts?.['A-2-3']
          if (!a23 || !Object.keys((a23.content as Record<string, unknown>) ?? {}).length) return undefined
          return serializeArtifactForPrompt(a23.content)
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
          else if (data.type === 'done') { disarmTimer(); await onDone(fullText); return }
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
          const partialId = await onDone(fullText + '\n\n_[응답이 중간에 끊겼습니다 — 재시도 버튼으로 이어서 받아주세요]_')
          setFailedChatRequest({
            activityCode: currentActivity, userId: userProfile?.uid, messages: msgs,
            assistantMessageId: typeof partialId === 'string' ? partialId : undefined,
          })
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
    if (fullText) await onDone(fullText)
    // 스트림이 done/error/timeout 없이 빈 응답으로 끝난 경우 — 조용한 무응답("문의에 답 없음") 방지.
    // 호출부 catch가 chatError를 띄워 사용자가 재시도할 수 있게 한다.
    else throw new Error('AI 응답이 도착하지 않았습니다. 네트워크 상태를 확인하고 재시도 버튼을 눌러주세요.')
  }

  async function discardResponseAfterActivityChange(requestedActivity: ActivityCode): Promise<boolean> {
    const activeState = useProjectStore.getState()
    if (!isStaleActivityResponse(
      requestedActivity,
      activeState.currentActivity,
      proj.currentCycle,
      activeState.project?.currentCycle,
    )) return false
    if (streamingFlushRef.current) {
      clearInterval(streamingFlushRef.current)
      streamingFlushRef.current = null
    }
    clearStreamingText()
    if (userProfile?.uid) {
      await clearStreamingState(proj.id, requestedActivity, userProfile.uid).catch(() => {})
    }
    return true
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
      await navigateOptimistically({ projectId: proj.id, activity: nextActivity,
        persist: () => advanceActivity(proj.id, allActivities, currentActivity, nextActivity) })
    } else {
      // 크로스 스테이지: StageMoveModal을 통해 이동 (단계 분석 기회 제공)
      setPendingStageMove(nextStageInfo.code as import('@/types').StageCode)
      setPendingAdvance(null)
    }
  }

  // ─── 활동 되돌아가기 처리 (Firestore 동기화 포함) ──────
  async function handleActivityReturn(targetCode: string) {
    if (!isHost) return
    if (!(targetCode in ACTIVITY_META)) return
    const code = targetCode as ActivityCode
    const targetStage = ACTIVITY_META[code].stage
    if (targetStage !== activityMeta.stage) {
      // 단계를 넘는 되돌아가기도 요청된 활동으로 도착하도록 대상 활동을 함께 넘긴다(#29).
      setPendingStageMove(targetStage, code)
      return
    }
    await navigateOptimistically({ projectId: proj.id, activity: code, persist: () => Promise.all([
      returnToActivity(proj.id, code, targetStage), setActivityStatus(proj.id, code, 'active_return'),
    ]) })
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

    let sourceContent = (
      localArtifact?.lastEditedContent
      ?? localArtifact?.aiDraft
      ?? fsArtifact?.content
      ?? {}
    ) as Record<string, unknown>
    const sourceTitle = localArtifact?.title ?? fsArtifact?.title ?? (currentMeta.label + ' 산출물')
    let sourceVersion = localArtifact?.currentVersion ?? fsArtifact?.version ?? 1
    let currentStatus = localArtifact?.status ?? fsArtifact?.status

    if (pendingForCurrent) {
      // "확정 후 다음 단계로" 경로는 저장 카드 수락 없이 pending 섹션을 곧바로 confirmed까지
      // 밀어넣으므로, 선택지·절차 문구 정화를 반드시 거친다 (verbatim 병합 금지).
      sourceContent = { ...sourceContent, ...sanitizeArtifactSections(pendingForCurrent.sections) }
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
    if (
      currentMeta.requiredSections?.length
      && !validateRequiredSections(sourceContent, currentMeta.requiredSections)
    ) {
      setChatError(`${displayActivityCode(currentActivity)} 산출물의 필수 항목을 모두 채운 뒤 이동해 주세요.`)
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

  function offerAdvanceAfterConfirmedNoop(onlyConfirmedNoops: boolean, userMessage: string) {
    if (isHost && onlyConfirmedNoops
      && !/고쳐|수정|바꿔|보완|전에/.test(userMessage)
      && /이동|넘어가|다음\s*활동|다음\s*단계|다음으로/.test(userMessage)) {
      handlePromptNextCommand()
    }
  }

  // ─── 활동 시작 환영 메시지 (API 호출 없음, 정적) ────────
  function showWelcomeMessage(welcomeText: string) {
    // 고정 ID로 저장: Firestore 콜백이 재호출돼도 같은 ID로 dedup 됨
    const msgId = `welcome-${proj.currentCycle ?? 1}-${currentActivity}`
    const msg = {
      id: msgId,
      role: 'assistant' as const,
      content: welcomeText,
      activityCode: currentActivity,
      activityType: '제시' as const,
      agentType: 'orchestrator' as const,
      cycleNumber: proj.currentCycle ?? 1,
      createdAt: Timestamp.now(),
    }
    addMessage(msg)
    setIsIdle(true)  // 환영 후 즉시 대기 상태
    // Firestore에는 같은 ID 문서가 없을 때만 저장 — 이미 있으면 작성 시각을 덮어써 대화 끝으로 옮기지 않는다(#30).
    saveMessageIfAbsent(proj.id, currentActivity, {
      role: 'assistant', content: welcomeText,
      activityCode: currentActivity, activityType: '제시', agentType: 'orchestrator',
      cycleNumber: proj.currentCycle ?? 1,
    }, msgId).catch(console.error)
  }

  // Firestore 메시지가 로드된 후에만 환영 메시지 표시
  // 방장만 저장 → 팀원은 Firestore 실시간 동기화로 수신
  // messages를 dep에 포함: stale closure 방지 + Firestore 재응답 시 재평가
  useEffect(() => {
    if (!project?.started) return
    if (!messagesLoaded || pendingNavigation) return
    // 개인 설계는 축약 환영 메시지 우선, 없으면 팀판으로 폴백 (협력 모드는 기존 그대로)
    // 연수용 약식 활동은 일반 환영 대신 trainingMode 정의로 만든 짧은 고정 안내(AI 없음)
    let welcome = isTrainingActivity(proj, currentActivity)
      ? buildTrainingWelcome(currentActivity)
      : (isSoloProject(project) ? SOLO_ACTIVITY_WELCOME[currentActivity] : undefined)
        ?? ACTIVITY_WELCOME[currentActivity]
    if (!welcome) return
    if (!isTrainingActivity(proj, currentActivity) && currentActivity === 'A-1-2' && !Object.keys(project.artifacts?.['A-1-1']?.content ?? {}).length) {
      welcome = welcome
        .replace('팀이 정한 기준에 따라 검토', '팀 비전과 학생 삶과의 연결을 기준으로 검토')
        .replace('지금까지 정한 기준으로 보면', '팀 비전과 학생 삶과의 연결을 기준으로 보면')
    }
    // 방장만, 이 활동(현재 주기)에 환영 메시지나 대화가 하나도 없을 때만 만든다(#30 재진입 때 다시 붙지 않게).
    // (introSentRef 대신 실제 messages 상태를 사용해 stale 방지)
    const amHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid
    const welcomeId = `welcome-${proj.currentCycle ?? 1}-${currentActivity}`
    if (!shouldCreateWelcomeMessage({
      started: !!project?.started,
      messagesLoaded,
      messagesLoadedByFallback,
      isHost: amHost,
      hasWelcomeText: !!welcome,
      welcomeId,
      cycle: proj.currentCycle ?? 1,
      messages,
    })) return
    showWelcomeMessage(welcome)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentActivity, project?.started, messagesLoaded, messagesLoadedByFallback, messages, pendingNavigation])

  // ─── 산출물 저장 수락 ────────────────────────────────
  function handleAcceptArtifactSave() {
    if (!pendingArtifactSave) return
    const targetActivity = (pendingArtifactSave.activityCode as ActivityCode | undefined) ?? currentActivity
    const targetMeta = ACTIVITY_META[targetActivity]
    const existing = currentArtifact?.activityCode === targetActivity ? currentArtifact : null
    const firestoreContent = (project?.artifacts?.[targetActivity]?.content ?? {}) as Record<string, unknown>
    const baseContent = existing?.aiDraft ?? firestoreContent
    // 선택지·절차 문구 정화 → 플레이스홀더 보강 — 신호 경로(applyArtifactUpdates)와 동일한 보호.
    // build*Structured의 chat-fallback 추출기도 정화된 ctx를 쓰도록 messages 원본 대신 ctxMsgs 전달.
    const ctxMsgs = sanitizeChatForExtraction(messages)
    // 팀원이 공동 편집 창에서 보낸 구조화 산출물(_schema 가 대상 활동과 같음)은 방장이 직접 보낸 것과 같게
    // 그대로 저장한다 — 정화·보강·빌더를 거치면 표·manualWorkspace 가 문자열로 바뀌거나 사라진다(C2).
    const proposedSections = pendingArtifactSave.sections as Record<string, unknown>
    const isStructuredProposal = proposedSections?._schema === targetActivity
    let enrichedSections: Record<string, string> = isStructuredProposal
      ? proposedSections as Record<string, string>
      : enrichArtifactSections(sanitizeArtifactSections(pendingArtifactSave.sections), ctxMsgs)
    // 구조화된 산출물로 변환 (연수용 활동은 양식과 같은 섹션 키 원문 유지, 구조화 제안은 이미 구조화됨)
    if (isStructuredProposal || isTrainingActivity(proj, targetActivity)) {
      // 그대로 저장
    } else if (targetActivity === 'T-1-1') {
      enrichedSections = buildT11Structured(enrichedSections, ctxMsgs, soloT11Opts()) as unknown as Record<string, string>
    } else if (targetActivity === 'T-1-2') {
      enrichedSections = buildT12Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    } else if (targetActivity === 'T-2-1') {
      enrichedSections = buildT21Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    } else if (targetActivity === 'T-2-2') {
      enrichedSections = buildT22Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    } else if (targetActivity === 'T-2-3') {
      enrichedSections = buildT23Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    } else if (targetActivity === 'A-1-2') {
      enrichedSections = buildA12Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    } else if (targetActivity === 'A-2-1') {
      enrichedSections = buildA21Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    } else if (targetActivity === 'A-2-2') {
      enrichedSections = buildA22Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    } else if (targetActivity === 'A-2-3') {
      enrichedSections = buildA23Structured(enrichedSections, ctxMsgs) as unknown as Record<string, string>
    }
    // 구조화 제안은 방장 직접 전송(onSendArtifact)처럼 내용 전체를 교체 — 옛 문자열 섹션이 표를 가리지 않게
    const merged = isStructuredProposal ? { ...enrichedSections } : { ...baseContent, ...enrichedSections }
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

  // ─── 선택지 재논의 → 선택·지지 대기를 종료하고 기본 AI 대화로 복귀 ─
  async function handleRestartOptionDiscussion(messageId: string) {
    try {
      await closeOptionChoice(proj.id, messageId)
    } catch (error) {
      setChatError('선택 대기를 종료하지 못했습니다. 다시 시도해 주세요.')
      throw error
    }

    setDiscussionMode('ai_facilitated')
    const noticeContent = '기존 안 선택과 팀원별 지지 요청을 종료하고, 기본 대화에서 다시 논의하겠습니다.'
    setIsIdle(false)
    setPendingAdvance(null)
    setPendingTeamDiscussion(null)
    setFlowNotice('결정은 보류했습니다. 산출물은 그대로 두고 대화를 이어가세요.')
    const noticeId = generateMessageId(proj.id, currentActivity)
    const noticeMessage = {
      id: noticeId,
      role: 'user' as const,
      content: noticeContent,
      activityCode: currentActivity,
      userId: userProfile?.uid,
      displayName: userProfile?.displayName,
      createdAt: Timestamp.now(),
    }
    addMessage(noticeMessage)
    saveMessage(proj.id, currentActivity, {
      role: 'user',
      content: noticeContent,
      activityCode: currentActivity,
      userId: userProfile?.uid,
      displayName: userProfile?.displayName,
    }, noticeId).catch(() => {
      setChatError('선택 대화 종료 기록을 저장하지 못했습니다.')
    })
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus()
    })
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
    setIsIdle(false)
    clearStreamingText()

    const discussionMessages = discussionContributions(messages, teamDiscussionStartIdx)

    if (discussionMessages.length === 0) {
      setIsAnalyzing(false)
      setIsLoading(false)
      setFlowNotice('새로운 팀 대화가 없어 분석하지 않았습니다. 이전 대화를 이어가세요.')
      return
    }

    setIsAnalyzing(true)
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
1. 팀이 합의한 규칙 목록 (규칙명 + 구체적 내용 + 가장 여건이 빠듯한 팀원도 지킬 수 있는 실천 방법 포함)
2. 보완이 필요한 부분 (없으면 생략)

⚠️ 키워드 나열 금지. 규칙 설명과 실천 방법을 빠짐없이 포함하고, 벌이나 강제 조치를 만들지 않는다.

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
        async (fullText) => {
          if (await discardResponseAfterActivityChange(currentActivity)) return
          // 교사들이 토의에서 학년을 밝히는 경우가 많아 분석 응답도 [TEAM_GRADE_BANDS]를 받는다.
          const gradeBandsSignal = parseTeamGradeBandsSignal(fullText)
          const bodyText = gradeBandsSignal ? gradeBandsSignal.cleanText : fullText
          const signal = parseDiscussionSignal(bodyText)
          const text1 = signal ? signal.cleanText : bodyText
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
            cycleNumber: proj.currentCycle ?? 1,
            ...(parsedActionCardAnalysis ? { actionCard: parsedActionCardAnalysis.card, actionCardState: 'pending' as const } : {}),
          }, newMsgIdAnalysis).catch(console.error)
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })
          if (gradeBandsSignal) await handleTeamGradeBandsSignal(gradeBandsSignal.bands)
          return newMsgIdAnalysis
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
  // 페이지 이동 직후 준비 전에는 전송만 막고 입력은 지킨다(#26).
  const sendBlockReason = pendingNavigation ? '활동 이동을 저장하고 있어요' : chatSendBlockReason({
    hasProject: !!projectState,
    hasUser: !!userProfile,
    messagesLoaded,
    currentActivity,
    projectActivity: projectState?.currentActivity,
  })
  const isHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid

  const [gradeProposalBusy, setGradeProposalBusy] = useState<string | null>(null)
  const repairingGradeModeRef = useRef(false)
  const storedTeamBandsKey = normalizeTeamGradeBands(project.teamGradeBands).join(',')
  useEffect(() => {
    if (!isHost || !needsMultiBandModeRepair(project) || repairingGradeModeRef.current) return
    repairingGradeModeRef.current = true
    void updateTeamGradeBands(project.id, project.teamGradeBands ?? [], { repairModeOnly: true })
      .catch(() => setChatError('팀 학년군의 분석시트 설정을 저장하지 못했습니다. 다시 열어주세요.'))
      .finally(() => { repairingGradeModeRef.current = false })
  // The transaction reads the latest project; rows edited during this repair are preserved.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, project.id, storedTeamBandsKey, project.curriculumSheetGradeMode])

  // [2026-05-15] useCallback으로 reference 안정화 — 매 render마다 새 함수가 prop으로 들어가면
  // 모달의 useEffect cleanup이 폭주해 본인 presence가 등록·삭제 cycle을 만들어 팀원 칩 깜빡임 발생했음.
  const handleTeamVisionWorkspacePatch = useCallback(async (patch: TeamVisionWorkspacePatch) => {
    if (!projectId) return undefined
    return patchTeamVisionWorkspace(projectId, patch)
  }, [projectId])

  const handleTeamVisionPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setTeamVisionWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  // T-1-2 핸들러
  const handleLessonDesignDirectionWorkspacePatch = useCallback(async (patch: LessonDesignDirectionWorkspacePatch) => {
    if (!projectId) return undefined
    return patchLessonDesignDirectionWorkspace(projectId, patch)
  }, [projectId])

  const handleLessonDesignDirectionPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setLessonDesignDirectionWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  // T-2-1 역할 배분 핸들러 — LDD와 동일 패턴
  const handleRoleDistributionWorkspacePatch = useCallback(async (patch: RoleDistributionWorkspacePatch) => {
    if (!projectId) return undefined
    return patchRoleDistributionWorkspace(projectId, patch)
  }, [projectId])

  const handleRoleDistributionPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setRoleDistributionWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  // T-2-2 팀 규칙 핸들러
  const handleTeamRulesWorkspacePatch = useCallback(async (patch: TeamRulesWorkspacePatch) => {
    if (!projectId) return undefined
    return patchTeamRulesWorkspace(projectId, patch)
  }, [projectId])

  const handleTeamRulesPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setTeamRulesWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  async function handleTeamRulesSendArtifact(content: T22Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['T-2-2']
    const existing = currentArtifact?.activityCode === 'T-2-2' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'T-2-2', {
      status: 'in_review',
      title: '팀 규칙 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('T-2-2')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'T-2-2',
      artifactType: '팀 규칙 결정',
      title: '팀 규칙 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '팀 규칙 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  // T-2-3 팀 일정 핸들러
  const handleTeamScheduleWorkspacePatch = useCallback(async (patch: TeamScheduleWorkspacePatch) => {
    if (!projectId) return undefined
    return patchTeamScheduleWorkspace(projectId, patch)
  }, [projectId])

  const handleTeamSchedulePresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setTeamScheduleWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  async function handleTeamScheduleSendArtifact(content: T23Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['T-2-3']
    const existing = currentArtifact?.activityCode === 'T-2-3' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'T-2-3', {
      status: 'in_review',
      title: '팀 일정 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('T-2-3')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'T-2-3',
      artifactType: '팀 일정 결정',
      title: '팀 일정 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '팀 일정 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  // A-1-2 주제 선정 핸들러
  const handleTopicSelectionWorkspacePatch = useCallback(async (patch: TopicSelectionWorkspacePatch) => {
    if (!projectId) return undefined
    return patchTopicSelectionWorkspace(projectId, patch)
  }, [projectId])

  const handleTopicSelectionPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setTopicSelectionWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  async function handleTopicSelectionSendArtifact(content: A12Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['A-1-2']
    const existing = currentArtifact?.activityCode === 'A-1-2' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'A-1-2', {
      status: 'in_review',
      title: '주제 선정 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('A-1-2')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'A-1-2',
      artifactType: '주제 선정',
      title: '주제 선정 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '주제 선정 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  // Ds-1-3 학습활동 설계 핸들러
  const handleLearningActivityWorkspacePatch = useCallback(async (patch: LearningActivityWorkspacePatch) => {
    if (!projectId) return undefined
    return patchLearningActivityWorkspace(projectId, patch)
  }, [projectId])

  const handleLearningActivityPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setLearningActivityWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  async function handleLearningActivitySendArtifact(content: Ds13Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['Ds-1-3']
    const existing = currentArtifact?.activityCode === 'Ds-1-3' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'Ds-1-3', {
      status: 'in_review',
      title: '학습활동 설계 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('Ds-1-3')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'Ds-1-3',
      artifactType: '학습활동 설계',
      title: '학습활동 설계 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '학습활동 설계 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  // Ds-2-2 스캐폴딩 설계 핸들러
  const handleScaffoldingWorkspacePatch = useCallback(async (patch: ScaffoldingWorkspacePatch) => {
    if (!projectId) return undefined
    return patchScaffoldingWorkspace(projectId, patch)
  }, [projectId])

  const handleScaffoldingPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setScaffoldingWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  // ── DI·E 공동 편집 세션 핸들러 (가이드 20260804 §4·§5) ──
  // 4종이 동일한 shape을 쓰므로 patch/presence/저장을 팩토리로 묶는다.
  const coeditModules = useMemo(() => ({
    'DI-1-1': {
      patch: patchMaterialDevWorkspace,
      setPresence: setMaterialDevWorkspacePresence,
      empty: emptyMaterialDevWorkspace,
      config: MATERIAL_DEV_CONFIG,
      title: '자료 탐색·개발 산출물',
      artifactType: '자료 탐색·개발',
    },
    'DI-2-1': {
      patch: patchLessonRecordWorkspace,
      setPresence: setLessonRecordWorkspacePresence,
      empty: emptyLessonRecordWorkspace,
      config: LESSON_RECORD_CONFIG,
      title: '수업 실행·기록 산출물',
      artifactType: '수업 실행·기록',
    },
    'E-1-1': {
      patch: patchLessonReflectionWorkspace,
      setPresence: setLessonReflectionWorkspacePresence,
      empty: emptyLessonReflectionWorkspace,
      config: LESSON_REFLECTION_CONFIG,
      title: '수업 성찰·공동 개선 산출물',
      artifactType: '수업 성찰과 공동 개선',
    },
    'E-2-1': {
      patch: patchCollaborationReflectionWorkspace,
      setPresence: setCollaborationReflectionWorkspacePresence,
      empty: emptyCollaborationReflectionWorkspace,
      config: COLLABORATION_REFLECTION_CONFIG,
      title: '협력 과정 성찰 산출물',
      artifactType: '협력 과정 성찰',
    },
  }), [])

  // E-2-1 합의 대조판은 빈 표가 아니라 T단계 산출물 5행이 채워진 상태로 열린다.
  // 가이드 p68 HOW — 이미 저장된 비전·방향·역할·규칙·일정을 손으로 옮겨 적게 하지 않는다.
  // solo는 T-1-2·T-2-1·T-2-2가 숨김 활동이라 비전·일정 2행만 생성된다.
  const collaborationEmptyWithAgreements = useCallback(() => {
    const base = emptyCollaborationReflectionWorkspace()
    return { ...base, rows: buildCollaborationAgreementRows(proj.artifacts, isSoloProject(proj)) }
  }, [proj.artifacts, proj.mode, proj.memberUids])

  // AI 제안 맥락 — 활동마다 "근거로 삼아야 할 이전 산출물"이 다르다(가이드 §4·§5).
  // 산출물이 없으면 해당 항목을 빼고 보낸다 → 라우트가 지어내지 않고 빈 칸으로 둔다.
  const makeCoeditSuggestContext = useCallback((code: 'DI-1-1' | 'DI-2-1' | 'E-1-1' | 'E-2-1'): CoeditSuggestContext => {
    const asText = (activityCode: string): string => {
      const content = proj.artifacts?.[activityCode]?.content as Record<string, unknown> | undefined
      if (!content) return ''
      return serializeArtifactForPrompt(content)
    }
    const pick = (specs: Array<[string, string]>) => specs
      .map(([activityCode, label]) => ({ label, text: asText(activityCode) }))
      .filter(a => a.text.trim())

    const priorArtifacts =
      code === 'DI-1-1' ? pick([['Ds-1-3', 'Ds-3 학습활동 설계'], ['Ds-2-2', 'Ds-5 스캐폴딩 설계'], ['Ds-1-1', 'Ds-1 평가 계획']])
      : code === 'DI-2-1' ? pick([['DI-1-1', 'DI-1 개발 자료 목록'], ['Ds-1-3', 'Ds-3 학습활동 설계']])
      : code === 'E-1-1' ? pick([['Ds-1-1', 'Ds-1 평가 계획·루브릭'], ['DI-2-1', 'DI-2 수업 기록'], ['A-2-2', 'A-4 통합 수업목표']])
      : pick([['T-1-1', 'T-1 공동 비전'], ['T-1-2', 'T-2 수업설계 방향'], ['T-2-1', 'T-3 역할 배분'], ['T-2-2', 'T-4 팀 규칙'], ['T-2-3', 'T-5 팀 일정']])

    return {
      projectTitle: proj.title,
      targetGradeGroup: proj.targetGradeGroup,
      targetSubjects: proj.targetSubjects,
      teamMembers: Object.values(proj.memberInfo ?? {}).map(m => m.displayName).filter(Boolean),
      priorArtifacts,
      chatContext: messages
        .filter(m => m.activityCode === code)
        .map(m => ({ role: m.role, content: m.content, displayName: m.displayName })),
    }
  }, [proj.artifacts, proj.title, proj.targetGradeGroup, proj.targetSubjects, proj.memberInfo, messages])

  const makeCoeditPatchHandler = useCallback((code: 'DI-1-1' | 'DI-2-1' | 'E-1-1' | 'E-2-1') =>
    async (patch: CoeditWorkspacePatch) => {
      if (!projectId) return undefined
      return coeditModules[code].patch(projectId, patch)
    }, [projectId, coeditModules])

  const makeCoeditPresenceHandler = useCallback((code: 'DI-1-1' | 'DI-2-1' | 'E-1-1' | 'E-2-1') =>
    async (entry: CoeditPresenceEntry | null) => {
      if (!projectId || !userProfile?.uid) return
      const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
      await coeditModules[code].setPresence(
        projectId,
        userProfile.uid,
        entry ? { ...entry, color } : null,
      ).catch(console.error)
    }, [projectId, presenceColor, userProfile?.uid, userProfile?.color, coeditModules])

  const makeCoeditSendHandler = useCallback((code: 'DI-1-1' | 'DI-2-1' | 'E-1-1' | 'E-2-1') =>
    async (content: Record<string, string>) => {
      if (!project?.id) return
      const mod = coeditModules[code]
      // 팀원은 직접 저장하지 않고 방장에게 제안 (기존 워크스페이스와 동일 규칙)
      if (effectiveProjectMode(project) === 'collaborative' && !isHost) {
        await proposeArtifactToHost(
          project.id, code, content,
          userProfile?.uid ?? '', userProfile?.displayName ?? '팀원',
        )
        return
      }
      const firestoreArtifact = project.artifacts?.[code]
      const existing = currentArtifact?.activityCode === code ? currentArtifact : null
      const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
      // 기존 내용 병합 — 공동 편집이 채우지 않은 섹션(AI가 쓴 것)을 지우지 않는다
      const base = (firestoreArtifact?.content ?? {}) as Record<string, unknown>
      const merged = { ...base }
      for (const [k, v] of Object.entries(content)) {
        if (v && v.trim()) merged[k] = v
      }
      await setProjectArtifact(project.id, code, {
        status: 'in_review',
        title: mod.title,
        content: merged,
        version,
      })
      setViewingActivity(code)
      setCurrentArtifact({
        id: existing?.id ?? Date.now().toString(),
        activityCode: code,
        artifactType: mod.artifactType,
        title: mod.title,
        status: 'in_review',
        currentVersion: version,
        aiDraft: merged,
        createdBy: userProfile?.uid ?? 'manual',
        meta: {
          author: '수동 공동 편집',
          createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
          updatedAt: Timestamp.now(),
          evidence: `${mod.artifactType} 공동 편집`,
          approvalStatus: 'pending',
        },
      })
    }, [project, isHost, currentArtifact, userProfile, coeditModules, setViewingActivity, setCurrentArtifact])

  async function handleScaffoldingSendArtifact(content: Ds22Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['Ds-2-2']
    const existing = currentArtifact?.activityCode === 'Ds-2-2' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'Ds-2-2', {
      status: 'in_review',
      title: '스캐폴딩 설계 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('Ds-2-2')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'Ds-2-2',
      artifactType: '스캐폴딩 설계',
      title: '스캐폴딩 설계 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '스캐폴딩 설계 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  async function handleRoleDistributionSendArtifact(content: T21Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['T-2-1']
    const existing = currentArtifact?.activityCode === 'T-2-1' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'T-2-1', {
      status: 'in_review',
      title: '역할 배분 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('T-2-1')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'T-2-1',
      artifactType: '역할 배분',
      title: '역할 배분 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '역할 배분 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  async function handleLessonDesignDirectionSendArtifact(content: T12Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['T-1-2']
    const existing = currentArtifact?.activityCode === 'T-1-2' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'T-1-2', {
      status: 'in_review',
      title: '수업설계 방향 설정 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('T-1-2')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'T-1-2',
      artifactType: '수업설계 방향 설정',
      title: '수업설계 방향 설정 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '수업설계 방향 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  // Ds-1-1 평가 계획 핸들러 — LDD와 동일 패턴
  const handleEvaluationPlanWorkspacePatch = useCallback(async (patch: EvaluationPlanWorkspacePatch) => {
    if (!projectId) return undefined
    return patchEvaluationPlanWorkspace(projectId, patch)
  }, [projectId])

  const handleEvaluationPlanPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setEvaluationPlanWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  async function handleEvaluationPlanSendArtifact(content: Ds11Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['Ds-1-1']
    const existing = currentArtifact?.activityCode === 'Ds-1-1' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'Ds-1-1', {
      status: 'in_review',
      title: '평가 설계 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('Ds-1-1')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'Ds-1-1',
      artifactType: '평가 설계',
      title: '평가 설계 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '평가 계획 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  // Ds-1-2 문제상황 핸들러 — Ds-1-1과 동일 패턴
  const handleProblemSituationWorkspacePatch = useCallback(async (patch: ProblemSituationWorkspacePatch) => {
    if (!projectId) return undefined
    return patchProblemSituationWorkspace(projectId, patch)
  }, [projectId])

  const handleProblemSituationPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setProblemSituationWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  async function handleProblemSituationSendArtifact(content: Ds12Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['Ds-1-2']
    const existing = currentArtifact?.activityCode === 'Ds-1-2' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'Ds-1-2', {
      status: 'in_review',
      title: '문제 상황 설정 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('Ds-1-2')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'Ds-1-2',
      artifactType: '문제 상황 설정',
      title: '문제 상황 설정 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '문제상황 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  const handleSupportToolWorkspacePatch = useCallback(async (patch: SupportToolWorkspacePatch) => {
    if (!projectId) return undefined
    return patchSupportToolWorkspace(projectId, patch)
  }, [projectId])

  const handleSupportToolPresence = useCallback(async (entry: { uid: string; displayName: string; color: string; cellKey: string; caretPos?: number; updatedAt: number } | null) => {
    if (!projectId || !userProfile?.uid) return
    const color = presenceColor ?? userProfile.color ?? entry?.color ?? '#1A73E8'
    await setSupportToolWorkspacePresence(
      projectId,
      userProfile.uid,
      entry ? { ...entry, color } : null,
    ).catch(console.error)
  }, [projectId, presenceColor, userProfile?.uid, userProfile?.color])

  async function handleSupportToolSendArtifact(content: Ds21Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['Ds-2-1']
    const existing = currentArtifact?.activityCode === 'Ds-2-1' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'Ds-2-1', {
      status: 'in_review',
      title: '자료와 도구 연결 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('Ds-2-1')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'Ds-2-1',
      artifactType: '자료와 도구 연결',
      title: '자료와 도구 연결 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '지원 도구 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

  async function handleTeamVisionSendArtifact(content: T11Structured) {
    if (!project?.id || !isHost) return
    const firestoreArtifact = project.artifacts?.['T-1-1']
    const existing = currentArtifact?.activityCode === 'T-1-1' ? currentArtifact : null
    const version = (firestoreArtifact?.version ?? existing?.currentVersion ?? 0) + 1
    await setProjectArtifact(project.id, 'T-1-1', {
      status: 'in_review',
      title: '공동 비전 설정 산출물',
      content: content as unknown as Record<string, unknown>,
      version,
    })
    setViewingActivity('T-1-1')
    setCurrentArtifact({
      id: existing?.id ?? Date.now().toString(),
      activityCode: 'T-1-1',
      artifactType: '공동 비전 설정',
      title: '공동 비전 설정 산출물',
      status: 'in_review',
      currentVersion: version,
      aiDraft: content as unknown as Record<string, unknown>,
      createdBy: userProfile?.uid ?? 'manual',
      meta: {
        author: '수동 공동 편집',
        createdAt: existing?.meta?.createdAt ?? Timestamp.now(),
        updatedAt: Timestamp.now(),
        evidence: '팀 공통 비전 워크스페이스',
        approvalStatus: 'pending',
      },
    })
  }

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

  async function saveGraphDataAndSyncSheet(data: Omit<GraphSavedData, 'savedAt'>) {
    if (!project?.id) return
    await saveGraphData(project.id, data)

    const currentRows = latestSheetRowsRef.current.length > 0
      ? latestSheetRowsRef.current
      : (project.curriculumSheet ?? [])
    const { rows: nextRows, changed } = mergeGraphAgentExamplesIntoRows(currentRows, data)
    let rowsForProposal = nextRows
    if (changed) {
      const currentById = new Map(currentRows.map(row => [row.id, row]))
      const updates = nextRows
        .filter(row => (currentById.get(row.id)?.agentLessonExample ?? '') !== (row.agentLessonExample ?? ''))
        .map(row => ({
          rowId: row.id,
          field: 'agentLessonExample' as const,
          value: row.agentLessonExample ?? '',
        }))
      if (updates.length > 0) {
        rowsForProposal = await patchCurriculumSheet(project.id, {
          type: 'update-cells',
          updates,
          updatedBy: userProfile?.displayName ?? undefined,
        })
        latestSheetRowsRef.current = rowsForProposal
      }
    }
    proposeCurriculumSheetArtifactSave(rowsForProposal, '지식 그래프 저장 결과')
  }

  // 분석시트 학년군 설정 — 산출물 표의 학년군 표기를 시트 화면과 일치시킨다.
  function sheetGradeSettings(rows: CurriculumSheetRow[]) {
    return {
      gradeMode: (project?.teamGradeBands?.length ?? 0) >= 2 ? 'multi' : project?.curriculumSheetGradeMode ?? defaultGradeMode(rows),
      sheetGradeBand: resolveSheetGradeBand(project?.curriculumSheetGradeBand, project?.targetGradeGroup),
    }
  }

  function proposeCurriculumSheetArtifactSave(rows: CurriculumSheetRow[], source: string) {
    if (!isHost) return
    const proposal = buildCurriculumSheetArtifactProposal(rows, sheetGradeSettings(rows))
    if (!proposal) return
    setPendingArtifactSave({
      ...proposal,
      title: `${proposal.title} (${source})`,
      activityCode: 'A-2-1',
    })
  }

  function isA21SheetArtifactRequest(text: string): boolean {
    if (currentActivity !== 'A-2-1') return false
    const compact = text.replace(/\s+/g, '')
    // 이동 요청은 저장된 시트의 재작성·재저장 요청이 아니다.
    if (/(이동|넘어가|다음활동|다음단계|다음으로)/.test(compact)) return false
    // 선택 버튼의 응답은 AI가 제안한 내용을 이어서 처리해야 한다.
    if (/^[A-Z]안을선택/.test(compact)) return false
    // 수정·교체 요청은 시트 그대로 저장하지 않고 AI가 변경 지시를 처리하게 한다.
    const isEditIntent = /(바꾸|바꿔|바꾼|대신|고쳐|고친|수정|변경|교체|추가|빼|뺀|제외|삭제|넣어|넣은)/.test(compact)
    if (isEditIntent) return false
    // 브리핑·요약·조회 의도는 정보 요청이지 산출물 작성 요청이 아님
    // (예: /이전 단계 브리핑 → "지금까지 완료된 모든 활동의 확정 산출물을 브리핑해주세요")
    const isBriefingIntent = /(브리핑|요약|조회|보여|알려|확인|되돌아|돌아보)/.test(compact)
    if (isBriefingIntent) return false
    const mentionsSheet = /(시트|분석표)/.test(compact)
    const asksToCreate = /(만들어|저장해|산출물로|작성해|제작해|생성해|정리해|완성해)/.test(compact)
    return mentionsSheet && asksToCreate
  }

  function addAssistantNotice(content: string) {
    const msgId = generateMessageId(proj.id, currentActivity)
    addMessage({
      id: msgId,
      role: 'assistant',
      content,
      activityCode: currentActivity,
      activityType: '생성',
      agentType: 'orchestrator',
      cycleNumber: proj.currentCycle ?? 1,
      createdAt: Timestamp.now(),
    })
    saveMessage(proj.id, currentActivity, {
      role: 'assistant',
      content,
      activityCode: currentActivity,
      activityType: '생성',
      agentType: 'orchestrator',
      cycleNumber: proj.currentCycle ?? 1,
    }, msgId).catch(console.error)
  }

  /**
   * [TEAM_GRADE_BANDS] 신호 처리 — 팀의 학년 구성을 프로젝트에 저장한다.
   * Firestore 쓰기는 방장만 수행한다(ACTIVITY_ADVANCE·ACTIVITY_RETURN 등 다른 신호 쓰기와 동일 게이팅).
   * 저장 안내 메시지도 Firestore에 남으므로 팀원 전원 화면에 한 번만 나타난다.
   */
  async function handleTeamGradeBandsSignal(bands: string[]) {
    if (bands.length === 0) return
    const saved = normalizeTeamGradeBands(project.teamGradeBands)
    const same = saved.length === bands.length && saved.every((band, index) => band === bands[index])
    if (same && !needsMultiBandModeRepair(project)) return
    try {
      if (!isHost) {
        const pending = userProfile?.uid ? project.teamGradeBandProposals?.[userProfile.uid] : undefined
        if (pending && pending.bands.join(',') === bands.join(',')) return
        await proposeTeamGradeBands(proj.id, bands, userProfile?.displayName ?? '팀원')
        addAssistantNotice(`학년군 ${formatGradeBandList(bands)}을 방장에게 확인 요청했습니다. 방장이 반영하면 분석시트에 적용됩니다.`)
        return
      }
      const next = await updateTeamGradeBands(proj.id, bands)
      if (next.length === 0) return
      addAssistantNotice(
        `팀 학년군을 ${formatGradeBandList(next)}으로 저장했습니다.`
        + (next.length >= 2 ? " 분석시트가 '다양한 학년군' 모드로 열리고, 자동 채우기가 팀 학년군별로 자료를 조회합니다." : ''),
      )
    } catch (err) {
      console.error('[TEAM_GRADE_BANDS] 저장 실패:', err)
      setChatError('학년군 정보를 저장하지 못했습니다. 다시 알려주세요.')
    }
  }

  function handleA21SheetArtifactRequest(text: string): boolean {
    if (!isA21SheetArtifactRequest(text)) return false

    const rows = latestSheetRowsRef.current.length > 0
      ? latestSheetRowsRef.current
      : (project?.curriculumSheet ?? [])
    const proposal = buildCurriculumSheetArtifactProposal(rows, sheetGradeSettings(rows))

    if (!proposal) {
      setWorkspaceInitialView('sheet')
      setShowWorkspace(true)
      setShowGraphPanel(true)
      if (isHost) setGraphOpen(proj.id, true, undefined, 'sheet').catch(console.error)
      addAssistantNotice('분석시트에 저장된 행이 아직 없습니다. 상단 \'교육과정 분석\' → 아래 \'AI 자동 채우기\' → 핵심아이디어 확인 후 \'성취기준 추천 및 분석표 생성\'으로 시트를 먼저 작성해 주세요.')
      return true
    }

    const sheetProposal = {
      ...proposal,
      title: `${proposal.title} (분석시트 기반)`,
      activityCode: 'A-2-1',
    }

    if (isHost) {
      setPendingArtifactSave(sheetProposal)
      addAssistantNotice('분석시트에 저장된 표를 기준으로 산출물 초안을 만들었습니다. 저장 카드에서 검토한 뒤 산출물에 저장하세요.')
    } else if (effectiveProjectMode(project) === 'collaborative') {
      proposeArtifactToHost(
        proj.id,
        'A-2-1',
        proposal.sections,
        userProfile?.uid ?? '',
        userProfile?.displayName ?? '팀원',
      ).catch(console.error)
      addAssistantNotice('분석시트에 저장된 표를 기준으로 방장에게 산출물 저장 제안을 보냈습니다.')
    } else {
      setChatError('산출물 저장은 방장만 실행할 수 있습니다.')
      addAssistantNotice('분석시트 표 형식 산출물은 방장이 저장할 수 있습니다. 방장에게 교육과정 분석 버튼에서 산출물 저장을 요청해주세요.')
    }

    return true
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

  // 연수용: 단계별 진행 중인지 판단할 이 활동의 교사 발화(시간순) — 환영 표시 대체에 쓴다
  const trainingUserTexts = useMemo(() => messages.filter(m => m.role === 'user' && m.activityCode === currentActivity).map(m => m.content), [messages, currentActivity])
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
      && proj.closedOptionMessages?.[lastAIMsg.id] !== true
      && !!parseOptions(lastAIMsg.content),
    [isTeamMode, lastAIMsg, currentActivity, proj.closedOptionMessages]
  )

  // ─── 직접 메시지 전송 (HelpCard 등 버튼에서 호출) ──────
  function getRetryRequest() {
    return !isLoading && !isAnalyzing
      && failedChatRequest?.activityCode === currentActivity
      && failedChatRequest.userId === userProfile?.uid
      ? failedChatRequest : null
  }

  // AI 답변 속 체크리스트 — 화면에 바로 반영하고 그 메시지 문서의 checklistState.순번 만 저장한다(팀원 화면은 구독으로 반영).
  function toggleChecklistItem(msg: Message, index: number, checked: boolean) {
    const by = userProfile?.displayName ?? '팀원'
    replaceMessage(msg.id, msg.content, { checklistState: { ...msg.checklistState, [String(index)]: { checked, by } } })
    setMessageChecklistItem(proj.id, msg, index, checked, by).catch(error => {
      console.error('[checklist] save failed:', error)
      setChatError('체크 상태를 저장하지 못했습니다. 다시 눌러 주세요.')
    })
  }

  // 보내기 대기열 — 연수용 화면(연수 막대 버튼·양식 저장 알림)과, AI 가 답하는 중에 교사가 친 메시지를 담는다.
  // AI 응답 중이거나 대화를 불러오기 전이면 버리지 않고 줄에 세워 '보내는 중'으로 보여 주다가 순서대로 보낸다(#T10).
  const trainingQueueRef = useRef<string[]>([])
  const [trainingQueueTick, setTrainingQueueTick] = useState(0)
  const [queuedSends, setQueuedSends] = useState<string[]>([])
  const enqueueTrainingSend = useCallback((text: string) => {
    if (!text.trim()) return
    trainingQueueRef.current.push(text)
    setQueuedSends([...trainingQueueRef.current])
    setTrainingQueueTick(tick => tick + 1)
  }, [])
  useEffect(() => {
    const onTrainingSend = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text
      if (text) enqueueTrainingSend(text)
    }
    window.addEventListener(TRAINING_SEND_EVENT, onTrainingSend)
    return () => window.removeEventListener(TRAINING_SEND_EVENT, onTrainingSend)
  }, [enqueueTrainingSend])
  useEffect(() => {
    if (isLoading || isAnalyzing || !messagesLoaded) return
    const next = trainingQueueRef.current.shift()
    if (!next) return
    setQueuedSends([...trainingQueueRef.current])
    // 고정 응답 경로는 isLoading 을 바꾸지 않으므로, 끝나면 다음 항목을 위해 한 번 더 깨운다.
    void sendMessageDirectly(next).finally(() => setTrainingQueueTick(tick => tick + 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendMessageDirectly 는 렌더마다 새로 만들어지는 함수
  }, [isLoading, isAnalyzing, messagesLoaded, trainingQueueTick])

  async function sendMessageDirectly(text: string, retryExistingMessage = false) {
    if (!text.trim() || isLoading || isAnalyzing || !project) return
    setIsIdle(false)
    setChatError(null)
    const retryRequest = retryExistingMessage ? getRetryRequest() : null
    let responseMessageId = retryRequest?.assistantMessageId
    setFailedChatRequest(null)
    // 재시도는 기존 대화의 발신자를 유지하고 AI 응답만 다시 요청한다.
    let requestMessages = retryExistingMessage ? (retryRequest?.messages ?? messages) : messages
    if (!retryExistingMessage) {
      const senderDisplayName = userProfile?.displayName
      const directMessageId = generateMessageId(proj.id, currentActivity)
      const tempUserMsg = {
        id: directMessageId,
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
        cycleNumber: proj.currentCycle ?? 1,
      }, directMessageId).catch(error => {
        // 대기열에서 보낸 글도 저장 실패 시 알리고 입력창에 되돌려 둔다(#T10)
        console.error('[sendMessageDirectly] save failed:', error)
        setChatError('메시지를 저장하지 못했어요. 입력한 글을 입력창에 되돌려 두었으니 다시 보내 주세요.')
        setInput(current => current.trim() ? current : text)
      })
      requestMessages = [...messages, tempUserMsg]

      if (handleA21SheetArtifactRequest(text)) return
      // 연수용: 양식 저장 알림 + 개입 금지면 AI 를 부르지 않고 고정 응답만 남긴다(프롬프트가 아니라 코드로 보장).
      const previousUserTexts = messages.filter(m => m.role === 'user' && m.activityCode === currentActivity).map(m => m.content)
      if (shouldReplyTrainingQuietly(proj, currentActivity, text, previousUserTexts)) {
        const quietId = generateMessageId(proj.id, currentActivity)
        addMessage({ id: quietId, role: 'assistant', content: TRAINING_QUIET_REPLY, activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator', createdAt: Timestamp.now() })
        saveMessage(proj.id, currentActivity, {
          role: 'assistant', content: TRAINING_QUIET_REPLY, activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator',
          cycleNumber: proj.currentCycle ?? 1,
        }, quietId).catch(console.error)
        return
      }
    }

    setIsLoading(true)
    clearStreamingText()
    streamingAccumRef.current = ''
    if (userProfile?.uid) setStreamingState(proj.id, currentActivity, '', userProfile.uid).catch(() => {})
    streamingFlushRef.current = setInterval(() => {
      if (streamingAccumRef.current && userProfile?.uid) {
        setStreamingState(proj.id, currentActivity, streamingAccumRef.current, userProfile.uid).catch(() => {})
      }
    }, 800)
    try {
      await streamFromAPI(
        requestMessages.map(m => ({ role: m.role, content: displayedMessageContent(proj, m, trainingUserTexts), displayName: m.displayName })),
        (chunk) => { appendStreamingText(chunk); streamingAccumRef.current += chunk },
        async (fullText) => {
          if (await discardResponseAfterActivityChange(currentActivity)) return
          // [TEAM_GRADE_BANDS]는 데이터 신호 — 가장 먼저 본문에서 떼어낸다(사용자 노출 금지).
          const gradeBandsSignal = parseTeamGradeBandsSignal(fullText)
          const bodyText = gradeBandsSignal ? gradeBandsSignal.cleanText : fullText
          const signal = parseDiscussionSignal(bodyText)
          let t1 = signal ? signal.cleanText : bodyText
          const advance = parseActivityAdvance(t1)
          t1 = advance ? advance.cleanText : t1
          const ret = parseActivityReturn(t1)
          const t2 = ret ? ret.cleanText : t1
          const { codes: rawCCodes, cleanText: t2c } = parseArtifactConfirm(t2)
          const { updates: rawUpd, cleanText: t2d } = parseArtifactUpdates(t2c)
          const { updates: upd, confirmCodes: cCodes, notices: saveNotices } = gateArtifactUpdates(rawUpd, rawCCodes, text)
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
          const finalText = appendSaveGateNotice(parsedActionCardD ? parsedActionCardD.cleanText : t2e.replace(/\n*\[ACTION_CARD:[^\]]+\]\n?/, '').trimEnd(), saveNotices)
          if (streamingFlushRef.current) { clearInterval(streamingFlushRef.current); streamingFlushRef.current = null }
          const replacingResponse = !!responseMessageId
          const newMsgId = responseMessageId ?? generateMessageId(proj.id, currentActivity)
          responseMessageId = newMsgId
          // 재시도로 끊긴 부분 답을 대체할 때는 원래 작성 시각을 유지해 대화 위치가 바뀌지 않게 한다.
          const replacedCreatedAt = replacingResponse ? messages.find(m => m.id === newMsgId)?.createdAt : undefined
          if (replacingResponse) replaceMessage(newMsgId, finalText, {
            activityType: '생성', agentType: 'orchestrator',
            actionCard: parsedActionCardD?.card,
            actionCardState: parsedActionCardD ? 'pending' as const : undefined,
          })
          else addMessage({ id: newMsgId, role: 'assistant', content: finalText, activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator', createdAt: Timestamp.now(),
            ...(parsedActionCardD ? { actionCard: parsedActionCardD.card, actionCardState: 'pending' as const } : {}),
          })
          if (hm) setHelpCardMap(prev => ({ ...prev, [newMsgId]: hm }))
          clearStreamingText()
          // 메시지 저장 완료 후 streaming 상태 삭제 → B 화면에서 공백 없이 메시지로 전환
          saveMessage(proj.id, currentActivity, {
            role: 'assistant', content: finalText, activityCode: currentActivity, activityType: '생성', agentType: 'orchestrator',
            cycleNumber: proj.currentCycle ?? 1,
            ...(parsedActionCardD ? { actionCard: parsedActionCardD.card, actionCardState: 'pending' as const } : {}),
          }, newMsgId, replacedCreatedAt)
            .then(() => clearStreamingState(proj.id, currentActivity, userProfile?.uid ?? ''))
            .catch(console.error)
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })
          if (gradeBandsSignal) await handleTeamGradeBandsSignal(gradeBandsSignal.bands)
          const onlyConfirmedNoops = await processArtifactSignals(upd, cCodes, finalText)

          // 구조화 산출물 자동 저장 fallback

          // P0-phil2 (Task #30): parseSaveIntent fallback 제거.
          // A안/B안 OptionsMessage가 이미 저장 결정을 묻는 중에 텍스트 패턴 매칭으로
          // "산출물 초안으로 저장할까요?" 카드를 또 띄우는 중복 UI 발생. 규칙 0-2/A안 게이트와 충돌.
          // 저장은 (a) A안/B안 명시 선택 또는 (b) ACTION_CARD primary 클릭 후 ARTIFACT_UPDATE 신호 경로만 허용.
          if (advance?.nextActivity) setPendingAdvance(advance.nextActivity)
          else if (ret?.targetActivity) await handleActivityReturn(ret.targetActivity)
          else offerAdvanceAfterConfirmedNoop(onlyConfirmedNoops, text)
          return newMsgId
        }
      )
    } catch (err) {
      console.error('Chat error:', err)
      setChatError('AI 응답 중 오류가 발생했습니다. 다시 시도해주세요.')
      setFailedChatRequest({ activityCode: currentActivity, userId: userProfile?.uid, messages: requestMessages, assistantMessageId: responseMessageId })
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
  async function confirmMemberRemoval(target: MemberRef) {
    if (!project || !userProfile?.uid) return
    setMemberCommand(current => current && { ...current, busy: true, error: undefined })
    try {
      await removeMember(project.id, userProfile.uid, target.uid)
      setMemberCommand({ command: { kind: 'confirm', target }, state: 'removed' })
    } catch (error) {
      const code = (error instanceof Error ? error.message : '') as MemberAdminError
      setMemberCommand(current => current && {
        ...current, busy: false,
        error: MEMBER_ADMIN_ERROR_COPY[code] ?? '내보내지 못했어요. 잠시 뒤 다시 시도해 주세요.',
      })
    }
  }

  async function handleSend() {
    const { input } = chatDraft.getSnapshot()
    if (!input.trim() || !project) return
    // 준비 전에는 보내지 않고 입력을 그대로 둔다 — 조용히 버리지 않는다(#26).
    if (sendBlockReason) return
    // 팀원 내보내기 명령은 AI 를 부르지 않고 방장 화면의 확인 카드로만 처리한다(명령 문장·카드는 저장하지 않음).
    const command = classifyMemberCommand(input, project, userProfile?.uid)
    if (command.kind !== 'none') {
      setMemberCommand({ command, state: 'pending' })
      setInput('')
      return
    }
    // AI 가 답하는 중이면 버리지 않고 대기열에 넣어 '보내는 중'으로 보여 주고, 답이 끝나면 보낸다(#T10).
    if (isLoading && !isTeamMode && !isWaitingForChoice) {
      const queuedReply = replyTo
        ? `[답장: "${(replyTo.content.replace(/\[.*?\]/g, '').replace(/[#*_~`>]/g, '').trim().split(/[.!?\n]/)[0]?.trim() || replyTo.content.slice(0, 60)).slice(0, 80)}"]\n`
        : ''
      enqueueTrainingSend(queuedReply + input.trim())
      setInput('')
      setReplyTo(null)
      return
    }

    // 답장 시: 인용 대상의 첫 문장만 간결하게 삽입
    const replyPrefix = replyTo
      ? (() => {
          const clean = replyTo.content.replace(/\[.*?\]/g, '').replace(/[#*_~`>]/g, '').trim()
          const firstSentence = clean.split(/[.!?\n]/)[0]?.trim() || clean.slice(0, 60)
          return `[답장: "${firstSentence.slice(0, 80)}"]\n`
        })()
      : ''
    const userMessage = replyPrefix + input.trim()
    setFlowNotice(null)
    if (hasDeferredDecision([...messages, { role: 'user', content: userMessage }])) {
      setPendingAdvance(null)
      setPendingTeamDiscussion(null)
    }
    setInput('')
    setIsIdle(false)  // 사용자 입력 시 idle 해제
    setChatError(null)  // 새 메시지 전송 시 이전 에러 초기화
    setFailedChatRequest(null)

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
      cycleNumber: proj.currentCycle ?? 1,
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
      cycleNumber: proj.currentCycle ?? 1,
    }, userMsgId).catch(error => {
      // 저장 실패를 조용히 넘기면 다음 스냅숏에서 메시지가 사라진다 — 알리고 입력한 글을 되돌려 둔다(#T10).
      console.error('[handleSend] save failed:', error)
      setChatError('메시지를 저장하지 못했어요. 입력한 글을 입력창에 되돌려 두었으니 다시 보내 주세요.')
      setInput(current => current.trim() ? current : userMessage)
    })
    setReplyTo(null)

    if (handleA21SheetArtifactRequest(userMessage)) return

    // 팀 토의 모드: AI 호출 없이 메시지만 저장 (AI는 토의 종료 후 응답)
    if (isTeamMode) return

    // 선택 대기 중 자유 입력 — 제시된 안이 마음에 들지 않아 직접 말로 답한 경우.
    // 방장(=solo 사용자 포함)이 입력하면 "이 중에는 없다 · 직접 입력"으로 간주해
    // 선택 대기를 해제하고 AI 응답을 이어간다. 팀원은 기존대로 의견만 남긴다.
    if (isWaitingForChoice) {
      if (!isHost) return
      if (lastAIMsg) await closeOptionChoice(proj.id, lastAIMsg.id).catch(console.error)
    }

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
    let responseMessageId: string | undefined
    try {
      await streamFromAPI(
        [...messages, tempUserMsg].map(m => ({ role: m.role, content: displayedMessageContent(proj, m, trainingUserTexts), displayName: m.displayName })),
        (text) => {
          appendStreamingText(text)
          streamingAccumRef.current += text
        },
        async (fullText) => {
          if (await discardResponseAfterActivityChange(currentActivity)) return
          // [TEAM_GRADE_BANDS]는 데이터 신호 — 가장 먼저 본문에서 떼어낸다(사용자 노출 금지).
          const gradeBandsSignal = parseTeamGradeBandsSignal(fullText)
          const bodyText = gradeBandsSignal ? gradeBandsSignal.cleanText : fullText
          const signal = parseDiscussionSignal(bodyText)
          let text1 = signal ? signal.cleanText : bodyText
          const advance = parseActivityAdvance(text1)
          text1 = advance ? advance.cleanText : text1
          const ret = parseActivityReturn(text1)
          const text2 = ret ? ret.cleanText : text1
          const { codes: rawConfirmCodes2, cleanText: text2c } = parseArtifactConfirm(text2)
          const { updates: rawUpdates, cleanText: text2d } = parseArtifactUpdates(text2c)
          const { updates, confirmCodes: confirmCodes2, notices: saveNotices2 } = gateArtifactUpdates(rawUpdates, rawConfirmCodes2, userMessage)
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
          const displayText = appendSaveGateNotice(cleanText, saveNotices2)
          // interval 정리 + Firestore 스트리밍 상태 삭제
          if (streamingFlushRef.current) {
            clearInterval(streamingFlushRef.current)
            streamingFlushRef.current = null
          }
          const newMsgId = generateMessageId(proj.id, currentActivity)
          responseMessageId = newMsgId
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
            cycleNumber: proj.currentCycle ?? 1,
            ...(parsedActionCard ? { actionCard: parsedActionCard.card, actionCardState: 'pending' as const } : {}),
          }, newMsgId)
            .then(() => clearStreamingState(proj.id, currentActivity, userProfile?.uid ?? ''))
            .catch((err) => { console.error(err); setChatError('메시지 저장에 실패했습니다. 내용은 화면에 표시되지만 새로고침 시 사라질 수 있습니다.') })
          if (signal) setPendingTeamDiscussion({ topic: signal.topic })
          if (gradeBandsSignal) await handleTeamGradeBandsSignal(gradeBandsSignal.bands)
          const onlyConfirmedNoops = await processArtifactSignals(updates, confirmCodes2, displayText)

          // 구조화 산출물 자동 저장 fallback (A안/B안 선택 후 AI 응답)

          // [ARTIFACT_UPDATE] 없이 저장 처리
          // P0-phil2 (Task #30): A-2-1 외 활동의 parseSaveIntent fallback 제거.
          // 일반 활동의 저장 경로는 (a) A안/B안 명시 선택 → ARTIFACT_UPDATE,
          // (b) ACTION_CARD primary 클릭 → 다음 턴 ARTIFACT_UPDATE 둘만 허용.
          // A-2-1: 구조화 스키마 전환 이후 extractA21TableForSave 특수 경로 비활성화.
          // 저장은 명시적인 ARTIFACT_UPDATE 신호로만 처리.

          if (advance?.nextActivity) {
            // 저장 여부와 무관하게 항상 pendingAdvance 배너로 막음
            // → 사용자가 산출물을 검토·확정한 후 직접 "다음 단계로" 버튼을 눌러야 이동
            setPendingAdvance(advance.nextActivity)
          } else if (ret?.targetActivity) await handleActivityReturn(ret.targetActivity)
          else offerAdvanceAfterConfirmedNoop(onlyConfirmedNoops, userMessage)
          return newMsgId
        }
      )
    } catch (err) {
      console.error('Chat error:', err)
      setChatError('AI 응답 중 오류가 발생했습니다. 다시 시도해주세요.')
      setFailedChatRequest({ activityCode: currentActivity, userId: userProfile?.uid, messages: [...messages, tempUserMsg], assistantMessageId: responseMessageId })
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
  function filterSlashCommands(slashQuery: string | null) { return slashQuery !== null
    ? SLASH_COMMANDS.filter(cmd => {
        if (cmd.hostOnly && !isHost) return false
        return slashQuery === '' ||
          cmd.label.includes(slashQuery) ||
          cmd.keywords.some(k => k.includes(slashQuery))
      })
    : []
  }

  // ─── 슬래시 커맨드 실행 ─────────────────────────────
  async function executeSlashCommand(cmdId: SlashCommandId) {
    const { input } = chatDraft.getSnapshot()
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
        // 답글 대상 메시지 내용을 산출물로 저장 제안 (선택지·절차 문구는 제외)
        const content = stripNonContentLines(replyTo.content.replace(/\[.*?\]/g, ''))
        if (!content) {
          setChatError('선택지·안내 문구는 산출물로 저장할 수 없습니다. 실제 내용이 담긴 메시지를 선택해주세요.')
          setReplyTo(null)
          return
        }
        void applyArtifactUpdates({ [activityMeta.label]: content }, undefined, undefined, 'manual')
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
    } else if (cmdId === 'coreidea') {
      setShowCoreIdeaBrowser(true)
    } else if (cmdId === 'reset-chat') {
      if (!confirm(`현재 활동(${displayActivityCode(currentActivity)})의 채팅을 모두 삭제하고 다시 시작하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return
      // 현재 활동 메시지 Firestore에서 삭제
      if (project?.id) {
        import('@/lib/firebase/projects').then(async ({ deleteActivityMessages }) => {
          await deleteActivityMessages(project.id, currentActivity)
          // 로컬 메시지도 제거
          const { setMessages } = useProjectStore.getState()
          setMessages(messages.filter(m => m.activityCode !== currentActivity))
        }).catch(console.error)
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const { slashQuery, slashCmdIdx } = chatDraft.getSnapshot()
    const filteredSlashCmds = filterSlashCommands(slashQuery)
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
    if (isLoading || isAnalyzing) return
    setShowDiscussionConfirm(false)
    try { await setTeamDiscussion(proj.id, currentActivity, true) }
    catch { setChatError('팀채팅을 시작하지 못했습니다. 다시 시도해 주세요.'); return }
    setIsIdle(false)
    // 로컬 즉시 반영 (Firestore 감지 전 UX)
    setDiscussionMode('team_discussion')
    setTeamDiscussionStartIdx(messages.filter(m => m.role !== 'system').length)
  }

  // 팀 채팅 종료 → Firestore 업데이트 후 AI 분석
  async function handleEndDiscussionAndAnalyze() {
    const isLegacyOptionRestart = proj.teamDiscussions?.[currentActivity]?.topic === '제안안을 다시 논의하기'
    if (isLegacyOptionRestart && lastAIMsg && parseOptions(lastAIMsg.content)) {
      await closeOptionChoice(proj.id, lastAIMsg.id).catch(() => {
        setChatError('이전 선택 대기를 종료하지 못했습니다. 다시 시도해 주세요.')
      })
    }

    try { await setTeamDiscussion(proj.id, currentActivity, false) }
    catch { setChatError('팀채팅을 종료하지 못했습니다. 다시 시도해 주세요.'); return }
    setDiscussionMode('ai_facilitated')
    setIsIdle(false)
    if (isLegacyOptionRestart) return
    void handleEndDiscussion()
  }

  const handleActionCardClickStable = useStableCallback(handleActionCardClick)
  const handleRestartOptionDiscussionStable = useStableCallback(handleRestartOptionDiscussion)
  const sendMessageDirectlyStable = useStableCallback(sendMessageDirectly)
  const toggleChecklistItemStable = useStableCallback(toggleChecklistItem)
  const pushGraphSelectionStateStable = useStableCallback(pushGraphSelectionState)
  const renderMessage = useCallback((msg: Message) => {
          if (msg.role === 'system') return null

          // 연수용 화면 버튼 메시지(양식 저장 알림·AI 도움 요청·단계별 진행 요청)는 교사 말풍선이 아니라 작은 칩으로(저장 데이터 형식은 그대로)
          const trainingChip = msg.role === 'user' ? trainingMessageChip(msg.content, msg.displayName) : null
          if (trainingChip) {
            const isSaveChip = !!trainingSaveNoticeChip(msg.content)
            return (
              <div key={msg.id} className="flex justify-center py-1" data-testid={isSaveChip ? 'training-save-chip' : 'training-request-chip'}>
                <span className={cn('rounded-full px-3 py-1 text-[12px] font-medium', isSaveChip ? 'bg-[#E6F4EA] text-[#137333]' : 'bg-[#E8F0FE] text-[#0B57D0]')}>
                  {isSaveChip ? '✓ ' : ''}{trainingChip}
                </span>
              </div>
            )
          }

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
                    onPrimary={() => handleActionCardClickStable(msg, 'primary', msg.actionCard!.primary)}
                    onSecondary={msg.actionCard.secondary
                      ? () => handleActionCardClickStable(msg, 'secondary', msg.actionCard!.secondary!)
                      : undefined}
                    onSkip={() => handleActionCardClickStable(msg, 'skip', msg.actionCard!.skip)}
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
                    proj.memberInfo ?? {}
                  }
                  currentUid={userProfile?.uid ?? ''}
                  isHost={isHost}
                  isClosed={proj.closedOptionMessages?.[msg.id] === true || msg.id !== lastAIMsg?.id || isLoading || isAnalyzing}
                  onDiscuss={() => handleRestartOptionDiscussionStable(msg.id)}
                  onSelect={async (label, content) => {
                    if (isLoading || isAnalyzing || !isHost || msg.id !== lastAIMsg?.id) return
                    try { await closeOptionChoice(proj.id, msg.id) }
                    catch (error) {
                      setChatError('선택을 기록하지 못했습니다. 다시 시도해 주세요.')
                      throw error
                    }
                    setInput('')
                    await sendMessageDirectlyStable(`${label}을 선택하겠습니다. "${content}"`)
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
              senderEmoji = userProfile?.displayName?.[0] || '?'
            } else {
              const info = msg.userId ? project.memberInfo?.[msg.userId] : undefined
              senderName = info?.displayName ?? msg.userId?.slice(0, 6) ?? '팀원'
              senderColor = info?.color ?? '#6B7280'
              senderEmoji = info?.displayName?.[0] || '?'
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
              <MemoMessageBubble
                role={msg.role as 'user' | 'assistant'}
                content={displayedMessageContent(proj, msg, trainingUserTexts)}
                activityType={msg.activityType}
                senderName={senderName}
                senderColor={senderColor}
                senderEmoji={senderEmoji}
                isSelf={isSelf}
                replyTo={msg.replyTo}
                stage={ACTIVITY_META[msg.activityCode]?.stage}
                standardTextMap={stdTooltipMap}
                checklist={msg.role === 'assistant' ? {
                  state: msg.checklistState,
                  canEdit: !!userProfile,
                  onToggle: (index, checked) => toggleChecklistItemStable(msg, index, checked),
                } : undefined}
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
                        setSheetPreferredCenterCode('')
                        setPinnedStandards([])  // 이전 수동 추가 초기화
                        pinnedStandardsRef.current = []
                        setCheckedGraphStandardIds([])  // 이전 토글 초기화
                        checkedGraphStandardIdsRef.current = []
                        setWorkspaceInitialView('graph')
                        setShowWorkspace(true)
                        setShowGraphPanel(true)
                        stableGraphKeywordRef.current = ' '
                        setStableGraphKeyword(' ')
                        if (isHost) {
                          setGraphOpen(proj.id, true, ' ', 'graph').catch(console.error)
                          pushGraphSelectionStateStable([], [])
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
                  onSearchStandards={() => sendMessageDirectlyStable('현재 활동에 맞는 성취기준을 찾아주세요')}
                  onShowExample={() => sendMessageDirectlyStable('현재 활동의 다른 팀 사례나 예시를 보여주세요')}
                  onShowGuide={() => sendMessageDirectlyStable('현재 위치와 앞으로 해야 할 일을 안내해주세요')}
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
                    onPrimary={() => handleActionCardClickStable(msg, 'primary', msg.actionCard!.primary)}
                    onSecondary={msg.actionCard.secondary
                      ? () => handleActionCardClickStable(msg, 'secondary', msg.actionCard!.secondary!)
                      : undefined}
                    onSkip={() => handleActionCardClickStable(msg, 'skip', msg.actionCard!.skip)}
                  />
                )
              })()}
            </div>
          )

  }, [proj, project.memberInfo, userProfile, currentActivity, lastAIMsg?.id, isLoading, isAnalyzing, isHost,
    trainingUserTexts, helpCardMap, setInput, setPendingArtifactSave, handleActionCardClickStable, handleRestartOptionDiscussionStable,
    sendMessageDirectlyStable, toggleChecklistItemStable, pushGraphSelectionStateStable])
  const cornerColor = STAGE_CORNER[project?.currentStage ?? 'T']

  return (
    <div className="chat-motion-decorative flex flex-col h-full overflow-hidden corner-wrap-chat"
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
      <ChatPanelHeader activity={currentActivity} teamMode={isTeamMode} extraTopSpace={GRAPH_ACTIVITIES.includes(currentActivity) && !showWorkspace}>
          {/* 중요 노트 버튼 */}
          <MD3Button
            onClick={() => setShowKeyNotes(true)}
            title="저장된 중요 노트 보기"
            aria-label="중요 노트 보기"
            variant="tonal"
            tone="amber"
            icon={<Star size={MD3_ICON.sm} weight="fill" />}
          >
            노트
            {!!proj.keyNotes?.length && (
              <span className="ml-0.5 min-w-[18px] rounded-full bg-[#E65100] px-1 py-[1px] text-[11px] font-medium leading-tight text-white">
                {proj.keyNotes.length}
              </span>
            )}
          </MD3Button>
          {/* 이 클라이언트가 보낸 AI 요청이 실패한 경우에만 재시도 */}
          {(() => {
            const retryRequest = getRetryRequest()
            const lastMsg = retryRequest?.messages.at(-1)
            if (!lastMsg) return null
            const retryContent = lastMsg.content
            return (
              <MD3Button
                onClick={() => sendMessageDirectly(retryContent, true)}
                title="AI 응답이 끊겼습니다. 다시 시도합니다"
                variant="tonal"
                tone="red"
                icon={
                  <svg width={MD3_ICON.sm} height={MD3_ICON.sm} viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.76-4.24L9 6h6V0l-1.35 2.35z"/>
                  </svg>
                }
              >
                재시도
              </MD3Button>
            )
          })()}
          {currentActivity === 'T-1-1' && (
            <CoeditButton label="비전 공동 편집" title="팀 공통 비전 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowTeamVisionWorkspace(true) }} />
          )}
          {currentActivity === 'T-1-2' && (
            <CoeditButton label="설계 방향 공동 편집" title="수업설계 방향 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowLessonDesignDirectionWorkspace(true) }} />
          )}
          {currentActivity === 'Ds-1-1' && (
            <CoeditButton label="평가 계획 공동 편집" title="평가 계획 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowEvaluationPlanWorkspace(true) }} />
          )}
          {currentActivity === 'Ds-1-2' && (
            <CoeditButton label="문제상황 공동 편집" title="문제상황 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowProblemSituationWorkspace(true) }} />
          )}
          {currentActivity === 'Ds-2-1' && (
            <CoeditButton label="지원 도구 공동 편집" title="지원 도구 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowSupportToolWorkspace(true) }} />
          )}
          {currentActivity === 'T-2-1' && (
            <CoeditButton label="역할 배분 공동 편집" title="역할 배분 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowRoleDistributionWorkspace(true) }} />
          )}
          {currentActivity === 'T-2-2' && (
            <CoeditButton label="팀 규칙 공동 편집" title="팀 규칙 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowTeamRulesWorkspace(true) }} />
          )}
          {currentActivity === 'T-2-3' && (
            <CoeditButton label="팀 일정 공동 편집" title="팀 일정 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowTeamScheduleWorkspace(true) }} />
          )}
          {currentActivity === 'A-1-2' && (
            <CoeditButton label="주제 선정 공동 편집" title="주제 선정 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowTopicSelectionWorkspace(true) }} />
          )}
          {currentActivity === 'Ds-1-3' && (
            <CoeditButton label="학습활동 공동 편집" title="학습활동 설계 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowLearningActivityWorkspace(true) }} />
          )}
          {currentActivity === 'Ds-2-2' && (
            <CoeditButton label="스캐폴딩 공동 편집" title="스캐폴딩 설계 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowScaffoldingWorkspace(true) }} />
          )}
          {currentActivity === 'A-2-2' && (
            <CoeditButton label="수업목표 공동 편집" title="통합 수업목표 진술 공동 편집"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowIntegratedGoalWorkspace(true) }} />
          )}
          {/* DI·E 공동 편집 (가이드 20260804 §4·§5) */}
          {currentActivity === 'DI-1-1' && (
            <CoeditButton label="자료 목록 공동 편집" title="자료 탐색·개발 공동 편집 (자료 워크스루)"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowMaterialDevWorkspace(true) }} />
          )}
          {currentActivity === 'DI-2-1' && (
            <CoeditButton label="수업 기록 공동 편집" title="수업 실행·기록 공동 편집 (결정적 장면 기록)"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowLessonRecordWorkspace(true) }} />
          )}
          {currentActivity === 'E-1-1' && (
            <CoeditButton label="성찰 공동 편집" title="수업 성찰·공동 개선 공동 편집 (증거 검토)"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowLessonReflectionWorkspace(true) }} />
          )}
          {currentActivity === 'E-2-1' && (
            <CoeditButton label="협력 성찰 공동 편집" title="협력 과정 성찰 공동 편집 (T단계 합의 대조)"
              showHint={coeditHintActivity === currentActivity}
              onClick={() => { setCoeditHintActivity(null); setShowCollaborationReflectionWorkspace(true) }} />
          )}
          {/* 교육과정 분석 워크스페이스 버튼 (A단계 활동에서만 표시) */}
          {GRAPH_ACTIVITIES.includes(currentActivity) && (
            <div className="relative flex items-center">
              {currentActivity === 'A-2-1' && !showWorkspace && (
                <div className="pointer-events-none absolute -top-12 right-0 z-20 min-w-[260px] rounded-2xl border border-white/80 bg-[#7B1FA2] px-3 py-2 text-center text-[12px] font-bold leading-snug text-white shadow-[0_8px_24px_rgba(123,31,162,0.35)]">
                  산출물 제작을 팀원과 이곳에서 함께해주세요.
                  <span className="absolute -bottom-1.5 right-8 h-3 w-3 rotate-45 border-b border-r border-white/80 bg-[#7B1FA2]" />
                </div>
              )}
              <MD3Button
                onClick={() => {
                  setShowWorkspace(true)
                  setWorkspaceInitialView('sheet')
                  setShowGraphPanel(true)
                  setSheetPreferredCenterCode('')
                  stableGraphKeywordRef.current = ' '
                  setStableGraphKeyword(' ')
                  if (isHost) setGraphOpen(proj.id, true, undefined, 'sheet').catch(console.error)
                }}
                variant="tonal"
                tone="purple"
                selected={showWorkspace}
                className={cn('border-2 border-transparent', !showWorkspace && 'kg-graph-btn-rainbow')}
                icon={<TreeStructure size={MD3_ICON.sm} weight={showWorkspace ? 'fill' : 'bold'} />}
                title="교육과정 분석 시트 + 지식 그래프"
              >
                교육과정 분석
              </MD3Button>
            </div>
          )}
          {/* 문제 상황 설정 워크숍 버튼 (Ds-1-2 활동에서만 표시) */}
          {currentActivity === 'Ds-1-2' && (
            <div className="relative flex items-center">
              {!showProblemSituationDesigner && coeditHintActivity !== 'Ds-1-2' && (
                <div className="pointer-events-none absolute top-full mt-2 right-0 z-[60] min-w-[280px] rounded-2xl border border-white/80 bg-[#00897B] px-3 py-2 text-center text-[12px] font-bold leading-snug text-white shadow-[0_8px_24px_rgba(0,137,123,0.35)]">
                  <span className="absolute -top-1.5 right-8 h-3 w-3 rotate-45 border-l border-t border-white/80 bg-[#00897B]" />
                  문제상황 워크숍을 이용한 후 공동 편집을 하는 것도 좋습니다.
                </div>
              )}
              <MD3Button
                onClick={() => {
                  const next = !showProblemSituationDesigner
                  setShowProblemSituationDesigner(next)
                  if (isHost) {
                    import('@/lib/firebase/projects').then(m =>
                      m.setProblemSituationOpen(proj.id, next).catch(console.error)
                    )
                  }
                }}
                variant="tonal"
                tone="teal"
                selected={showProblemSituationDesigner}
                className="workshop-glow"
                icon={<PencilRuler size={MD3_ICON.sm} weight={showProblemSituationDesigner ? 'fill' : 'regular'} />}
                title="문제 상황 설정 워크숍 (이 단계 전용 특별 기능)"
              >
                문제상황 워크숍
                {isHost && showProblemSituationDesigner && (
                  <span className="ml-0.5 text-[11px] opacity-80">공유중</span>
                )}
              </MD3Button>
            </div>
          )}
          {userProfile && (
            <AvatarChip name={userProfile.displayName} color={userProfile.color} size={32} />
          )}
          {isTeamMode && (
            <span className="text-[12px] bg-[#CDE9E5] text-[#00564C] px-3 h-8 inline-flex items-center rounded-full font-medium">
              팀 자유 토의 중
            </span>
          )}
      </ChatPanelHeader>

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
          ? serializeArtifactForPrompt(evalArtifact.content)
          : undefined
        const a21Artifact = proj.artifacts?.['A-2-1']
        const achievementStandardsAnalysis = a21Artifact
          ? serializeArtifactForPrompt(a21Artifact.content)
          : undefined
        const a22Artifact = proj.artifacts?.['A-2-2']
        const learningObjective = a22Artifact
          ? serializeArtifactForPrompt(a22Artifact.content)
          : undefined
        const a23Artifact = proj.artifacts?.['A-2-3']
        const learnerProfile = a23Artifact
          ? serializeArtifactForPrompt(a23Artifact.content)
          : undefined

        return createPortal(
          <WorkshopErrorBoundary
            onClose={() => {
              setShowProblemSituationDesigner(false)
              if (isHost) {
                import('@/lib/firebase/projects').then(m =>
                  m.setProblemSituationOpen(proj.id, false).catch(console.error)
                )
              }
            }}
          >
          <ProblemSituationDesigner
            projectId={proj.id}
            projectTitle={proj.title}
            targetGradeGroup={proj.targetGradeGroup}
            teamGradeBands={proj.teamGradeBands}
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
                  // _schema로 전용 Ds12Renderer가 구조화 렌더 (없으면 raw JSON 노출)
                  _schema: 'Ds-1-2',
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
                    _schema: 'Ds-1-2',
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
                `## 🎯 탐구 질문`,
                data.drivingQuestion,
                ``,
                `## 🔍 하위 탐구 질문`,
                eqList,
                ``,
                `---`,
                ``,
                `수정하거나 보완할 내용이 있으면 여기서 바로 말씀해 주세요.`,
              ].join('\n')
              const newMsgId = generateMessageId(proj.id, 'Ds-1-2')
              addMessage({ id: newMsgId, role: 'assistant', content: chatContent, activityCode: 'Ds-1-2', activityType: '제시', agentType: 'orchestrator', createdAt: Timestamp.now() })
              saveMessage(proj.id, 'Ds-1-2', { role: 'assistant', content: chatContent, activityCode: 'Ds-1-2', activityType: '제시', agentType: 'orchestrator', cycleNumber: proj.currentCycle ?? 1 }, newMsgId).catch(console.error)
            }}
            onClose={() => {
              setShowProblemSituationDesigner(false)
              if (isHost) {
                import('@/lib/firebase/projects').then(m =>
                  m.setProblemSituationOpen(proj.id, false).catch(console.error)
                )
              }
            }}
          />
          </WorkshopErrorBoundary>,
          document.body,
        )
      })()}

      {/* TRAINING_BAR_SLOT — 연수 막대 자리(코덱스 TrainingModeBar). isTrainingActivity(proj, currentActivity) 일 때만 렌더 */}
      {isTrainingActivity(proj, currentActivity) && (
        <TrainingModeBar
          project={proj}
          activityCode={currentActivity}
          content={proj.artifacts?.[currentActivity]?.content as Record<string, unknown> | undefined}
          loaded={messagesLoaded}
          isHost={isHost}
          busy={isLoading || isAnalyzing}
          onSend={enqueueTrainingSend}
          onNext={nextCode => handleActivityAdvance(nextCode)}
        />
      )}
      {/* 메시지 목록 — chatFontScale로 메시지 영역만 독립 zoom */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={messagesViewportRef}
          role="log"
          aria-label="협력적 수업설계 대화 메시지"
          aria-relevant="additions"
          tabIndex={0}
          onScroll={handleMessagesScroll}
          className="h-full overflow-y-auto px-4 py-4 space-y-1 relative focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1A73E8]"
          style={{ zoom: chatFontScale }}
        >
        {visibleMessages.length === 0 && !streamingText && !isLoading && !messagesLoaded && (
          <div className="flex items-center justify-center h-full text-[#DADCE0]">
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><SpinnerGap size={28} /></span>
          </div>
        )}

        <MessageList key={currentActivity} messages={visibleMessages} renderMessage={renderMessage} onCommit={handleMessageListCommit} />

        {/* 성취기준 찾기 모달 */}
        {(showStandardsBrowser) && <StandardsFinderModal
          open={showStandardsBrowser}
          onClose={() => setShowStandardsBrowser(false)}
          onInsert={(md) => setInput(prev => (prev ? prev + '\n\n' : '') + md)}
        />}

        {/* 핵심아이디어 찾기 모달 */}
        {(showCoreIdeaBrowser) && <CoreIdeaFinderModal
          open={showCoreIdeaBrowser}
          onClose={() => setShowCoreIdeaBrowser(false)}
          onInsert={(md) => setInput(prev => (prev ? prev + '\n\n' : '') + md)}
        />}

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

        {(showTeamVisionWorkspace) && <TeamVisionWorkspaceModal
          open={showTeamVisionWorkspace}
          onClose={() => setShowTeamVisionWorkspace(false)}
          workspace={proj.teamVisionWorkspace}
          artifactContent={proj.artifacts?.['T-1-1']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={teamVisionPresence}
          isHost={isHost}
          onPatchSave={handleTeamVisionWorkspacePatch}
          onPresenceUpdate={handleTeamVisionPresence}
          onSendArtifact={handleTeamVisionSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          chatMessages={messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          projectId={proj.id}
          collaborativeMembers={Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => ({ uid, displayName: info.displayName || '팀원', color: info.color }))}
        />}

        {(showLessonDesignDirectionWorkspace) && <LessonDesignDirectionWorkspaceModal
          open={showLessonDesignDirectionWorkspace}
          onClose={() => setShowLessonDesignDirectionWorkspace(false)}
          workspace={proj.lessonDesignDirectionWorkspace}
          artifactContent={proj.artifacts?.['T-1-2']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={lessonDesignDirectionPresence}
          isHost={isHost}
          onPatchSave={handleLessonDesignDirectionWorkspacePatch}
          onPresenceUpdate={handleLessonDesignDirectionPresence}
          onSendArtifact={handleLessonDesignDirectionSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          existingTeamVision={(proj.artifacts?.['T-1-1']?.content as { teamVision?: string } | undefined)?.teamVision ?? proj.teamVisionWorkspace?.teamVision}
          existingCoreKeywords={(proj.artifacts?.['T-1-1']?.content as { coreKeywords?: string[] } | undefined)?.coreKeywords ?? proj.teamVisionWorkspace?.coreKeywords}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          projectId={proj.id}
          collaborativeMembers={Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => ({ uid, displayName: info.displayName || '팀원', color: info.color }))}
        />}

        {(showEvaluationPlanWorkspace) && <EvaluationPlanWorkspaceModal
          open={showEvaluationPlanWorkspace}
          onClose={() => setShowEvaluationPlanWorkspace(false)}
          workspace={proj.evaluationPlanWorkspace}
          artifactContent={proj.artifacts?.['Ds-1-1']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={evaluationPlanPresence}
          isHost={isHost}
          onPatchSave={handleEvaluationPlanWorkspacePatch}
          onPresenceUpdate={handleEvaluationPlanPresence}
          onSendArtifact={handleEvaluationPlanSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          integratedGoal={(proj.artifacts?.['A-2-2']?.content as { integratedGoal?: string } | undefined)?.integratedGoal ?? proj.integratedGoalWorkspace?.integratedGoal}
          subjectGoals={(proj.artifacts?.['A-2-2']?.content as { subjectGoals?: Array<{ subject: string; goal: string }> } | undefined)?.subjectGoals}
          learnerProfile={(() => {
            const a23 = proj.artifacts?.['A-2-3']?.content as Record<string, unknown> | undefined
            if (!a23) return undefined
            return serializeArtifactForPrompt(a23)
          })()}
          standardSources={designStandardSources(proj.artifacts, proj.curriculumSheet)}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          projectId={proj.id}
          collaborativeMembers={Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => ({ uid, displayName: info.displayName || '팀원', color: info.color }))}
        />}

        {(showProblemSituationWorkspace) && <ProblemSituationWorkspaceModal
          open={showProblemSituationWorkspace}
          onClose={() => setShowProblemSituationWorkspace(false)}
          workspace={proj.problemSituationWorkspace}
          artifactContent={proj.artifacts?.['Ds-1-2']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={problemSituationPresence}
          isHost={isHost}
          onPatchSave={handleProblemSituationWorkspacePatch}
          onPresenceUpdate={handleProblemSituationPresence}
          onSendArtifact={handleProblemSituationSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          integratedGoal={(proj.artifacts?.['A-2-2']?.content as { integratedGoal?: string } | undefined)?.integratedGoal ?? proj.integratedGoalWorkspace?.integratedGoal}
          subjectGoals={(proj.artifacts?.['A-2-2']?.content as { subjectGoals?: Array<{ subject: string; goal: string }> } | undefined)?.subjectGoals}
          learnerProfile={(() => {
            const a23 = proj.artifacts?.['A-2-3']?.content as Record<string, unknown> | undefined
            if (!a23) return undefined
            return serializeArtifactForPrompt(a23)
          })()}
          evaluationPlan={(() => {
            const ds11 = proj.artifacts?.['Ds-1-1']?.content as { rubric?: Array<{ item?: string; method?: string; timing?: string }> } | undefined
            if (!ds11?.rubric || ds11.rubric.length === 0) return undefined
            return ds11.rubric.map(r => `- ${r.item ?? ''} (${r.method ?? ''} · ${r.timing ?? ''})`).join('\n')
          })()}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          projectId={proj.id}
          collaborativeMembers={Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => ({ uid, displayName: info.displayName || '팀원', color: info.color }))}
        />}

        {(showSupportToolWorkspace) && <SupportToolWorkspaceModal
          open={showSupportToolWorkspace}
          onClose={() => setShowSupportToolWorkspace(false)}
          workspace={proj.supportToolWorkspace}
          artifactContent={proj.artifacts?.['Ds-2-1']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={supportToolPresence}
          isHost={isHost}
          onPatchSave={handleSupportToolWorkspacePatch}
          onPresenceUpdate={handleSupportToolPresence}
          onSendArtifact={handleSupportToolSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          integratedGoal={(proj.artifacts?.['A-2-2']?.content as { integratedGoal?: string } | undefined)?.integratedGoal ?? proj.integratedGoalWorkspace?.integratedGoal}
          subjectGoals={(proj.artifacts?.['A-2-2']?.content as { subjectGoals?: Array<{ subject: string; goal: string }> } | undefined)?.subjectGoals}
          learnerProfile={(() => {
            const a23 = proj.artifacts?.['A-2-3']?.content as Record<string, unknown> | undefined
            if (!a23) return undefined
            return serializeArtifactForPrompt(a23)
          })()}
          learningActivities={(() => {
            const ds13 = proj.artifacts?.['Ds-1-3']?.content as Record<string, unknown> | undefined
            if (!ds13) return undefined
            return serializeArtifactForPrompt(ds13)
          })()}
          evaluationPlan={(() => {
            const ds11 = proj.artifacts?.['Ds-1-1']?.content as { rubric?: Array<{ item?: string; method?: string; timing?: string }> } | undefined
            if (!ds11?.rubric || ds11.rubric.length === 0) return undefined
            return ds11.rubric.map(r => `- ${r.item ?? ''} (${r.method ?? ''} · ${r.timing ?? ''})`).join('\n')
          })()}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          projectId={proj.id}
          collaborativeMembers={Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => ({ uid, displayName: info.displayName || '팀원', color: info.color }))}
        />}

        {(showRoleDistributionWorkspace) && <RoleDistributionWorkspaceModal
          open={showRoleDistributionWorkspace}
          onClose={() => setShowRoleDistributionWorkspace(false)}
          workspace={proj.roleDistributionWorkspace}
          artifactContent={proj.artifacts?.['T-2-1']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={roleDistributionPresence}
          isHost={isHost}
          onPatchSave={handleRoleDistributionWorkspacePatch}
          onPresenceUpdate={handleRoleDistributionPresence}
          onSendArtifact={handleRoleDistributionSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          memberNames={Object.values(proj.memberInfo ?? {}).map(m => m.displayName).filter(Boolean) as string[]}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          teamVision={(proj.artifacts?.['T-1-1']?.content as { teamVision?: string } | undefined)?.teamVision ?? proj.teamVisionWorkspace?.teamVision}
          coreKeywords={(proj.artifacts?.['T-1-1']?.content as { coreKeywords?: string[] } | undefined)?.coreKeywords ?? proj.teamVisionWorkspace?.coreKeywords}
          projectId={proj.id}
          collaborativeMembers={Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => ({ uid, displayName: info.displayName || '팀원', color: info.color }))}
        />}

        {(showTeamRulesWorkspace) && <TeamRulesWorkspaceModal
          open={showTeamRulesWorkspace}
          projectId={projectId}
          onClose={() => setShowTeamRulesWorkspace(false)}
          workspace={proj.teamRulesWorkspace}
          artifactContent={proj.artifacts?.['T-2-2']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={teamRulesPresence}
          isHost={isHost}
          onPatchSave={handleTeamRulesWorkspacePatch}
          onPresenceUpdate={handleTeamRulesPresence}
          onSendArtifact={handleTeamRulesSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          teamVision={(proj.artifacts?.['T-1-1']?.content as { teamVision?: string } | undefined)?.teamVision ?? proj.teamVisionWorkspace?.teamVision}
          coreKeywords={(proj.artifacts?.['T-1-1']?.content as { coreKeywords?: string[] } | undefined)?.coreKeywords ?? proj.teamVisionWorkspace?.coreKeywords}
          existingRoles={(proj.artifacts?.['T-2-1']?.content as { roles?: Array<{ teacherName?: string; role?: string }> } | undefined)?.roles}
        />}

        {(showTeamScheduleWorkspace) && <TeamScheduleWorkspaceModal
          open={showTeamScheduleWorkspace}
          projectId={projectId}
          onClose={() => setShowTeamScheduleWorkspace(false)}
          workspace={proj.teamScheduleWorkspace}
          artifactContent={proj.artifacts?.['T-2-3']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={teamSchedulePresence}
          isHost={isHost}
          onPatchSave={handleTeamScheduleWorkspacePatch}
          onPresenceUpdate={handleTeamSchedulePresence}
          onSendArtifact={handleTeamScheduleSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          teamVision={(proj.artifacts?.['T-1-1']?.content as { teamVision?: string } | undefined)?.teamVision ?? proj.teamVisionWorkspace?.teamVision}
          coreKeywords={(proj.artifacts?.['T-1-1']?.content as { coreKeywords?: string[] } | undefined)?.coreKeywords ?? proj.teamVisionWorkspace?.coreKeywords}
          existingRoles={(proj.artifacts?.['T-2-1']?.content as { roles?: Array<{ teacherName?: string; role?: string }> } | undefined)?.roles}
          existingRules={(proj.artifacts?.['T-2-2']?.content as { rules?: Array<{ category?: string; name?: string }> } | undefined)?.rules}
        />}

        {(showTopicSelectionWorkspace) && <TopicSelectionWorkspaceModal
          open={showTopicSelectionWorkspace}
          projectId={projectId}
          onClose={() => setShowTopicSelectionWorkspace(false)}
          workspace={proj.topicSelectionWorkspace}
          artifactContent={proj.artifacts?.['A-1-2']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={topicSelectionPresence}
          isHost={isHost}
          onPatchSave={handleTopicSelectionWorkspacePatch}
          onPresenceUpdate={handleTopicSelectionPresence}
          onSendArtifact={handleTopicSelectionSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          teamVision={(proj.artifacts?.['T-1-1']?.content as { teamVision?: string } | undefined)?.teamVision ?? proj.teamVisionWorkspace?.teamVision}
          coreKeywords={(proj.artifacts?.['T-1-1']?.content as { coreKeywords?: string[] } | undefined)?.coreKeywords ?? proj.teamVisionWorkspace?.coreKeywords}
        />}

        {(showLearningActivityWorkspace) && <LearningActivityWorkspaceModal
          open={showLearningActivityWorkspace}
          projectId={projectId}
          onClose={() => setShowLearningActivityWorkspace(false)}
          workspace={proj.learningActivityWorkspace}
          artifactContent={proj.artifacts?.['Ds-1-3']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={learningActivityPresence}
          isHost={isHost}
          onPatchSave={handleLearningActivityWorkspacePatch}
          onPresenceUpdate={handleLearningActivityPresence}
          onSendArtifact={handleLearningActivitySendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          problemScenario={proj.problemSituationData?.scenario
            ? [proj.problemSituationData.scenario.title, proj.problemSituationData.scenario.row1, proj.problemSituationData.scenario.row2, proj.problemSituationData.scenario.row3].filter(Boolean).join(' / ')
            : undefined}
          drivingQuestion={proj.problemSituationData?.drivingQuestion}
          evaluationPlan={(() => {
            const c = proj.artifacts?.['Ds-1-1']?.content as { rubric?: Array<{ item?: string; method?: string }> } | undefined
            if (!c?.rubric?.length) return undefined
            return c.rubric.map(r => [r.item, r.method].filter(Boolean).join(' · ')).filter(Boolean).join('\n')
          })()}
        />}

        {(showScaffoldingWorkspace) && <ScaffoldingWorkspaceModal
          open={showScaffoldingWorkspace}
          projectId={projectId}
          onClose={() => setShowScaffoldingWorkspace(false)}
          workspace={proj.scaffoldingWorkspace}
          artifactContent={proj.artifacts?.['Ds-2-2']?.content as Record<string, unknown> | undefined}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={scaffoldingPresence}
          isHost={isHost}
          onPatchSave={handleScaffoldingWorkspacePatch}
          onPresenceUpdate={handleScaffoldingPresence}
          onSendArtifact={handleScaffoldingSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          learningActivities={(() => {
            const c = proj.artifacts?.['Ds-1-3']?.content as { activities?: Array<{ name?: string; session?: string }> } | undefined
            if (!c?.activities?.length) return undefined
            return c.activities.map(a => [a.name, a.session].filter(Boolean).join(' (') + (a.session ? ')' : '')).filter(Boolean).join('\n')
          })()}
          learnerProfile={(() => {
            const c = proj.artifacts?.['A-2-3']?.content as Record<string, unknown> | undefined
            if (!c) return undefined
            const v = c['학습자 프로필'] ?? c['commonProfile']
            return typeof v === 'string' ? v : v ? JSON.stringify(v).slice(0, 800) : undefined
          })()}
        />}

        {/* DI·E 공동 편집 세션 (가이드 20260804 §4·§5) — 공용 모달 + 활동별 설정 */}
        {(showMaterialDevWorkspace) && <CoeditWorkspaceModal
          projectId={projectId}
          open={showMaterialDevWorkspace}
          onClose={() => setShowMaterialDevWorkspace(false)}
          config={MATERIAL_DEV_CONFIG}
          workspace={proj.materialDevWorkspace}
          emptyWorkspace={emptyMaterialDevWorkspace}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={materialDevPresence}
          isHost={isHost}
          onPatchSave={makeCoeditPatchHandler('DI-1-1')}
          onPresenceUpdate={makeCoeditPresenceHandler('DI-1-1')}
          onSendArtifact={makeCoeditSendHandler('DI-1-1')}
          suggestContext={makeCoeditSuggestContext('DI-1-1')}
        />}

        {(showLessonRecordWorkspace) && <CoeditWorkspaceModal
          projectId={projectId}
          open={showLessonRecordWorkspace}
          onClose={() => setShowLessonRecordWorkspace(false)}
          config={LESSON_RECORD_CONFIG}
          workspace={proj.lessonRecordWorkspace}
          emptyWorkspace={emptyLessonRecordWorkspace}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={lessonRecordPresence}
          isHost={isHost}
          onPatchSave={makeCoeditPatchHandler('DI-2-1')}
          onPresenceUpdate={makeCoeditPresenceHandler('DI-2-1')}
          onSendArtifact={makeCoeditSendHandler('DI-2-1')}
          suggestContext={makeCoeditSuggestContext('DI-2-1')}
        />}

        {(showLessonReflectionWorkspace) && <CoeditWorkspaceModal
          projectId={projectId}
          open={showLessonReflectionWorkspace}
          onClose={() => setShowLessonReflectionWorkspace(false)}
          config={LESSON_REFLECTION_CONFIG}
          workspace={proj.lessonReflectionWorkspace}
          emptyWorkspace={emptyLessonReflectionWorkspace}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={lessonReflectionPresence}
          isHost={isHost}
          onPatchSave={makeCoeditPatchHandler('E-1-1')}
          onPresenceUpdate={makeCoeditPresenceHandler('E-1-1')}
          onSendArtifact={makeCoeditSendHandler('E-1-1')}
          suggestContext={makeCoeditSuggestContext('E-1-1')}
        />}

        {(showCollaborationReflectionWorkspace) && <CoeditWorkspaceModal
          projectId={projectId}
          open={showCollaborationReflectionWorkspace}
          onClose={() => setShowCollaborationReflectionWorkspace(false)}
          config={COLLABORATION_REFLECTION_CONFIG}
          workspace={proj.collaborationReflectionWorkspace}
          emptyWorkspace={collaborationEmptyWithAgreements}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          presence={collaborationReflectionPresence}
          isHost={isHost}
          onPatchSave={makeCoeditPatchHandler('E-2-1')}
          onPresenceUpdate={makeCoeditPresenceHandler('E-2-1')}
          onSendArtifact={makeCoeditSendHandler('E-2-1')}
          suggestContext={makeCoeditSuggestContext('E-2-1')}
        />}

        {(showIntegratedGoalWorkspace) && <IntegratedGoalWorkspaceModal
          open={showIntegratedGoalWorkspace}
          onClose={() => setShowIntegratedGoalWorkspace(false)}
          workspace={proj.integratedGoalWorkspace}
          artifactContent={integratedGoalArtifactContent}
          currentUid={userProfile?.uid}
          currentUserName={userProfile?.displayName}
          currentUserColor={integratedGoalCurrentUserColor}
          presence={integratedGoalPresence}
          isHost={isHost}
          onPatchSave={handleIntegratedGoalWorkspacePatch}
          onPresenceUpdate={handleIntegratedGoalPresence}
          onSendArtifact={handleIntegratedGoalSendArtifact}
          projectTitle={proj.title}
          targetGradeGroup={proj.targetGradeGroup}
          targetSubjects={proj.targetSubjects}
          existingCoreIdea={integratedGoalExistingCoreIdea}
          chatMessages={messages.map(m => ({ role: m.role, content: m.content, displayName: m.displayName }))}
          existingAnalysis={(() => {
            // 시트 모드에 따른 행 학년군을 함께 넘긴다. 혼성 학년(multi)이거나 한 학년군이라도
            // 프로젝트 학년군과 다른 학년군을 고른 경우에만 `[국어·3-4학년군]`으로 표기한다.
            const rows = proj.curriculumSheet ?? []
            const mode = (proj.teamGradeBands?.length ?? 0) >= 2 ? 'multi' : proj.curriculumSheetGradeMode ?? defaultGradeMode(rows)
            const band = resolveSheetGradeBand(proj.curriculumSheetGradeBand, proj.targetGradeGroup)
            const projectBand = toGradeBandLabel(proj.targetGradeGroup)
            return rows
            .filter(r => r.coreIdea?.trim() || r.subject?.trim() || r.standard?.trim())
            .map(r => {
              const parts: string[] = []
              const rowBand = effectiveRowGradeBand(r, mode, band)
              const showBand = !!rowBand && (mode === 'multi' || rowBand !== projectBand)
              parts.push(showBand ? `[${r.subject ?? ''}·${rowBand}]` : `[${r.subject ?? ''}]`)
              if (r.coreIdea?.trim()) parts.push(`핵심아이디어: ${r.coreIdea.trim()}`)
              if (r.standard?.trim()) parts.push(`성취기준: ${r.standard.trim()}`)
              if (r.knowledge?.trim()) parts.push(`지식·이해: ${r.knowledge.trim()}`)
              if (r.processFunction?.trim()) parts.push(`과정·기능: ${r.processFunction.trim()}`)
              if (r.valueAttitude?.trim()) parts.push(`가치·태도: ${r.valueAttitude.trim()}`)
              // 연결 줄 — 이 성취기준이 어느 교과 핵심아이디어를 위해 붙었는지 함께 전달.
              if (r.linkedCoreIdea?.coreIdea?.trim()) {
                parts.push(`연결: ${r.linkedCoreIdea.subject} 핵심아이디어 ${r.linkedCoreIdea.coreIdea.trim()}`)
              }
              return parts.join(' / ')
            })
            .join('\n') || undefined
          })()}
          projectId={proj.id}
          collaborativeMembers={Object.entries(proj.memberInfo ?? {}).map(([uid, info]) => ({ uid, displayName: info.displayName || '팀원', color: info.color }))}
        />}

        {/* 교육과정 분석 워크스페이스 — 분석시트 ↔ 지식그래프 통합 모달 */}
        {(showWorkspace) && <CurriculumWorkspaceModal
          key={`curriculum-workspace-${workspaceInitialView}`}
          open={showWorkspace}
          initialView={workspaceInitialView}
          onClose={() => {
            setShowWorkspace(false)
            setShowGraphPanel(false)
            setWorkspaceInitialView('sheet')
            setSheetPreferredCenterCode('')
            stableGraphKeywordRef.current = ''
            setStableGraphKeyword('')
            if (isHost) setGraphOpen(proj.id, false).catch(console.error)
          }}
          sheetRows={proj.curriculumSheet ?? []}
          onSheetSave={async (newRows) => {
            try {
              const savedRows = await patchCurriculumSheet(proj.id, { type: 'replace-all', rows: newRows, updatedBy: userProfile?.displayName ?? undefined })
              latestSheetRowsRef.current = savedRows
            } catch (e) { console.error('[curriculumSheet save]', e) }
          }}
          onSheetPatch={async (patch) => {
            try {
              const savedRows = await patchCurriculumSheet(proj.id, patch)
              latestSheetRowsRef.current = savedRows
              return savedRows
            } catch (e) {
              console.error('[curriculumSheet patch]', e)
              return undefined
            }
          }}
          onRequestArtifactSave={(rows) => proposeCurriculumSheetArtifactSave(rows, '분석시트 저장')}
          onPresenceUpdate={async (entry) => {
            try {
              const { updateDoc, doc, deleteField } = await import('firebase/firestore')
              const { db } = await import('@/lib/firebase/config')
              const uid = userProfile?.uid
              if (!uid) return
              const assignedColor = proj.memberInfo?.[uid]?.color ?? userProfile?.color ?? entry?.color ?? '#9AA0A6'
              if (entry) {
                await updateDoc(doc(db, 'projects', proj.id), { [`curriculumSheetPresence.${uid}`]: { ...entry, color: assignedColor } })
              } else {
                await updateDoc(doc(db, 'projects', proj.id), { [`curriculumSheetPresence.${uid}`]: deleteField() })
              }
            } catch { /* ignore */ }
          }}
          onGraphCodesFromSheet={(codes, options) => {
            setActiveGraphCodes(codes)
            setSheetPreferredCenterCode(options?.centerCode ?? '')
            stableGraphKeywordRef.current = ' '
            setStableGraphKeyword(' ')
          }}
          onViewChange={(view) => {
            setWorkspaceInitialView(view)
            if (isHost) {
              const keyword = view === 'graph'
                ? (stableGraphKeywordRef.current || ' ')
                : undefined
              setGraphOpen(proj.id, true, keyword, view).catch(console.error)
            }
          }}
          presence={Object.fromEntries(
            Object.entries(proj.curriculumSheetPresence ?? {}).map(([uid, entry]) => [
              uid,
              { ...entry, color: proj.memberInfo?.[uid]?.color ?? entry.color },
            ]),
          )}
          currentUserName={userProfile?.displayName ?? ''}
          currentUid={userProfile?.uid ?? ''}
          currentUserColor={userProfile?.uid ? (proj.memberInfo?.[userProfile.uid]?.color ?? userProfile?.color) : userProfile?.color}
          projectId={proj.id}
          a12Artifact={(() => {
            const a12 = proj.artifacts?.['A-1-2']?.content as Record<string, unknown> | undefined
            if (!a12) return undefined
            // 다양한 필드명 대응 + raw content 전체 전달
            return {
              ...a12,
              selectedTopic: (a12['selectedTopic'] || a12['선택 주제'] || a12['주제']) as string | undefined,
              linkedSubjects: (a12['linkedSubjects'] || a12['교과 연계']) as Array<{ subject: string; focus: string }> | undefined,
              targetSubjects: (a12['targetSubjects'] || a12['대상 교과'] || proj.targetSubjects) as string[] | undefined,
              topicType: (a12['topicType'] || a12['주제 유형']) as string | undefined,
            }
          })()}
          graphSavedData={proj.graphSavedData ?? null}
          targetGradeGroup={proj.targetGradeGroup}
          chatContext={(() => {
            // 최근 대화 + 이전 산출물 요약을 chatContext로 전달
            const parts: string[] = []
            // 이전 활동 산출물 내용
            const arts = proj.artifacts ?? {}
            for (const [code, art] of Object.entries(arts)) {
              const c = art.content as Record<string, unknown>
              const topic = (c['선택 주제'] || c['주제'] || c['selectedTopic']) as string | undefined
              const linked = c['linkedSubjects'] as Array<{ subject: string; focus: string }> | undefined
              if (topic) parts.push(`[${code} 산출물] 주제: ${topic}`)
              if (linked?.length) parts.push(`[${code}] 연계 교과: ${linked.map(l => `${l.subject}(${l.focus})`).join(', ')}`)
            }
            // 최근 AI 메시지에서 주제/교과 관련 내용 추출
            const recentMsgs = messages.filter(m => m.activityCode === 'A-1-2' || m.activityCode === 'A-2-1').slice(-10)
            for (const msg of recentMsgs) {
              if (msg.content.length > 20 && msg.content.length < 1000) {
                parts.push(`[${msg.role}/${msg.activityCode}] ${msg.content.substring(0, 300)}`)
              }
            }
            return parts.length > 0 ? parts.join('\n') : undefined
          })()}
          teamGradeBands={proj.teamGradeBands}
          gradeMode={(proj.teamGradeBands?.length ?? 0) >= 2 ? 'multi' : proj.curriculumSheetGradeMode}
          sheetGradeBand={proj.curriculumSheetGradeBand}
          onGradeSettingsChange={async (settings) => {
            // 시트는 공동 편집이라 팀원 누구나 학년군 모드를 바꿀 수 있다(호스트 제한 없음).
            try { await updateCurriculumSheetSettings(proj.id, settings) }
            catch (e) { console.error('[curriculumSheet grade settings]', e) }
          }}
          renderGraphView={(onBackToSheet) => {
            const graphKeyword = stableGraphKeyword || graphKeywordForShare
            return (
              <>
                <GraphWorkspaceHeader
                  keyword={graphKeyword}
                  isLeader={isHost}
                  onBack={onBackToSheet}
                  onSearch={value => {
                    if (value === stableGraphKeywordRef.current) return
                    stableGraphKeywordRef.current = value
                    setStableGraphKeyword(value)
                    if (isHost) setGraphOpen(proj.id, true, value, 'graph').catch(console.error)
                  }}
                />
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
                    onPinChange={(nextPins) => { pinnedStandardsRef.current = nextPins; setPinnedStandards(nextPins); if (isHost) pushGraphSelectionState(nextPins, checkedGraphStandardIdsRef.current) }}
                    externalCheckedStandardIds={checkedGraphStandardIds}
                    onCheckedStandardsChange={(ids) => { checkedGraphStandardIdsRef.current = ids; setCheckedGraphStandardIds(ids); if (isHost) pushGraphSelectionState(pinnedStandardsRef.current, ids) }}
                    onClose={onBackToSheet}
                    externalRecommendations={Object.values(proj.graphCenterRecommendations ?? {}).map(r => ({ nodeId: r.nodeId, recommenderName: r.recommenderName, recommenderUid: r.recommenderUid ?? undefined }))}
                    externalCenterNodeId={proj.graphCenterNodeId}
                    preferredCenterCode={sheetPreferredCenterCode}
                    savedData={proj.graphSavedData ?? null}
                    curriculumSheet={proj.curriculumSheet}
                    artifactContext={(() => { const parts: string[] = []; if (proj.targetGradeGroup) parts.push(`학년군: ${proj.targetGradeGroup}`); if (proj.title) parts.push(`프로젝트: ${proj.title}`); const arts = proj.artifacts ?? {}; for (const [code, art] of Object.entries(arts)) { const c = art.content as Record<string, unknown>; const topic = (c['선택 주제'] || c['주제'] || c['수업 목표']) as string | undefined; if (topic) parts.push(`${code} 산출물 — ${topic}`) }; return parts.join('\n') || undefined })()}
                    onSetCenter={(nodeId) => setGraphCenter(proj.id, nodeId)}
                    onRecommendCenter={(nodeId) => recommendGraphCenter(proj.id, nodeId, userProfile?.displayName ?? '팀원', userProfile?.uid)}
                    onSaveGraph={isHost ? async (data) => { try { await saveGraphDataAndSyncSheet(data) } catch (e) { console.error('[saveGraphData]', e); throw e } } : undefined}
                  />
                </div>
              </>
            )
          }}
        />}

        {/* @노트 툴팁 — createPortal로 body에 렌더링 (overflow 부모 회피) */}
        {noteTooltip && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed pointer-events-none"
            style={{ left: noteTooltip.x, top: noteTooltip.y, transform: 'translateY(-100%)', zIndex: 999999 }}
          >
            <div className="w-[280px] p-3 rounded-xl bg-[#202124] text-white text-xs font-normal leading-relaxed shadow-2xl">
              <span className="block font-bold text-[#FFB74D] mb-1">노트 #{noteTooltip.num}</span>
              {noteTooltip.preview}
            </div>
          </div>,
          document.body,
        )}

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
              .replace(/\[(?:ARTIFACT_UPDATE|ARTIFACT_CONFIRM|ACTION_CARD|ACTIVITY_ADVANCE|ACTIVITY_RETURN|HELP_CARD|TEAM_DISCUSSION_READY|TEAM_GRADE_BANDS|STANDARD_SEARCH)[\s\S]*?\]/g, '')
              .trim()
            if (!cleaned) return
            const note: KeyNote = {
              id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              // 충분한 길이 허용 — 표·다단 구조를 온전히 보존. Firestore 문서 1MB 한도에 여유.
              content: cleaned.slice(0, 200000), // subcollection 저장 — 문서당 1MiB 한도 내 사실상 무제한
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
          onSendToArtifact={isHost && ctxMenu ? () => {
            const content = stripNonContentLines(ctxMenu.message.content
              .replace(/\[(?:ARTIFACT_UPDATE|ARTIFACT_CONFIRM|ACTION_CARD|ACTIVITY_ADVANCE|ACTIVITY_RETURN|HELP_CARD|TEAM_DISCUSSION_READY|TEAM_GRADE_BANDS|STANDARD_SEARCH)[^\]]*\]/g, '')
              .replace(/\[ARTIFACT_UPDATE\]/g, ''))
            if (!content) {
              setChatError('선택지·안내 문구는 산출물로 저장할 수 없습니다. 실제 내용이 담긴 메시지를 선택해주세요.')
              return
            }
            const activityMeta = ACTIVITY_META[currentActivity]
            // 현재 활동의 산출물 키로 저장
            const sectionKey = activityMeta.recommendedSections?.[0]?.key
              ?? activityMeta.requiredSections?.[0]?.key
              ?? activityMeta.label
            void applyArtifactUpdates({ [sectionKey]: content }, currentActivity, content, 'manual')
          } : undefined}
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

        {isHost && Object.entries(proj.teamGradeBandProposals ?? {}).map(([uid, proposal]) => (
          <div key={proposal.id} className="mx-4 mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3" role="status">
            <div className="flex-1 text-sm text-violet-950">
              <p className="font-semibold">{proposal.proposedByName}님의 학년군 확인 요청</p>
              <p>{formatGradeBandList(proposal.bands)} · 반영하면 기존 팀 학년군에 추가됩니다.</p>
            </div>
            {[true, false].map(accept => (
              <button key={String(accept)} disabled={gradeProposalBusy !== null}
                className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
                onClick={async () => {
                  setGradeProposalBusy(proposal.id)
                  try {
                    const next = await resolveTeamGradeBandProposal(proj.id, uid, proposal.id, accept)
                    if (next) addAssistantNotice(`방장이 팀 학년군을 ${formatGradeBandList(next)}으로 반영했습니다. 분석시트의 학년군 설정에도 적용됩니다.`)
                  } catch (error) {
                    setChatError(error instanceof Error ? error.message : '학년군 제안을 처리하지 못했습니다.')
                  } finally { setGradeProposalBusy(null) }
                }}>{accept ? '팀 학년군에 반영' : '반영하지 않기'}</button>
            ))}
          </div>
        ))}

        {/* 팀 토의 제안 카드 (AI가 제안한 경우) */}
        {isHost && pendingTeamDiscussion && !isTeamMode && !showDiscussionConfirm && (
          <TeamDiscussionProposal
            topic={pendingTeamDiscussion.topic}
            onAccept={handleAcceptDiscussion}
            onDecline={() => setPendingTeamDiscussion(null)}
          />
        )}

        {/* 산출물 저장 제안 카드 (방장에게만 표시) */}
        {pendingArtifactSave && isHost && !showWorkspace && (
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
        {pendingArtifactSave && isHost && showWorkspace && (
          <div className="fixed right-8 bottom-8 z-[10050] w-[460px] max-w-[calc(100vw-2rem)]">
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
          </div>
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
        {TEAM_OPTION_VOTING_ENABLED && isWaitingForChoice && !isHost && lastAIMsg && (() => {
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

        {/* 보내기 대기열 — AI 답이 끝나면 순서대로 보낸다(#T10) */}
        {queuedSends.map((text, index) => (
          <div key={`queued-${index}`} className="mb-2 flex justify-end" data-testid="queued-send">
            <div className="max-w-[80%] rounded-2xl border border-dashed border-[#A0BCE8] bg-[#F1F6FE] px-3 py-2 text-[13px] text-[#3C4043]">
              <span className="whitespace-pre-wrap">{text}</span>
              <span className="ml-2 text-[11px] text-[#5F6368]">보내는 중…</span>
            </div>
          </div>
        ))}

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

        </div>
        {hasNewAIResponse && (
          <button
            type="button"
            onClick={scrollToLatestAIResponse}
            className="absolute bottom-3 left-1/2 z-50 flex min-h-10 -translate-x-1/2 items-center gap-1.5 rounded-full border border-[#AECBFA] bg-white px-4 py-2 text-xs font-bold text-[#1557B0] shadow-lg transition-colors hover:bg-[#E8F0FE] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]"
            aria-label="새 AI 응답으로 이동"
          >
            <ArrowDown size={14} weight="bold" aria-hidden="true" />
            새 AI 응답
          </button>
        )}
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
      {flowNotice && <p role="status" className="px-4 py-2 text-sm text-[#00695C] bg-[#E0F2F1]">{flowNotice}</p>}
      {memberCommand && (
        <MemberCommandPanel
          value={memberCommand}
          isHost={isHost}
          onChoose={target => setMemberCommand({ command: { kind: 'confirm', target }, state: 'pending' })}
          onRemove={target => { void confirmMemberRemoval(target) }}
          onClose={() => setMemberCommand(null)}
        />
      )}
      <div className="px-4 py-3 border-t"
        style={isTeamMode
          ? { background: 'linear-gradient(90deg, #E0F2F1 0%, #F1F8F7 100%)', borderColor: '#80CBC4' }
          : { background: '#F8F9FA', borderColor: '#DADCE0' }}
      >
        {/* 팀 채팅 컨트롤 바 — solo 모드에서는 팀 협업 컨트롤(방장/팀원·팀 채팅)이 불필요해 숨긴다.
            (안 선택 대기 메시지는 solo에서도 필요하므로 isWaitingForChoice일 때는 유지) */}
        {!(isSoloProject(proj) && !isTeamMode && !isWaitingForChoice) && (
        <div className="flex items-center justify-between mb-2">
          {isTeamMode ? (
            <span className="text-[11px] text-[#00695C] font-medium">팀원끼리 자유롭게 대화하세요 · AI는 잠시 대기 중</span>
          ) : isWaitingForChoice ? (
            <span className="text-[11px] text-[#E65100] font-medium flex items-center gap-1">
              <Chat size={16} weight="regular" className="text-[#E65100]" />
              {isHost
                ? '안을 선택하거나, 마음에 들지 않으면 원하는 내용을 그대로 입력해 주세요'
                : '방장이 안을 검토하고 있습니다 · 의견을 남길 수 있어요'}
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
        )}
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

        <ChatDraftBoundary draft={chatDraft}>{({ input, slashQuery, slashCmdIdx }) => {
          const filteredSlashCmds = filterSlashCommands(slashQuery)
          return <>
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
              setSheetPreferredCenterCode('')
              stableGraphKeywordRef.current = ' '
              setStableGraphKeyword(' ')
              setWorkspaceInitialView('graph')
              setShowWorkspace(true)
              setShowGraphPanel(true)
              if (isHost) setGraphOpen(proj.id, true, ' ', 'graph').catch(console.error)
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
            <div className={cn('chat-input-inner relative', isTeamMode ? 'bg-[#E0F2F1]' : 'bg-white')}>
              <textarea
                data-chat-input=""
                value={input}
                onChange={(e) => {
                  markChatInput()
                  const val = e.target.value
                  setInput(val)
                  // @노트 토큰이 없어지면 툴팁 닫기
                  if (noteTooltip && !val.includes('@노트#')) setNoteTooltip(null)
                  const match = val.match(/(?:^|\s)\/([\w가-힣]*)$/)
                  if (match) {
                    setSlashQuery(match[1])
                    setSlashCmdIdx(0)
                  } else {
                    setSlashQuery(null)
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder={sendBlockReason
                  ? `${sendBlockReason}… 입력은 해 두고 준비되면 보낼 수 있어요`
                  : isTeamMode
                  ? '팀원에게 의견을 전달하세요...'
                  : isWaitingForChoice
                    ? isHost ? '안을 고르거나, 원하는 내용을 직접 입력해도 됩니다...' : '방장에게 의견을 남겨 주세요...'
                    : '메시지를 입력하세요... (/ 로 커맨드 · Shift+Enter: 줄바꿈)'}
                rows={3}
                disabled={isLoading && !isTeamMode && !isWaitingForChoice}
                className={cn(
                  'w-full resize-none border-0 rounded-[18px] px-3 py-2 text-sm',
                  'focus:outline-none disabled:opacity-50',
                  input.includes('@노트#') ? 'text-transparent caret-[#202124]' : 'text-[#202124]',
                )}
                style={{ background: 'transparent' }}
              />
              {sendBlockReason && input.trim() && (
                <span role="status" className="absolute -top-5 right-2 z-[3] rounded-full bg-[#FEF7E0] px-2 py-0.5 text-[10px] font-semibold text-[#B06000]">
                  {sendBlockReason}… 준비되면 보낼 수 있어요
                </span>
              )}
              {/* 하이라이트 오버레이 — textarea 위, 노트 토큰만 pointer-events 활성 */}
              {input.includes('@노트#') && (
                <div
                  className="absolute inset-0 rounded-[18px] px-3 py-2 text-sm whitespace-pre-wrap break-words pointer-events-none overflow-visible z-[2]"
                  style={{ color: '#202124', lineHeight: '1.5' }}
                >
                  {input.split(/(@노트#\d+)/).map((part, i) => {
                    const noteMatch = part.match(/^@노트#(\d+)$/)
                    if (!noteMatch) return <span key={i}>{part}</span>
                    const num = parseInt(noteMatch[1])
                    const note = (proj.keyNotes ?? [])[num - 1]
                    const preview = note ? (note.content.length > 80 ? note.content.slice(0, 80) + '…' : note.content) : '(노트 없음)'
                    return (
                      <span
                        key={i}
                        className="pointer-events-auto cursor-default rounded-[3px] bg-[#FFE0B2] text-[#C2410C]"
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setNoteTooltip({ num, preview, x: rect.left, y: rect.top - 8 })
                        }}
                        onMouseLeave={() => setNoteTooltip(null)}
                      >
                        {part}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {/* 전송 버튼 — morph-shape 일렁임 */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || (isLoading && !isTeamMode && !isWaitingForChoice) || !!sendBlockReason}
            title={sendBlockReason ?? undefined}
            className={cn(
              'chat-motion-decorative w-12 h-[70px] text-white flex items-center justify-center flex-shrink-0',
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
          </>
        }}</ChatDraftBoundary>
      </div>

    </div>
  )
}
