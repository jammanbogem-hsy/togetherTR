'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, Check, PaperPlaneRight } from '@phosphor-icons/react'
import { CurriculumFinderDialog, FINDER_CHIP, FINDER_ACTIVE, FINDER_INACTIVE } from './CurriculumFinderDialog'
import { MD3Button } from '@/components/ui/MD3Button'
import { groupStandardsByArea, standardClipboardLine } from '@/lib/curriculum/standardFinder'
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
  const [area, setArea] = useState('')
  const [copyFeedback, setCopyFeedback] = useState<{ code: string; error: boolean; message: string } | null>(null)

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
    setArea('')
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

  const groups = useMemo(() => groupStandardsByArea(filtered), [filtered])
  const visibleGroups = area ? groups.filter(group => group.key === area) : groups

  async function copyStandard(st: FlatStandard) {
    try {
      await navigator.clipboard.writeText(standardClipboardLine(st.code, st.text))
      setCopyFeedback({ code: st.code, error: false, message: `${st.code} 코드와 성취기준을 복사했습니다.` })
    } catch {
      setCopyFeedback({ code: st.code, error: true, message: '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.' })
    }
  }

  return <CurriculumFinderDialog
    open={open} onClose={onClose} title="성취기준 찾기"
    description="교과·학년군·영역으로 찾고, 여러 개를 선택해 채팅에 인용하세요."
    filters={<>
      <div>
        <p className="mb-2 text-sm font-medium text-[#444746]">교과 · 복수 선택</p>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
          {SUBJECTS.map(subject => <button key={subject} type="button" aria-pressed={activeSubjects.includes(subject)} onClick={() => toggleSubject(subject)} className={cn(FINDER_CHIP, activeSubjects.includes(subject) ? FINDER_ACTIVE : FINDER_INACTIVE)}>{activeSubjects.includes(subject) && <Check size={16} />}{subject}</button>)}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-[#444746]">학년군 · 단일 선택</p>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
          {['', ...GRADE_BANDS].map(grade => <button key={grade} type="button" aria-pressed={gradeBand === grade} onClick={() => { setGradeBand(grade); setArea('') }} className={cn(FINDER_CHIP, gradeBand === grade ? FINDER_ACTIVE : FINDER_INACTIVE)}>{gradeBand === grade && <Check size={16} />}{grade || '전체'}</button>)}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_2fr]">
        <label className="text-sm font-medium text-[#444746]">영역
          <select aria-label="성취기준 영역" value={area} onChange={event => setArea(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-[#747775] bg-white px-3 text-base text-[#1F1F1F] focus:outline-2 focus:outline-[#0B57D0]">
            <option value="">전체 영역</option>
            {groups.map(group => <option key={group.key} value={group.key}>{group.subject} · {group.area} ({group.standards.length})</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-[#444746]">검색
          <input aria-label="성취기준 검색" value={query} onChange={event => { setQuery(event.target.value); setArea('') }} placeholder="성취기준 내용·코드·영역 검색" className="mt-1 min-h-12 w-full rounded-xl border border-[#747775] bg-white px-4 text-base text-[#1F1F1F] placeholder:text-[#5F6368] focus:outline-2 focus:outline-[#0B57D0]" />
        </label>
      </div>
    </>}
    footer={<>
      <div className="w-full min-w-0 text-[#444746] sm:w-auto sm:flex-1">선택 <strong className="text-[#0842A0]">{selected.size}</strong>개 · 결과 {visibleGroups.reduce((sum, group) => sum + group.standards.length, 0)}개
        {copyFeedback && <p role={copyFeedback.error ? 'alert' : 'status'} className={cn('mt-1 text-sm', copyFeedback.error ? 'text-[#8C1D18]' : 'text-[#0D652D]')}>{copyFeedback.message}</p>}
      </div>
      {selected.size > 0 && <MD3Button variant="text" tone="neutral" className="min-h-11 text-base" onClick={() => setSelected(new Set())}>선택 해제</MD3Button>}
      <MD3Button variant="filled" className="min-h-12 text-base" disabled={selected.size === 0} onClick={insertSelected} icon={<PaperPlaneRight size={20} />}>채팅에 보내기</MD3Button>
    </>}
  >
    {activeSubjects.length === 0 ? <p className="py-12 text-center text-base text-[#444746]">교과를 하나 이상 선택해 주세요.</p>
      : loading ? <p role="status" className="py-12 text-center text-base text-[#444746]">성취기준을 불러오는 중…</p>
      : visibleGroups.length === 0 ? <p className="py-12 text-center text-base text-[#444746]">조건에 맞는 성취기준이 없습니다.</p>
      : <div className="space-y-6">{visibleGroups.map(group => <section key={group.key} aria-label={`${group.subject} ${group.area}`}>
        <h3 className="mb-3 rounded-xl bg-[#E9EEF6] px-4 py-3 text-lg font-semibold text-[#1F1F1F]">{group.subject} · {group.area} <span className="ml-2 text-sm font-medium text-[#444746]">{group.standards.length}개</span></h3>
        <ul className="space-y-2">{group.standards.map(st => {
          const checked = selected.has(st.code)
          return <li key={st.code} className={cn('flex items-start gap-1 rounded-2xl border p-2 transition-colors', checked ? 'border-[#0B57D0] bg-[#E8F0FE]' : 'border-[#C4C7C5] bg-white')}>
            <button type="button" role="checkbox" aria-checked={checked} aria-label={`${st.code} ${st.text}`} onClick={() => toggleStandard(st.code)} className="flex min-w-0 flex-1 items-start gap-3 rounded-xl p-2 text-left hover:bg-[#F0F4F9] focus-visible:outline-2 focus-visible:outline-[#0B57D0] sm:p-3">
              <span aria-hidden="true" className={cn('mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2', checked ? 'border-[#0B57D0] bg-[#0B57D0] text-white' : 'border-[#747775] bg-white')}>{checked && <Check size={18} weight="bold" />}</span>
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-base font-semibold text-[#0842A0]">{st.code}</span><span className="text-sm text-[#444746]">{st.gradeBand}</span></span>
                <span className="block text-base leading-relaxed text-[#1F1F1F] sm:text-lg [word-break:keep-all] [overflow-wrap:anywhere]">{st.text}</span>
              </span>
            </button>
            <MD3Button variant="text" size="sm" className="min-h-11 shrink-0 px-2 text-sm sm:px-3 sm:text-base" aria-label={`${st.code} 코드와 성취기준 복사`} onClick={() => { void copyStandard(st) }} icon={copyFeedback?.code === st.code && !copyFeedback.error ? <Check size={20} /> : <Copy size={20} />}>{copyFeedback?.code === st.code && !copyFeedback.error ? '복사됨' : '복사'}</MD3Button>
          </li>
        })}</ul>
      </section>)}</div>}
  </CurriculumFinderDialog>
}
