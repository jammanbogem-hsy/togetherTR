'use client'

/**
 * 성취기준 → 성취수준 → 학습활동 → 평가 정렬 점검 카드 (Ds 단계 산출물 패널).
 * 성취기준마다 그 코드를 근거로 적은 학습 활동(Ds-1-3)·평가 요소(Ds-1-1)를 한 줄에 모으고 빈칸을 드러낸다.
 */

import { useMemo, useState } from 'react'
import { buildAlignment, type AlignmentLink } from '@/lib/curriculum/alignment'
import { designStandardSources, extractStandardCodes } from '@/lib/curriculum/standardCodes'
import { useAchievementLevels } from '@/lib/curriculum/useAchievementLevels'
import type { CurriculumSheetRow } from '@/types'
import { AchievementLevelList, LevelBadge } from './AchievementLevelDisclosure'

type ArtifactMap = Record<string, { content?: Record<string, unknown> | null } | undefined>

function LinkList({ links, emptyText, artifactReady }: { links: AlignmentLink[]; emptyText: string; artifactReady: boolean }) {
  if (links.length === 0) {
    return artifactReady
      ? <span className="inline-block rounded-md bg-[#FCE8E6] px-2 py-0.5 text-[11px] font-bold text-[#C5221F]">{emptyText}</span>
      : <span className="text-[12px] text-[#9AA0A6]">아직 설계 전</span>
  }
  return (
    <ul className="space-y-1">
      {links.map((link, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[#3C4043]">
          <span className="flex shrink-0 gap-0.5 pt-px">{link.levels.map(l => <LevelBadge key={l} level={l} />)}</span>
          <span>{link.label}</span>
        </li>
      ))}
    </ul>
  )
}

export function AlignmentMatrixCard({ artifacts, curriculumSheet }: {
  artifacts?: ArtifactMap | null
  curriculumSheet?: readonly Pick<CurriculumSheetRow, 'standard'>[] | null
}) {
  const [open, setOpen] = useState(true)
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const { levels, error } = useAchievementLevels(true)

  const codes = useMemo(() => {
    const all = extractStandardCodes(designStandardSources(artifacts, curriculumSheet).join('\n'))
    return levels ? all.filter(code => levels[code]) : all
  }, [artifacts, curriculumSheet, levels])

  const alignment = useMemo(
    () => buildAlignment(codes, artifacts?.['Ds-1-1']?.content, artifacts?.['Ds-1-3']?.content),
    [codes, artifacts],
  )

  if (codes.length === 0) return null

  const gaps = alignment.rows.filter(r =>
    (alignment.hasActivityArtifact && r.activities.length === 0) || (alignment.hasEvaluationArtifact && r.evaluations.length === 0),
  ).length
  const noALevel = alignment.hasActivityArtifact
    ? alignment.rows.filter(r => r.activities.length > 0 && !r.activities.some(a => a.levels.includes('A'))).length
    : 0

  return (
    <section className="rounded-2xl border border-[#DADCE0] bg-white overflow-hidden [word-break:keep-all]">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] text-left"
      >
        <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider">성취기준 정렬 점검 — 성취기준 · 성취수준 · 학습활동 · 평가</span>
        <span className="flex items-center gap-2 text-[11px] font-semibold">
          {gaps > 0
            ? <span className="rounded-full bg-[#FCE8E6] px-2 py-0.5 text-[#C5221F]">빈칸 {gaps}</span>
            : (alignment.hasActivityArtifact || alignment.hasEvaluationArtifact) && <span className="rounded-full bg-[#E6F4EA] px-2 py-0.5 text-[#137333]">빈칸 없음</span>}
          <span className="text-[#80868B]">{open ? '접기' : '펼치기'}</span>
        </span>
      </button>
      {open && (
        <div>
          {error && <p className="px-4 py-2 text-[12px] text-[#C5221F]">{error}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm border-collapse">
              <thead>
                <tr className="bg-[#1A73E8] text-left text-xs font-bold text-white">
                  <th className="px-3 py-2 w-[26%]">성취기준 · 성취수준</th>
                  <th className="px-3 py-2">학습 활동 (Ds-1-3)</th>
                  <th className="px-3 py-2">평가 요소 (Ds-1-1)</th>
                </tr>
              </thead>
              <tbody>
                {alignment.rows.map(row => {
                  const entry = levels?.[row.code]
                  const expanded = expandedCode === row.code
                  return (
                    <tr key={row.code} className="align-top border-b border-[#F1F3F4]">
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-[#1A73E8]">{row.code}</p>
                        {entry && <p className="text-[11px] text-[#80868B]">{entry.subject} · {entry.band}</p>}
                        {entry && (
                          <button
                            type="button"
                            onClick={() => setExpandedCode(expanded ? null : row.code)}
                            aria-expanded={expanded}
                            className="mt-1 text-[11px] font-semibold text-[#5F6368] underline-offset-2 hover:underline"
                          >
                            성취수준 {expanded ? '접기' : '보기'}
                          </button>
                        )}
                        {entry && expanded && <div className="mt-1.5"><AchievementLevelList entry={entry} /></div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <LinkList links={row.activities} emptyText="연결된 활동 없음" artifactReady={alignment.hasActivityArtifact} />
                      </td>
                      <td className="px-3 py-2.5">
                        <LinkList links={row.evaluations} emptyText="평가 요소 없음" artifactReady={alignment.hasEvaluationArtifact} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 border-t border-[#E8EAED] bg-[#F8F9FA] px-4 py-2.5 text-[11px] leading-relaxed text-[#5F6368]">
            {noALevel > 0 && (
              <p className="font-semibold text-[#B06000]">
                활동은 있지만 A 수준을 겨냥한 활동이 없는 성취기준 {noALevel}개 — 학생이 A 수준 행동을 해 볼 기회가 있는지 확인해 보세요.
              </p>
            )}
            <p>연결은 산출물에 적힌 성취기준 코드로만 판단합니다. 코드 옆 A·B·C 표시는 그 활동·평가가 겨냥하는 수준입니다. 빈칸이 있으면 채팅에서 &ldquo;정렬 점검 빈칸을 채워 줘&rdquo;처럼 요청해 보세요.</p>
          </div>
        </div>
      )}
    </section>
  )
}
