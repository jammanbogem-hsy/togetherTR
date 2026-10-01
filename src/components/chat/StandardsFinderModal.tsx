'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, MagnifyingGlass, Check, PaperPlaneRight } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { fetchCurriculumJson } from '@/lib/curriculum/curriculumFilters'

/**
 * 성취기준 찾기 모달.
 *
 * 데이터 소스: public/curriculum_json/{교과}.json (12개 파일).
 * 각 파일 구조: { subject: {name}, core_idea_groups: [{area, standard_sets: [{school_level, grade_band, standards: [{code, text}]}]}] }
 *
 * UX:
 *  - 교과 필터 (chip 다중 선택)
 *  - 학년군 필터 (chip 단일 선택)
 *  - 키워드 검색 (대소문자·공백 관대)
 *  - 체크박스 다중 선택 → "채팅에 보내기" 클릭 시 선택된 성취기준을 마크다운 목록으로 채팅 입력창에 삽입
 */

interface CurriculumFile {
  subject: { name: string; school_levels?: string[] }
  core_idea_groups: Array<{
    area: string
    standard_sets: Array<{
      school_level: string
      grade_band: string
      standards: Array<{ code: string; text: string }>
    }>
  }>
}

interface FlatStandard {
  code: string
  text: string
  subject: string
  area: string
  schoolLevel: string
  gradeBand: string
}

const SUBJECTS = [
  '국어', '도덕', '사회', '수학', '과학', '실과',
  '체육', '음악', '미술', '영어', '통합교과', '창의적체험활동',
] as const

const SUBJECT_FILE: Record<string, string> = {
  '국어': '국어교육과정.json',
  '도덕': '도덕교육과정.json',
  '사회': '사회교육과정.json',
  '수학': '수학교육과정.json',
  '과학': '과학교육과정.json',
  '실과': '실과교육과정.json',
  '체육': '체육교육과정.json',
  '음악': '음악교육과정.json',
  '미술': '미술교육과정.json',
  '영어': '영어 교육과정.json',
  '통합교과': '통합교과교육과정.json',
  '창의적체험활동': '창의적체험활동교육과정.json',
}

const GRADE_BANDS = ['1~2학년군', '3~4학년군', '5~6학년군', '중1~3학년군', '고1학년', '전학년'] as const

export function StandardsFinderModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  onInsert: (markdown: string) => void
}) {
  const [loadedSubjects, setLoadedSubjects] = useState<Record<string, FlatStandard[]>>({})
  const [activeSubjects, setActiveSubjects] = useState<string[]>([])
  const [gradeBand, setGradeBand] = useState<string>('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelected(new Set())
      setQuery('')
    }
  }, [open])

  // 활성 교과 로드 (필요 시점에 fetch — 처음 활성화될 때 한 번만)
  useEffect(() => {
    if (!open) return
    const toLoad = activeSubjects.filter(s => !(s in loadedSubjects))
    if (toLoad.length === 0) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const updates: Record<string, FlatStandard[]> = {}
      for (const s of toLoad) {
        try {
          const file = SUBJECT_FILE[s]
          if (!file) continue
          const data = await fetchCurriculumJson<CurriculumFile>(file)
          const flat: FlatStandard[] = []
          for (const g of data.core_idea_groups ?? []) {
            for (const set of g.standard_sets ?? []) {
              for (const st of set.standards ?? []) {
                flat.push({
                  code: st.code,
                  text: st.text,
                  subject: data.subject?.name ?? s,
                  area: g.area ?? '',
                  schoolLevel: set.school_level ?? '',
                  gradeBand: set.grade_band ?? '',
                })
              }
            }
          }
          updates[s] = flat
        } catch { /* ignore individual subject failures */ }
      }
      if (!cancelled) {
        setLoadedSubjects(prev => ({ ...prev, ...updates }))
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSubjects])

  // 현재 로드·활성화된 성취기준 pool
  const pool: FlatStandard[] = useMemo(() => {
    if (activeSubjects.length === 0) return []
    const out: FlatStandard[] = []
    for (const s of activeSubjects) {
      const list = loadedSubjects[s]
      if (list) out.push(...list)
    }
    return out
  }, [activeSubjects, loadedSubjects])

  // 필터링
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pool.filter(st => {
      if (gradeBand && !st.gradeBand.includes(gradeBand.replace('군', ''))) {
        // 유연한 매칭: "3~4학년군" ↔ "3~4학년"
        if (st.gradeBand !== gradeBand) return false
      }
      if (!q) return true
      return (
        st.code.toLowerCase().includes(q) ||
        st.text.toLowerCase().includes(q) ||
        st.area.toLowerCase().includes(q)
      )
    })
  }, [pool, gradeBand, query])

  function toggleSubject(s: string) {
    setActiveSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  function toggleStandard(code: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(code)) n.delete(code); else n.add(code)
      return n
    })
  }

  function insertSelected() {
    if (selected.size === 0) return
    const chosen = pool.filter(st => selected.has(st.code))
    if (chosen.length === 0) return
    // 깔끔하게 "코드 본문" 한 줄씩만 — 마크다운·메타 정보 제거
    const lines = chosen.map(st => `${st.code} ${st.text}`)
    onInsert(lines.join('\n') + '\n')
    onClose()
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[96vw] max-w-[960px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-gradient-to-br from-[#E8F0FE] to-white px-5 py-4 flex items-center gap-3 border-b border-[#DADCE0] flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#1A73E8] flex items-center justify-center flex-shrink-0">
            <MagnifyingGlass size={20} weight="bold" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-[#1A73E8] uppercase tracking-widest">성취기준 찾기</p>
            <h3 className="text-[15px] font-bold text-[#202124]">
              교과·학년군으로 필터 · 다중 선택 후 채팅에 인용
            </h3>
          </div>
          <button onClick={onClose} aria-label="닫기" className="p-1.5 rounded-full hover:bg-white text-[#5F6368] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 필터 영역 */}
        <div className="px-5 py-3 border-b border-[#F1F3F4] bg-[#FAFBFC] flex-shrink-0 space-y-2.5">
          {/* 교과 */}
          <div>
            <p className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-widest mb-1.5">교과 (복수 선택)</p>
            <div className="flex flex-wrap gap-1.5">
              {SUBJECTS.map(s => {
                const active = activeSubjects.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSubject(s)}
                    className={cn(
                      'px-2.5 py-1 text-[12px] font-semibold rounded-full transition-colors',
                      active
                        ? 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
                        : 'bg-white text-[#5F6368] border border-[#DADCE0] hover:bg-[#E8F0FE] hover:text-[#1A73E8]',
                    )}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
          {/* 학년군 */}
          <div>
            <p className="text-[10px] font-bold text-[#9AA0A6] uppercase tracking-widest mb-1.5">학년군 (단일 선택)</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setGradeBand('')}
                className={cn(
                  'px-2.5 py-1 text-[12px] font-semibold rounded-full transition-colors',
                  gradeBand === ''
                    ? 'bg-[#5F6368] text-white'
                    : 'bg-white text-[#5F6368] border border-[#DADCE0] hover:bg-[#F1F3F4]',
                )}
              >
                전체
              </button>
              {GRADE_BANDS.map(g => {
                const active = gradeBand === g
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGradeBand(g)}
                    className={cn(
                      'px-2.5 py-1 text-[12px] font-semibold rounded-full transition-colors',
                      active
                        ? 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
                        : 'bg-white text-[#5F6368] border border-[#DADCE0] hover:bg-[#E8F0FE] hover:text-[#1A73E8]',
                    )}
                  >
                    {g}
                  </button>
                )
              })}
            </div>
          </div>
          {/* 키워드 검색 */}
          <div className="flex items-center gap-2 bg-white border border-[#DADCE0] rounded-full px-3 py-1.5">
            <MagnifyingGlass size={14} weight="regular" className="text-[#9AA0A6] flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="성취기준 내용·코드·영역 키워드 검색"
              className="flex-1 text-[13px] bg-transparent outline-none text-[#202124] placeholder:text-[#9AA0A6]"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-[#9AA0A6] hover:text-[#5F6368]"><X size={14} /></button>
            )}
          </div>
        </div>

        {/* 결과 리스트 */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {activeSubjects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[#9AA0A6] py-10">
              <p className="text-[13px] font-semibold mb-1">교과를 선택해 주세요</p>
              <p className="text-[11px]">위에서 교과를 하나 이상 선택하면 해당 성취기준이 로드됩니다.</p>
            </div>
          ) : loading ? (
            <div className="h-full flex items-center justify-center text-[#9AA0A6] text-[12px]">
              불러오는 중…
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[#9AA0A6] text-[12px]">
              조건에 맞는 성취기준이 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-[#F1F3F4]">
              {filtered.map(st => {
                const checked = selected.has(st.code)
                return (
                  <li key={st.code}>
                    <button
                      type="button"
                      onClick={() => toggleStandard(st.code)}
                      className={cn(
                        'w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[#F8F9FA] transition-colors text-left',
                        checked && 'bg-[#E8F0FE]',
                      )}
                    >
                      <span className={cn(
                        'flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5',
                        checked ? 'bg-[#1A73E8] border-[#1A73E8] text-white' : 'border-[#DADCE0] bg-white',
                      )}>
                        {checked && <Check size={12} weight="bold" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-[11px] font-bold font-mono text-[#1A73E8]">{st.code}</span>
                          <span className="text-[10px] text-[#9AA0A6]">{st.subject} · {st.gradeBand}</span>
                          {st.area && <span className="text-[10px] text-[#9AA0A6]">· {st.area}</span>}
                        </div>
                        <p className="text-[12px] text-[#3C4043] leading-relaxed" style={{ wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                          {st.text}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* 하단 액션 */}
        <div className="border-t border-[#E8EAED] bg-[#F8F9FA] px-5 py-3 flex items-center gap-3 flex-shrink-0">
          <span className="text-[12px] text-[#5F6368]">
            선택 <strong className="text-[#1A73E8] tabular-nums">{selected.size}</strong>개
            {pool.length > 0 && <span className="text-[#9AA0A6]"> · 전체 {pool.length}개</span>}
          </span>
          <span className="flex-1" />
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-2.5 py-1 text-[11px] font-semibold text-[#5F6368] hover:bg-[#E8EAED] rounded-full transition-colors"
            >
              선택 해제
            </button>
          )}
          <button
            type="button"
            onClick={insertSelected}
            disabled={selected.size === 0}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-bold rounded-full transition-colors flex-shrink-0',
              'bg-[#1A73E8] text-white hover:bg-[#1557B0] disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <PaperPlaneRight size={13} weight="fill" />
            채팅에 보내기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
