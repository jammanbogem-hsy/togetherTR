'use client'

import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
type DetailStatus = 'loading' | 'error' | 'done'
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

// ─── PS_READY 신호 파싱 ───────────────────────────────
function parsePsReady(text: string): ProblemSituationData | null {
  const match = /\[PS_READY:\s*([^\]]+)\]/.exec(text)
  if (!match) return null
  const raw = match[1]
  const get = (key: string) => {
    const m = new RegExp(`${key}=([^|\\]]+)`).exec(raw)
    return m ? m[1].trim() : ''
  }
  return {
    scenario: { title: get('제목'), row1: get('행1'), row2: get('행2'), row3: get('행3') },
    drivingQuestion: get('핵심질문'),
    essentialQuestions: [get('탐구1'), get('탐구2'), get('탐구3')].filter(Boolean),
  }
}
function cleanPsReady(text: string) { return text.replace(/\[PS_READY:[^\]]+\]/g, '').trim() }

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
  labelColor = '#5F6368',
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
        <div className="text-[10px] font-bold mb-1.5 uppercase tracking-wide" style={{ color: labelColor }}>
          {label}
        </div>
      )}
      {children}
    </>
  )
  return (
    <div className={`relative group/zoom px-4 py-3 ${borderless ? '' : 'border-b border-[#DADCE0]'} ${bg ?? ''}`}>
      <button
        type="button"
        onClick={() => onZoom(label || '내용', body)}
        title="확대해서 보기"
        className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full border border-[#DADCE0] bg-white px-2 py-1 text-[10px] font-bold text-[#5F6368] shadow-sm opacity-0 transition-opacity group-hover/zoom:opacity-100 hover:bg-[#F1F3F4]"
      >
        <ArrowsOut size={11} weight="bold" /> 확대
      </button>
      {body}
    </div>
  )
}

// ─── 노드 맵 컴포넌트 ─────────────────────────────────
function NodeMap({ centerNode, selectedStandards }: {
  centerNode: GraphSavedData['centerNode']; selectedStandards: GraphSavedData['selectedStandards']
}) {
  const hasData = centerNode !== null || selectedStandards.length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#9AA0A6] text-xs text-center px-4 gap-2">
        <span className="text-2xl">🔍</span>
        <span className="leading-relaxed">지식 그래프 데이터가 없습니다.<br />A-2-1 단계에서 저장해 주세요.</span>
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
            <span className="text-[10px] font-semibold" style={{ color: subjectColor(centerNode.subjectId) }}>중심 성취기준 · {subjectName(centerNode.subjectId)}</span>
          </div>
          <div className="text-xs font-bold text-[#202124] leading-snug">[{shortStdId(centerNode.id)}]</div>
          <div className="text-xs text-[#444] leading-relaxed mt-0.5 line-clamp-3">{centerNode.text}</div>
        </div>
      )}
      {centerNode && bySubject.size === 0 && <div className="text-[10px] text-[#9AA0A6] text-center py-2">연결된 성취기준 없음</div>}
      {Array.from(bySubject.entries()).map(([subjId, nodes]) => (
        <div key={subjId} className="rounded-lg border p-2.5" style={{ borderColor: subjectColor(subjId) + '55', backgroundColor: subjectColor(subjId) + '0C' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: subjectColor(subjId) }} />
            <span className="text-[10px] font-semibold" style={{ color: subjectColor(subjId) }}>{subjectName(subjId)}</span>
            <span className="text-[10px] text-[#9AA0A6]">({nodes.length}개)</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {nodes.map(n => (
              <div key={n.id} className="bg-white rounded-md px-2 py-1.5 border border-[#E8EAED]">
                <div className="text-[10px] font-semibold text-[#444]">[{shortStdId(n.id)}]</div>
                <div className="text-[10px] text-[#666] leading-relaxed line-clamp-2 mt-0.5">{n.text}</div>
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
  const detailPending = selectedStatus === 'loading' || selectedStatus === 'error'
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
        <p className="text-sm font-bold text-[#5F6368]">생성된 문제 상황 후보가 없습니다.</p>
        <p className="text-[12px] text-[#9AA0A6]">다시 생성하거나 공동 편집에서 직접 작성해 주세요.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">

      {/* ① 문제 상황 후보 — 책갈피 탭 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 rounded-full bg-[#1A73E8]" />
          <h3 className="text-xs font-bold text-[#202124]">문제 상황 후보</h3>
          <span className="text-[10px] text-[#9AA0A6]">({candidates.length}개 · 하나만 산출물로 선택)</span>
          {anyDetailLoading && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-[#1967D2] bg-[#E8F0FE] px-2 py-0.5 rounded-full">
              <SpinnerGap size={10} className="animate-spin" weight="bold" /> 후보 상세 생성 중 {detailDoneCount}/{candidates.length}
            </span>
          )}
        </div>
        <div className="flex items-end gap-1 border-b border-[#DADCE0]">
          {candidates.map((c, i) => {
            const active = selectedIndex === i
            const committed = committedIndex === i
            return (
              <button
                key={i}
                onClick={() => setSelectedIndex(i)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-[11px] font-semibold transition-colors -mb-px border-b-2 ${
                  active
                    ? 'bg-[#E8F0FE] text-[#1A73E8] border-[#1A73E8]'
                    : 'bg-transparent text-[#5F6368] border-transparent hover:bg-[#F1F3F4]'
                }`}
              >
                <span className={`flex-shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center border ${
                  committed ? 'bg-[#1A73E8] border-[#1A73E8]' : active ? 'border-[#1A73E8]' : 'border-[#9AA0A6]'
                }`}>
                  {committed && <CheckCircle size={9} weight="fill" color="white" />}
                </span>
                <span className="leading-snug max-w-[150px] truncate">{c.title}</span>
                {result.recommended?.index === i && !committed && (
                  <span className="flex-shrink-0 text-[9px] font-bold text-[#1A73E8] bg-white border border-[#AECBFA] px-1 py-px rounded">추천</span>
                )}
              </button>
            )
          })}
        </div>
        {/* 선택 후보 요약 + 선택 CTA */}
        <div className="rounded-b-xl border border-t-0 border-[#DADCE0] bg-white px-4 py-3">
          <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{selected?.scenario}</p>
          {selected?.dataSources && (
            <p className="text-[10px] text-[#5F6368] leading-relaxed mt-1.5">
              <span className="font-bold text-[#1967D2]">데이터 출처</span> · {selected.dataSources}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {isCommitted ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#137333] bg-[#E6F4EA] border border-[#A8D5B5] px-3 py-1.5 rounded-full">
                <CheckCircle size={13} weight="fill" /> 이 후보가 산출물로 선택됨
              </span>
            ) : (
              <button
                type="button"
                onClick={commitSelected}
                disabled={detailPending}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#1A73E8] hover:bg-[#1557B0] px-3 py-1.5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle size={13} weight="fill" /> 이 후보를 산출물로 선택
              </button>
            )}
            <span className="text-[10px] text-[#9AA0A6]">
              {detailPending ? '상세 생성이 끝나면 선택할 수 있습니다' : '산출물에는 선택한 1개 후보만 저장됩니다'}
            </span>
          </div>
        </div>
      </section>

      {/* ② 선정 문제 상황 상세 (선택 후보 기준) */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 rounded-full bg-[#1A73E8]" />
          <h3 className="text-xs font-bold text-[#202124]">선정 문제 상황</h3>
          <span className="text-[10px] text-[#1967D2] bg-[#E8F0FE] px-2 py-0.5 rounded-full font-medium">
            {selected?.title}
          </span>
          {isCommitted && (
            <span className="text-[10px] text-white bg-[#137333] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <CheckCircle size={9} weight="fill" /> 선택됨
            </span>
          )}
          {isRecommended && !isCommitted && (
            <span className="text-[10px] text-[#1A73E8] bg-white border border-[#AECBFA] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              AI 추천
            </span>
          )}
        </div>

        {detail == null ? (
          <div className="rounded-2xl border border-[#DADCE0] bg-white overflow-hidden">
            {selectedStatus === 'loading' ? (
              <div className="px-4 py-3 bg-[#E8F0FE] border-b border-[#DADCE0] flex items-center gap-2">
                <SpinnerGap size={14} className="animate-spin text-[#1A73E8] flex-shrink-0" weight="bold" />
                <p className="text-[11px] text-[#1967D2] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  이 후보의 상세(문제 상황 전문·성취기준 연결·실제 자료·산출물·AI 점검)를 생성하고 있습니다. 약 30초 정도 걸립니다.
                </p>
              </div>
            ) : selectedStatus === 'error' ? (
              <div className="px-4 py-3 bg-[#FCE8E6] border-b border-[#DADCE0] flex items-center gap-2 flex-wrap">
                <p className="text-[11px] text-[#C5221F] leading-relaxed flex-1 min-w-0" style={{ wordBreak: 'keep-all' }}>
                  이 후보의 상세 생성에 실패했습니다. 다른 후보에는 영향이 없습니다.
                </p>
                <button
                  type="button"
                  onClick={() => onRetryDetail(selectedIndex)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-[#C5221F] hover:bg-[#A50E0E] px-3 py-1 rounded-full transition-colors"
                >
                  <ArrowClockwise size={12} weight="bold" /> 이 후보 상세 다시 생성
                </button>
              </div>
            ) : (
              <div className="px-4 py-3 bg-[#FEF7E0] border-b border-[#DADCE0]">
                <p className="text-[11px] text-[#B06000] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  이 후보는 요약만 생성되었습니다. &lsquo;재생성&rsquo;하면 모든 후보의 상세를 받을 수 있습니다.
                </p>
              </div>
            )}
            <Block label="문제 상황 요약" onZoom={openZoom}>
              <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{selected?.scenario}</p>
            </Block>
            <Block label="데이터 출처" borderless onZoom={openZoom}>
              <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{selected?.dataSources}</p>
            </Block>
          </div>
        ) : (
          <div className="rounded-2xl border border-[#DADCE0] bg-white overflow-hidden">
            <Block label="문제 상황 전문" onZoom={openZoom}>
              <p className="text-[12px] text-[#202124] leading-[1.8]" style={{ wordBreak: 'keep-all' }}>
                {detail.fullScenario}
              </p>
            </Block>

            {detail.standardsAlignment?.length > 0 && (
              <Block label="성취기준 연결" onZoom={openZoom}>
                <div className="space-y-2">
                  {detail.standardsAlignment.map((s, i) => (
                    <div key={i} className={`rounded-lg px-3 py-2.5 border ${s.isCenter
                      ? 'bg-[#E8F0FE] border-[#C5CAE9]'
                      : 'bg-[#F8F9FA] border-[#DADCE0]'}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        {s.isCenter && (
                          <span className="text-[9px] font-black bg-[#1A73E8] text-white px-1.5 py-0.5 rounded-full">중심</span>
                        )}
                        <span className={`text-[11px] font-bold ${s.isCenter ? 'text-[#1557B0]' : 'text-[#5F6368]'}`}>
                          [{s.standardId}]
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.isCenter ? 'bg-[#C5CAE9] text-[#1557B0]' : 'bg-[#E8EAED] text-[#5F6368]'}`}>
                          {s.subject}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{s.connection}</p>
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
                    <li key={i} className="flex gap-2 text-[11px] text-[#444] leading-relaxed">
                      <span className="flex-shrink-0 text-[#1A73E8] font-bold">{i + 1})</span>
                      <span className="flex-1">
                        {item.label}
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-[#1A73E8] hover:underline font-medium">
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
              <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                {orPending(detail.learningContent)}
              </p>
            </Block>

            <Block label="산출물" onZoom={openZoom}>
              <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                {orPending(detail.artifacts)}
              </p>
            </Block>

            <Block label="AI 점검: 학습내용/산출물 반영 검토" labelColor="#1967D2" bg="bg-[#E8F0FE]" borderless onZoom={openZoom}>
              <p className="text-[11px] text-[#1967D2] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                {orPending(detail.alignmentCheck)}
              </p>
            </Block>
          </div>
        )}
      </section>

      {/* ③ 탐구 질문 & 하위 탐구 질문 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 rounded-full bg-[#059669]" />
          <h3 className="text-xs font-bold text-[#202124]">탐구 질문 &amp; 하위 탐구 질문</h3>
        </div>
        <div className="rounded-2xl border border-[#DADCE0] bg-white overflow-hidden">
          {hasQuestions ? (
            <>
              <Block label="탐구 질문 (Driving Question)" labelColor="#059669" bg="bg-[#F0FDF4]" onZoom={openZoom}>
                <p className="text-[13px] font-semibold text-[#065F46] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  {result.drivingQuestion || '— (생성되지 않음, 재생성 권장)'}
                </p>
              </Block>
              <Block label="하위 탐구 질문 (Essential Questions)" borderless onZoom={openZoom}>
                {essentials.length > 0 ? (
                  <ol className="space-y-1.5">
                    {essentials.map((q, i) => (
                      <li key={i} className="flex gap-2 text-[12px] text-[#444] leading-relaxed">
                        <span className="flex-shrink-0 font-bold text-[#059669]">{i + 1}.</span>
                        <span style={{ wordBreak: 'keep-all' }}>{q}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[11px] text-[#9AA0A6]">하위 탐구 질문이 생성되지 않았습니다. 상단 &lsquo;재생성&rsquo;을 눌러 다시 시도하세요.</p>
                )}
              </Block>
            </>
          ) : (
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2 text-center bg-[#FEF7E0]">
              <p className="text-[12px] font-bold text-[#B06000]">탐구 질문·하위 탐구 질문이 생성되지 않았습니다</p>
              <p className="text-[11px] text-[#B06000]/80 leading-relaxed">AI 응답이 잘렸을 수 있습니다. 상단 우측 &lsquo;재생성&rsquo; 버튼을 눌러 다시 생성하면 탐구 질문과 하위 탐구 질문이 함께 채워집니다.</p>
            </div>
          )}
        </div>
      </section>

      {/* 선택 저장 버튼 — 선택된(현재 보고 있는) 후보를 산출물 후보로 확정 */}
      <button
        onClick={commitSelected}
        className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold transition-colors ${
          isCommitted
            ? 'bg-[#E6F4EA] text-[#137333] border border-[#A8D5B5] cursor-default'
            : 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
        }`}
      >
        <CheckCircle size={14} weight="fill" />
        {isCommitted ? `‘${selected?.title ?? ''}’ 후보 선택됨` : '이 후보를 산출물로 선택'}
      </button>

      {/* 섹션 확대 보기 모달 */}
      {zoom && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4" onClick={() => setZoom(null)}>
          <div
            className="bg-white w-full max-w-[860px] max-h-[88vh] rounded-[18px] shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-[#DADCE0] bg-white">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] px-3 py-1.5 text-[12px] font-extrabold text-[#1A73E8]">
                <ArrowsOut size={13} weight="bold" /> 확대 보기
              </span>
              <span className="text-[14px] font-extrabold text-[#202124] truncate">{zoom.title}</span>
              <button
                type="button"
                onClick={() => setZoom(null)}
                className="ml-auto w-9 h-9 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] flex items-center justify-center transition-colors"
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
  useEffect(() => {
    // onSnapshot: 컴포넌트가 열려 있는 동안 Firestore 변경을 실시간으로 반영
    const unsub = onSnapshot(doc(db, 'projects', projectId), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        const gd = d?.graphSavedData
        // graphSavedData 필드가 존재하고 선택된 성취기준 또는 중심 노드가 있으면 유효
        const hasCenter = gd?.centerNode != null
        const hasStandards = Array.isArray(gd?.selectedStandards) && gd.selectedStandards.length > 0
        if (gd && (hasCenter || hasStandards)) {
          setLocalGraphData(gd)
        }
      }
    }, (err) => console.error('[ProblemSituationDesigner] onSnapshot 오류:', err))
    return () => unsub()
  }, [projectId])

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
    targetSubjects,
  }), [localGraphData, achievementStandardsAnalysis, evaluationPlan, learningObjective, learnerProfile, projectTitle, targetGradeGroup, targetSubjects])

  // 후보 하나의 상세를 두 조각(scenario / plan)으로 동시에 요청해 결과에 병합한다.
  // 조각이 도착하는 대로 화면에 채우고, 둘 다 성공해야 'done'. gen이 바뀌었으면(재생성) 늦은 응답은 버린다.
  const loadCandidateDetail = useCallback(async (outline: ProblemSituationResult, index: number, gen: number) => {
    setDetailStatus(prev => ({ ...prev, [index]: 'loading' }))
    const body = buildRequestBody()
    const results = await Promise.allSettled(DETAIL_PARTS.map(async part => {
      const { detail } = await postGenerate<{ index: number; part: DetailPart; detail: Partial<ProblemCandidateDetail> }>({
        ...body,
        phase: 'detail',
        candidateIndex: index,
        part,
        outline,
      })
      if (gen !== generationRef.current) return
      setResult(prev => (prev ? applyCandidateDetail(prev, index, detail) : prev))
    }))
    if (gen !== generationRef.current) return
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed.length > 0) {
      console.error(`[ProblemSituationDesigner] 후보 ${index + 1} 상세 생성 실패:`, failed.map(f => f.reason))
      setDetailStatus(prev => ({ ...prev, [index]: 'error' }))
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
    <div className="fixed inset-0 z-50 bg-[#F8F9FA] flex flex-col" style={{ fontFamily: 'inherit' }}>
      {/* 헤더 — 공동 편집 모달과 톤 통일 */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-[#DADCE0] flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowStandards(v => !v)}
          title={showStandards ? '성취기준 사이드바 접기' : '성취기준 사이드바 펼치기'}
          className="w-9 h-9 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] flex items-center justify-center transition-colors"
        >
          <SidebarSimple size={18} weight={showStandards ? 'fill' : 'regular'} />
        </button>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#E8EAED] bg-white px-3 py-2 text-[12px] font-extrabold text-[#3C4043] shadow-sm">
          <FileText size={15} weight="bold" />
          Ds-1-2
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold text-[#202124] leading-tight">문제상황 개발 워크숍</div>
          <div className="text-[11px] text-[#9AA0A6] mt-0.5 truncate">Claude AI 에이전트가 교과 융합 문제상황을 설계합니다</div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {currentData && (
            <span className="text-[11px] text-[#1A73E8] bg-[#E8F0FE] px-2.5 py-1.5 rounded-full font-bold flex items-center gap-1">
              <CheckCircle size={11} weight="fill" /> 시나리오 확정됨
            </span>
          )}
          {isLeader && (
            <button
              onClick={() => { setShowExistingChoice(false); generate() }}
              disabled={isGenerating}
              className="flex items-center gap-1.5 text-[12px] font-bold text-[#5F6368] hover:text-[#1A73E8] px-3 py-1.5 rounded-full hover:bg-[#F1F3F4] transition-colors disabled:opacity-40"
            >
              <ArrowClockwise size={14} className={isGenerating ? 'animate-spin' : ''} />
              재생성
            </button>
          )}
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] flex items-center justify-center transition-colors" aria-label="닫기">
            <X size={18} weight="bold" />
          </button>
        </div>
      </div>

      {/* 본문 3-컬럼 */}
      <div className="flex-1 flex overflow-hidden gap-3 p-3">

        {/* ── 왼쪽: 노드 맵 (접기/펼치기) ── */}
        {showStandards ? (
          <div className="w-72 flex-shrink-0 flex flex-col bg-white rounded-xl border border-[#DADCE0] overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[#DADCE0] flex-shrink-0 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-[#202124]">교과 융합 성취기준</div>
                <div className="text-[10px] text-[#9AA0A6] mt-0.5">A-2-1 지식 그래프에서 저장된 노드</div>
              </div>
              <button
                type="button"
                onClick={() => setShowStandards(false)}
                title="사이드바 접기"
                className="w-7 h-7 rounded-full hover:bg-[#F1F3F4] text-[#9AA0A6] hover:text-[#5F6368] flex items-center justify-center transition-colors flex-shrink-0"
              >
                <SidebarSimple size={15} weight="fill" />
              </button>
            </div>
            <NodeMap
              centerNode={localGraphData?.centerNode ?? null}
              selectedStandards={localGraphData?.selectedStandards ?? []}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowStandards(true)}
            title="성취기준 사이드바 펼치기"
            className="w-8 flex-shrink-0 flex flex-col items-center justify-center gap-2 bg-white rounded-xl border border-[#DADCE0] text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#1A73E8] transition-colors"
          >
            <CaretRight size={14} weight="bold" />
            <span className="text-[10px] font-bold tracking-wide" style={{ writingMode: 'vertical-rl' }}>성취기준</span>
          </button>
        )}

        {/* ── 가운데: 결과 패널 ── */}
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-[#DADCE0] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#DADCE0] flex-shrink-0 bg-[#E8F0FE]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#1A73E8]" />
            <span className="text-xs font-bold text-[#1967D2]">Claude — 문제상황 설계 결과</span>
            {isGenerating && (
              <span className="ml-auto text-[10px] text-[#9AA0A6] flex items-center gap-1">
                <SpinnerGap size={11} className="animate-spin" /> 분석 중…
              </span>
            )}
            {result && !isGenerating && (
              <span className="ml-auto text-[10px] text-[#34A853]">완료</span>
            )}
            {generateError && <span className="ml-auto text-[10px] text-[#EA4335]">오류</span>}
          </div>

          <div className="flex-1 overflow-hidden">
            {/* 기존 저장 내용 선택지 */}
            {showExistingChoice && !isGenerating && !result && (
              <div className="flex flex-col items-center justify-center h-full gap-5 px-8">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-[#E6F4EA] flex items-center justify-center mx-auto mb-3">
                    <CheckCircle size={24} weight="fill" className="text-[#34A853]" />
                  </div>
                  <p className="text-sm font-semibold text-[#202124]">이전에 저장된 설계 내용이 있습니다</p>
                  <p className="text-xs text-[#9AA0A6] mt-1.5">기존 내용을 불러오거나 새로 생성할 수 있습니다</p>
                </div>
                <div className="w-full max-w-sm bg-[#F8F9FA] rounded-xl border border-[#E8EAED] px-4 py-3">
                  <p className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-wide mb-1">이전 저장 제목</p>
                  <p className="text-sm font-semibold text-[#202124]">{savedData!.scenario.title}</p>
                  {savedData!.drivingQuestion && (
                    <p className="text-[11px] text-[#5F6368] mt-1.5 leading-relaxed">🎯 {savedData!.drivingQuestion}</p>
                  )}
                </div>
                <div className="flex gap-3 w-full max-w-sm">
                  <button
                    onClick={() => {
                      if (savedData!.fullResult) {
                        setResult(savedData!.fullResult as ProblemSituationResult)
                      }
                      setShowExistingChoice(false)
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-[#E6F4EA] text-[#34A853] text-sm font-semibold hover:bg-[#D4EDDA] transition-colors border border-[#A8D5B5]"
                  >
                    기존 내용 사용하기
                  </button>
                  {isLeader && (
                    <button
                      onClick={() => {
                        setShowExistingChoice(false)
                        generate()
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-[#E8F0FE] text-[#1967D2] text-sm font-semibold hover:bg-[#D2E3FC] transition-colors border border-[#C5CAE9]"
                    >
                      새로 생성하기
                    </button>
                  )}
                </div>
              </div>
            )}
            {isGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-14 h-14 flex items-center justify-center">
                    <CircleNotch size={56} className="animate-spin text-[#1A73E8]" weight="bold" />
                    <PencilRuler size={22} weight="fill" className="absolute text-[#1A73E8]" />
                  </div>
                  <div className="text-center">
                    <p className="text-[15px] font-extrabold text-[#1967D2]">문제상황 설계 중…</p>
                    <p className="text-[12px] text-[#9AA0A6] mt-1">후보 개요를 먼저 만든 뒤(약 20~30초) 후보별 상세를 이어서 채웁니다.</p>
                  </div>
                </div>
                <div className="w-full max-w-md bg-[#F8F9FA] rounded-2xl border border-[#DADCE0] px-5 py-4 space-y-2.5">
                  {GEN_STEPS.map((label, i) => {
                    const done = i < genStep
                    const active = i === genStep
                    return (
                      <div key={i} className="flex items-center gap-2.5">
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                          done ? 'bg-[#34A853] text-white'
                          : active ? 'bg-[#1A73E8] text-white'
                          : 'bg-[#E8EAED] text-[#9AA0A6]'
                        }`}>
                          {done
                            ? <CheckCircle size={13} weight="fill" />
                            : active
                              ? <SpinnerGap size={12} className="animate-spin" weight="bold" />
                              : <span className="text-[10px] font-bold">{i + 1}</span>}
                        </span>
                        <span className={`text-[12px] leading-snug ${
                          done ? 'text-[#5F6368]'
                          : active ? 'text-[#1967D2] font-bold'
                          : 'text-[#9AA0A6]'
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
                <div className="w-10 h-10 rounded-full bg-[#E6F4EA] flex items-center justify-center">
                  <CheckCircle size={20} weight="fill" className="text-[#34A853]" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#202124]">{currentData.scenario.title}</p>
                  <p className="text-xs text-[#9AA0A6] mt-1">기존 확정 내용이 로드되었습니다</p>
                </div>
                <div className="w-full max-w-md bg-[#F8F9FA] rounded-xl border border-[#E8EAED] px-4 py-3 text-[12px] text-[#444] leading-relaxed">
                  {currentData.scenario.row1}
                </div>
                <p className="text-[11px] text-[#5F6368]">수정이 필요하면 오른쪽 채팅에서 요청하거나, 상단 재생성 버튼으로 새로 설계하세요.</p>
              </div>
            )}
            {generateError && !isGenerating && !showExistingChoice && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-[#EA4335]">
                <p className="text-sm font-medium">생성 실패</p>
                <p className="text-xs text-[#9AA0A6]">{generateError}</p>
                <button onClick={generate} className="mt-2 px-4 py-1.5 rounded-lg bg-[#EA4335] text-white text-xs hover:bg-[#C62828] transition-colors">
                  다시 시도
                </button>
              </div>
            )}
            {result && !isGenerating && (
              <ResultView result={result} detailStatus={detailStatus} onRetryDetail={retryDetail} onSelect={setCurrentData} />
            )}
          </div>
        </div>

        {/* ── 오른쪽: 채팅 패널 ── */}
        <div className="w-72 flex-shrink-0 flex flex-col bg-white rounded-xl border border-[#DADCE0] overflow-hidden">
          <div className="px-3 py-2.5 border-b border-[#DADCE0] flex-shrink-0">
            <div className="text-xs font-bold text-[#202124]">수정 채팅</div>
            <div className="text-[10px] text-[#9AA0A6] mt-0.5">아이디어 수정·선택·확정</div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {chatMessages.length === 0 && !chatStreamingText && (
              <div className="text-[11px] text-[#9AA0A6] text-center mt-4 leading-relaxed px-2">
                결과를 보고 수정하고 싶은 내용을 입력하세요.<br /><br />
                <span className="text-[#1A73E8]">&quot;저장해줘&quot;</span>라고 하면 채팅 내용을 반영한 시나리오로 산출물에 확정됩니다.
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'user' ? 'bg-[#1A73E8] text-white rounded-br-sm' : 'bg-[#F1F3F4] text-[#202124] rounded-bl-sm'
                }`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
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
                <div className="max-w-[90%] rounded-xl rounded-bl-sm px-3 py-2 text-xs leading-relaxed bg-[#F1F3F4] text-[#202124]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                    p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  }}>{chatStreamingText}</ReactMarkdown>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          <div className="p-2 border-t border-[#DADCE0] flex-shrink-0">
            <div className="flex items-end gap-1.5 bg-[#F8F9FA] rounded-xl border border-[#DADCE0] p-2">
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                placeholder="수정 요청 또는 '저장해줘'"
                rows={2}
                className="flex-1 bg-transparent resize-none text-xs text-[#202124] placeholder-[#9AA0A6] outline-none leading-relaxed"
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim() || chatStreaming}
                className="p-1.5 rounded-lg bg-[#1A73E8] text-white disabled:opacity-40 hover:bg-[#1557B0] transition-colors flex-shrink-0"
              >
                {chatStreaming ? <SpinnerGap size={14} className="animate-spin" /> : <PaperPlaneRight size={14} weight="fill" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 하단 저장 바 */}
      {isLeader && (
        <div className="flex-shrink-0 bg-white border-t border-[#DADCE0] px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {currentData ? (
              <button
                onClick={() => setShowDataModal(true)}
                className="flex items-center gap-1.5 text-xs text-[#34A853] bg-[#E6F4EA] px-2.5 py-1.5 rounded-lg hover:bg-[#C8E6C9] transition-colors truncate max-w-xs"
                title="확정 내용 전체 보기"
              >
                <ArrowsOut size={13} />
                <span className="truncate">&quot;{currentData.scenario.title}&quot; 확정됨 — 클릭해서 전체 보기</span>
              </button>
            ) : (
              <p className="text-xs text-[#9AA0A6]">결과에서 &quot;이 시나리오로 확정&quot; 버튼을 클릭하거나 채팅에서 &quot;저장해줘&quot;라고 하세요.</p>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={!currentData || isSaving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-[#1A73E8] text-white hover:bg-[#1557B0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {isSaving
              ? <><SpinnerGap size={15} className="animate-spin" />저장 중…</>
              : <><FloppyDisk size={15} weight="bold" />저장하고 산출물 작성</>
            }
          </button>
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
            className="relative bg-[#F8F9FA] rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
            style={{ boxShadow: '0 32px 64px rgba(0,0,0,0.28)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── 히어로 헤더 ── */}
            <div
              className="relative px-8 pt-8 pb-6 flex-shrink-0 overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #00695C 0%, #00897B 60%, #26A69A 100%)' }}
            >
              {/* 배경 패턴 */}
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: 'radial-gradient(circle at 80% 20%, white 1px, transparent 1px), radial-gradient(circle at 20% 80%, white 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }} />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#B2DFDB] bg-white/20 px-3 py-1 rounded-full tracking-wider uppercase">
                    <CheckCircle size={11} weight="fill" />
                    확정된 문제상황 · Ds-1-2
                  </span>
                  <button
                    onClick={() => setShowDataModal(false)}
                    className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/20 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                <h2 className="text-[22px] font-black text-white leading-snug" style={{ wordBreak: 'keep-all' }}>
                  {currentData.scenario.title}
                </h2>
              </div>
            </div>

            {/* ── 탐구 질문 배너 ── */}
            <div className="mx-6 -mt-3 mb-1 flex-shrink-0 relative z-10">
              <div className="rounded-2xl bg-white border border-[#B2DFDB] shadow-md px-5 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-[#00897B] flex items-center justify-center flex-shrink-0">
                    <PencilRuler size={13} weight="fill" className="text-white" />
                  </div>
                  <span className="text-[10px] font-black text-[#00897B] uppercase tracking-widest">탐구 질문 (Driving Question)</span>
                </div>
                <p className="text-[15px] font-bold text-[#004D40] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
                  {currentData.drivingQuestion}
                </p>
              </div>
            </div>

            {/* ── 본문 스크롤 영역 ── */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

              {/* 문제 상황 */}
              <div className="bg-white rounded-2xl border border-[#E8EAED] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[#E0F2F1] border-b border-[#B2DFDB]">
                  <BookOpen size={15} weight="fill" className="text-[#00897B] flex-shrink-0" />
                  <span className="text-[11px] font-black text-[#00695C] uppercase tracking-wider">문제 상황</span>
                </div>
                <div className="px-5 py-4">
                  <p className="text-[13px] text-[#202124] leading-[1.9]" style={{ wordBreak: 'keep-all' }}>
                    {currentData.scenario.row1}
                  </p>
                </div>
              </div>

              {/* 교과별 학습 내용 및 산출물 */}
              <div className="bg-white rounded-2xl border border-[#E8EAED] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[#F3E5F5] border-b border-[#E1BEE7]">
                  <Users size={15} weight="fill" className="text-[#7B1FA2] flex-shrink-0" />
                  <span className="text-[11px] font-black text-[#6A1B9A] uppercase tracking-wider">교과별 학습 내용 및 산출물</span>
                </div>
                <div className="px-5 py-4 space-y-2">
                  {currentData.scenario.row2
                    .split(/\s*\/\s*(?=【|\[)|\n+/)
                    .map(s => s.trim()).filter(Boolean)
                    .map((item, i) => (
                      <p key={i} className="text-[13px] text-[#444] leading-[1.8]" style={{ wordBreak: 'keep-all' }}>
                        {item}
                      </p>
                    ))
                  }
                </div>
              </div>

              {/* 데이터 출처 */}
              <div className="bg-white rounded-2xl border border-[#E8EAED] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[#E8F0FE] border-b border-[#C5CAE9]">
                  <Database size={15} weight="fill" className="text-[#1A73E8] flex-shrink-0" />
                  <span className="text-[11px] font-black text-[#1557B0] uppercase tracking-wider">데이터 출처</span>
                </div>
                <ol className="divide-y divide-[#F1F3F4]">
                  {currentData.scenario.row3
                    .split(/\s*\/\s*/)
                    .map(s => s.trim()).filter(Boolean)
                    .map((item, i) => (
                      <li key={i} className="flex items-start gap-3 px-5 py-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#E8F0FE] border border-[#C5CAE9] flex items-center justify-center text-[10px] font-black text-[#1A73E8] mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-[13px] text-[#444] leading-[1.8]" style={{ wordBreak: 'keep-all' }}>{item}</p>
                      </li>
                    ))
                  }
                </ol>
              </div>

              {/* 하위 탐구 질문 */}
              <div className="bg-white rounded-2xl border border-[#E8EAED] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[#FFF8E1] border-b border-[#FFE082]">
                  <MagnifyingGlass size={15} weight="fill" className="text-[#F9A825] flex-shrink-0" />
                  <span className="text-[11px] font-black text-[#B06000] uppercase tracking-wider">하위 탐구 질문 (Essential Questions)</span>
                </div>
                <ol className="divide-y divide-[#F8F9FA]">
                  {(currentData.essentialQuestions ?? []).map((q, i) => (
                    <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#FFF8E1] border border-[#FFE082] flex items-center justify-center text-[10px] font-black text-[#F9A825] mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-[13px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{q}</span>
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
