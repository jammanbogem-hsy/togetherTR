'use client'

// Ds-2-1 지원 도구(자료) 설계 산출물 렌더러 (자체 완결).
// 저장 형태가 여러 가지라 content를 유연하게 정규화한다:
//  (A) 워크숍/ARTIFACT 저장: { '활동별 자료 설계': "<markdown table string>", 'AI 점검': "<string>" }
//  (B) 공동편집 구조: { _schema:'Ds-2-1', materials:[{activity,name,purpose,sourceType,devScope,owner,schedule}], envCheck }
// 어떤 경우든 raw JSON이 노출되지 않도록 사람이 읽는 카드로 렌더.

type AnyRec = Record<string, unknown>
const S = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : String(v))

interface Material {
  activity: string
  name: string
  purpose: string
  sourceType: string
  devScope: string
  owner: string
  schedule: string
}
interface Normalized {
  materials: Material[]
  envCheck: string
}

// markdown 파이프 테이블 문자열을 7개 컬럼 순서대로 파싱
// 컬럼 순서: 대상 활동 | 자료/도구명 | 활용 이유 | 탐색/개발 | 공동/개별 | 담당 교사 | 일정
function parseMarkdownTable(src: string): Material[] {
  const lines = (src ?? '').split(/\r?\n/).map(l => l.trim()).filter(l => l.includes('|'))
  const out: Material[] = []
  for (const line of lines) {
    // 셀 분리: 앞뒤 파이프 제거 후 split
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
    // 구분선(--- 등) 스킵
    if (cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) continue
    // 헤더 스킵 (첫 셀이 헤더 라벨)
    const first = cells[0]
    if (/^대상\s*활동$/.test(first) || /^활동$/.test(first)) continue
    if (cells.every(c => c === '')) continue
    out.push({
      activity: cells[0] ?? '',
      name: cells[1] ?? '',
      purpose: cells[2] ?? '',
      sourceType: cells[3] ?? '',
      devScope: cells[4] ?? '',
      owner: cells[5] ?? '',
      schedule: cells[6] ?? '',
    })
  }
  return out
}

function normalize(content: AnyRec): Normalized {
  const out: Normalized = { materials: [], envCheck: '' }

  // (B) 구조: materials 배열 우선
  const rawM = content['materials']
  if (Array.isArray(rawM)) {
    out.materials = rawM.map((m) => {
      const o = (m ?? {}) as AnyRec
      return {
        activity: S(o.activity ?? o['대상 활동'] ?? o['활동']),
        name: S(o.name ?? o['자료/도구명'] ?? o['자료·도구']),
        purpose: S(o.purpose ?? o['활용 이유']),
        sourceType: S(o.sourceType ?? o['탐색/개발'] ?? o['탐색·개발']),
        devScope: S(o.devScope ?? o['공동/개별'] ?? o['공동·개별']),
        owner: S(o.owner ?? o['담당 교사'] ?? o['담당']),
        schedule: S(o.schedule ?? o['일정']),
      }
    })
  }

  // (A) 워크숍 저장: markdown table 문자열
  if (out.materials.length === 0) {
    const tbl = content['활동별 자료 설계']
    if (typeof tbl === 'string' && tbl.trim()) {
      out.materials = parseMarkdownTable(tbl)
    } else if (Array.isArray(tbl)) {
      out.materials = tbl.map((m) => {
        const o = (m ?? {}) as AnyRec
        return {
          activity: S(o.activity ?? o['대상 활동'] ?? o['활동']),
          name: S(o.name ?? o['자료/도구명'] ?? o['자료·도구']),
          purpose: S(o.purpose ?? o['활용 이유']),
          sourceType: S(o.sourceType ?? o['탐색/개발'] ?? o['탐색·개발']),
          devScope: S(o.devScope ?? o['공동/개별'] ?? o['공동·개별']),
          owner: S(o.owner ?? o['담당 교사'] ?? o['담당']),
          schedule: S(o.schedule ?? o['일정']),
        }
      })
    }
  }

  out.envCheck = S(content['envCheck'] || content['AI 점검'] || content['AI점검'])

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
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">활동별 자료 설계</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse [word-break:keep-all]">
              {cols.some(c => c.label) && (
                <thead className="bg-[#E8F0FE]">
                  <tr>
                    {cols.map(c => (
                      <th key={c.id} className="px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody className="divide-y divide-[#F1F3F4]">
                {rows.map(r => (
                  <tr key={r.id} className="align-top">
                    {cols.map((c, ci) => (
                      <td key={c.id} className={ci === 0
                        ? 'min-w-[120px] px-3 py-2.5 bg-[#F8F9FA] font-bold text-[#3C4043] whitespace-pre-wrap'
                        : 'min-w-[120px] px-3 py-2.5 text-[#202124] leading-relaxed whitespace-pre-wrap'}>
                        {cell(r, c.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

export function Ds21Renderer({ data }: { data: Record<string, unknown> }) {
  // 공동 편집 문서가 있으면 사용자가 편집한 그대로 렌더 (임의 추가 블록 포함 WYSIWYG)
  const mw = (data?.manualWorkspace ?? null) as ManualWorkspace | null
  if (mw && ((mw.rows?.length ?? 0) > 0 || (mw.blocks?.length ?? 0) > 0)) {
    return <BlockDoc mw={mw} />
  }

  const d = normalize(data ?? {})
  const hasMaterials = d.materials.length > 0
  const hasEnvCheck = !!d.envCheck.trim()

  if (!hasMaterials && !hasEnvCheck) {
    return (
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">지원 도구(자료) 설계</span>
        </div>
        <div className="px-4 py-6 text-center text-sm text-[#9AA0A6]">
          아직 작성되지 않았습니다.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 활동별 자료 설계 */}
      {hasMaterials && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">활동별 자료 설계</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse [word-break:keep-all]">
              <thead className="bg-[#E8F0FE]">
                <tr>
                  <th className="min-w-[120px] px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">대상 활동</th>
                  <th className="min-w-[130px] px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">자료·도구</th>
                  <th className="min-w-[200px] px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">활용 이유</th>
                  <th className="min-w-[100px] px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">탐색·개발</th>
                  <th className="min-w-[90px] px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">공동·개별</th>
                  <th className="min-w-[90px] px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">담당</th>
                  <th className="min-w-[100px] px-3 py-2 text-left text-[11px] font-bold text-[#1A237E] whitespace-nowrap border-b border-[#BBDEFB]">일정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F3F4]">
                {d.materials.map((m, i) => (
                  <tr key={i} className="align-top">
                    <td className="min-w-[120px] px-3 py-2.5 bg-[#F8F9FA] font-bold text-[#3C4043] leading-relaxed whitespace-pre-wrap">{m.activity}</td>
                    <td className="min-w-[130px] px-3 py-2.5 font-medium text-[#202124] leading-relaxed whitespace-pre-wrap">{m.name}</td>
                    <td className="min-w-[200px] px-3 py-2.5 text-[#3C4043] leading-relaxed whitespace-pre-wrap">{m.purpose}</td>
                    <td className="min-w-[100px] px-3 py-2.5 text-[#3C4043] leading-relaxed whitespace-pre-wrap">{m.sourceType}</td>
                    <td className="min-w-[90px] px-3 py-2.5 text-[#3C4043] leading-relaxed whitespace-pre-wrap">{m.devScope}</td>
                    <td className="min-w-[90px] px-3 py-2.5 text-[#3C4043] leading-relaxed whitespace-pre-wrap">{m.owner}</td>
                    <td className="min-w-[100px] px-3 py-2.5 text-[#3C4043] leading-relaxed whitespace-pre-wrap">{m.schedule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI 점검 */}
      {hasEnvCheck && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0]">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">AI 점검</span>
          </div>
          <div className="px-4 py-3 bg-[#E8F0FE]">
            <p className="text-[12px] text-[#1967D2] leading-relaxed [word-break:keep-all] whitespace-pre-wrap">{d.envCheck}</p>
          </div>
        </div>
      )}
    </div>
  )
}
