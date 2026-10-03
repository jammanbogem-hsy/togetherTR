'use client'

import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '@/lib/markdown/remarkPlugins'
import { parsePsReady, cleanPsReady } from '@/lib/problem-situation/readySignal'
import { extractFallbackStandards, type FallbackStandard } from '@/lib/problem-situation/standardsFallback'
import { isEmptyScenarioDetail, usableGraphData } from '@/lib/problem-situation/designerState'
import { buildRecentConversationContext, buildTeamPreparationContext } from '@/lib/problem-situation/workshopContext'
import { useProjectStore } from '@/store/project'
import { XIcon as X, ArrowClockwiseIcon as ArrowClockwise, PaperPlaneRightIcon as PaperPlaneRight, FloppyDiskIcon as FloppyDisk, SpinnerGapIcon as SpinnerGap, CheckCircleIcon as CheckCircle, ArrowsOutIcon as ArrowsOut, BookOpenIcon as BookOpen, UsersIcon as Users, DatabaseIcon as Database, LightbulbIcon as Lightbulb, MagnifyingGlassIcon as MagnifyingGlass, FileTextIcon as FileText, SidebarSimpleIcon as SidebarSimple, CaretRightIcon as CaretRight, CircleNotchIcon as CircleNotch, PencilRulerIcon as PencilRuler } from '@phosphor-icons/react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import {
  DETAIL_PARTS,
  applyCandidateDetail,
  type DetailPart,
  type ProblemCandidateDetail,
  type ProblemSituationResult,
  type ProblemScenarioCandidate,
} from '@/lib/problem-situation/generation'
import type { GraphSavedData } from '@/lib/knowledge-graph/domain'
import { MD3Button, MD3_ICON } from '@/components/ui/MD3Button'

// ─── 교과 색상 ────────────────────────────────────────
const SUBJECT_COLORS: Record<string, string> = {
  sub_kor: '#7C3AED', sub_math: '#2563EB', sub_sci: '#059669',
  sub_soc: '#D97706', sub_mor: '#DC2626', sub_art: '#DB2777',
  sub_mus: '#8B5CF6', sub_pe: '#16A34A', sub_eng: '#0891B2',
  sub_prac: '#B45309', sub_int: '#0D9488', sub_extra: '#7C2D12',
  default: '#6B7280',
}
const SUBJECT_NAMES: Record<string, string> = {
  sub_kor: '국어', sub_math: '수학', sub_sci: '과학', sub_soc: '사회',
  sub_mor: '도덕', sub_art: '미술', sub_mus: '음악', sub_pe: '체육',
  sub_eng: '영어', sub_prac: '실과', sub_int: '통합교과', sub_extra: '창체',
}
function subjectColor(id?: string) { return SUBJECT_COLORS[id ?? ''] ?? SUBJECT_COLORS.default }
function subjectName(id?: string) { return SUBJECT_NAMES[id ?? ''] ?? id ?? '' }
// 성취기준 ID에서 교과 prefix 제거: sub_soc_6사03-01 → 6사03-01
function shortStdId(id: string) {
  const last = id.lastIndexOf('_')
  return last >= 0 ? id.slice(last + 1) : id
}

// 생성 진행 단계 라벨 (로딩 화면용 — 1단계 '개요' 생성 동안 표시)
const GEN_STEPS = [
  '성취기준·지식 그래프 분석',
  'A단계 수업목표·평가 계획 연계 지점 확인',
  '교과 융합 문제상황 후보 3안 구상',
  '탐구 질문·하위 탐구 질문 도출',
]

// 생성은 2단계로 나뉜다. Firebase Hosting이 요청 하나를 60초에서 끊기 때문에
// 개요(후보 요약+탐구 질문)를 먼저 받고, 후보별 상세는 병렬 요청으로 이어서 받는다.
// empty: 응답은 왔지만 성취기준 연결이 비어 자동 재요청 1회 뒤에도 비어 있는 상태
type DetailStatus = 'loading' | 'error' | 'done' | 'empty'
type DetailStatusMap = Partial<Record<number, DetailStatus>>

// Hosting 제한(60초)보다 조금 앞서 끊어 사용자에게 명확한 안내를 보여준다.
const GENERATE_TIMEOUT_MS = 58_000

async function postGenerate<T>(body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS)
  try {
    const res = await fetch('/api/problem-situation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null) as (T & { error?: string }) | null
    if (!res.ok) {
      if (res.status === 502 || res.status === 504) {
        throw new Error('서버 응답 시간(60초)을 초과했습니다. 다시 시도해 주세요.')
      }
      throw new Error(data?.error ?? `API 오류 ${res.status}`)
    }
    if (!data) throw new Error('서버 응답을 읽지 못했습니다.')
    if (data.error) throw new Error(String(data.error))
    return data
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('응답이 60초 안에 오지 않아 요청을 중단했습니다. 다시 시도해 주세요.')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ─── 타입 ─────────────────────────────────────────────
interface ProblemScenario {
  title: string; row1: string; row2: string; row3: string
}

interface ProblemSituationData {
  scenario: ProblemScenario
  drivingQuestion: string
  essentialQuestions: string[]
  fullResult?: ProblemSituationResult | Record<string, unknown>  // 전체 생성 결과 보존 (산출물 저장용)
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  projectId: string
  projectTitle: string
  targetGradeGroup: string
  teamGradeBands?: string[]
  targetSubjects: string[]
  graphSavedData?: GraphSavedData | null
  achievementStandardsAnalysis?: string  // A-2-1 산출물 텍스트 (성취기준 분석 결과)
  evaluationPlan?: string
  learningObjective?: string
  learnerProfile?: string
  savedData?: ProblemSituationData | null
  isLeader: boolean
  onSave: (data: ProblemSituationData) => Promise<void>
  onClose: () => void
}

// 후보 상세 (recommended 또는 candidate.fullScenario 채워진 경우)
type ScenarioDetail = {
  title: string
  fullScenario: string
  standardsAlignment: ProblemSituationResult['recommended']['standardsAlignment']
  realData: ProblemSituationResult['recommended']['realData']
  learningContent: string
  artifacts: string
  alignmentCheck: string
}

// 선택된 후보 index 기준 상세 추출 (옛 데이터 호환: 상세 없으면 null → 요약만)
function getScenarioDetail(result: ProblemSituationResult, i: number): ScenarioDetail | null {
  const c: ProblemScenarioCandidate | undefined = result.candidates[i]
  if (c?.fullScenario) {
    return {
      title: c.title,
      fullScenario: c.fullScenario,
      standardsAlignment: c.standardsAlignment ?? [],
      realData: c.realData ?? [],
      learningContent: c.learningContent ?? '',
      artifacts: c.artifacts ?? '',
      alignmentCheck: c.alignmentCheck ?? '',
    }
  }
  if (result.recommended && result.recommended.index === i) return result.recommended
  return null
}

// result → ProblemSituationData 매핑 (idx 주어지면 해당 후보 기준, 상세 없으면 recommended fallback)
// ⚠️ 산출물에는 "선택된 1개 문제상황"만 담는다 — fullResult.candidates를 선택 후보 하나로 축소.
function resultToSaveData(result: ProblemSituationResult, idx?: number): ProblemSituationData {
  const i = idx ?? result.recommended?.index ?? 0
  const detail = getScenarioDetail(result, i) ?? result.recommended
  const chosenCandidate = result.candidates?.[i]
  // 선택된 후보만 남긴 단일 후보 결과 사본 (recommended도 그 후보로 통일, index=0)
  const fullResult: ProblemSituationResult = {
    ...result,
    candidates: chosenCandidate ? [chosenCandidate] : [],
    recommended: {
      index: 0,
      title: detail.title,
      fullScenario: detail.fullScenario,
      standardsAlignment: detail.standardsAlignment ?? [],
      realData: detail.realData ?? [],
      learningContent: detail.learningContent,
      artifacts: detail.artifacts,
      alignmentCheck: detail.alignmentCheck,
    },
  }
  return {
    scenario: {
      title: detail.title,
      row1: detail.fullScenario,
      row2: [detail.learningContent, detail.artifacts].filter(Boolean).join('\n\n산출물: '),
      row3: (detail.realData ?? []).map(d => typeof d === 'string' ? d : d.label).join(' / '),
    },
    drivingQuestion: result.drivingQuestion,
    essentialQuestions: result.essentialQuestions,
    fullResult,  // 전체 결과 보존 → onSave에서 산출물 구조 그대로 저장
  }
}

// ─── 확대 가능한 섹션 블록 ───────────────────────────
// 결과 패널의 각 섹션. hover 시 '확대' 버튼 → 같은 내용을 큰 글씨 모달로.
function Block({
  label,
  labelColor = 'var(--md-sys-on-surface-variant)',
  bg,
  borderless,
  onZoom,
  children,
}: {
  label: string
  labelColor?: string
  bg?: string
  borderless?: boolean
  onZoom: (title: string, body: ReactNode) => void
  children: ReactNode
}) {
  const body = (
    <>
      {label && (
        <div className="text-[14px] font-medium mb-1.5" style={{ color: labelColor }}>
          {label}
        </div>
      )}
      {children}
    </>
  )
  return (
    <div className={`relative group/zoom px-4 py-3 ${borderless ? '' : 'border-b border-[var(--md-sys-outline-variant)]'} ${bg ?? ''}`}>
      <button
        type="button"
        onClick={() => onZoom(label || '내용', body)}
        title="확대해서 보기"
        className="absolute top-2 right-2 z-10 flex h-7 items-center gap-1 rounded-[var(--md-sys-radius-sm)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)] px-2.5 text-[13px] font-medium text-[var(--md-sys-on-surface-variant)] opacity-0 transition-opacity group-hover/zoom:opacity-100 focus-visible:opacity-100 hover:bg-[var(--md-sys-surface-container-high)]"
      >
        <ArrowsOut size={11} weight="bold" /> 확대
      </button>
      {body}
    </div>
  )
}

// ─── 노드 맵 컴포넌트 ─────────────────────────────────
function NodeMap({ centerNode, selectedStandards, fallbackStandards = [] }: {
  centerNode: GraphSavedData['centerNode']; selectedStandards: GraphSavedData['selectedStandards']
  fallbackStandards?: FallbackStandard[]
}) {
  const hasData = centerNode !== null || selectedStandards.length > 0
  if (!hasData && fallbackStandards.length > 0) return <FallbackStandardList standards={fallbackStandards} />
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--md-sys-outline)] text-[14px] text-center px-4 gap-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--md-sys-surface-container-high)] text-[var(--md-sys-on-surface-variant)]">
          <MagnifyingGlass size={22} weight="bold" />
        </span>
        <span className="leading-relaxed">지식 그래프 데이터가 없습니다.<br />A-3 단계에서 저장해 주세요.</span>
      </div>
    )
  }
  const bySubject = new Map<string, GraphSavedData['selectedStandards']>()
  for (const n of selectedStandards) {
    if (centerNode && n.id === centerNode.id) continue
    const list = bySubject.get(n.subjectId) ?? ([] as GraphSavedData['selectedStandards'])
    list.push(n)
    bySubject.set(n.subjectId, list)
  }
  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      {centerNode && (
        <div className="rounded-xl border-2 p-3" style={{ borderColor: subjectColor(centerNode.subjectId), backgroundColor: subjectColor(centerNode.subjectId) + '18' }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: subjectColor(centerNode.subjectId) }} />
            <span className="text-[13px] font-semibold" style={{ color: subjectColor(centerNode.subjectId) }}>중심 성취기준 · {subjectName(centerNode.subjectId)}</span>
          </div>
          <div className="text-[14px] font-bold text-[var(--md-sys-on-surface)] leading-snug">[{shortStdId(centerNode.id)}]</div>
          <div className="text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed mt-0.5 line-clamp-3">{centerNode.text}</div>
        </div>
      )}
      {centerNode && bySubject.size === 0 && <div className="text-[13px] text-[var(--md-sys-outline)] text-center py-2">연결된 성취기준 없음</div>}
      {Array.from(bySubject.entries()).map(([subjId, nodes]) => (
        <div key={subjId} className="rounded-lg border p-2.5" style={{ borderColor: subjectColor(subjId) + '55', backgroundColor: subjectColor(subjId) + '0C' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: subjectColor(subjId) }} />
            <span className="text-[13px] font-semibold" style={{ color: subjectColor(subjId) }}>{subjectName(subjId)}</span>
            <span className="text-[13px] text-[var(--md-sys-outline)]">({nodes.length}개)</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {nodes.map(n => (
              <div key={n.id} className="bg-[var(--md-sys-surface-container-lowest)] rounded-md px-2 py-1.5 border border-[var(--md-sys-outline-variant)]">
                <div className="text-[13px] font-semibold text-[var(--md-sys-on-surface-variant)]">[{shortStdId(n.id)}]</div>
                <div className="text-[13px] text-[var(--md-sys-on-surface-variant)] leading-relaxed line-clamp-2 mt-0.5">{n.text}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// 지식 그래프가 없을 때 A-2-1 분석표·분석시트의 성취기준을 학년군별로 보여 준다.
function FallbackStandardList({ standards }: { standards: FallbackStandard[] }) {
  const byBand = new Map<string, FallbackStandard[]>()
  for (const standard of standards) {
    const band = standard.gradeBand || '학년군 미지정'
    byBand.set(band, [...(byBand.get(band) ?? []), standard])
  }
  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      {Array.from(byBand.entries()).map(([band, items]) => (
        <div key={band} className="rounded-lg border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-low)] p-2.5">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[13px] font-semibold text-[var(--md-sys-primary)]">{band}</span>
            <span className="text-[13px] text-[var(--md-sys-outline)]">({items.length}개)</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {items.map(item => (
              <div key={item.code} className="bg-[var(--md-sys-surface-container-lowest)] rounded-md px-2 py-1.5 border border-[var(--md-sys-outline-variant)]">
                <div className="text-[13px] font-semibold text-[var(--md-sys-on-surface-variant)]">
                  [{item.code}]{item.subject && <span className="ml-1 font-normal text-[var(--md-sys-outline)]">{item.subject}</span>}
                </div>
                {item.text && <div className="text-[13px] text-[var(--md-sys-on-surface-variant)] leading-relaxed line-clamp-2 mt-0.5">{item.text}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── 결과 표시 컴포넌트 ───────────────────────────────
function ResultView({
  result,
  detailStatus,
  onRetryDetail,
  onSelect,
}: {
  result: ProblemSituationResult
  detailStatus: DetailStatusMap
  onRetryDetail: (index: number) => void
  onSelect: (data: ProblemSituationData) => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(result.recommended?.index ?? 0)
  const [zoom, setZoom] = useState<{ title: string; body: ReactNode } | null>(null)
  // 산출물로 보낼 단 하나의 확정 후보 (기본값: AI 추천 후보)
  const [committedIndex, setCommittedIndex] = useState(result.recommended?.index ?? 0)
  const openZoom = (title: string, body: ReactNode) => setZoom({ title, body })
  const candidates = result.candidates ?? []
  const selected = candidates[selectedIndex]
  const detail = getScenarioDetail(result, selectedIndex)
  const isRecommended = result.recommended?.index === selectedIndex
  const isCommitted = committedIndex === selectedIndex
  const selectedStatus = detailStatus[selectedIndex]
  // 상세가 아직 생성 중이거나 실패한 후보는 산출물로 선택할 수 없다 (빈 상세 저장 방지).
  // 상세는 두 조각으로 나뉘어 도착하므로 일부만 채워진 상태에서도 선택을 막는다.
  const detailPending = selectedStatus === 'loading' || selectedStatus === 'error' || selectedStatus === 'empty'
  const anyDetailLoading = candidates.some((_, i) => detailStatus[i] === 'loading')
  const detailDoneCount = candidates.filter((c, i) => detailStatus[i] === 'done' || (detailStatus[i] == null && !!c.fullScenario)).length
  // 조각이 아직 안 온 필드는 빈칸 대신 생성 중 표시
  const orPending = (v: string | undefined) => v || (selectedStatus === 'loading' ? '생성 중…' : '')
  const commitSelected = () => {
    setCommittedIndex(selectedIndex)
    try { onSelect(resultToSaveData(result, selectedIndex)) }
    catch (e) { console.error('[후보 선택] resultToSaveData 오류:', e) }
  }
  const essentials = result.essentialQuestions ?? []
  const hasQuestions = !!result.drivingQuestion?.trim() || essentials.length > 0

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-2">
        <p className="text-[16px] font-bold text-[var(--md-sys-on-surface-variant)]">생성된 문제 상황 후보가 없습니다.</p>
        <p className="text-[14px] text-[var(--md-sys-outline)]">다시 생성하거나 공동 편집에서 직접 작성해 주세요.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">

      {/* ① 문제 상황 후보 — 책갈피 탭 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-[16px] font-medium text-[var(--md-sys-on-surface)]">문제 상황 후보</h3>
          <span className="text-[14px] text-[var(--md-sys-on-surface-variant)]">{candidates.length}개 · 하나만 산출물로 선택</span>
          {anyDetailLoading && (
            <span className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-primary-container)] px-2.5 text-[14px] font-medium text-[var(--md-sys-on-primary-container)]">
              <SpinnerGap size={10} className="animate-spin" weight="bold" /> 후보 상세 생성 중 {detailDoneCount}/{candidates.length}
            </span>
          )}
        </div>
        <div role="tablist" aria-label="문제 상황 후보" className="flex items-end overflow-x-auto border-b border-[var(--md-sys-outline-variant)]">
          {candidates.map((c, i) => {
            const active = selectedIndex === i
            const committed = committedIndex === i
            return (
              <button
                key={i}
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedIndex(i)}
                className={`flex h-12 flex-shrink-0 items-center gap-1.5 px-4 text-[15px] font-medium transition-colors -mb-px border-b-2 ${
                  active
                    ? 'text-[var(--md-sys-primary)] border-[var(--md-sys-primary)]'
                    : 'text-[var(--md-sys-on-surface-variant)] border-transparent hover:bg-[var(--md-sys-surface-container-high)]'
                }`}
              >
                <span className={`flex-shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center border ${
                  committed ? 'bg-[var(--md-sys-primary)] border-[var(--md-sys-primary)]' : active ? 'border-[var(--md-sys-primary)]' : 'border-[var(--md-sys-outline)]'
                }`}>
                  {committed && <CheckCircle size={9} weight="fill" color="white" />}
                </span>
                <span className="leading-snug max-w-[240px] truncate">{c.title}</span>
                {result.recommended?.index === i && !committed && (
                  <span className="flex-shrink-0 rounded-[var(--md-sys-radius-xs)] bg-[var(--md-sys-primary-container)] px-1.5 py-px text-[13px] font-medium text-[var(--md-sys-on-primary-container)]">추천</span>
                )}
              </button>
            )
          })}
        </div>
        {/* 선택 후보 요약 + 선택 CTA */}
        <div className="mt-3 rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container-low)] px-4 py-3">
          <p className="text-[15px] text-[var(--md-sys-on-surface)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{selected?.scenario}</p>
          {selected?.dataSources && (
            <p className="text-[13px] text-[var(--md-sys-on-surface-variant)] leading-relaxed mt-1.5">
              <span className="font-bold text-[var(--md-sys-primary)]">데이터 출처</span> · {selected.dataSources}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {isCommitted ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-tertiary-container)] px-3 text-[14px] font-medium text-[var(--md-sys-on-tertiary-container)]">
                <CheckCircle size={13} weight="fill" /> 이 후보가 산출물로 선택됨
              </span>
            ) : (
              <MD3Button
                variant="filled"
                tone="blue"
                size="sm"
                onClick={commitSelected}
                disabled={detailPending}
                icon={<CheckCircle size={MD3_ICON.sm} weight="fill" />}
              >
                이 후보를 산출물로 선택
              </MD3Button>
            )}
            <span className="text-[14px] text-[var(--md-sys-on-surface-variant)]">
              {detailPending ? '상세 생성이 끝나면 선택할 수 있습니다' : '산출물에는 선택한 1개 후보만 저장됩니다'}
            </span>
          </div>
        </div>
      </section>

      {/* ② 선정 문제 상황 상세 (선택 후보 기준) */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-[16px] font-medium text-[var(--md-sys-on-surface)]">선정 문제 상황</h3>
          <span className="text-[13px] text-[var(--md-sys-primary)] bg-[var(--md-sys-primary-container)] px-2 py-0.5 rounded-full font-medium">
            {selected?.title}
          </span>
          {isCommitted && (
            <span className="text-[13px] text-white bg-[var(--md-sys-tertiary)] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <CheckCircle size={9} weight="fill" /> 선택됨
            </span>
          )}
          {isRecommended && !isCommitted && (
            <span className="text-[13px] text-[var(--md-sys-primary)] bg-[var(--md-sys-surface-container-lowest)] border border-[var(--md-sys-outline-variant)] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              AI 추천
            </span>
          )}
        </div>

        {detail == null ? (
          <div className="overflow-hidden rounded-[var(--md-sys-radius-lg)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)]">
            {selectedStatus === 'loading' ? (
              <div className="px-4 py-3 bg-[var(--md-sys-primary-container)] border-b border-[var(--md-sys-outline-variant)] flex items-center gap-2">
                <SpinnerGap size={14} className="animate-spin text-[var(--md-sys-primary)] flex-shrink-0" weight="bold" />
                <p className="text-[14px] text-[var(--md-sys-primary)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  이 후보의 상세(문제 상황 전문·성취기준 연결·실제 자료·산출물·AI 점검)를 생성하고 있습니다. 약 30초 정도 걸립니다.
                </p>
              </div>
            ) : selectedStatus === 'error' || selectedStatus === 'empty' ? (
              <div className="px-4 py-3 bg-[var(--md-sys-error-container)] border-b border-[var(--md-sys-outline-variant)] flex items-center gap-2 flex-wrap">
                <p className="text-[14px] text-[var(--md-sys-error)] leading-relaxed flex-1 min-w-0" style={{ wordBreak: 'keep-all' }}>
                  {selectedStatus === 'empty'
                    ? '성취기준 연결을 불러오지 못했어요 — 다시 생성해 주세요.'
                    : '이 후보의 상세 생성에 실패했습니다. 다른 후보에는 영향이 없습니다.'}
                </p>
                <MD3Button variant="filled" tone="red" size="sm" onClick={() => onRetryDetail(selectedIndex)} icon={<ArrowClockwise size={MD3_ICON.sm} weight="bold" />}>
                  이 후보 상세 다시 생성
                </MD3Button>
              </div>
            ) : (
              <div className="px-4 py-3 bg-[#FEF7E0] border-b border-[var(--md-sys-outline-variant)]">
                <p className="text-[14px] text-[#B06000] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  이 후보는 요약만 생성되었습니다. &lsquo;재생성&rsquo;하면 모든 후보의 상세를 받을 수 있습니다.
                </p>
              </div>
            )}
            <Block label="문제 상황 요약" onZoom={openZoom}>
              <p className="text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{selected?.scenario}</p>
            </Block>
            <Block label="데이터 출처" borderless onZoom={openZoom}>
              <p className="text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{selected?.dataSources}</p>
            </Block>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--md-sys-radius-lg)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)]">
            <Block label="문제 상황 전문" onZoom={openZoom}>
              <p className="text-[14px] text-[var(--md-sys-on-surface)] leading-[1.8]" style={{ wordBreak: 'keep-all' }}>
                {detail.fullScenario}
              </p>
            </Block>

            {selectedStatus === 'empty' && !(detail.standardsAlignment?.length > 0) && (
              <div className="px-4 py-3 bg-[var(--md-sys-error-container)] border-b border-[var(--md-sys-outline-variant)] flex items-center gap-2 flex-wrap">
                <p className="text-[14px] text-[var(--md-sys-error)] leading-relaxed flex-1 min-w-0" style={{ wordBreak: 'keep-all' }}>
                  성취기준 연결을 불러오지 못했어요 — 다시 생성해 주세요.
                </p>
                <button
                  type="button"
                  onClick={() => onRetryDetail(selectedIndex)}
                  className="inline-flex items-center gap-1 text-[14px] font-bold text-white bg-[var(--md-sys-error)] hover:opacity-90 px-3 py-1 rounded-full transition-colors"
                >
                  <ArrowClockwise size={12} weight="bold" /> 다시 생성
                </button>
              </div>
            )}

            {detail.standardsAlignment?.length > 0 && (
              <Block label="성취기준 연결" onZoom={openZoom}>
                <div className="space-y-2">
                  {detail.standardsAlignment.map((s, i) => (
                    <div key={i} className={`rounded-lg px-3 py-2.5 border ${s.isCenter
                      ? 'bg-[var(--md-sys-primary-container)] border-[var(--md-sys-outline-variant)]'
                      : 'bg-[var(--md-sys-surface-container-low)] border-[var(--md-sys-outline-variant)]'}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        {s.isCenter && (
                          <span className="text-[12px] font-black bg-[var(--md-sys-primary)] text-white px-1.5 py-0.5 rounded-full">중심</span>
                        )}
                        <span className={`text-[14px] font-bold ${s.isCenter ? 'text-[var(--md-sys-primary)]' : 'text-[var(--md-sys-on-surface-variant)]'}`}>
                          [{s.standardId}]
                        </span>
                        <span className={`text-[13px] px-1.5 py-0.5 rounded-full font-medium ${s.isCenter ? 'bg-[var(--md-sys-outline-variant)] text-[var(--md-sys-primary)]' : 'bg-[var(--md-sys-outline-variant)] text-[var(--md-sys-on-surface-variant)]'}`}>
                          {s.subject}
                        </span>
                      </div>
                      <p className="text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{s.connection}</p>
                    </div>
                  ))}
                </div>
              </Block>
            )}

            <Block label="실제 데이터" onZoom={openZoom}>
              <ol className="space-y-1.5">
                {(detail.realData ?? []).map((d, i) => {
                  const item = typeof d === 'string' ? { label: d, url: undefined } : d
                  return (
                    <li key={i} className="flex gap-2 text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed">
                      <span className="flex-shrink-0 text-[var(--md-sys-primary)] font-bold">{i + 1})</span>
                      <span className="flex-1">
                        {item.label}
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="ml-1.5 inline-flex items-center gap-0.5 text-[13px] text-[var(--md-sys-primary)] hover:underline font-medium">
                            링크 ↗
                          </a>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </Block>

            <Block label="교과별 학습 내용" onZoom={openZoom}>
              <p className="text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                {orPending(detail.learningContent)}
              </p>
            </Block>

            <Block label="산출물" onZoom={openZoom}>
              <p className="text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                {orPending(detail.artifacts)}
              </p>
            </Block>

            <Block label="AI 점검: 학습내용/산출물 반영 검토" labelColor="#1967D2" bg="bg-[var(--md-sys-primary-container)]" borderless onZoom={openZoom}>
              <p className="text-[14px] text-[var(--md-sys-primary)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                {orPending(detail.alignmentCheck)}
              </p>
            </Block>
          </div>
        )}
      </section>

      {/* ③ 탐구 질문 & 하위 탐구 질문 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-[16px] font-medium text-[var(--md-sys-on-surface)]">탐구 질문 &amp; 하위 탐구 질문</h3>
        </div>
        <div className="overflow-hidden rounded-[var(--md-sys-radius-lg)] border border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)]">
          {hasQuestions ? (
            <>
              <Block label="탐구 질문 (Driving Question)" labelColor="var(--md-sys-on-tertiary-container)" bg="bg-[var(--md-sys-tertiary-container)]" onZoom={openZoom}>
                <p className="text-[16px] font-medium text-[var(--md-sys-on-tertiary-container)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  {result.drivingQuestion || '— (생성되지 않음, 재생성 권장)'}
                </p>
              </Block>
              <Block label="하위 탐구 질문 (Essential Questions)" borderless onZoom={openZoom}>
                {essentials.length > 0 ? (
                  <ol className="space-y-1.5">
                    {essentials.map((q, i) => (
                      <li key={i} className="flex gap-2 text-[14px] text-[var(--md-sys-on-surface-variant)] leading-relaxed">
                        <span className="flex-shrink-0 font-medium text-[var(--md-sys-tertiary)]">{i + 1}.</span>
                        <span style={{ wordBreak: 'keep-all' }}>{q}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[14px] text-[var(--md-sys-outline)]">하위 탐구 질문이 생성되지 않았습니다. 상단 &lsquo;재생성&rsquo;을 눌러 다시 시도하세요.</p>
                )}
              </Block>
            </>
          ) : (
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2 text-center bg-[#FEF7E0]">
              <p className="text-[14px] font-bold text-[#B06000]">탐구 질문·하위 탐구 질문이 생성되지 않았습니다</p>
              <p className="text-[14px] text-[#B06000]/80 leading-relaxed">AI 응답이 잘렸을 수 있습니다. 상단 우측 &lsquo;재생성&rsquo; 버튼을 눌러 다시 생성하면 탐구 질문과 하위 탐구 질문이 함께 채워집니다.</p>
            </div>
          )}
        </div>
      </section>

      {/* 선택 저장 버튼 — 선택된(현재 보고 있는) 후보를 산출물 후보로 확정 */}
      <MD3Button
        variant={isCommitted ? 'tonal' : 'filled'}
        tone={isCommitted ? 'green' : 'blue'}
        fullWidth
        className="flex-shrink-0"
        onClick={commitSelected}
        disabled={!isCommitted && detailPending}
        icon={<CheckCircle size={MD3_ICON.sm} weight="fill" />}
      >
        {isCommitted ? `‘${selected?.title ?? ''}’ 후보 선택됨` : '이 후보를 산출물로 선택'}
      </MD3Button>

      {/* 섹션 확대 보기 모달 */}
      {zoom && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4" onClick={() => setZoom(null)}>
          <div
            role="dialog" aria-modal="true" aria-label={zoom.title}
            className="bg-[var(--md-sys-surface-container-lowest)] w-full max-w-[860px] max-h-[88vh] rounded-[var(--md-sys-radius-xl)] shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-[var(--md-sys-outline-variant)] bg-[var(--md-sys-surface-container-lowest)]">
              <span className="inline-flex h-8 items-center gap-1 rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-primary-container)] px-3 text-[14px] font-medium text-[var(--md-sys-on-primary-container)]">
                <ArrowsOut size={13} weight="bold" /> 확대 보기
              </span>
              <span className="text-[18px] font-medium text-[var(--md-sys-on-surface)] truncate">{zoom.title}</span>
              <button
                type="button"
                onClick={() => setZoom(null)}
                className="ml-auto w-9 h-9 rounded-full hover:bg-[var(--md-sys-surface-container-high)] text-[var(--md-sys-on-surface-variant)] flex items-center justify-center transition-colors"
                aria-label="닫기"
              >
                <X size={18} weight="bold" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-7 py-6">
              <div style={{ zoom: 1.5 } as unknown as CSSProperties}>
                {zoom.body}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── 메인 컴포넌트 ────────────────────────────────────
export default function ProblemSituationDesigner({
  projectId,
  projectTitle,
  targetGradeGroup,
  teamGradeBands,
  targetSubjects,
  graphSavedData,
  achievementStandardsAnalysis,
  evaluationPlan,
  learningObjective,
  learnerProfile,
  savedData,
  isLeader,
  onSave,
  onClose,
}: Props) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [result, setResult] = useState<ProblemSituationResult | null>(null)
  const [showDataModal, setShowDataModal] = useState(false)
  // 기존 저장 내용이 있을 때 선택지 표시
  const [showExistingChoice, setShowExistingChoice] = useState(!!(savedData?.scenario?.title))
  // 좌측 성취기준 사이드바 접기/펼치기
  const [showStandards, setShowStandards] = useState(true)
  // 생성 진행 단계 인디케이터
  const [genStep, setGenStep] = useState(0)
  // 후보별 상세 생성 상태 (개요를 받은 뒤 후보마다 병렬로 요청)
  const [detailStatus, setDetailStatus] = useState<DetailStatusMap>({})
  // 재생성 시 이전 생성의 늦은 응답을 버리기 위한 세대 번호
  const generationRef = useRef(0)
  // 상세 재요청에 쓰는 현재 개요 (요약+탐구 질문)
  const outlineRef = useRef<ProblemSituationResult | null>(null)

  // graphSavedData: Firestore 실시간 리스너로 항상 최신 데이터 유지
  const [localGraphData, setLocalGraphData] = useState<Props['graphSavedData']>(graphSavedData ?? null)
  // 지식 그래프 없이 분석시트로 진행한 팀을 위한 성취기준 대체 목록 원천 (같은 구독에서 읽음)
  const [standardSources, setStandardSources] = useState<{ analysisRows?: unknown; sheetRows?: unknown }>({})
  // 생성 맥락 보강: T단계 팀 준비 산출물(같은 구독에서 읽음)과 Ds-2 대화의 최근 내용
  const [teamPreparation, setTeamPreparation] = useState('')
  useEffect(() => {
    // onSnapshot: 컴포넌트가 열려 있는 동안 Firestore 변경을 실시간으로 반영
    const unsub = onSnapshot(doc(db, 'projects', projectId), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setStandardSources({ analysisRows: d?.artifacts?.['A-2-1']?.content?.rows, sheetRows: d?.curriculumSheet })
        setTeamPreparation(buildTeamPreparationContext(d?.artifacts))
        // 그래프가 비워지면 이전 그래프를 남기지 않고 null로 바꿔 대체 성취기준 목록이 보이게 한다.
        setLocalGraphData(usableGraphData(d?.graphSavedData))
      }
    }, (err) => console.error('[ProblemSituationDesigner] onSnapshot 오류:', err))
    return () => unsub()
  }, [projectId])

  const hasGraphStandards = localGraphData?.centerNode != null || (localGraphData?.selectedStandards?.length ?? 0) > 0
  const fallbackStandards = hasGraphStandards ? [] : extractFallbackStandards({
    ...standardSources,
    analysisText: achievementStandardsAnalysis,
  })

  // 확정된 문제상황
  const [currentData, setCurrentData] = useState<ProblemSituationData | null>(savedData ?? null)

  // 채팅 상태
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)
  const [chatStreamingText, setChatStreamingText] = useState('')
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const [isSaving, setIsSaving] = useState(false)

  // ── 생성 (2단계: 개요 → 후보별 상세 병렬) ─────────────────
  const buildRequestBody = useCallback(() => ({
    graphSavedData: localGraphData,
    achievementStandardsAnalysis,
    evaluationPlan,
    learningObjective,
    learnerProfile,
    projectTitle,
    targetGradeGroup,
    teamGradeBands,
    targetSubjects,
    teamPreparation: teamPreparation || undefined,
    // 생성 시점의 대화를 담는다(요청마다 최신 상태를 읽어 의존성 변화로 콜백이 매번 바뀌지 않게 한다).
    recentConversation: buildRecentConversationContext(useProjectStore.getState().messages) || undefined,
  }), [localGraphData, achievementStandardsAnalysis, evaluationPlan, learningObjective, learnerProfile, projectTitle, targetGradeGroup, teamGradeBands, targetSubjects, teamPreparation])

  // 후보 하나의 상세를 두 조각(scenario / plan)으로 동시에 요청해 결과에 병합한다.
  // 조각이 도착하는 대로 화면에 채우고, 둘 다 성공해야 'done'. gen이 바뀌었으면(재생성) 늦은 응답은 버린다.
  // scenario 조각의 성취기준 연결이 비면 그 조각만 자동으로 1회 다시 받고, 그래도 비면 'empty'로 둔다.
  const loadCandidateDetail = useCallback(async (
    outline: ProblemSituationResult,
    index: number,
    gen: number,
    parts: readonly DetailPart[] = DETAIL_PARTS,
    autoRetry = true,
  ): Promise<void> => {
    setDetailStatus(prev => ({ ...prev, [index]: 'loading' }))
    const body = buildRequestBody()
    let emptyScenario = false
    const results = await Promise.allSettled(parts.map(async part => {
      const { detail } = await postGenerate<{ index: number; part: DetailPart; detail: Partial<ProblemCandidateDetail> }>({
        ...body,
        phase: 'detail',
        candidateIndex: index,
        part,
        outline,
      })
      if (gen !== generationRef.current) return
      if (isEmptyScenarioDetail(part, detail)) emptyScenario = true
      setResult(prev => (prev ? applyCandidateDetail(prev, index, detail) : prev))
    }))
    if (gen !== generationRef.current) return
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed.length > 0) {
      console.error(`[ProblemSituationDesigner] 후보 ${index + 1} 상세 생성 실패:`, failed.map(f => f.reason))
      setDetailStatus(prev => ({ ...prev, [index]: 'error' }))
      return
    }
    if (emptyScenario) {
      if (autoRetry) return loadCandidateDetail(outline, index, gen, ['scenario'], false)
      setDetailStatus(prev => ({ ...prev, [index]: 'empty' }))
      return
    }
    setDetailStatus(prev => ({ ...prev, [index]: 'done' }))
  }, [buildRequestBody])

  const generate = useCallback(async () => {
    const gen = ++generationRef.current
    setIsGenerating(true)
    setGenerateError(null)
    setResult(null)
    setDetailStatus({})
    outlineRef.current = null
    let outline: ProblemSituationResult
    try {
      outline = await postGenerate<ProblemSituationResult>({ ...buildRequestBody(), phase: 'outline' })
    } catch (e) {
      if (gen !== generationRef.current) return
      setGenerateError(e instanceof Error ? e.message : '생성 실패')
      setIsGenerating(false)
      return
    }
    if (gen !== generationRef.current) return
    outlineRef.current = outline
    setResult(outline)
    setIsGenerating(false)
    // 후보별 상세는 각각 별도 요청으로 동시에 받는다 (요청당 60초 제한 회피).
    outline.candidates.forEach((_, i) => { void loadCandidateDetail(outline, i, gen) })
  }, [buildRequestBody, loadCandidateDetail])

  const retryDetail = useCallback((index: number) => {
    const outline = outlineRef.current
    if (!outline) return
    void loadCandidateDetail(outline, index, generationRef.current)
  }, [loadCandidateDetail])

  // 기존 저장 내용이 없으면 자동 생성, 있으면 선택지 표시
  useEffect(() => {
    if (!savedData?.scenario?.title) { generate() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 채팅 자동 스크롤
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages, chatStreamingText])

  // 생성 중 단계 인디케이터 — 일정 간격으로 다음 단계로 진행 (마지막 단계에서 정지)
  useEffect(() => {
    if (!isGenerating) { setGenStep(0); return }
    setGenStep(0)
    const t = setInterval(() => {
      setGenStep(s => (s < GEN_STEPS.length - 1 ? s + 1 : s))
    }, 2600)
    return () => clearInterval(t)
  }, [isGenerating])

  // ── 채팅 전송 ──────────────────────────────────────
  const sendChat = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || chatStreaming) return
    setChatInput('')
    const newMessages: ChatMessage[] = [...chatMessages, { role: 'user', content: text }]
    setChatMessages(newMessages)
    setChatStreaming(true)
    setChatStreamingText('')

    try {
      const res = await fetch('/api/problem-situation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          currentScenario: currentData?.scenario ?? null,
          drivingQuestion: currentData?.drivingQuestion,
          essentialQuestions: currentData?.essentialQuestions,
          claudeIdeas: result ? JSON.stringify(result, null, 2) : '',
          openaiScenario: '',
          projectTitle,
          targetGradeGroup,
        }),
      })
      if (!res.ok || !res.body) throw new Error('채팅 API 오류')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'text') { fullText += evt.text; setChatStreamingText(fullText) }
            else if (evt.type === 'done') {
              const psData = parsePsReady(fullText)
              if (psData) setCurrentData(psData)
              setChatMessages(prev => [...prev, { role: 'assistant', content: cleanPsReady(fullText) }])
              setChatStreamingText('')
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}` }])
      setChatStreamingText('')
    } finally {
      setChatStreaming(false)
    }
  }, [chatInput, chatMessages, chatStreaming, currentData, result, projectTitle, targetGradeGroup])

  const handleSave = async () => {
    if (!currentData || !isLeader) return
    setIsSaving(true)
    try {
      await onSave(currentData)
    } catch (e) {
      console.error('[ProblemSituationDesigner] 저장 실패:', e)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="m3-shell fixed inset-0 z-50 bg-[var(--md-sys-surface-container-low)] flex flex-col" style={{ fontFamily: 'inherit' }}>
      {/* M3 small top app bar */}
      <header className="m3-top-app-bar flex h-[72px] flex-shrink-0 items-center gap-2 px-3 sm:px-4">
        <MD3Button
          variant="text"
          tone="neutral"
          onClick={() => setShowStandards(v => !v)}
          aria-label={showStandards ? '성취기준 사이드바 접기' : '성취기준 사이드바 펼치기'}
          title={showStandards ? '성취기준 사이드바 접기' : '성취기준 사이드바 펼치기'}
          icon={<SidebarSimple size={20} weight={showStandards ? 'fill' : 'regular'} />}
        />
        <span className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] border border-[var(--md-sys-outline-variant)] px-3 text-[14px] font-medium text-[var(--md-sys-on-surface-variant)]">
          <FileText size={15} weight="bold" />
          Ds-2
        </span>
        <div className="min-w-0 pl-1">
          <h1 className="truncate text-[21px] font-medium leading-6 text-[var(--md-sys-on-surface)]">문제상황 개발 워크숍</h1>
          <p className="truncate text-[14px] text-[var(--md-sys-on-surface-variant)]">AI가 교과 융합 문제상황 후보를 설계합니다</p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-shrink-0 items-center gap-2">
          {currentData && (
            <span className="hidden h-8 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-tertiary-container)] px-3 text-[14px] font-medium text-[var(--md-sys-on-tertiary-container)] sm:inline-flex">
              <CheckCircle size={14} weight="fill" /> 시나리오 확정됨
            </span>
          )}
          {isLeader && (
            <MD3Button
              variant="outlined"
              tone="neutral"
              onClick={() => { setShowExistingChoice(false); generate() }}
              disabled={isGenerating}
              icon={<ArrowClockwise size={MD3_ICON.sm} className={isGenerating ? 'animate-spin' : ''} />}
            >
              재생성
            </MD3Button>
          )}
          <MD3Button variant="text" tone="neutral" onClick={onClose} aria-label="닫기" icon={<X size={20} weight="bold" />} />
        </div>
      </header>

      {/* 본문 3-컬럼 */}
      <div className="flex-1 flex overflow-hidden gap-3 p-3 sm:gap-4 sm:p-4">

        {/* ── 왼쪽: 노드 맵 (접기/펼치기) ── */}
        {showStandards ? (
          <div className="w-80 flex-shrink-0 xl:w-[22rem] 2xl:w-[26rem] flex flex-col bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--md-sys-outline-variant)] flex-shrink-0 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-medium text-[var(--md-sys-on-surface)]">교과 융합 성취기준</h2>
                <p className="text-[13px] text-[var(--md-sys-on-surface-variant)] mt-0.5">{hasGraphStandards || fallbackStandards.length === 0 ? 'A-3 지식 그래프에서 저장한 성취기준' : 'A-3 분석표·분석시트의 성취기준'}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowStandards(false)}
                title="사이드바 접기"
                className="w-7 h-7 rounded-full hover:bg-[var(--md-sys-surface-container-high)] text-[var(--md-sys-outline)] hover:text-[var(--md-sys-on-surface-variant)] flex items-center justify-center transition-colors flex-shrink-0"
              >
                <SidebarSimple size={15} weight="fill" />
              </button>
            </div>
            <NodeMap
              centerNode={localGraphData?.centerNode ?? null}
              selectedStandards={localGraphData?.selectedStandards ?? []}
              fallbackStandards={fallbackStandards}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowStandards(true)}
            title="성취기준 사이드바 펼치기"
            className="w-10 flex-shrink-0 flex flex-col items-center justify-center gap-2 bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] text-[var(--md-sys-on-surface-variant)] hover:bg-[var(--md-sys-surface-container-high)] hover:text-[var(--md-sys-primary)] transition-colors"
          >
            <CaretRight size={14} weight="bold" />
            <span className="text-[12px] font-bold tracking-wide" style={{ writingMode: 'vertical-rl' }}>성취기준</span>
          </button>
        )}

        {/* ── 가운데: 결과 패널 ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--md-sys-outline-variant)] flex-shrink-0">
            <PencilRuler size={18} weight="fill" className="text-[var(--md-sys-primary)]" />
            <h2 className="text-[16px] font-medium text-[var(--md-sys-on-surface)]">문제상황 설계 결과</h2>
            {isGenerating && (
              <span className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-primary-container)] px-2.5 text-[14px] font-medium text-[var(--md-sys-on-primary-container)]">
                <SpinnerGap size={13} className="animate-spin" /> 설계 중
              </span>
            )}
            {result && !isGenerating && (
              <span className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-tertiary-container)] px-2.5 text-[14px] font-medium text-[var(--md-sys-on-tertiary-container)]"><CheckCircle size={13} weight="fill" /> 완료</span>
            )}
            {generateError && <span className="ml-auto inline-flex h-7 items-center rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-error-container)] px-2.5 text-[14px] font-medium text-[var(--md-sys-on-error-container)]">오류</span>}
          </div>

          <div className="flex-1 overflow-hidden">
            {/* 기존 저장 내용 선택지 */}
            {showExistingChoice && !isGenerating && !result && (
              <div className="flex flex-col items-center justify-center h-full gap-5 px-8">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-[var(--md-sys-tertiary-container)] flex items-center justify-center mx-auto mb-3">
                    <CheckCircle size={24} weight="fill" className="text-[var(--md-sys-tertiary)]" />
                  </div>
                  <p className="text-[16px] font-semibold text-[var(--md-sys-on-surface)]">이전에 저장된 설계 내용이 있습니다</p>
                  <p className="text-[14px] text-[var(--md-sys-outline)] mt-1.5">기존 내용을 불러오거나 새로 생성할 수 있습니다</p>
                </div>
                <div className="w-full max-w-sm rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container)] px-4 py-3">
                  <p className="text-[12px] font-bold text-[var(--md-sys-outline)] uppercase tracking-wide mb-1">이전 저장 제목</p>
                  <p className="text-[16px] font-semibold text-[var(--md-sys-on-surface)]">{savedData!.scenario.title}</p>
                  {savedData!.drivingQuestion && (
                    <p className="text-[13px] text-[var(--md-sys-on-surface-variant)] mt-1.5 leading-relaxed">🎯 {savedData!.drivingQuestion}</p>
                  )}
                </div>
                <div className="flex w-full max-w-sm gap-3">
                  <MD3Button
                    variant="filled"
                    tone="blue"
                    className="flex-1"
                    onClick={() => {
                      if (savedData!.fullResult) {
                        setResult(savedData!.fullResult as ProblemSituationResult)
                      }
                      setShowExistingChoice(false)
                    }}
                  >
                    기존 내용 사용하기
                  </MD3Button>
                  {isLeader && (
                    <MD3Button
                      variant="outlined"
                      tone="blue"
                      className="flex-1"
                      onClick={() => {
                        setShowExistingChoice(false)
                        generate()
                      }}
                    >
                      새로 생성하기
                    </MD3Button>
                  )}
                </div>
              </div>
            )}
            {isGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-14 h-14 flex items-center justify-center">
                    <CircleNotch size={56} className="animate-spin text-[var(--md-sys-primary)]" weight="bold" />
                    <PencilRuler size={22} weight="fill" className="absolute text-[var(--md-sys-primary)]" />
                  </div>
                  <div className="text-center">
                    <p className="text-[17px] font-extrabold text-[var(--md-sys-primary)]">문제상황 설계 중…</p>
                    <p className="text-[14px] text-[var(--md-sys-outline)] mt-1">후보 개요를 먼저 만든 뒤(약 20~30초) 후보별 상세를 이어서 채웁니다.</p>
                  </div>
                </div>
                <div className="w-full max-w-md rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container)] px-5 py-4 space-y-2.5">
                  {GEN_STEPS.map((label, i) => {
                    const done = i < genStep
                    const active = i === genStep
                    return (
                      <div key={i} className="flex items-center gap-2.5">
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                          done ? 'bg-[var(--md-sys-tertiary)] text-white'
                          : active ? 'bg-[var(--md-sys-primary)] text-white'
                          : 'bg-[var(--md-sys-outline-variant)] text-[var(--md-sys-outline)]'
                        }`}>
                          {done
                            ? <CheckCircle size={13} weight="fill" />
                            : active
                              ? <SpinnerGap size={12} className="animate-spin" weight="bold" />
                              : <span className="text-[12px] font-bold">{i + 1}</span>}
                        </span>
                        <span className={`text-[14px] leading-snug ${
                          done ? 'text-[var(--md-sys-on-surface-variant)]'
                          : active ? 'text-[var(--md-sys-primary)] font-bold'
                          : 'text-[var(--md-sys-outline)]'
                        }`}>
                          {label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* fullResult 없이 기존 내용 선택 → 확정 상태 안내 */}
            {!showExistingChoice && !isGenerating && !result && !generateError && currentData && (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
                <div className="w-10 h-10 rounded-full bg-[var(--md-sys-tertiary-container)] flex items-center justify-center">
                  <CheckCircle size={20} weight="fill" className="text-[var(--md-sys-tertiary)]" />
                </div>
                <div className="text-center">
                  <p className="text-[16px] font-semibold text-[var(--md-sys-on-surface)]">{currentData.scenario.title}</p>
                  <p className="text-[14px] text-[var(--md-sys-outline)] mt-1">기존 확정 내용이 로드되었습니다</p>
                </div>
                <div className="w-full max-w-md rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container)] px-4 py-3 text-[15px] text-[var(--md-sys-on-surface-variant)] leading-relaxed">
                  {currentData.scenario.row1}
                </div>
                <p className="text-[13px] text-[var(--md-sys-on-surface-variant)]">수정이 필요하면 오른쪽 채팅에서 요청하거나, 상단 재생성 버튼으로 새로 설계하세요.</p>
              </div>
            )}
            {generateError && !isGenerating && !showExistingChoice && (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
                <p className="text-[18px] font-medium text-[var(--md-sys-error)]">생성 실패</p>
                <p className="text-[16px] text-[var(--md-sys-on-surface-variant)]">{generateError}</p>
                <MD3Button variant="filled" tone="red" className="mt-2" icon={<ArrowClockwise size={MD3_ICON.sm} />} onClick={generate}>
                  다시 시도
                </MD3Button>
              </div>
            )}
            {result && !isGenerating && (
              <ResultView result={result} detailStatus={detailStatus} onRetryDetail={retryDetail} onSelect={setCurrentData} />
            )}
          </div>
        </div>

        {/* ── 오른쪽: 채팅 패널 ── */}
        <div className="w-80 flex-shrink-0 xl:w-[22rem] 2xl:w-[26rem] flex flex-col bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--md-sys-outline-variant)] flex-shrink-0">
            <h2 className="text-[16px] font-medium text-[var(--md-sys-on-surface)]">수정 채팅</h2>
            <p className="text-[13px] text-[var(--md-sys-on-surface-variant)] mt-0.5">아이디어 수정·선택·확정</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {chatMessages.length === 0 && !chatStreamingText && (
              <div className="text-[13px] text-[var(--md-sys-outline)] text-center mt-4 leading-relaxed px-2">
                결과를 보고 수정하고 싶은 내용을 입력하세요.<br /><br />
                <span className="text-[var(--md-sys-primary)]">&quot;저장해줘&quot;</span>라고 하면 채팅 내용을 반영한 시나리오로 산출물에 확정됩니다.
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-[var(--md-sys-radius-lg)] px-3 py-2 text-[15px] leading-relaxed ${
                  m.role === 'user' ? 'bg-[var(--md-sys-primary-container)] text-[var(--md-sys-on-primary-container)] rounded-br-[4px]' : 'bg-[var(--md-sys-surface-container-high)] text-[var(--md-sys-on-surface)] rounded-bl-[4px]'
                }`}>
                  <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={{
                    p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    ul: ({ children }) => <ul className="pl-3 list-disc space-y-0.5">{children}</ul>,
                    li: ({ children }) => <li>{children}</li>,
                  }}>{m.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {chatStreamingText && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-[var(--md-sys-radius-lg)] rounded-bl-[4px] px-3 py-2 text-[15px] leading-relaxed bg-[var(--md-sys-surface-container-high)] text-[var(--md-sys-on-surface)]">
                  <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={{
                    p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  }}>{cleanPsReady(chatStreamingText)}</ReactMarkdown>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          <div className="p-3 flex-shrink-0">
            <div className="flex items-end gap-1.5 rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-high)] py-1.5 pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-[var(--md-sys-primary)]">
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                placeholder="수정 요청 또는 '저장해줘'"
                rows={2}
                aria-label="수정 요청 입력"
                className="flex-1 bg-transparent resize-none py-1.5 text-[15px] text-[var(--md-sys-on-surface)] placeholder-[var(--md-sys-on-surface-variant)] outline-none leading-relaxed"
              />
              <MD3Button
                variant="filled"
                tone="blue"
                aria-label="보내기"
                onClick={sendChat}
                disabled={!chatInput.trim() || chatStreaming}
                icon={chatStreaming ? <SpinnerGap size={18} className="animate-spin" /> : <PaperPlaneRight size={18} weight="fill" />}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 하단 저장 바 */}
      {isLeader && (
        <div className="flex-shrink-0 bg-[var(--md-sys-surface-container)] px-4 py-3 sm:px-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {currentData ? (
              <button
                onClick={() => setShowDataModal(true)}
                className="flex h-8 items-center gap-1.5 truncate max-w-xs rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-tertiary-container)] px-3 text-[15px] font-medium text-[var(--md-sys-on-tertiary-container)] transition-opacity hover:opacity-90"
                title="확정 내용 전체 보기"
              >
                <ArrowsOut size={13} />
                <span className="truncate">&quot;{currentData.scenario.title}&quot; 확정됨 — 클릭해서 전체 보기</span>
              </button>
            ) : (
              <p className="text-[15px] text-[var(--md-sys-on-surface-variant)]">결과에서 &quot;이 후보를 산출물로 선택&quot; 버튼을 클릭하거나 채팅에서 &quot;저장해줘&quot;라고 하세요.</p>
            )}
          </div>
          <MD3Button
            variant="filled"
            tone="blue"
            onClick={handleSave}
            disabled={!currentData || isSaving}
            className="flex-shrink-0"
            icon={isSaving ? <SpinnerGap size={MD3_ICON.sm} className="animate-spin" /> : <FloppyDisk size={MD3_ICON.sm} weight="bold" />}
          >
            {isSaving ? '저장 중…' : '저장하고 산출물 작성'}
          </MD3Button>
        </div>
      )}

      {/* 확정 내용 전체 보기 모달 */}
      {showDataModal && currentData && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
          style={{ backdropFilter: 'blur(4px)' }}
          onClick={() => setShowDataModal(false)}
        >
          <div
            role="dialog" aria-modal="true"
            className="relative bg-[var(--md-sys-surface-container-low)] rounded-[var(--md-sys-radius-xl)] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
            style={{ boxShadow: '0 32px 64px rgba(0,0,0,0.28)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── 히어로 헤더 ── */}
            <div
              className="relative px-8 pt-8 pb-6 flex-shrink-0 overflow-hidden"
              style={{ background: 'var(--md-sys-tertiary-container)' }}
            >
              {/* 배경 패턴 */}
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-[var(--md-sys-radius-sm)] bg-[var(--md-sys-surface-container-lowest)] px-3 text-[14px] font-medium text-[var(--md-sys-on-tertiary-container)]">
                    <CheckCircle size={11} weight="fill" />
                    확정된 문제상황 · Ds-2
                  </span>
                  <button
                    onClick={() => setShowDataModal(false)}
                    aria-label="닫기"
                    className="p-2 rounded-full text-[var(--md-sys-on-tertiary-container)] hover:bg-black/5 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                <h2 className="text-[24px] font-normal text-[var(--md-sys-on-tertiary-container)] leading-snug" style={{ wordBreak: 'keep-all' }}>
                  {currentData.scenario.title}
                </h2>
              </div>
            </div>

            {/* ── 탐구 질문 배너 ── */}
            <div className="mx-6 -mt-3 mb-1 flex-shrink-0 relative z-10">
              <div className="rounded-[var(--md-sys-radius-lg)] bg-[var(--md-sys-surface-container-lowest)] px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-[var(--md-sys-tertiary)] flex items-center justify-center flex-shrink-0">
                    <PencilRuler size={13} weight="fill" className="text-white" />
                  </div>
                  <span className="text-[14px] font-medium text-[var(--md-sys-tertiary)]">탐구 질문 (Driving Question)</span>
                </div>
                <p className="text-[18px] font-medium text-[var(--md-sys-on-surface)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  {currentData.drivingQuestion}
                </p>
              </div>
            </div>

            {/* ── 본문 스크롤 영역 ── */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

              {/* 문제 상황 */}
              <div className="bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[var(--md-sys-surface-container)]">
                  <BookOpen size={15} weight="fill" className="text-[var(--md-sys-tertiary)] flex-shrink-0" />
                  <span className="text-[15px] font-medium text-[var(--md-sys-on-surface)]">문제 상황</span>
                </div>
                <div className="px-5 py-4">
                  <p className="text-[15px] text-[var(--md-sys-on-surface)] leading-[1.9]" style={{ wordBreak: 'keep-all' }}>
                    {currentData.scenario.row1}
                  </p>
                </div>
              </div>

              {/* 교과별 학습 내용 및 산출물 */}
              <div className="bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[var(--md-sys-surface-container)]">
                  <Users size={15} weight="fill" className="text-[var(--md-sys-secondary)] flex-shrink-0" />
                  <span className="text-[15px] font-medium text-[var(--md-sys-on-surface)]">교과별 학습 내용 및 산출물</span>
                </div>
                <div className="px-5 py-4 space-y-2">
                  {currentData.scenario.row2
                    .split(/\s*\/\s*(?=【|\[)|\n+/)
                    .map(s => s.trim()).filter(Boolean)
                    .map((item, i) => (
                      <p key={i} className="text-[15px] text-[var(--md-sys-on-surface-variant)] leading-[1.8]" style={{ wordBreak: 'keep-all' }}>
                        {item}
                      </p>
                    ))
                  }
                </div>
              </div>

              {/* 데이터 출처 */}
              <div className="bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[var(--md-sys-surface-container)]">
                  <Database size={15} weight="fill" className="text-[var(--md-sys-primary)] flex-shrink-0" />
                  <span className="text-[15px] font-medium text-[var(--md-sys-on-surface)]">데이터 출처</span>
                </div>
                <ol className="divide-y divide-[var(--md-sys-surface-container-high)]">
                  {currentData.scenario.row3
                    .split(/\s*\/\s*/)
                    .map(s => s.trim()).filter(Boolean)
                    .map((item, i) => (
                      <li key={i} className="flex items-start gap-3 px-5 py-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--md-sys-secondary-container)] flex items-center justify-center text-[13px] font-medium text-[var(--md-sys-on-secondary-container)] mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-[15px] text-[var(--md-sys-on-surface-variant)] leading-[1.8]" style={{ wordBreak: 'keep-all' }}>{item}</p>
                      </li>
                    ))
                  }
                </ol>
              </div>

              {/* 하위 탐구 질문 */}
              <div className="bg-[var(--md-sys-surface-container-lowest)] rounded-[var(--md-sys-radius-lg)] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[var(--md-sys-surface-container)]">
                  <MagnifyingGlass size={15} weight="fill" className="text-[var(--md-sys-primary)] flex-shrink-0" />
                  <span className="text-[15px] font-medium text-[var(--md-sys-on-surface)]">하위 탐구 질문 (Essential Questions)</span>
                </div>
                <ol className="divide-y divide-[var(--md-sys-surface-container-low)]">
                  {(currentData.essentialQuestions ?? []).map((q, i) => (
                    <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--md-sys-secondary-container)] flex items-center justify-center text-[13px] font-medium text-[var(--md-sys-on-secondary-container)] mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-[15px] text-[var(--md-sys-on-surface-variant)] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{q}</span>
                    </li>
                  ))}
                </ol>
              </div>

            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
