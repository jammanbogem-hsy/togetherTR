'use client'

// Ds-1-2 문제상황 산출물 렌더러 (자체 완결).
// 저장 형태가 여러 가지라 content를 유연하게 정규화한다:
//  (A) 워크숍 저장: { '문제상황 후보': [...], '선정 문제상황': {제목,문제상황,성취기준연결,데이터출처,교과별학습내용,산출물,AI점검}, '핵심 질문', '탐구 질문' }
//  (B) fallback 저장: { '문제상황', '교과별 학습 내용 및 산출물', '데이터 출처', '핵심 질문', '탐구 질문' }
//  (C) 공동편집 구조: { _schema:'Ds-1-2', scenario:{title,authenticity,contentProduct,audienceAction}, drivingQuestion }
// 어떤 경우든 raw JSON이 노출되지 않도록 사람이 읽는 카드로 렌더.

type AnyRec = Record<string, unknown>
const S = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : String(v))

interface Candidate { title: string; scenario: string; dataSources: string; selected: boolean }
interface Alignment { standardId: string; subject: string; isCenter: boolean; connection: string }
interface RealData { label: string; url?: string }
interface Normalized {
  candidates: Candidate[]
  selected: {
    title: string
    fullScenario: string
    alignment: Alignment[]
    alignmentText: string
    realData: RealData[]
    learningContent: string
    artifacts: string
    aiCheck: string
  }
  drivingQuestion: string
  essentialQuestions: string[]
}

function normalize(content: AnyRec): Normalized {
  const out: Normalized = {
    candidates: [],
    selected: { title: '', fullScenario: '', alignment: [], alignmentText: '', realData: [], learningContent: '', artifacts: '', aiCheck: '' },
    drivingQuestion: '',
    essentialQuestions: [],
  }

  // 후보
  const rawC = content['문제상황 후보']
  if (Array.isArray(rawC)) {
    out.candidates = rawC.map((c) => {
      const o = (c ?? {}) as AnyRec
      return {
        title: S(o['제목'] ?? o.title),
        scenario: S(o['문제상황'] ?? o.scenario),
        dataSources: S(o['데이터출처'] ?? o.dataSources),
        selected: Boolean(o['선정'] ?? o.selected),
      }
    })
  }

  // 선정 문제상황 — (A) 중첩 객체 우선
  const sel = (content['선정 문제상황'] ?? {}) as AnyRec
  const scenarioObj = (content['scenario'] ?? {}) as AnyRec  // (C)
  const sa = sel['성취기준연결']
  const rd = sel['데이터출처']
  out.selected = {
    title: S(sel['제목'] || content['제목'] || scenarioObj['title'] || content['title']),
    fullScenario: S(
      sel['문제상황'] ||
      content['문제상황'] ||
      scenarioObj['authenticity'] ||
      '',
    ),
    alignment: Array.isArray(sa)
      ? sa.map((x) => {
          const o = (x ?? {}) as AnyRec
          return {
            standardId: S(o.standardId),
            subject: S(o.subject),
            isCenter: Boolean(o.isCenter),
            connection: S(o.connection),
          }
        })
      : [],
    // 채팅 흐름 fallback — 성취기준 연결이 구조화 배열이 아니라 문자열(마커)로 저장된 경우
    alignmentText: !Array.isArray(sa)
      ? S(content['성취기준 연결'] ?? content['성취기준연결'] ?? (typeof sa === 'string' ? sa : ''))
      : '',
    realData: Array.isArray(rd)
      ? rd.map((x) => {
          const o = (x ?? {}) as AnyRec
          return { label: S(o.label), url: o.url ? S(o.url) : undefined }
        })
      : [],
    learningContent: S(sel['교과별학습내용'] || content['교과별 학습 내용 및 산출물'] || scenarioObj['contentProduct']),
    artifacts: S(sel['산출물']),
    aiCheck: S(sel['AI점검']),
  }
  // 데이터 출처가 문자열 형태(fallback)면 realData로 흡수
  if (out.selected.realData.length === 0) {
    const ds = S(content['데이터 출처'])
    if (ds) out.selected.realData = ds.split(/[\n,]/).map(s => ({ label: s.trim() })).filter(r => r.label)
  }

  out.drivingQuestion = S(content['핵심 질문'] || content['핵심질문'] || content['drivingQuestion'])
  const eq = content['탐구 질문']
  out.essentialQuestions = Array.isArray(eq)
    ? eq.map(S).filter(Boolean)
    : typeof eq === 'string'
      ? eq.split('\n').map(s => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean)
      : []

  return out
}

// ── 공동 편집 문서 그대로 렌더 (manualWorkspace) ──────────────────────
// 사용자가 추가/이동한 임의 블록까지 WYSIWYG로 보이도록, 인식 키가 아닌
// 실제 편집한 문서 구조를 그대로 표현한다.
type MWBlock = {
  id: string; type: string; content?: string
  table?: { columns: Array<{ id: string; label?: string }>; rows: Array<{ id: string; cells?: Record<string, unknown> }> }
}
type MWCol = { id: string; label?: string }
type MWRow = { id: string; cells?: Record<string, unknown> }
type ManualWorkspace = { columns?: MWCol[]; rows?: MWRow[]; blocks?: MWBlock[] }

function parseChecklistLines(content: string): Array<{ text: string; checked: boolean }> {
  return (content ?? '').split(/\r?\n/).map(line => {
    const m = line.match(/^\s*[-*]?\s*\[([ xX])\]\s*(.*)$/)
    if (m) return { text: m[2], checked: m[1].toLowerCase() === 'x' }
    return { text: line.replace(/^\s*[-*]\s*/, ''), checked: false }
  }).filter(it => it.text.trim())
}

function BlockDoc({ mw }: { mw: ManualWorkspace }) {
  const rows = mw.rows ?? []
  const cols = mw.columns ?? []
  const blocks = mw.blocks ?? []
  const cell = (r: MWRow, cId: string) => S(r.cells?.[cId]).trim()
  const rowsHaveContent = rows.some(r => cols.some(c => cell(r, c.id)))

  return (
    <div className="space-y-4">
      {rowsHaveContent && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">문제상황 시나리오</span>
          </div>
          <table className="w-full text-sm border-collapse [word-break:keep-all]">
            <tbody className="divide-y divide-[#F1F3F4]">
              {rows.map(r => (
                <tr key={r.id} className="align-top">
                  {cols.map((c, ci) => (
                    <td key={c.id} className={ci === 0
                      ? 'w-[150px] px-3 py-2.5 bg-[#F8F9FA] font-bold text-[#3C4043] whitespace-nowrap'
                      : 'px-3 py-2.5 text-[#202124] leading-relaxed whitespace-pre-wrap'}>
                      {cell(r, c.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white px-5 py-4 space-y-3">
          {blocks.map(b => {
            const text = S(b.content)
            if (b.type === 'table' && b.table) {
              const tc = b.table.columns ?? []
              return (
                <div key={b.id} className="overflow-x-auto rounded-lg border border-[#DADCE0]">
                  <table className="min-w-full border-collapse text-[13px]">
                    <thead className="bg-[#E8F0FE]">
                      <tr>{tc.map(c => <th key={c.id} className="border border-[#BBDEFB] px-3 py-2 text-left font-bold text-[#1A237E]">{c.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {(b.table.rows ?? []).map(r => (
                        <tr key={r.id} className="align-top">
                          {tc.map(c => <td key={c.id} className="border border-[#DADCE0] px-3 py-2 text-[#3C4043] [word-break:keep-all]">{S(r.cells?.[c.id])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            if (!text.trim()) return null
            if (b.type === 'heading') return <h3 key={b.id} className="text-[17px] font-extrabold text-[#202124] pt-2">{text}</h3>
            if (b.type === 'subheading') return <h4 key={b.id} className="text-[13px] font-bold text-[#1967D2] uppercase tracking-wider pt-1">{text}</h4>
            if (b.type === 'quote') return <blockquote key={b.id} className="border-l-4 border-[#AECBFA] bg-[#F8F9FA] pl-4 py-2 text-[13px] italic text-[#3C4043] leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{text}</blockquote>
            if (b.type === 'checklist') return (
              <ul key={b.id} className="space-y-1.5">
                {parseChecklistLines(text).map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-[#3C4043] leading-relaxed [word-break:keep-all]">
                    <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${it.checked ? 'bg-[#34A853] border-[#34A853] text-white' : 'border-[#9AA0A6]'}`}>{it.checked ? '✓' : ''}</span>
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>
            )
            return <p key={b.id} className="text-[13px] text-[#202124] leading-[1.8] whitespace-pre-wrap [word-break:keep-all]">{text}</p>
          })}
        </div>
      )}
    </div>
  )
}

export function Ds12Renderer({ data }: { data: AnyRec }) {
  // 공동 편집 문서가 있으면 사용자가 편집한 그대로 렌더 (임의 추가 블록 포함 WYSIWYG)
  const mw = (data?.manualWorkspace ?? null) as ManualWorkspace | null
  if (mw && ((mw.rows?.length ?? 0) > 0 || (mw.blocks?.length ?? 0) > 0)) {
    return <BlockDoc mw={mw} />
  }

  const d = normalize(data ?? {})
  const sel = d.selected
  const hasDetail = !!(sel.fullScenario || sel.alignment.length || sel.alignmentText || sel.realData.length || sel.learningContent || sel.artifacts)

  return (
    <div className="space-y-4">
      {/* 선정 문제 상황 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center gap-2">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">선정 문제 상황</span>
          {sel.title && (
            <span className="text-[11px] font-bold text-[#1A73E8] bg-[#E8F0FE] px-2 py-0.5 rounded-full">{sel.title}</span>
          )}
        </div>

        {hasDetail ? (
          <div className="divide-y divide-[#F1F3F4]">
            {sel.fullScenario && (
              <p className="px-4 py-3 text-[13px] text-[#202124] leading-[1.8] [word-break:keep-all] whitespace-pre-wrap">
                {sel.fullScenario}
              </p>
            )}

            {sel.alignment.length > 0 && (
              <div className="px-4 py-3">
                <div className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wide mb-2">성취기준 연결</div>
                <div className="space-y-2">
                  {sel.alignment.map((s, i) => (
                    <div key={i} className={s.isCenter
                      ? 'rounded-lg px-3 py-2.5 border bg-[#FFF8E1] border-[#FFE082]'
                      : 'rounded-lg px-3 py-2.5 border bg-[#F8F9FA] border-[#E8EAED]'}>
                      <div className="flex items-center gap-1.5 mb-1">
                        {s.isCenter && <span className="text-[9px] font-black bg-[#F9A825] text-white px-1.5 py-0.5 rounded-full">중심</span>}
                        <span className={s.isCenter ? 'text-[11px] font-bold text-[#B06000]' : 'text-[11px] font-bold text-[#5F6368]'}>[{s.standardId}]</span>
                        {s.subject && <span className={s.isCenter
                          ? 'text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-[#FFE082] text-[#B06000]'
                          : 'text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-[#E8EAED] text-[#5F6368]'}>{s.subject}</span>}
                      </div>
                      <p className="text-[12px] text-[#3C4043] leading-relaxed [word-break:keep-all]">{s.connection}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sel.alignment.length === 0 && sel.alignmentText && (
              <div className="px-4 py-3">
                <div className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wide mb-2">성취기준 연결 (평가 기준)</div>
                <p className="text-[12px] text-[#3C4043] leading-relaxed [word-break:keep-all] whitespace-pre-wrap">{sel.alignmentText}</p>
              </div>
            )}

            {sel.realData.length > 0 && (
              <div className="px-4 py-3">
                <div className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wide mb-1.5">실제 데이터</div>
                <ol className="space-y-1.5">
                  {sel.realData.map((dd, i) => (
                    <li key={i} className="flex gap-2 text-[12px] text-[#3C4043] leading-relaxed">
                      <span className="flex-shrink-0 text-[#1A73E8] font-bold">{i + 1})</span>
                      <span className="flex-1">
                        {dd.label}
                        {dd.url && (
                          <a href={dd.url} target="_blank" rel="noopener noreferrer"
                            className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-[#1A73E8] hover:underline font-medium">링크 ↗</a>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {sel.learningContent && (
              <div className="px-4 py-3">
                <div className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wide mb-1.5">교과별 학습 내용</div>
                <p className="text-[12px] text-[#3C4043] leading-relaxed [word-break:keep-all] whitespace-pre-wrap">{sel.learningContent}</p>
              </div>
            )}

            {sel.artifacts && (
              <div className="px-4 py-3">
                <div className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wide mb-1.5">산출물</div>
                <p className="text-[12px] text-[#3C4043] leading-relaxed [word-break:keep-all] whitespace-pre-wrap">{sel.artifacts}</p>
              </div>
            )}

            {sel.aiCheck && (
              <div className="px-4 py-3 bg-[#E8F0FE]">
                <div className="text-[11px] font-bold text-[#1967D2] mb-1.5">AI 점검: 학습내용·산출물 반영 검토</div>
                <p className="text-[12px] text-[#1967D2] leading-relaxed [word-break:keep-all] whitespace-pre-wrap">{sel.aiCheck}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">
            아직 문제상황 상세가 작성되지 않았습니다. 워크숍에서 후보를 선택하거나 공동 편집에서 작성해 주세요.
          </div>
        )}
      </div>

      {/* 탐구 질문 & 하위 탐구 질문 */}
      {(d.drivingQuestion || d.essentialQuestions.length > 0) && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">탐구 질문 &amp; 하위 탐구 질문</span>
          </div>
          {d.drivingQuestion && (
            <div className="px-4 py-3 bg-[#F0FDF4] border-b border-[#F1F3F4]">
              <div className="text-[10px] font-bold text-[#059669] mb-1">탐구 질문 (Driving Question)</div>
              <p className="text-[13px] font-semibold text-[#065F46] leading-relaxed [word-break:keep-all]">{d.drivingQuestion}</p>
            </div>
          )}
          {d.essentialQuestions.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-[10px] font-bold text-[#5F6368] mb-1.5">하위 탐구 질문 (Essential Questions)</div>
              <ol className="space-y-1.5">
                {d.essentialQuestions.map((q, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-[#3C4043] leading-relaxed">
                    <span className="flex-shrink-0 font-bold text-[#059669]">{i + 1}.</span>
                    <span className="[word-break:keep-all]">{q}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
