'use client'

/**
 * 교육과정 매핑 테스트 라우트 (/dev/curriculum-map)
 *
 * 목적: 수업 주제를 입력하면 같은 입력으로 두 판정기를 동시에 돌려 나란히 비교한다.
 *   좌: 기존 "AI 자동 채우기" API (/api/curriculum-sheet/autofill, OpenAI 임베딩 유사도)
 *   우: Jev(TypeSafe System One) 판단 패킷 (/api/curriculum-sheet/jev, 확률·confidence)
 * 로그인·프로젝트 없이 열리며, UI는 검증용으로만 최소 구성.
 * 상단 단계 표시는 에이전트가 지금 무엇을 하는지 보여준다 (기존 호출 → Jev 호출 → 비교).
 */

import { useMemo, useState } from 'react'

const SUBJECTS = ['국어', '수학', '과학', '사회', '도덕', '미술', '음악', '체육', '영어', '실과'] as const
const GRADE_GROUPS = ['초1-2', '초3-4', '초5-6'] as const
const SEP = ' | '

// ── 기존(autofill) 응답 형태 ─────────────────────────────────────────────
interface CoreIdeaOption {
  subject: string
  coreIdeaId: string
  area: string
  idea: string
  score: number
  standardsCount: number
  sampleStandards: string[]
}

interface CoreIdeaProposal {
  subject: string
  focus: string
  isCenter: boolean
  selectedCoreIdea: string
  options: CoreIdeaOption[]
}

interface MappedRow {
  id: string
  subject: string
  isCenter: boolean
  coreIdea: string
  area: string
  standard: string
  knowledge: string
  processFunction: string
  valueAttitude: string
  description?: string
}

// ── Jev 응답 형태 (/api/curriculum-sheet/jev) ────────────────────────────
interface JevSubjectResult {
  subject: string
  isCenter: boolean
  error?: string
  elapsedMs: number
  usage: { input_tokens: number; output_tokens: number }
  questionCount: number
  area: { choice: string; confidence: number; ranked: Array<{ area: string; probability: number }> }
  coreIdea: {
    confidence: number
    margin: number
    withinTopAreaConfidence: number
    mode: '제시' | '확인' | '명료화'
    ranked: Array<{ coreIdeaId: string; area: string; idea: string; probability: number }>
  }
  standards: Array<{ code: string; text: string; area: string; coreIdeaId: string; score: number; confidence: number; level: string }>
  sufficiency: { score: number; confidence: number; level: string }
  fusion: number
}

interface JevResponse {
  model: string
  totalMs: number
  usage: { input_tokens: number; output_tokens: number }
  thresholds: { present: number; confirm: number }
  subjects: JevSubjectResult[]
}

// ── 단계 표시 ────────────────────────────────────────────────────────────
type StepId = 'emb-core' | 'emb-rows' | 'jev' | 'compare'
type StepState = { status: 'idle' | 'running' | 'done' | 'error'; ms?: number; note?: string }
const STEP_LABELS: Record<StepId, string> = {
  'emb-core': '기존 · 핵심아이디어 후보 찾기 (OpenAI 임베딩 유사도)',
  'emb-rows': '기존 · 분석표 생성 (성취기준·내용체계 채우기 + LLM 설명)',
  'jev': 'Jev · 판단 패킷 받기 (영역·핵심아이디어·성취기준 동시 질의)',
  'compare': '비교 · 두 결과 일치 여부 판정 (코드)',
}
const STEP_ORDER: StepId[] = ['emb-core', 'emb-rows', 'jev', 'compare']
const IDLE_STEPS: Record<StepId, StepState> = { 'emb-core': { status: 'idle' }, 'emb-rows': { status: 'idle' }, 'jev': { status: 'idle' }, 'compare': { status: 'idle' } }

type Verdict = { ok: boolean; notes: string[] }

function bandOf(gradeGroup: string): string {
  const match = gradeGroup.match(/(\d)-(\d)/)
  return match ? `${match[1]}-${match[2]}학년군` : ''
}

function splitItems(value: string): string[] {
  return value ? value.split(SEP).map(s => s.trim()).filter(Boolean) : []
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function codeOf(standard: string): string {
  return standard.match(/\[([^\]]+)\]/)?.[1] ?? ''
}

/** 행 단위 자동 판정: 학년군 접두사, 비초등 항목, 빈 칸 */
function judgeRow(row: MappedRow, gradeGroup: string): Verdict {
  const band = bandOf(gradeGroup)
  const notes: string[] = []
  for (const [label, value] of [['지식·이해', row.knowledge], ['과정·기능', row.processFunction], ['가치·태도', row.valueAttitude]] as const) {
    const items = splitItems(value)
    if (items.length === 0) { notes.push(`${label} 비어 있음`); continue }
    for (const item of items) {
      const prefix = item.match(/^([^:]{1,12}학년군|중학교|고등학교)\s*:/)?.[1]
      if (!prefix) notes.push(`${label} "${item.slice(0, 24)}" 학년군 접두사 없음`)
      else if (/중학교|고등학교/.test(prefix)) notes.push(`${label} "${item.slice(0, 24)}" 비초등`)
      else if (prefix !== band) notes.push(`${label} "${item.slice(0, 24)}" ${prefix} (프로젝트는 ${band})`)
    }
  }
  if (!row.coreIdea) notes.push('핵심아이디어 비어 있음')
  if (!row.standard) notes.push('성취기준 비어 있음')
  else {
    const codeMatch = row.standard.match(/^\[(\d)/)
    const expectedDigit = gradeGroup.match(/(\d)$/)?.[1]
    if (codeMatch && expectedDigit && codeMatch[1] !== expectedDigit) notes.push(`성취기준 코드 ${row.standard.slice(0, 12)} 학년군 불일치`)
  }
  return { ok: notes.length === 0, notes }
}

function Bar({ value, max = 1, tone = 'blue' }: { value: number; max?: number; tone?: 'blue' | 'purple' | 'green' }) {
  const width = Math.max(0, Math.min(100, (value / max) * 100))
  const color = tone === 'purple' ? 'bg-purple-500' : tone === 'green' ? 'bg-green-500' : 'bg-blue-500'
  return (
    <span className="inline-block h-2 w-24 overflow-hidden rounded bg-gray-200 align-middle">
      <span className={`block h-full ${color}`} style={{ width: `${width}%` }} />
    </span>
  )
}

function StepList({ steps }: { steps: Record<StepId, StepState> }) {
  const icon = (s: StepState) => s.status === 'running' ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
    : s.status === 'done' ? <span className="text-green-700">✓</span>
    : s.status === 'error' ? <span className="text-red-700">✕</span>
    : <span className="text-gray-400">○</span>
  return (
    <ol className="mt-3 space-y-1 rounded border border-gray-200 bg-gray-50 p-3">
      {STEP_ORDER.map(id => {
        const s = steps[id]
        return (
          <li key={id} className={`flex items-center gap-2 ${s.status === 'idle' ? 'text-gray-400' : s.status === 'running' ? 'font-semibold text-blue-800' : 'text-gray-800'}`}>
            <span className="w-4 text-center">{icon(s)}</span>
            <span>{STEP_LABELS[id]}</span>
            {s.ms != null && <span className="text-xs text-gray-500">{s.ms}ms</span>}
            {s.note && <span className={`text-xs ${s.status === 'error' ? 'text-red-700' : 'text-gray-500'}`}>{s.note}</span>}
          </li>
        )
      })}
    </ol>
  )
}

export default function CurriculumMapTestPage() {
  const [topic, setTopic] = useState('우리 지역의 물 문제와 해결 방안')
  const [gradeGroup, setGradeGroup] = useState<(typeof GRADE_GROUPS)[number]>('초5-6')
  const [subjects, setSubjects] = useState<string[]>(['사회', '과학', '국어'])
  const [center, setCenter] = useState('사회')
  const [context, setContext] = useState('')

  const [proposals, setProposals] = useState<CoreIdeaProposal[] | null>(null)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<MappedRow[] | null>(null)
  const [jev, setJev] = useState<JevResponse | null>(null)
  const [raw, setRaw] = useState<{ proposals?: unknown; rows?: unknown; jev?: unknown }>({})
  const [steps, setSteps] = useState<Record<StepId, StepState>>(IDLE_STEPS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  const effectiveCenter = subjects.includes(center) ? center : subjects[0] ?? ''

  const basePayload = useMemo(() => ({
    a12Artifact: { selectedTopic: topic, targetSubjects: subjects },
    targetGradeGroup: gradeGroup,
    chatContext: context.trim() || undefined,
    existingRows: effectiveCenter ? [{ subject: effectiveCenter, isCenter: true }] : [],
  }), [topic, subjects, gradeGroup, context, effectiveCenter])

  const jevPayload = useMemo(() => ({
    topic, gradeGroup, subjects, center: effectiveCenter, chatContext: context.trim() || undefined,
  }), [topic, gradeGroup, subjects, effectiveCenter, context])

  function setStep(id: StepId, state: StepState) {
    setSteps(prev => ({ ...prev, [id]: state }))
  }

  async function post(url: string, body: Record<string, unknown>) {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
    return data
  }

  async function runCoreIdeas(): Promise<CoreIdeaProposal[] | null> {
    setStep('emb-core', { status: 'running' })
    const started = performance.now()
    try {
      const data = await post('/api/curriculum-sheet/autofill', { ...basePayload, mode: 'coreIdeas' }) as { proposals: CoreIdeaProposal[] }
      setProposals(data.proposals)
      setRaw(prev => ({ ...prev, proposals: data }))
      const defaults: Record<string, string> = {}
      for (const p of data.proposals) defaults[p.subject] = p.selectedCoreIdea
      setSelections(defaults)
      setStep('emb-core', { status: 'done', ms: Math.round(performance.now() - started), note: `${data.proposals.length}개 교과` })
      return data.proposals
    } catch (e) {
      setStep('emb-core', { status: 'error', note: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  async function runComplete(selected: Record<string, string>): Promise<MappedRow[] | null> {
    setStep('emb-rows', { status: 'running' })
    const started = performance.now()
    try {
      const data = await post('/api/curriculum-sheet/autofill', {
        ...basePayload,
        mode: 'complete',
        selectedCoreIdeas: Object.entries(selected).map(([subject, coreIdea]) => ({ subject, coreIdea })),
      }) as { rows: MappedRow[] }
      setRows(data.rows)
      setRaw(prev => ({ ...prev, rows: data }))
      setStep('emb-rows', { status: 'done', ms: Math.round(performance.now() - started), note: `${data.rows.length}행` })
      return data.rows
    } catch (e) {
      setStep('emb-rows', { status: 'error', note: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  async function runJev(): Promise<JevResponse | null> {
    setStep('jev', { status: 'running' })
    const started = performance.now()
    try {
      const data = await post('/api/curriculum-sheet/jev', jevPayload) as JevResponse
      setJev(data)
      setRaw(prev => ({ ...prev, jev: data }))
      const questions = data.subjects.reduce((sum, s) => sum + s.questionCount, 0)
      const failed = data.subjects.filter(s => s.error).length
      setStep('jev', {
        status: failed === data.subjects.length ? 'error' : 'done',
        ms: Math.round(performance.now() - started),
        note: failed ? `${failed}개 교과 실패 · 질문 ${questions}개` : `질문 ${questions}개 · 입력 ${data.usage.input_tokens} 토큰 · 서버 왕복 ${data.totalMs}ms`,
      })
      return data
    } catch (e) {
      setStep('jev', { status: 'error', note: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  async function runEmbeddingChain() {
    const result = await runCoreIdeas()
    if (!result) return null
    const defaults: Record<string, string> = {}
    for (const p of result) defaults[p.subject] = p.selectedCoreIdea
    return runComplete(defaults)
  }

  async function runAll() {
    setBusy(true); setError(''); setRows(null); setProposals(null); setJev(null)
    setSteps({ ...IDLE_STEPS })
    // 기존 체인(1→2단계)과 Jev 호출을 동시에 시작해 속도 차이를 그대로 본다.
    const [embRows, jevData] = await Promise.all([runEmbeddingChain(), runJev()])
    setStep('compare', { status: 'running' })
    if (embRows && jevData) setStep('compare', { status: 'done', ms: 0 })
    else setStep('compare', { status: 'error', note: '한쪽 결과가 없어 비교 불가' })
    setBusy(false)
  }

  async function rerunComplete() {
    setBusy(true); setError('')
    await runComplete(selections)
    setBusy(false)
  }

  function toggleSubject(subject: string) {
    setSubjects(prev => prev.includes(subject) ? prev.filter(s => s !== subject) : [...prev, subject])
  }

  const verdicts = useMemo(() => (rows ?? []).map(row => judgeRow(row, gradeGroup)), [rows, gradeGroup])
  const rowBySubject = useMemo(() => new Map((rows ?? []).map((row, i) => [row.subject, { row, verdict: verdicts[i] }])), [rows, verdicts])
  const proposalBySubject = useMemo(() => new Map((proposals ?? []).map(p => [p.subject, p])), [proposals])
  const jevBySubject = useMemo(() => new Map((jev?.subjects ?? []).map(s => [s.subject, s])), [jev])
  const subjectOrder = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const s of [...(proposals ?? []).map(p => p.subject), ...(jev?.subjects ?? []).map(j => j.subject)]) {
      if (!seen.has(s)) { seen.add(s); order.push(s) }
    }
    return order
  }, [proposals, jev])

  const hasResults = subjectOrder.length > 0

  return (
    <main className="mx-auto max-w-[1500px] p-6 text-sm text-gray-900">
      <h1 className="text-xl font-bold">교육과정 매핑 테스트 — 기존(임베딩) vs Jev</h1>
      <p className="mt-1 text-gray-600">
        같은 주제로 <b>좌측</b>은 앱의 &quot;AI 자동 채우기&quot; API(<code>/api/curriculum-sheet/autofill</code>, OpenAI 임베딩),
        <b> 우측</b>은 Jev 판단 패킷(<code>/api/curriculum-sheet/jev</code>, 확률·confidence)을 동시에 호출해 나란히 보여줍니다. 로그인·프로젝트 불필요.
      </p>

      <section className="mt-5 grid gap-4 rounded border border-gray-300 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="font-semibold">수업 주제</span>
          <input className="rounded border border-gray-300 px-3 py-2" value={topic} onChange={e => setTopic(e.target.value)} placeholder="예: 우리 지역의 물 문제와 해결 방안" />
        </label>

        <div className="flex flex-col gap-1">
          <span className="font-semibold">학년군</span>
          <div className="flex gap-3">
            {GRADE_GROUPS.map(g => (
              <label key={g} className="flex items-center gap-1">
                <input type="radio" name="grade" checked={gradeGroup === g} onChange={() => setGradeGroup(g)} /> {g}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-semibold">교과 (체크) · 중심 교과 (라디오)</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {SUBJECTS.map(s => (
              <span key={s} className="flex items-center gap-1">
                <input type="checkbox" checked={subjects.includes(s)} onChange={() => toggleSubject(s)} />
                <input type="radio" name="center" disabled={!subjects.includes(s)} checked={effectiveCenter === s} onChange={() => setCenter(s)} title="중심 교과" />
                {s}
              </span>
            ))}
          </div>
          <span className="text-xs text-gray-500">교과를 하나도 고르지 않으면 주제·맥락 문장에 언급된 교과만 사용됩니다.</span>
        </div>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="font-semibold">추가 맥락 (선택, 채팅 맥락 역할)</span>
          <textarea className="rounded border border-gray-300 px-3 py-2" rows={2} value={context} onChange={e => setContext(e.target.value)} placeholder="예: 학생들이 지역 하천 오염 사진을 조사하고 지도로 정리한 뒤 캠페인 글을 씁니다." />
        </label>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={busy || !topic.trim()} onClick={runAll}>
            {busy ? '실행 중…' : '주제 → 매핑 실행 (기존 + Jev 동시)'}
          </button>
          <button className="rounded border border-gray-400 px-3 py-2 disabled:opacity-50" disabled={busy || !topic.trim()} onClick={async () => { setBusy(true); setSteps({ ...IDLE_STEPS }); await runCoreIdeas(); setBusy(false) }}>
            기존 1단계만
          </button>
          <button className="rounded border border-purple-600 px-3 py-2 text-purple-800 disabled:opacity-50" disabled={busy || !topic.trim()} onClick={async () => { setBusy(true); setSteps({ ...IDLE_STEPS }); await runJev(); setBusy(false) }}>
            Jev만
          </button>
        </div>
        {error && <p className="rounded bg-red-50 p-2 text-red-700 md:col-span-2">오류: {error}</p>}
        <div className="md:col-span-2">
          <span className="font-semibold">에이전트 진행 단계</span>
          <StepList steps={steps} />
        </div>
      </section>

      {hasResults && (
        <section className="mt-6">
          <div className="grid gap-3 md:grid-cols-2">
            <h2 className="rounded bg-blue-50 px-3 py-2 font-bold text-blue-900">
              좌 · 기존 (OpenAI 임베딩 유사도)
              {steps['emb-core'].ms != null && <span className="ml-2 text-xs font-normal">1단계 {steps['emb-core'].ms}ms{steps['emb-rows'].ms != null ? ` · 2단계 ${steps['emb-rows'].ms}ms` : ''}</span>}
            </h2>
            <h2 className="rounded bg-purple-50 px-3 py-2 font-bold text-purple-900">
              우 · Jev 판단 패킷 ({jev?.model ?? 'jev-latest'})
              {jev && <span className="ml-2 text-xs font-normal">서버 왕복 {jev.totalMs}ms · 입력 {jev.usage.input_tokens} 토큰 · 게이트 제시≥{jev.thresholds.present} / 확인≥{jev.thresholds.confirm}</span>}
            </h2>
          </div>

          {subjectOrder.map(subject => {
            const proposal = proposalBySubject.get(subject)
            const built = rowBySubject.get(subject)
            const j = jevBySubject.get(subject)
            const embIdea = built?.row.coreIdea ?? selections[subject] ?? proposal?.selectedCoreIdea ?? ''
            const jevTopIdea = j?.coreIdea.ranked[0]?.idea ?? ''
            const ideaMatch = Boolean(embIdea && jevTopIdea) ? embIdea.trim() === jevTopIdea.trim() : null
            const embCode = built ? codeOf(built.row.standard) : ''
            const jevTopCodes = (j?.standards ?? []).slice(0, 3).map(s => codeOf(s.code))
            const stdMatch = embCode && jevTopCodes.length ? jevTopCodes.includes(embCode) : null
            const isCenter = proposal?.isCenter || j?.isCenter
            return (
              <div key={subject} className="mt-4">
                <div className="mb-1 flex flex-wrap items-center gap-3 border-b border-gray-300 pb-1">
                  <span className="text-base font-bold">{isCenter ? '★ ' : ''}{subject}</span>
                  {ideaMatch != null && <span className={`rounded px-2 py-0.5 text-xs ${ideaMatch ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>핵심아이디어 {ideaMatch ? '일치' : '불일치'} (기존 선택 vs Jev 1위)</span>}
                  {stdMatch != null && <span className={`rounded px-2 py-0.5 text-xs ${stdMatch ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>성취기준 {stdMatch ? '일치' : '불일치'} (기존 {embCode} vs Jev 상위 3)</span>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {/* 좌: 기존 */}
                  <div className="rounded border border-blue-200 p-3">
                    {proposal ? (
                      <>
                        <div className="text-xs font-semibold text-blue-900">1단계 · 핵심아이디어 후보 (유사도 점수){proposal.focus ? <span className="ml-2 font-normal text-gray-500">초점: {proposal.focus}</span> : null}</div>
                        <ul className="mt-1 space-y-2">
                          {proposal.options.map(o => (
                            <li key={o.coreIdeaId + o.idea} className="flex gap-2">
                              <input type="radio" name={`ci-${proposal.subject}`} className="mt-1" checked={selections[proposal.subject] === o.idea} onChange={() => setSelections(s => ({ ...s, [proposal.subject]: o.idea }))} />
                              <div>
                                <div><span className="rounded bg-blue-100 px-1 text-xs text-blue-800">{o.area}</span> <span className="text-xs text-gray-500">점수 {o.score} · 성취기준 {o.standardsCount}개</span></div>
                                <div>{o.idea}</div>
                                {o.sampleStandards.length > 0 && <div className="text-xs text-gray-500">예: {o.sampleStandards.slice(0, 2).join(' / ')}</div>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : <div className="text-gray-400">1단계 결과 없음</div>}
                    {built ? (
                      <div className="mt-3 border-t border-blue-100 pt-2">
                        <div className="text-xs font-semibold text-blue-900">2단계 · 분석표 행
                          <span className={`ml-2 rounded px-2 py-0.5 text-xs font-normal ${built.verdict?.ok ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{built.verdict?.ok ? '자동 판정 OK' : '자동 판정 주의'}</span>
                        </div>
                        <div className="mt-1"><span className="text-gray-500">영역</span> {built.row.area}</div>
                        <div><span className="text-gray-500">핵심아이디어</span> {built.row.coreIdea}</div>
                        <div><span className="text-gray-500">성취기준</span> {built.row.standard}</div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-gray-600">지식·이해 / 과정·기능 / 가치·태도 {built.verdict && !built.verdict.ok ? `· 메모 ${built.verdict.notes.length}건` : ''}</summary>
                          {([['지식·이해', built.row.knowledge], ['과정·기능', built.row.processFunction], ['가치·태도', built.row.valueAttitude]] as const).map(([label, value]) => (
                            <div key={label} className="mt-1 text-xs"><b>{label}</b><ul className="list-disc pl-4">{splitItems(value).map(item => <li key={item}>{item}</li>)}</ul></div>
                          ))}
                          {built.verdict && !built.verdict.ok && <ul className="mt-1 list-disc pl-4 text-xs text-amber-700">{built.verdict.notes.map(n => <li key={n}>{n}</li>)}</ul>}
                          {built.row.description && <div className="mt-1 text-xs text-gray-600"><b>수업내용 설명(LLM)</b> {built.row.description}</div>}
                        </details>
                      </div>
                    ) : proposal ? <div className="mt-2 text-xs text-gray-400">2단계 미실행</div> : null}
                  </div>

                  {/* 우: Jev */}
                  <div className="rounded border border-purple-200 p-3">
                    {!j ? <div className="text-gray-400">Jev 결과 없음</div> : j.error ? <div className="text-red-700">오류: {j.error}</div> : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                          <span>응답 {j.elapsedMs}ms</span><span>· 질문 {j.questionCount}개</span><span>· 입력 {j.usage.input_tokens} 토큰</span>
                          <span className={`ml-auto rounded px-2 py-0.5 font-semibold ${j.coreIdea.mode === '제시' ? 'bg-green-100 text-green-800' : j.coreIdea.mode === '확인' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-800'}`}>게이트: {j.coreIdea.mode}</span>
                        </div>

                        <div className="mt-2 text-xs font-semibold text-purple-900">영역 <span className="font-normal text-gray-500">confidence {j.area.confidence.toFixed(2)}</span></div>
                        <ul className="mt-1 space-y-0.5">
                          {j.area.ranked.map(a => <li key={a.area} className="flex items-center gap-2"><Bar value={a.probability} tone="purple" /><span className="w-10 text-xs text-gray-500">{pct(a.probability)}</span><span>{a.area}</span></li>)}
                        </ul>

                        <div className="mt-2 text-xs font-semibold text-purple-900">핵심아이디어 <span className="font-normal text-gray-500">confidence {j.coreIdea.confidence.toFixed(2)} · 1·2위 격차 {pct(j.coreIdea.margin)} · 1위 영역 내 집중도 {j.coreIdea.withinTopAreaConfidence.toFixed(2)}</span></div>
                        <ul className="mt-1 space-y-1">
                          {j.coreIdea.ranked.slice(0, 3).map(c => (
                            <li key={c.coreIdeaId + c.idea} className="flex gap-2">
                              <div className="flex shrink-0 items-center gap-1 pt-0.5"><Bar value={c.probability} tone="purple" /><span className="w-10 text-xs text-gray-500">{pct(c.probability)}</span></div>
                              <div><span className="rounded bg-purple-100 px-1 text-xs text-purple-800">{c.area}</span> {c.idea}</div>
                            </li>
                          ))}
                        </ul>

                        <div className="mt-2 text-xs font-semibold text-purple-900">성취기준 관련도 <span className="font-normal text-gray-500">(0 무관 ~ 3 핵심, 상위 5)</span></div>
                        <ul className="mt-1 space-y-1">
                          {j.standards.map(s => (
                            <li key={s.code} className="flex gap-2">
                              <div className="flex shrink-0 items-center gap-1 pt-0.5"><Bar value={s.score} max={3} tone="green" /><span className="w-14 text-xs text-gray-500">{s.score.toFixed(2)} {s.level}</span></div>
                              <div><b>{s.code}</b> {s.text}</div>
                            </li>
                          ))}
                        </ul>

                        <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
                          <span>정보충분성: <b>{j.sufficiency.level}</b> ({j.sufficiency.score.toFixed(2)}/2, conf {j.sufficiency.confidence.toFixed(2)})</span>
                          <span>융합 주제 여부: <b>{pct(j.fusion)}</b></span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {proposals && (
            <button className="mt-4 rounded border border-blue-700 px-3 py-2 font-semibold text-blue-700 disabled:opacity-50" disabled={busy} onClick={rerunComplete}>
              좌측 라디오 선택 반영해 2단계 다시 생성
            </button>
          )}
        </section>
      )}

      {Boolean(raw.proposals || raw.rows || raw.jev) && (
        <section className="mt-6">
          <button className="text-gray-600 underline" onClick={() => setShowRaw(v => !v)}>{showRaw ? '원본 JSON 숨기기' : '원본 JSON 보기'}</button>
          {showRaw && <pre className="mt-2 max-h-[480px] overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(raw, null, 2)}</pre>}
        </section>
      )}
    </main>
  )
}
