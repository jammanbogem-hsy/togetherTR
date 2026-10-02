'use client'

// 교육과정 분석맵 우측 패널 — 검색 결과, 선택 성취기준 상세·관련 목록, 보기 설정.
// M3: surface-container-low 시트 + surface-container-lowest 카드.

import { useMemo, useState } from 'react'
import { MD3Button } from '@/components/ui/MD3Button'
import { EDGE_THRESHOLD_MAX, EDGE_THRESHOLD_MIN, groupResultsByBand } from './mapMath'
import { JudgeBadge, M3Switch, SectionTitle } from './MapPanelBits'
import { AchievementLevelList } from './MapLevelBits'
import { PickButton, RelatedCard, ResultCard } from './MapResultCards'
import type { RelatedState, SearchState } from './useCurriculumMap'
import { subjectIcon } from './subjectIcons'
import type { MapFilters, MapNode } from './types'

export interface MapSidePanelProps {
  subjectColors: Record<string, string>
  filters: MapFilters
  onEdgeThresholdChange: (value: number) => void
  onAlwaysLabelsChange: (value: boolean) => void
  onPhysicsChange: (value: boolean) => void
  /** 관련 카드에 양쪽 성취수준 원문을 붙이기 위한 조회표 */
  nodeById: Map<string, MapNode>
  onResetFilters: () => void
  /** 카드 호버 → 캔버스에서 해당 노드·연결 강조 */
  onHoverItem: (id: string | null) => void
  search: SearchState
  onPickResult: (id: string) => void
  selectedNode: MapNode | null
  related: RelatedState
  onPickRelated: (id: string) => void
  onRefetchRelated: () => void
  onClearSelection: () => void
  /** 필터에 가려져 점선으로 표시된 관련 항목 수 */
  hiddenRelatedCount: number
  /** 결과를 묶어 보여 줄 학년군 순서 (체크된 것만) */
  bands: string[]
  /** 담긴 성취기준 id */
  pickedIds: ReadonlySet<string>
  /** 없으면 담기 버튼을 숨긴다(보낼 곳이 없는 공개 사이트) */
  onTogglePick?: (id: string) => void
  /** 검색 결과 맨 위에 놓는 조각(융합 핵심 추천 카드) */
  searchTop?: React.ReactNode
}

function Hint({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="py-5 text-center text-[14px] leading-[1.5] text-[var(--md-on-surface-variant)]">{children}</p>
  )
}

function Loading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="py-4">
      <div className="m3-progress mb-2.5" />
      <p className="text-center text-[14px] text-[var(--md-on-surface-variant)]">{children}</p>
    </div>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div className="rounded-xl bg-[var(--md-error-container)] px-4 py-3">
      <p className="text-[14px] leading-[1.5] text-[var(--md-on-error-container)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 text-[14px] font-medium text-[var(--md-on-error-container)] underline"
        >
          다시 시도
        </button>
      )}
    </div>
  )
}

export default function MapSidePanel({
  subjectColors,
  filters,
  onEdgeThresholdChange,
  onAlwaysLabelsChange,
  onPhysicsChange,
  nodeById,
  onResetFilters,
  onHoverItem,
  search,
  onPickResult,
  selectedNode,
  related,
  onPickRelated,
  onRefetchRelated,
  onClearSelection,
  hiddenRelatedCount,
  bands,
  pickedIds,
  onTogglePick,
  searchTop,
}: MapSidePanelProps): React.ReactElement {
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [weakOpen, setWeakOpen] = useState(false)

  // 학년군별 묶기 — 백엔드 byBand 가 있으면 그대로, 없으면 클라이언트에서
  const bandGroups = useMemo(
    () => groupResultsByBand(search.results, bands, search.byBand, search.emptyBands),
    [bands, search.byBand, search.emptyBands, search.results],
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--md-surface-container-low)]">
      {/* ── 선택 성취기준 상세 ─────────────────────────────────────────── */}
      {selectedNode && (
        <section className="border-b border-[var(--md-outline-variant)] p-5">
          <SectionTitle
            right={
              <MD3Button variant="text" size="xs" tone="neutral" onClick={onClearSelection}>
                선택 해제
              </MD3Button>
            }
          >
            선택한 성취기준
          </SectionTitle>

          <div className="rounded-xl border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-lowest)] p-4">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[13px] font-medium text-white"
                style={{ backgroundColor: subjectColors[selectedNode.subjectId] ?? '#747775' }}
              >
                {subjectIcon(selectedNode.subjectId) && (
                  <span className="material-symbols-rounded text-[18px] leading-none">
                    {subjectIcon(selectedNode.subjectId)}
                  </span>
                )}
                {selectedNode.subject}
              </span>
              <span className="text-[16px] font-medium text-[var(--md-on-surface)]">{selectedNode.code}</span>
              <span className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">{selectedNode.band}</span>
            </div>
            <p className="mb-3 text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{selectedNode.text}</p>
            <div className="mb-3">
              {onTogglePick && (
                <PickButton picked={pickedIds.has(selectedNode.id)} onToggle={() => onTogglePick(selectedNode.id)} />
              )}
            </div>
            <dl className="space-y-1.5">
              {selectedNode.area && (
                <div className="flex gap-2">
                  <dt className="flex-shrink-0 text-[12px] font-medium text-[var(--md-on-surface-variant)]">영역</dt>
                  <dd className="text-[14px] text-[var(--md-on-surface)]">{selectedNode.area}</dd>
                </div>
              )}
              {selectedNode.coreIdea && (
                <div className="flex gap-2">
                  <dt className="flex-shrink-0 text-[12px] font-medium text-[var(--md-on-surface-variant)]">
                    핵심 아이디어
                  </dt>
                  <dd className="text-[14px] leading-[1.5] text-[var(--md-on-surface)]">{selectedNode.coreIdea}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="flex-shrink-0 text-[12px] font-medium text-[var(--md-on-surface-variant)]">연결</dt>
                <dd className="text-[14px] text-[var(--md-on-surface)]">
                  유사도 이웃·교과 간 링크 {selectedNode.degree}개
                </dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-[var(--md-outline-variant)] pt-3">
              <h4 className="mb-2 text-[13px] font-medium text-[var(--md-on-surface-variant)]">
                성취수준 (공식 원문)
              </h4>
              <AchievementLevelList levels={selectedNode.levels} />
            </div>
          </div>

          {/* 관련 성취기준 */}
          <div className="mt-5">
            <SectionTitle
              right={
                <div className="flex items-center gap-2">
                  {related.status === 'loading' && (
                    <span className="rounded-lg bg-[var(--md-surface-container-high)] px-2 py-0.5 text-[13px] font-medium text-[var(--md-on-surface-variant)]">
                      AI 판정 중…
                    </span>
                  )}
                  <JudgeBadge judge={related.judge} elapsedMs={related.elapsedMs} />
                  <MD3Button
                    variant="outlined"
                    size="xs"
                    onClick={onRefetchRelated}
                    disabled={related.status === 'loading'}
                  >
                    관련 다시 판정
                  </MD3Button>
                </div>
              }
            >
              관련 성취기준
            </SectionTitle>

            <p className="mb-2 text-[13px] leading-[1.5] text-[var(--md-on-surface-variant)]">
              색 선 = AI 관계 판정(두 성취기준의 성취수준 A·B·C 원문까지 근거로 판정) · 회색 선 = 의미가
              비슷한 이웃(마우스를 올렸을 때). 카드의 ‘성취수준 비교’에서 두 원문을 수준별로 나란히 볼 수 있습니다.
            </p>

            {related.status === 'loading' && (
              <Loading>지금은 의미가 비슷한 이웃을 보여 주는 중입니다. AI 관계 판정이 끝나면 바뀝니다.</Loading>
            )}
            {related.status === 'ready' && hiddenRelatedCount > 0 && (
              <p className="mb-2 text-[13px] leading-[1.5] text-[var(--md-on-surface-variant)]">
                필터에 가려진 관련 성취기준 {hiddenRelatedCount}개를 점선으로 표시했습니다.
              </p>
            )}
            {related.status === 'error' && related.error && (
              <ErrorBox message={related.error} onRetry={onRefetchRelated} />
            )}
            {related.status === 'ready' && related.items.length === 0 && (
              <Hint>관련 성취기준을 찾지 못했습니다.</Hint>
            )}

            <ul className="space-y-2">
              {related.items.map(item => (
                <li key={item.id}>
                  <RelatedCard
                    item={item}
                    color={subjectColors[item.subjectId] ?? 'var(--md-on-surface-variant)'}
                    picked={pickedIds.has(item.id)}
                    onClick={() => onPickRelated(item.id)}
                    onHover={onHoverItem}
                    onTogglePick={onTogglePick ? () => onTogglePick(item.id) : undefined}
                    centerCode={selectedNode.code}
                    centerLevels={selectedNode.levels}
                    itemLevels={nodeById.get(item.id)?.levels}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── 검색 결과 ───────────────────────────────────────────────────── */}
      <section className="border-b border-[var(--md-outline-variant)] p-5">
        <SectionTitle right={<JudgeBadge judge={search.judge} elapsedMs={search.elapsedMs} />}>
          {search.submittedQuery ? `‘${search.submittedQuery}’ 검색 결과` : '검색 결과'}
        </SectionTitle>

        {search.status === 'idle' && (
          <Hint>
            수업 주제(예: 기후 위기, 우리 마을)를 검색하면
            <br />
            함께 엮을 성취기준과 융합의 중심이 될
            <br />
            ★ 핵심 성취기준을 추천해 줍니다.
          </Hint>
        )}
        {search.status === 'loading' && <Loading>성취기준을 찾는 중…</Loading>}
        {search.status === 'error' && search.error && <ErrorBox message={search.error} />}
        {search.status === 'ready' && searchTop}
        {search.status === 'ready' && search.results.length === 0 && (
          <Hint>일치하는 성취기준이 없습니다. 다른 키워드를 시도해 보세요.</Hint>
        )}

        {/* 결과가 하나도 없으면 위의 안내만 보여 준다 (학년군별 '없음' 줄 중복 방지) */}
        {search.status === 'ready' && bandGroups.groups.length > 0 && (
          <div className="space-y-4">
            {bandGroups.groups.map(group => (
              <div key={group.band}>
                <h4 className="mb-2 text-[13px] font-medium text-[var(--md-on-surface-variant)]">
                  {group.band} · {group.items.length}개
                </h4>
                <ul className="space-y-2">
                  {group.items.map(r => (
                    <li key={r.id}>
                      <ResultCard
                        result={r}
                        color={subjectColors[r.subjectId] ?? '#747775'}
                        picked={pickedIds.has(r.id)}
                        onClick={() => onPickResult(r.id)}
                        onHover={onHoverItem}
                        onTogglePick={onTogglePick ? () => onTogglePick(r.id) : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {bandGroups.emptyBands.map(band => (
              <div key={band}>
                <h4 className="mb-1 text-[13px] font-medium text-[var(--md-on-surface-variant)]">{band}</h4>
                <p className="text-[13px] leading-[1.5] text-[var(--md-outline)]">
                  해당 학년군에 관련 성취기준이 없습니다
                </p>
              </div>
            ))}
          </div>
        )}

        {search.weak.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--md-outline-variant)]">
            <button
              type="button"
              onClick={() => setWeakOpen(o => !o)}
              aria-expanded={weakOpen}
              className="m3-state flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <span className="text-[14px] font-medium text-[var(--md-on-surface-variant)]">
                관련성 낮음 {search.weak.length}개
              </span>
              <span className="material-symbols-rounded text-[20px] leading-none text-[var(--md-on-surface-variant)]">
                {weakOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {weakOpen && (
              <ul className="space-y-2 p-3 pt-0">
                {search.weak.map(r => (
                  <li key={r.id}>
                    <ResultCard
                      result={r}
                      color={subjectColors[r.subjectId] ?? '#747775'}
                      picked={pickedIds.has(r.id)}
                      onClick={() => onPickResult(r.id)}
                      onHover={onHoverItem}
                      onTogglePick={onTogglePick ? () => onTogglePick(r.id) : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── 보기 설정 ───────────────────────────────────────────────────── */}
      <section className="p-5">
        <SectionTitle
          right={
            <div className="flex items-center gap-1">
              <MD3Button variant="text" size="xs" tone="neutral" onClick={onResetFilters}>
                초기화
              </MD3Button>
              <MD3Button variant="text" size="xs" onClick={() => setFiltersOpen(o => !o)}>
                {filtersOpen ? '접기' : '펼치기'}
              </MD3Button>
            </div>
          }
        >
          보기 설정
        </SectionTitle>

        {filtersOpen && (
          <div className="space-y-5">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="edge-threshold" className="text-[12px] font-medium text-[var(--md-on-surface-variant)]">
                  연결선 표시 기준
                </label>
                <span className="rounded-lg bg-[var(--md-primary-container)] px-2 py-0.5 text-[12px] font-medium tabular-nums text-[var(--md-on-primary-container)]">
                  {filters.edgeThreshold.toFixed(2)}
                </span>
              </div>
              <input
                id="edge-threshold"
                type="range"
                className="m3-slider"
                min={EDGE_THRESHOLD_MIN}
                max={EDGE_THRESHOLD_MAX}
                step={0.05}
                value={filters.edgeThreshold}
                onChange={e => onEdgeThresholdChange(Number(e.target.value))}
              />
              <p className="mt-1 text-[12px] leading-[1.5] text-[var(--md-on-surface-variant)]">
                값을 올리면 더 강하게 연결된 성취기준만 남습니다.
              </p>
            </div>

            {filters.layout === 'similarity' ? (
              <>
                <M3Switch
                  checked={filters.physics}
                  onChange={onPhysicsChange}
                  label="움직임"
                />
                <p className="-mt-3 text-[13px] leading-[1.5] text-[var(--md-on-surface-variant)]">
                  끄면 노드가 지금 위치에 멈춥니다. 노드를 끌어 옮기는 것은 계속 됩니다.
                </p>
              </>
            ) : (
              <p className="text-[13px] leading-[1.5] text-[var(--md-on-surface-variant)]">
                성좌·표 배치에서는 자리가 교과·영역·학년군을 뜻하므로 움직이거나 끌어 옮기지 않습니다.
                유사도 지도는 캔버스 왼쪽 위 ‘유사도’ 버튼으로 볼 수 있습니다.
              </p>
            )}

            <M3Switch
              checked={filters.alwaysLabels}
              onChange={onAlwaysLabelsChange}
              label="라벨 항상 표시"
            />
          </div>
        )}
      </section>
    </div>
  )
}
