'use client'

import type { T11Structured } from '@/lib/artifacts/schemas'

export type T11DeletableField = 'personalVisions' | 'teamVision' | 'coreKeywords' | 'designPrinciples' | 'blocks'

interface Props {
  data: T11Structured
  /** 카드별 부분 삭제 — 호출자(ArtifactPanel)가 해당 필드를 비우고 setProjectArtifact 호출 */
  onDeleteField?: (field: T11DeletableField) => void
}

// 카드 헤더 우측 X 버튼 — onDeleteField가 있을 때만 표시
function SectionDeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} 섹션 삭제`}
      className="ml-auto w-6 h-6 rounded-md text-[#9AA0A6] hover:bg-[#FFEBEE] hover:text-[#C62828] inline-flex items-center justify-center transition-colors"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  )
}

export function T11Renderer({ data, onDeleteField }: Props) {
  const personalVisions = data?.personalVisions ?? []
  const teamVision = data?.teamVision ?? ''
  const coreKeywords = data?.coreKeywords ?? []
  const designPrinciples = data?.designPrinciples ?? []
  const manualWorkspace = data?.manualWorkspace
  // manualWorkspace.blocks(자유 편집 블록)만 별도 섹션으로 렌더.
  // manualWorkspace.columns/rows(개인 비전 표)는 personalVisions와 동일 데이터의 두 번 출력이라 제거.
  const includedBlocks = manualWorkspace?.blocks?.filter(block => {
    if (block.includeInArtifact === false) return false
    if (block.type === 'table') return (block.table?.columns?.length ?? 0) > 0 || !!block.content?.trim()
    return !!block.content?.trim()
  }) ?? []

  return (
    <div className="space-y-4">
      {/* 개인 비전 표 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">개인 비전</span>
          {onDeleteField && <SectionDeleteButton onClick={() => onDeleteField('personalVisions')} label="개인 비전" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm border-collapse [word-break:keep-all]">
            <thead className="bg-[#1A73E8]">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">교사명</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-white whitespace-nowrap border-b border-[#1557B0]">개인 비전 키워드</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-white border-b border-[#1557B0]">AI 정교화 비전</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F4]">
              {personalVisions.length > 0 ? (
                personalVisions.map((pv, i) => (
                  <tr key={i} className="hover:bg-[#F8F9FA]/50 transition-colors">
                    <td className="px-3 py-2.5 text-sm text-[#202124] font-semibold whitespace-nowrap">
                      {pv.teacherName} 선생님
                      {pv.subject && <span className="ml-1 text-[10px] text-[#5F6368] font-normal">({pv.subject})</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-[#202124]">
                      {pv.keywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {pv.keywords.map((kw, j) => (
                            <span key={j} className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-[#E8F0FE] text-[#1A73E8]">
                              {kw}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[#9AA0A6] text-xs">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed">
                      {pv.refinedVision || <span className="text-[#9AA0A6] text-xs">-</span>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-sm text-[#9AA0A6]">
                    아직 개인 비전이 수집되지 않았습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 팀 공통 비전 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">팀 공통 비전</span>
          {onDeleteField && <SectionDeleteButton onClick={() => onDeleteField('teamVision')} label="팀 공통 비전" />}
        </div>
        <div className="px-4 py-4">
          {teamVision ? (
            <p className="text-base font-semibold text-[#202124] leading-relaxed">
              &ldquo;{teamVision}&rdquo;
            </p>
          ) : (
            <p className="text-sm text-[#9AA0A6]">아직 팀 비전이 확정되지 않았습니다</p>
          )}
        </div>
      </div>

      {/* 핵심 키워드 */}
      <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
        <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">핵심 키워드</span>
          {onDeleteField && <SectionDeleteButton onClick={() => onDeleteField('coreKeywords')} label="핵심 키워드" />}
        </div>
        <div className="px-4 py-3">
          {coreKeywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {coreKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-[#E8F0FE] text-[#1A73E8] border border-[#D2E3FC]"
                >
                  #{kw}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#9AA0A6]">아직 핵심 키워드가 추출되지 않았습니다</p>
          )}
        </div>
      </div>

      {designPrinciples.length > 0 && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">설계 원칙</span>
            {onDeleteField && <SectionDeleteButton onClick={() => onDeleteField('designPrinciples')} label="설계 원칙" />}
          </div>
          <ol className="px-4 py-3 space-y-2">
            {designPrinciples.map((item, index) => (
              <li key={`${item.principle}-${index}`} className="text-sm text-[#202124] leading-relaxed">
                <span className="font-bold text-[#1A73E8] mr-2">{index + 1}.</span>
                {item.principle}
                {item.rationale && <p className="ml-6 text-xs text-[#5F6368]">{item.rationale}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {includedBlocks.length > 0 && (
        <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white">
          <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center">
            <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">자유 편집 블록</span>
            {onDeleteField && <SectionDeleteButton onClick={() => onDeleteField('blocks')} label="자유 편집 블록" />}
          </div>
          <div className="px-4 py-3 space-y-2.5">
            {includedBlocks.map(block => (
              <div
                key={block.id}
                className="rounded-xl border border-[#E8EAED] bg-white px-3 py-2.5 text-sm text-[#202124] leading-relaxed whitespace-pre-wrap"
              >
                {block.type === 'heading' ? (
                  <p className="text-base font-extrabold">{block.content}</p>
                ) : block.type === 'checklist' ? (
                  <p><span className="font-bold text-[#137333] mr-1">{block.checked ? '✓' : '□'}</span>{block.content}</p>
                ) : block.type === 'quote' ? (
                  <blockquote className="border-l-4 border-[#DADCE0] pl-3 italic text-[#5F6368]">{block.content}</blockquote>
                ) : block.type === 'table' && block.table ? (
                  <div className="-m-1 overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          {block.table.columns.map(column => (
                            <th key={column.id} className="border border-[#1557B0] bg-[#1A73E8] px-2.5 py-2 text-left text-xs font-bold text-white">
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.table.rows.map(row => (
                          <tr key={row.id}>
                            {block.table!.columns.map(column => (
                              <td key={column.id} className="border border-[#DADCE0] px-2.5 py-2 align-top">
                                {row.cells?.[column.id]?.trim() || <span className="text-[#9AA0A6] text-xs">-</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>{block.content}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
