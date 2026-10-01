'use client'

// 교육과정 분석맵 — "융합 찾기" 패널 조각.
//  - FusionHubCard: 검색 결과 맨 위의 ★ 핵심 추천 카드. 체크하면 융합 그래프가 열린다.
//  - FusionPanel: 융합 그래프가 열려 있을 때 오른쪽 패널(교과별 짝 목록·담기).

import { useMemo } from 'react'
import { MD3Button } from '@/components/ui/MD3Button'
import { JudgeBadge, SectionTitle } from './MapPanelBits'
import { RelatedCard } from './MapResultCards'
import { subjectIcon } from './subjectIcons'
import type { FusionState } from './useCurriculumMap'
import type { MapFusionHub, MapNode } from './types'

/** 융합 방식 — 교사가 바로 수업 활동으로 읽을 수 있는 한 줄 */
export const RELATION_TYPE_HINTS: Record<string, string> = {
  '의미연결': '같은 개념·주제를 두 교과에서 함께 다룬다',
  '도구-활용': '한 교과의 기능·방법을 다른 교과 탐구의 도구로 쓴다 (예: 그래프로 과학 자료 해석)',
  '현상-가치': '탐구한 현상을 가치·실천의 관점에서 성찰한다 (예: 환경 현상 → 도덕적 실천)',
  '내용-표현': '탐구한 내용을 글·그림·음악·몸짓으로 표현한다',
  '개념-적용': '한쪽에서 익힌 개념을 다른 쪽에서 실제 상황에 적용한다',
  '문제-해결': '같은 문제를 두 교과가 서로 다른 방식으로 함께 푼다',
  '탐구-실천': '탐구 결과를 생활 속 실천 활동으로 잇는다',
  '원인-결과': '한쪽 내용이 다른 쪽의 원인 또는 결과가 된다',
}

const GOLD = '#F5B301'

function Star({ size = 18 }: { size?: number }): React.ReactElement {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 9 : 4
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${(Math.cos(a) * radius).toFixed(1)},${(Math.sin(a) * radius).toFixed(1)}`)
  }
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden className="shrink-0">
      <polygon points={pts.join(' ')} fill={GOLD} stroke="#8A5A00" strokeWidth={1} />
    </svg>
  )
}

function SubjectPill({ subjectId, name, color }: { subjectId: string; name: string; color: string }): React.ReactElement {
  const icon = subjectIcon(subjectId)
  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[13px] font-medium text-white" style={{ backgroundColor: color }}>
      {icon && <span className="material-symbols-rounded text-[16px] leading-none">{icon}</span>}
      {name}
    </span>
  )
}

export function FusionHubCard({
  hubs,
  nodeById,
  subjectColors,
  subjectNames,
  activeHubId,
  onOpen,
  onLocate,
}: {
  hubs: MapFusionHub[]
  nodeById: Map<string, MapNode>
  subjectColors: Record<string, string>
  subjectNames: Record<string, string>
  activeHubId: string | null
  onOpen: (hubId: string) => void
  /** 지도에서 위치 보기 */
  onLocate: (id: string) => void
}): React.ReactElement | null {
  const [main, ...others] = hubs.filter(h => nodeById.has(h.id))
  if (!main) return null
  const node = nodeById.get(main.id)!
  const color = subjectColors[node.subjectId] ?? '#747775'
  const checked = activeHubId === main.id

  return (
    <div className="mb-4">
      <div
        className="rounded-2xl border-2 p-4"
        style={{ borderColor: GOLD, background: 'linear-gradient(180deg, rgba(245,179,1,0.10), rgba(245,179,1,0.02))' }}
      >
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#8A5A00]">
          <Star />
          융합 핵심 추천
          <span className="ml-auto text-[12px] font-medium text-[var(--md-on-surface-variant)]">
            주제 관련 {Math.round(main.topic * 100)}% · 엮을 교과 {main.partnerSubjectIds.length}개
          </span>
        </div>
        <button type="button" onClick={() => onLocate(main.id)} className="block w-full text-left" title="지도에서 위치 보기">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <SubjectPill subjectId={node.subjectId} name={node.subject} color={color} />
            <span className="text-[16px] font-semibold text-[var(--md-on-surface)]">{node.code}</span>
            <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{node.band}</span>
          </div>
          <p className="text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{node.text}</p>
        </button>
        {main.partnerSubjectIds.length > 0 && (
          <p className="mt-2 text-[13px] leading-[1.5] text-[var(--md-on-surface-variant)]">
            함께 엮을 수 있는 교과: {main.partnerSubjectIds.map(id => subjectNames[id] ?? id).join(' · ')}
          </p>
        )}
        <label
          className={`m3-state mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-semibold ${
            checked ? 'bg-[#F5B301] text-[#3A2600]' : 'bg-[var(--md-surface-container-lowest)] text-[var(--md-on-surface)] ring-1 ring-[#F5B301]'
          }`}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onOpen(main.id)}
            className="h-5 w-5 accent-[#8A5A00]"
          />
          이 성취기준을 중심으로 융합 묶음 보기
        </label>
      </div>

      {others.length > 0 && (
        <div className="mt-2">
          <p className="mb-1.5 text-[12px] font-medium text-[var(--md-on-surface-variant)]">다른 중심 후보</p>
          <ul className="space-y-1.5">
            {others.map(h => {
              const n = nodeById.get(h.id)!
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(h.id)}
                    className="m3-state flex w-full items-center gap-2 rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] px-3 py-2 text-left"
                    title="이 성취기준을 중심으로 융합 묶음 보기"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subjectColors[n.subjectId] ?? '#747775' }} />
                    <span className="text-[13px] font-semibold text-[var(--md-on-surface)]">{n.code}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--md-on-surface-variant)]">{n.text}</span>
                    <span className="material-symbols-rounded text-[18px] leading-none text-[var(--md-on-surface-variant)]">hub</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export function FusionPanel({
  fusion,
  hubNode,
  nodeById,
  subjectColors,
  subjectOrder,
  subjectNames,
  strongMin,
  showWeak,
  focusedId,
  onFocus,
  pickedIds,
  onTogglePick,
  onHover,
  onClose,
}: {
  fusion: FusionState
  hubNode: MapNode | null
  nodeById: Map<string, MapNode>
  subjectColors: Record<string, string>
  subjectOrder: readonly string[]
  subjectNames: Record<string, string>
  strongMin: number
  showWeak: boolean
  focusedId: string | null
  onFocus: (id: string | null) => void
  pickedIds: ReadonlySet<string>
  onTogglePick?: (id: string) => void
  onHover: (id: string | null) => void
  onClose: () => void
}): React.ReactElement {
  const strong = fusion.items.filter(i => i.strength >= strongMin)
  const visible = showWeak || strong.length < 3 ? fusion.items : strong
  const groups = useMemo(() => {
    const bySubject = new Map<string, typeof visible>()
    for (const item of visible) {
      const list = bySubject.get(item.subjectId)
      if (list) list.push(item)
      else bySubject.set(item.subjectId, [item])
    }
    return [...bySubject.entries()].sort(
      (a, b) => (subjectOrder.indexOf(a[0]) + 1 || 99) - (subjectOrder.indexOf(b[0]) + 1 || 99),
    )
  }, [subjectOrder, visible])
  const allPicked = hubNode !== null && [hubNode.id, ...visible.map(i => i.id)].every(id => pickedIds.has(id))

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--md-surface-container-low)]">
      <section className="border-b border-[var(--md-outline-variant)] p-5">
        <SectionTitle
          right={
            <MD3Button variant="text" size="xs" tone="neutral" onClick={onClose}>
              원래 지도로
            </MD3Button>
          }
        >
          융합 묶음
        </SectionTitle>
        {hubNode && (
          <div className="rounded-2xl border-2 p-4" style={{ borderColor: GOLD }}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Star />
              <SubjectPill subjectId={hubNode.subjectId} name={hubNode.subject} color={subjectColors[hubNode.subjectId] ?? '#747775'} />
              <span className="text-[16px] font-semibold text-[var(--md-on-surface)]">{hubNode.code}</span>
              <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{hubNode.band}</span>
            </div>
            <p className="text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{hubNode.text}</p>
          </div>
        )}
        <p className="mt-3 text-[13px] leading-[1.5] text-[var(--md-on-surface-variant)]">
          ‘{fusion.query || '주제 없음'}’을 수업 주제로 두고, 같은 학년군 다른 교과 성취기준 중 이 핵심과 한 수업으로 엮기 자연스러운 것을
          AI 가 판정했습니다. 선 색은 융합 방식, 가까울수록 엮기 쉽습니다.
        </p>
        {onTogglePick && hubNode && visible.length > 0 && (
          <div className="mt-3">
            <MD3Button
              variant={allPicked ? 'outlined' : 'filled'}
              size="sm"
              onClick={() => {
                for (const id of [hubNode.id, ...visible.map(i => i.id)]) {
                  if (allPicked || !pickedIds.has(id)) onTogglePick(id)
                }
              }}
            >
              {allPicked ? '묶음 담기 취소' : `묶음 전체 담기 (${visible.length + 1}개)`}
            </MD3Button>
          </div>
        )}
      </section>

      <section className="p-5">
        <SectionTitle right={<JudgeBadge judge={fusion.judge} elapsedMs={fusion.elapsedMs} />}>
          {fusion.status === 'ready' ? `함께 엮을 성취기준 ${visible.length}개` : '함께 엮을 성취기준'}
        </SectionTitle>
        {fusion.status === 'loading' && (
          <div className="py-4">
            <div className="m3-progress mb-2.5" />
            <p className="text-center text-[14px] text-[var(--md-on-surface-variant)]">융합 관계를 판정하는 중…</p>
          </div>
        )}
        {fusion.status === 'error' && fusion.error && (
          <p className="rounded-xl bg-[var(--md-error-container)] px-4 py-3 text-[14px] text-[var(--md-on-error-container)]">{fusion.error}</p>
        )}
        <div className="space-y-4">
          {groups.map(([subjectId, items]) => (
            <div key={subjectId}>
              <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: subjectColors[subjectId] ?? 'inherit' }}>
                {subjectNames[subjectId] ?? subjectId} · {items.length}개
              </h4>
              <ul className="space-y-2">
                {items.map(item => (
                  <li key={item.id} className={focusedId === item.id ? 'rounded-xl ring-2 ring-[#F5B301]' : undefined}>
                    <RelatedCard
                      item={item}
                      color={subjectColors[item.subjectId] ?? 'var(--md-on-surface-variant)'}
                      picked={pickedIds.has(item.id)}
                      onClick={() => onFocus(focusedId === item.id ? null : item.id)}
                      onHover={onHover}
                      onTogglePick={onTogglePick ? () => onTogglePick(item.id) : undefined}
                      centerCode={hubNode?.code ?? ''}
                      centerLevels={hubNode?.levels}
                      itemLevels={nodeById.get(item.id)?.levels}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
