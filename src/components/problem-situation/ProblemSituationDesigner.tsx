'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { XIcon as X, ArrowClockwiseIcon as ArrowClockwise, PaperPlaneRightIcon as PaperPlaneRight, FloppyDiskIcon as FloppyDisk, SpinnerGapIcon as SpinnerGap, CheckCircleIcon as CheckCircle, ArrowsOutIcon as ArrowsOut, PencilRulerIcon as PencilRuler, BookOpenIcon as BookOpen, UsersIcon as Users, DatabaseIcon as Database, LightbulbIcon as Lightbulb, MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import type { ProblemSituationResult } from '@/app/api/problem-situation/generate/route'
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

// result → ProblemSituationData 매핑
function resultToSaveData(result: ProblemSituationResult): ProblemSituationData {
  const r = result.recommended
  return {
    scenario: {
      title: r.title,
      row1: r.fullScenario,
      row2: [r.learningContent, r.artifacts].filter(Boolean).join('\n\n산출물: '),
      row3: (r.realData ?? []).map(d => typeof d === 'string' ? d : d.label).join(' / '),
    },
    drivingQuestion: result.drivingQuestion,
    essentialQuestions: result.essentialQuestions,
    fullResult: result,  // 전체 결과 보존 → onSave에서 산출물 구조 그대로 저장
  }
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
  onSelect,
}: {
  result: ProblemSituationResult
  onSelect: (data: ProblemSituationData) => void
}) {
  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">

      {/* ① 문제 상황 후보 테이블 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 rounded-full bg-[#7C3AED]" />
          <h3 className="text-xs font-bold text-[#202124]">문제 상황 후보</h3>
        </div>
        <div className="rounded-xl border border-[#E8EAED] overflow-hidden">
          {/* 테이블 헤더 */}
          <div className="grid grid-cols-[2fr_4fr_2.5fr] bg-[#F3F0FF] border-b border-[#E8EAED]">
            <div className="px-3 py-2 text-[10px] font-bold text-[#7C3AED]">제목</div>
            <div className="px-3 py-2 text-[10px] font-bold text-[#7C3AED] border-l border-[#E8EAED]">문제 상황</div>
            <div className="px-3 py-2 text-[10px] font-bold text-[#7C3AED] border-l border-[#E8EAED]">데이터 출처</div>
          </div>
          {/* 후보 행 */}
          {result.candidates.map((c, i) => (
            <div
              key={i}
              className={`grid grid-cols-[2fr_4fr_2.5fr] border-b border-[#E8EAED] last:border-b-0 transition-colors ${
                result.recommended.index === i ? 'bg-[#FAF8FF]' : 'bg-white hover:bg-[#FAFAFA]'
              }`}
            >
              <div className="px-3 py-2.5 flex items-start gap-1.5">
                {result.recommended.index === i && (
                  <span className="mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-full bg-[#7C3AED] flex items-center justify-center">
                    <CheckCircle size={9} weight="fill" color="white" />
                  </span>
                )}
                <span className="text-[11px] font-semibold text-[#202124] leading-snug">{c.title}</span>
              </div>
              <div className="px-3 py-2.5 border-l border-[#E8EAED]">
                <p className="text-[11px] text-[#444] leading-relaxed">{c.scenario}</p>
              </div>
              <div className="px-3 py-2.5 border-l border-[#E8EAED]">
                <p className="text-[11px] text-[#666] leading-relaxed">{c.dataSources}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ② 선정 문제 상황 상세 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 rounded-full bg-[#1A73E8]" />
          <h3 className="text-xs font-bold text-[#202124]">선정 문제 상황</h3>
          <span className="text-[10px] text-[#7C3AED] bg-[#F3F0FF] px-2 py-0.5 rounded-full font-medium">
            {result.recommended.title}
          </span>
        </div>
        <div className="rounded-xl border border-[#E8EAED] bg-white overflow-hidden">
          {/* 전문 */}
          <div className="px-4 py-3 border-b border-[#E8EAED]">
            <p className="text-[12px] text-[#202124] leading-[1.8]" style={{ wordBreak: 'keep-all' }}>
              {result.recommended.fullScenario}
            </p>
          </div>

          {/* 성취기준 연결 */}
          {result.recommended.standardsAlignment?.length > 0 && (
            <div className="px-4 py-3 border-b border-[#E8EAED]">
              <div className="text-[10px] font-bold text-[#5F6368] mb-2 uppercase tracking-wide">성취기준 연결</div>
              <div className="space-y-2">
                {result.recommended.standardsAlignment.map((s, i) => (
                  <div key={i} className={`rounded-lg px-3 py-2.5 border ${s.isCenter
                    ? 'bg-[#FFF8E1] border-[#FFE082]'
                    : 'bg-[#F8F9FA] border-[#E8EAED]'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {s.isCenter && (
                        <span className="text-[9px] font-black bg-[#F9A825] text-white px-1.5 py-0.5 rounded-full">중심</span>
                      )}
                      <span className={`text-[11px] font-bold ${s.isCenter ? 'text-[#B06000]' : 'text-[#5F6368]'}`}>
                        [{s.standardId}]
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.isCenter ? 'bg-[#FFE082] text-[#B06000]' : 'bg-[#E8EAED] text-[#5F6368]'}`}>
                        {s.subject}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>{s.connection}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 실제 데이터 */}
          <div className="px-4 py-3 border-b border-[#E8EAED]">
            <div className="text-[10px] font-bold text-[#5F6368] mb-1.5 uppercase tracking-wide">실제 데이터</div>
            <ol className="space-y-1.5">
              {result.recommended.realData.map((d, i) => {
                const item = typeof d === 'string' ? { label: d, url: undefined } : d
                return (
                  <li key={i} className="flex gap-2 text-[11px] text-[#444] leading-relaxed">
                    <span className="flex-shrink-0 text-[#7C3AED] font-bold">{i + 1})</span>
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
          </div>

          {/* 학습 내용 */}
          <div className="px-4 py-3 border-b border-[#E8EAED]">
            <div className="text-[10px] font-bold text-[#5F6368] mb-1.5 uppercase tracking-wide">교과별 학습 내용</div>
            <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
              {result.recommended.learningContent}
            </p>
          </div>

          {/* 산출물 */}
          <div className="px-4 py-3 border-b border-[#E8EAED]">
            <div className="text-[10px] font-bold text-[#5F6368] mb-1.5 uppercase tracking-wide">산출물</div>
            <p className="text-[11px] text-[#444] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
              {result.recommended.artifacts}
            </p>
          </div>

          {/* AI 점검 */}
          <div className="px-4 py-3 bg-[#F3F0FF]">
            <div className="text-[10px] font-bold text-[#7C3AED] mb-1.5">AI 점검: 학습내용/산출물 반영 검토</div>
            <p className="text-[11px] text-[#5B21B6] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
              {result.recommended.alignmentCheck}
            </p>
          </div>
        </div>
      </section>

      {/* ③ 핵심 질문 & 탐구 질문 */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 rounded-full bg-[#059669]" />
          <h3 className="text-xs font-bold text-[#202124]">핵심 질문 & 탐구 질문</h3>
        </div>
        <div className="rounded-xl border border-[#E8EAED] bg-white overflow-hidden">
          {/* 핵심 질문 */}
          <div className="px-4 py-3 bg-[#F0FDF4] border-b border-[#E8EAED]">
            <div className="text-[10px] font-bold text-[#059669] mb-1">핵심 질문 (Driving Question)</div>
            <p className="text-[12px] font-semibold text-[#065F46] leading-relaxed" style={{ wordBreak: 'keep-all' }}>
              {result.drivingQuestion}
            </p>
          </div>
          {/* 탐구 질문 */}
          <div className="px-4 py-3">
            <div className="text-[10px] font-bold text-[#5F6368] mb-1.5">탐구 질문 (Essential Questions)</div>
            <ol className="space-y-1.5">
              {result.essentialQuestions.map((q, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-[#444] leading-relaxed">
                  <span className="flex-shrink-0 font-bold text-[#059669]">{i + 1}.</span>
                  <span style={{ wordBreak: 'keep-all' }}>{q}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* 선택 저장 버튼 */}
      <button
        onClick={() => { try { onSelect(resultToSaveData(result)) } catch (e) { console.error('[확정 버튼] resultToSaveData 오류:', e) } }}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1557B0] transition-colors"
      >
        <CheckCircle size={14} weight="fill" />
        이 시나리오로 확정
      </button>
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

  // ── 생성 ──────────────────────────────────────────
  const generate = useCallback(async () => {
    setIsGenerating(true)
    setGenerateError(null)
    setResult(null)
    try {
      const res = await fetch('/api/problem-situation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphSavedData: localGraphData,
          achievementStandardsAnalysis,
          evaluationPlan,
          learningObjective,
          learnerProfile,
          projectTitle,
          targetGradeGroup,
          targetSubjects,
        }),
      })
      if (!res.ok) throw new Error(`API 오류 ${res.status}`)
      const data = await res.json() as ProblemSituationResult
      if ('error' in data) throw new Error(String((data as {error:string}).error))
      setResult(data)
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : '생성 실패')
    } finally {
      setIsGenerating(false)
    }
  }, [localGraphData, achievementStandardsAnalysis, evaluationPlan, learningObjective, learnerProfile, projectTitle, targetGradeGroup, targetSubjects])

  // 기존 저장 내용이 없으면 자동 생성, 있으면 선택지 표시
  useEffect(() => {
    if (!savedData?.scenario?.title) { generate() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 채팅 자동 스크롤
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages, chatStreamingText])

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
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E8EAED] flex-shrink-0">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 bg-[#00897B] flex items-center justify-center flex-shrink-0"
            style={{ animation: 'morph-shape 9s ease-in-out infinite, stage-bounce 3.5s ease-in-out infinite', boxShadow: '0 6px 18px rgba(0,137,123,0.42)' }}
          >
            <PencilRuler size={24} weight="fill" className="text-white" />
          </div>
          <div>
            <div className="text-base font-bold text-[#202124]">문제상황 개발 워크숍</div>
            <div className="text-xs text-[#9AA0A6] mt-0.5">Ds-1-2 · Claude AI 에이전트가 교과 융합 문제상황을 설계합니다</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentData && (
            <span className="text-[11px] text-[#34A853] bg-[#E6F4EA] px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
              <CheckCircle size={11} weight="fill" /> 시나리오 확정됨
            </span>
          )}
          {isLeader && (
            <button
              onClick={() => { setShowExistingChoice(false); generate() }}
              disabled={isGenerating}
              className="flex items-center gap-1.5 text-xs text-[#5F6368] hover:text-[#1A73E8] px-3 py-1.5 rounded-lg hover:bg-[#F1F3F4] transition-colors disabled:opacity-40"
            >
              <ArrowClockwise size={14} className={isGenerating ? 'animate-spin' : ''} />
              재생성
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F1F3F4] text-[#5F6368] transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 본문 3-컬럼 */}
      <div className="flex-1 flex overflow-hidden gap-3 p-3">

        {/* ── 왼쪽: 노드 맵 ── */}
        <div className="w-72 flex-shrink-0 flex flex-col bg-white rounded-xl border border-[#E8EAED] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#E8EAED] flex-shrink-0">
            <div className="text-xs font-semibold text-[#444]">교과 융합 성취기준</div>
            <div className="text-[10px] text-[#9AA0A6] mt-0.5">A-2-1 지식 그래프에서 저장된 노드</div>
          </div>
          <NodeMap
            centerNode={localGraphData?.centerNode ?? null}
            selectedStandards={localGraphData?.selectedStandards ?? []}
          />
        </div>

        {/* ── 가운데: 결과 패널 ── */}
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-[#E8EAED] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#E8EAED] flex-shrink-0 bg-[#F3F0FF]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            <span className="text-xs font-semibold text-[#7C3AED]">Claude — 문제상황 설계 결과</span>
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
                      className="flex-1 py-2.5 rounded-xl bg-[#F3F0FF] text-[#7C3AED] text-sm font-semibold hover:bg-[#EDE9FE] transition-colors border border-[#C4B5FD]"
                    >
                      새로 생성하기
                    </button>
                  )}
                </div>
              </div>
            )}
            {isGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-[#9AA0A6]">
                <SpinnerGap size={32} className="animate-spin text-[#7C3AED]" />
                <div className="text-center">
                  <p className="text-sm font-medium text-[#7C3AED]">문제상황 설계 중</p>
                  <p className="text-xs text-[#9AA0A6] mt-1">성취기준·평가계획을 분석하여 최적의 아이디어를 생성합니다</p>
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
              <ResultView result={result} onSelect={setCurrentData} />
            )}
          </div>
        </div>

        {/* ── 오른쪽: 채팅 패널 ── */}
        <div className="w-72 flex-shrink-0 flex flex-col bg-white rounded-xl border border-[#E8EAED] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#E8EAED] flex-shrink-0">
            <div className="text-xs font-semibold text-[#444]">수정 채팅</div>
            <div className="text-[10px] text-[#9AA0A6] mt-0.5">아이디어 수정·선택·확정</div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {chatMessages.length === 0 && !chatStreamingText && (
              <div className="text-[11px] text-[#9AA0A6] text-center mt-4 leading-relaxed px-2">
                결과를 보고 수정하고 싶은 내용을 입력하세요.<br /><br />
                <span className="text-[#1A73E8]">"저장해줘"</span>라고 하면 채팅 내용을 반영한 시나리오로 산출물에 확정됩니다.
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

          <div className="p-2 border-t border-[#E8EAED] flex-shrink-0">
            <div className="flex items-end gap-1.5 bg-[#F8F9FA] rounded-xl border border-[#E8EAED] p-2">
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
        <div className="flex-shrink-0 bg-white border-t border-[#E8EAED] px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {currentData ? (
              <button
                onClick={() => setShowDataModal(true)}
                className="flex items-center gap-1.5 text-xs text-[#34A853] bg-[#E6F4EA] px-2.5 py-1.5 rounded-lg hover:bg-[#C8E6C9] transition-colors truncate max-w-xs"
                title="확정 내용 전체 보기"
              >
                <ArrowsOut size={13} />
                <span className="truncate">"{currentData.scenario.title}" 확정됨 — 클릭해서 전체 보기</span>
              </button>
            ) : (
              <p className="text-xs text-[#9AA0A6]">결과에서 "이 시나리오로 확정" 버튼을 클릭하거나 채팅에서 "저장해줘"라고 하세요.</p>
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

            {/* ── 핵심 질문 배너 ── */}
            <div className="mx-6 -mt-3 mb-1 flex-shrink-0 relative z-10">
              <div className="rounded-2xl bg-white border border-[#B2DFDB] shadow-md px-5 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-[#00897B] flex items-center justify-center flex-shrink-0">
                    <PencilRuler size={13} weight="fill" className="text-white" />
                  </div>
                  <span className="text-[10px] font-black text-[#00897B] uppercase tracking-widest">핵심 질문 (Driving Question)</span>
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

              {/* 탐구 질문 */}
              <div className="bg-white rounded-2xl border border-[#E8EAED] overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3 bg-[#FFF8E1] border-b border-[#FFE082]">
                  <MagnifyingGlass size={15} weight="fill" className="text-[#F9A825] flex-shrink-0" />
                  <span className="text-[11px] font-black text-[#B06000] uppercase tracking-wider">탐구 질문 (Essential Questions)</span>
                </div>
                <ol className="divide-y divide-[#F8F9FA]">
                  {currentData.essentialQuestions.map((q, i) => (
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
