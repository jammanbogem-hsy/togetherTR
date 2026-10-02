'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Graph as GraphIcon } from '@phosphor-icons/react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Project, ActivityCode } from '@/types'
import { ACTIVITY_META } from '@/types'
import { buildProjectOntology, computeInheritance, type OntologyNode, type NodeInheritance } from '@/lib/ontology/projectOntology'
import { ProjectOntologyGraph, OntologyLegend } from './ProjectOntologyGraph'
import { STAGE_COLOR, STAGE_LABELS } from '@/lib/ui/stageColors'

/**
 * 프로젝트 온톨로지 모달.
 * - 프로젝트 구조 전체를 그래프로 한눈에
 * - 노드 클릭 시 하단에 해당 활동 정보 패널
 * - 공개 링크 페이지에서도 인라인(모달 아님) 렌더로 재사용 가능
 */

export function ProjectOntologyModal({
  open,
  onClose,
  project,
  onOpenActivity,
}: {
  open: boolean
  onClose: () => void
  project: Project
  onOpenActivity?: (code: ActivityCode) => void
}) {
  const graph = useMemo(() => buildProjectOntology({
    artifacts: project.artifacts,
    activityStatuses: project.activityStatuses,
    currentActivity: project.currentActivity,
    stageReports: project.stageReports,
  }), [project.artifacts, project.activityStatuses, project.currentActivity, project.stageReports])

  const inheritanceMap = useMemo(() => computeInheritance(graph.nodes), [graph.nodes])

  const [selectedId, setSelectedId] = useState<ActivityCode | null>(null)
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setSelectedId(null)
  }

  if (!open || typeof document === 'undefined') return null

  const selected = selectedId ? graph.nodes.find(n => n.id === selectedId) : null
  const selectedArtifact = selected ? project.artifacts?.[selected.id] : null

  function handleNodeClick(n: OntologyNode) {
    setSelectedId(n.id)
  }

  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[96vw] max-w-[1400px] max-h-[94vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-gradient-to-br from-[#E8F0FE] to-white px-5 py-4 flex items-center gap-3 border-b border-[#DADCE0] flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#1A73E8] flex items-center justify-center flex-shrink-0">
            <GraphIcon size={20} weight="fill" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-[#1A73E8] uppercase tracking-widest">프로젝트 온톨로지</p>
            <h3 className="text-[15px] font-bold text-[#202124] truncate">{project.title}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="p-1.5 rounded-full hover:bg-white text-[#5F6368] transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* 도움말 */}
        <div className="px-5 pt-3 pb-2 text-[11px] text-[#5F6368] border-b border-[#F1F3F4]">
          <span className="font-bold text-[#3C4043]">T-CID 모형 구조도</span> — 5단계(팀준비→분석→설계→개발·실행→평가) 활동이 교육적 관계(가드레일·백워드·순환)로 연결된 모습입니다. 노드에 마우스를 올리면 관련 활동이 강조되고, 클릭하면 해당 활동 정보가 아래에 표시됩니다.
        </div>

        {/* 본문 — 좌: 그래프 / 우: 노드 상세 (2-pane) */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 좌측: 그래프 */}
          <div className="flex-1 min-w-0 overflow-auto bg-gradient-to-b from-white to-[#F8F9FA] px-4 py-4">
            <ProjectOntologyGraph graph={graph} onNodeClick={handleNodeClick} className="mx-auto" />
            {/* 그래프 아래 범례 (항상 노출) */}
            <div className="mt-4 rounded-xl border border-[#E8EAED] bg-white px-4 py-3">
              <OntologyLegend />
            </div>
          </div>
          {/* 우측: 노드 상세 — 선택 전엔 안내 메시지, 선택 시 드로어 */}
          <aside className="w-[440px] flex-shrink-0 border-l border-[#E8EAED] bg-[#FAFBFC] overflow-y-auto">
            {selected ? (
              <div className="p-4">
                <ActivityDetailDrawer
                  node={selected}
                  inheritance={inheritanceMap.get(selected.id) ?? { incoming: [], unique: [], outgoing: [] }}
                  artifactTitle={selectedArtifact?.title}
                  allNodes={graph.nodes}
                  onOpen={() => { onOpenActivity?.(selected.id); onClose() }}
                  onClear={() => setSelectedId(null)}
                  onJumpTo={(code) => setSelectedId(code)}
                />
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-[#9AA0A6]">
                <div className="w-14 h-14 rounded-2xl bg-[#F3E5F5] flex items-center justify-center mb-3">
                  <GraphIcon size={28} weight="regular" className="text-[#7B1FA2]" />
                </div>
                <p className="text-[13px] font-semibold text-[#5F6368] mb-1">노드를 클릭해보세요</p>
                <p className="text-[11px] leading-relaxed">
                  왼쪽 그래프에서 활동 노드를 클릭하면<br />
                  해당 산출물의 핵심 개념 · 계승 흐름 · 원문을<br />
                  이곳에서 바로 확인할 수 있습니다.
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 산출물 원문 마크다운 렌더 — 테이블·볼드·리스트를 실제 시각 요소로 변환.
 * AI가 단일 라인에 `| a | b | --- | ... |` 형태로 말아 넣은 경우도 정규화.
 */
function normalizeInlinePipeList(text: string): string {
  if (text.includes('\n')) return text
  const trimmed = text.trim()
  if (!trimmed.startsWith('|')) return text
  const pipeCount = (trimmed.match(/\|/g) || []).length
  if (pipeCount < 4) return text
  const core = trimmed.slice(1).replace(/\|$/, '')
  const rawCells = core.split('|').map(s => s.trim()).filter(Boolean)
  const evenCount = rawCells.length - (rawCells.length % 2)
  if (evenCount < 4) return text
  const cells = rawCells.slice(0, evenCount)
  const pairs: [string, string][] = []
  for (let i = 0; i < cells.length; i += 2) pairs.push([cells[i], cells[i + 1]])
  const isSep = (s: string) => /^:?-{2,}:?$/.test(s)
  const sepIdx = pairs.findIndex(p => isSep(p[0]) && isSep(p[1]))
  if (sepIdx > 0 && sepIdx < pairs.length - 1) {
    const header = pairs[sepIdx - 1]
    const dataRows = pairs.slice(sepIdx + 1).filter(p => !(isSep(p[0]) && isSep(p[1])))
    if (dataRows.length === 0) return text
    return [
      `| ${header[0]} | ${header[1]} |`,
      `| --- | --- |`,
      ...dataRows.map(p => `| ${p[0]} | ${p[1]} |`),
    ].join('\n')
  }
  return [
    `| 항목 | 내용 |`,
    `| --- | --- |`,
    ...pairs.filter(p => !(isSep(p[0]) && isSep(p[1]))).map(p => `| ${p[0]} | ${p[1]} |`),
  ].join('\n')
}

const sectionMarkdownComponents: Components = {
  p: ({ children }) => <p className="text-[12px] text-[#3C4043] leading-relaxed my-1">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-[#202124]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#5F6368]">{children}</em>,
  ul: ({ children }) => <ul className="space-y-0.5 my-1 pl-0">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-5 my-1 space-y-0.5 text-[12px] text-[#3C4043]">{children}</ol>,
  li: ({ children }) => (
    <li className="flex items-start gap-1.5 text-[12px] text-[#3C4043] leading-relaxed">
      <span className="mt-1.5 w-1 h-1 rounded-full bg-[#1A73E8] flex-shrink-0" />
      <span className="flex-1 min-w-0">{children}</span>
    </li>
  ),
  table: ({ children }) => (
    <div className="my-2 rounded-lg border border-[#E8EAED] overflow-hidden">
      <table className="w-full border-collapse text-[11px]" style={{ tableLayout: 'auto' }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#F8F9FA]">{children}</thead>,
  th: ({ children }) => (
    <th className="px-2 py-1.5 text-left font-bold text-[10px] text-[#5F6368] uppercase tracking-wider align-top" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
      {children}
    </th>
  ),
  tr: ({ children }) => <tr className="border-t border-[#F1F3F4]">{children}</tr>,
  td: ({ children }) => (
    <td className="px-2 py-1.5 text-[11px] text-[#3C4043] leading-snug align-top" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
      {children}
    </td>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 bg-[#F1F3F4] border border-[#DADCE0] rounded text-[11px] text-[#202124]">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 px-2 py-1 bg-[#F8F9FA] border-l-2 border-[#DADCE0] rounded-r text-[11px] text-[#5F6368]">
      {children}
    </blockquote>
  ),
}

/**
 * 해시태그 칩 — 개념 하나를 시각화. 단계 색상 사용.
 */
function ConceptTag({
  kw, stage, size = 'md',
}: {
  kw: string
  stage?: OntologyNode['stage']
  size?: 'sm' | 'md'
}) {
  const color = stage ? STAGE_COLOR[stage] : STAGE_COLOR.T
  const sizeClass = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-[11px] px-2 py-0.5'
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${sizeClass}`}
      style={{
        color: color.hex,
        backgroundColor: color.hex + '1A',     // 10% opacity
        border: `1px solid ${color.hex}33`,    // 20%
      }}
    >
      #{kw}
    </span>
  )
}

function ActivityDetailDrawer({
  node, inheritance, artifactTitle, allNodes, onOpen, onClear, onJumpTo,
}: {
  node: OntologyNode
  inheritance: NodeInheritance
  artifactTitle?: string
  allNodes: OntologyNode[]
  onOpen: () => void
  onClear: () => void
  onJumpTo: (code: ActivityCode) => void
}) {
  const meta = ACTIVITY_META[node.id]
  const color = STAGE_COLOR[meta.stage]
  const statusLabel = node.isDone
    ? '완료'
    : node.hasArtifact
      ? '진행 중 (초안 저장됨)'
      : node.isCurrent
        ? '현재 진행'
        : '미진행'

  // 계승: 키워드별 출처·도착 그룹핑
  const nodeMap = new Map<ActivityCode, OntologyNode>()
  for (const n of allNodes) nodeMap.set(n.id, n)

  const incomingByActivity = new Map<ActivityCode, string[]>()
  for (const link of inheritance.incoming) {
    if (!incomingByActivity.has(link.activity)) incomingByActivity.set(link.activity, [])
    incomingByActivity.get(link.activity)!.push(link.keyword)
  }
  const outgoingByActivity = new Map<ActivityCode, string[]>()
  for (const link of inheritance.outgoing) {
    if (!outgoingByActivity.has(link.activity)) outgoingByActivity.set(link.activity, [])
    outgoingByActivity.get(link.activity)!.push(link.keyword)
  }

  return (
    <div className="space-y-3">
      {/* 상단: 활동 정체성 */}
      <div className="flex items-start gap-3">
        <span
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-[13px] font-extrabold flex-shrink-0"
          style={{ backgroundColor: color.hex }}
        >
          {node.id}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: color.hex }}>
            {STAGE_LABELS[meta.stage]} 단계 · {statusLabel}
          </p>
          <p className="text-[15px] font-bold text-[#202124] truncate">{meta.label}</p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-[#5F6368]">
            {meta.isGuardrailSource && (
              <span className="px-2 py-0.5 rounded-full bg-[#F3E5F5] text-[#7B1FA2] font-semibold">가드레일 소스</span>
            )}
            {meta.isBackwardDesignFirst && (
              <span className="px-2 py-0.5 rounded-full bg-[#FFF3E0] text-[#E65100] font-semibold">백워드 시작</span>
            )}
            {artifactTitle && (
              <span className="px-2 py-0.5 rounded-full bg-[#E8F0FE] text-[#1A73E8] font-semibold truncate max-w-[240px]">
                산출물: {artifactTitle}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onOpen}
            className="px-3 py-1.5 text-[12px] font-semibold rounded-full bg-[#1A73E8] text-white hover:bg-[#1557B0] transition-colors whitespace-nowrap"
          >
            이 활동으로 이동
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="선택 해제"
            className="p-1.5 rounded-full text-[#5F6368] hover:bg-[#E8EAED] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 구조화된 교육 정보 — 성취기준·핵심아이디어·차시.
          특히 A-2-1(성취기준 분석), Ds-*(설계), T-2-3(일정)에서 의미 있음. */}
      {node.structured && (
        node.structured.standardCodes.length > 0 ||
        node.structured.coreIdeas.length > 0 ||
        node.structured.classHourPlan.length > 0
      ) && (
        <div className="rounded-xl border-2 border-[#E1BEE7] bg-gradient-to-br from-[#F3E5F5] to-white px-3 py-2.5 space-y-2">
          <p className="text-[10px] font-bold text-[#7B1FA2] uppercase tracking-widest">
            📚 구조화된 교육 정보
          </p>
          {node.structured.standardCodes.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-[#5F6368] mb-1">성취기준 코드 ({node.structured.standardCodes.length})</p>
              <div className="flex flex-wrap gap-1">
                {node.structured.standardCodes.map(code => (
                  <span
                    key={code}
                    className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-mono font-bold bg-white border border-[#CE93D8] text-[#6A1B9A]"
                  >
                    [{code}]
                  </span>
                ))}
              </div>
            </div>
          )}
          {node.structured.coreIdeas.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-[#5F6368] mb-1">핵심아이디어 ({node.structured.coreIdeas.length})</p>
              <ul className="space-y-1">
                {node.structured.coreIdeas.map((idea, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#3C4043] leading-relaxed">
                    <span className="text-[#F9AB00] flex-shrink-0 mt-0.5">★</span>
                    <span>{idea}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {node.structured.classHourPlan.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-[#5F6368] mb-1">차시 구성 ({node.structured.classHourPlan.length})</p>
              <div className="flex flex-wrap gap-1">
                {node.structured.classHourPlan.map((item, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] bg-white border border-[#CE93D8] text-[#6A1B9A] max-w-[280px] truncate"
                    title={item}
                  >
                    🕐 {item}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 핵심 개념 (전체) */}
      {node.keywords && node.keywords.length > 0 ? (
        <div className="rounded-xl border border-[#E8EAED] bg-white px-3 py-2.5">
          <p className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-widest mb-1.5">
            🏷 이 산출물의 핵심 개념
          </p>
          <div className="flex flex-wrap gap-1.5">
            {node.keywords.map(kw => <ConceptTag key={kw} kw={kw} stage={node.stage} />)}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#E8EAED] bg-white px-3 py-3 text-[12px] text-[#9AA0A6] text-center">
          아직 산출물이 저장되지 않아 추출할 개념이 없습니다.
        </div>
      )}

      {/* 이전에서 계승된 개념 */}
      {incomingByActivity.size > 0 && (
        <div className="rounded-xl border border-[#E8EAED] bg-white overflow-hidden">
          <p className="px-3 py-1.5 text-[10px] font-bold text-[#9AA0A6] uppercase tracking-widest bg-[#F8F9FA] border-b border-[#F1F3F4]">
            ↘ 이전 활동에서 계승된 개념
          </p>
          <div className="divide-y divide-[#F1F3F4]">
            {Array.from(incomingByActivity.entries()).map(([srcId, kws]) => {
              const src = nodeMap.get(srcId)
              if (!src) return null
              return (
                <button
                  key={srcId}
                  type="button"
                  onClick={() => onJumpTo(srcId)}
                  className="w-full flex items-start gap-3 px-3 py-2 hover:bg-[#F8F9FA] transition-colors text-left"
                >
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-extrabold flex-shrink-0"
                    style={{ backgroundColor: STAGE_COLOR[src.stage].hex }}
                  >
                    {src.id}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-[#202124] truncate">{src.label}에서</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {kws.map(kw => <ConceptTag key={kw} kw={kw} stage={src.stage} size="sm" />)}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 이후로 이어지는 개념 */}
      {outgoingByActivity.size > 0 && (
        <div className="rounded-xl border border-[#E8EAED] bg-white overflow-hidden">
          <p className="px-3 py-1.5 text-[10px] font-bold text-[#9AA0A6] uppercase tracking-widest bg-[#F8F9FA] border-b border-[#F1F3F4]">
            ↗ 이후 활동으로 이어지는 개념
          </p>
          <div className="divide-y divide-[#F1F3F4]">
            {Array.from(outgoingByActivity.entries()).map(([dstId, kws]) => {
              const dst = nodeMap.get(dstId)
              if (!dst) return null
              return (
                <button
                  key={dstId}
                  type="button"
                  onClick={() => onJumpTo(dstId)}
                  className="w-full flex items-start gap-3 px-3 py-2 hover:bg-[#F8F9FA] transition-colors text-left"
                >
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-extrabold flex-shrink-0"
                    style={{ backgroundColor: STAGE_COLOR[dst.stage].hex }}
                  >
                    {dst.id}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-[#202124] truncate">{dst.label}에서 다시 등장</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {kws.map(kw => <ConceptTag key={kw} kw={kw} stage={dst.stage} size="sm" />)}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 원문 — 항상 펼쳐서 바로 확인 가능. 마크다운(테이블/볼드/리스트)을 실제 시각으로 렌더. */}
      {node.sections && node.sections.length > 0 && (
        <div className="rounded-xl border border-[#E8EAED] bg-white overflow-hidden">
          <p className="px-3 py-2 text-[11px] font-bold text-[#5F6368] bg-[#F8F9FA] border-b border-[#F1F3F4]">
            📄 산출물 원문 ({node.sections.length}개 섹션)
          </p>
          <div className="divide-y divide-[#F1F3F4]">
            {node.sections.map(sec => (
              <div key={sec.key} className="px-3 py-2">
                <p className="text-[11px] font-bold mb-1" style={{ color: color.hex }}>{sec.key}</p>
                <div className="text-[#3C4043]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={sectionMarkdownComponents}>
                    {normalizeInlinePipeList(sec.value)}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 공개 링크 페이지용 인라인 버전 — 모달이 아닌 섹션으로 렌더.
 * 민감 정보 없이 구조만 보여준다.
 */
export function PublicOntologySection({
  stageReports,
}: {
  stageReports?: Record<string, unknown>
}) {
  const graph = useMemo(
    () => buildProjectOntology({ stageReports: stageReports as Record<string, never> }),
    [stageReports],
  )
  return (
    <section>
      <header className="mb-5 flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-white flex-shrink-0 bg-gradient-to-br from-[#1A73E8] to-[#1557B0]">
          <GraphIcon size={22} weight="fill" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#1A73E8]">프로젝트 구조</p>
          <h2 className="text-[20px] font-extrabold text-[#202124] leading-tight">온톨로지 그래프</h2>
        </div>
      </header>
      <article>
        <p className="text-[13px] text-[#5F6368] leading-relaxed mb-5">
          이 프로젝트는 T-CID 협력적 수업설계 모형(팀준비 → 분석 → 설계 → 개발·실행 → 평가)을 따라 구성되었습니다. 아래 그래프는 각 단계의 활동과 그 사이의 교육적 관계(가드레일·백워드 디자인·주기 순환)를 보여줍니다.
        </p>
        <div className="rounded-2xl border border-[#DADCE0] bg-white p-4 mb-4 shadow-sm">
          <ProjectOntologyGraph graph={graph} publicMode className="mx-auto" />
        </div>
        <OntologyLegend publicMode />
      </article>
    </section>
  )
}
