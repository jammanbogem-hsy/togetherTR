'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { CurriculumSheetRow } from '@/types'
import type { CurriculumSheetEditableField, CurriculumSheetPatch } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'
import { curriculumJsonAssetPath } from '@/lib/curriculum/curriculumFilters'
import {
  ELEMENTARY_GRADE_BANDS,
  allowedGradeBandsForSubject,
  bandsLackingStandards,
  bandsWithStandards,
  filterItemsByGradeBandStrict,
  makeBridgeRow,
  defaultGradeMode,
  effectiveRowGradeBand,
  integratedBandMismatch,
  nextUnusedGradeBand,
  resolveGradePrefixBandForMode,
  resolveSheetGradeBand,
  standardMatchesGradeBand,
  toGradeBandLabel,
  usedGradeBands,
} from '@/lib/curriculum/sheetGradeBands'
import type { SheetGradeMode } from '@/lib/curriculum/sheetGradeBands'

// ─── 교육과정 데이터 타입 ─────────────────────────────────

interface ContentItem {
  id: string; subject: string; course: string; area: string
  gradeBands: string[]; coreIdeas: string[]; knowledge: string[]; functions: string[]; attitudes: string[]
}
interface CurriculumFile {
  subject: { name: string }
  core_idea_groups: Array<{ area: string; standard_sets: Array<{ school_level: string; grade_band: string; standards: Array<{ code: string; text: string }> }> }>
}
interface FlatStandard { code: string; text: string; subject: string; area: string; gradeBand: string; label: string }
interface PresenceEntry { uid: string; displayName: string; color: string; cellKey: string; updatedAt: number }
type PresenceMap = Record<string, PresenceEntry>

// ─── 상수 ─────────────────────────────────────────────────

const SUBJECTS = ['국어', '수학', '과학', '사회', '도덕', '미술', '음악', '체육', '영어', '실과', '통합교과'] as const
const SEP = ' | '
const SUBJECT_FILE: Record<string, string> = {
  '국어': '국어교육과정.json', '도덕': '도덕교육과정.json', '사회': '사회교육과정.json',
  '수학': '수학교육과정.json', '과학': '과학교육과정.json', '실과': '실과교육과정.json',
  '체육': '체육교육과정.json', '음악': '음악교육과정.json', '미술': '미술교육과정.json',
  '영어': '영어 교육과정.json',
  // 통합교과(바른 생활·슬기로운 생활·즐거운 생활) — 1~2학년군 전용. StandardsFinderModal과 동일 매핑.
  '통합교과': '통합교과교육과정.json',
}
const PRESENCE_COLORS = ['#EA4335', '#4285F4', '#34A853', '#FBBC04', '#FF6D01', '#46BDC6', '#E040FB', '#00BCD4']
const ELEMENTARY_LEVELS = ['초등학교', '초']
const STANDARD_CODE_RE = /\[?(\d[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2})\]?/g
const SHEET_EDITABLE_FIELDS: CurriculumSheetEditableField[] = [
  'session',
  'subject',
  'gradeBand',
  'linkedCoreIdea',
  'isCenter',
  'coreIdea',
  'standard',
  'knowledge',
  'processFunction',
  'valueAttitude',
  'agentLessonExample',
  'description',
]

interface CoreIdeaOption {
  subject: string
  coreIdeaId: string
  area: string
  idea: string
  score: number
  standardsCount: number
  sampleStandards: string[]
  /** 이 후보에 성취기준이 실제로 있는 학년군들(서버 제공, 없으면 제한하지 않음). */
  gradeBands?: string[]
}
interface CoreIdeaProposal {
  subject: string
  focus: string
  isCenter: boolean
  selectedCoreIdea: string
  /** 이 교과가 채울 학년군들 — 시트 행의 gradeBand에서 서버가 유도한 값. */
  gradeBands?: string[]
  options: CoreIdeaOption[]
  /** 서버 판정기(jev | embedding)와 Jev confidence 게이트(제시/확인/명료화). */
  judge?: 'jev' | 'embedding'
  confidence?: number
  mode?: '제시' | '확인' | '명료화'
}
interface AutofillStep {
  id: string
  label: string
  ms?: number
  judge?: 'jev' | 'embedding'
}
interface AutofillReview {
  proposals: CoreIdeaProposal[]
  message?: string
  judge?: 'jev' | 'embedding'
  steps?: AutofillStep[]
  /** 교사에게 보여줄 서버 안내 — 통합교과 학년군 조정, 해당 학년군에 성취기준이 없어 제외된 교과 등. */
  notes?: string[]
}
/** 자동 채우기 진행 단계 표시(에이전트가 지금 무엇을 하는지). */
interface AutofillProgress {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  ms?: number
  note?: string
}
const JUDGE_LABEL: Record<'jev' | 'embedding', string> = { jev: 'Jev 판정', embedding: '임베딩 유사도(Jev 미사용)' }
/** 연결 줄 후보 — /api/curriculum-sheet/autofill mode:'bridgeStandards' 응답 항목. */
interface BridgeCandidate {
  subject: string
  code: string
  text: string
  standard: string
  area: string
  coreIdea: string
  contentCoreIdea: string
  score: number
  level: '무관' | '약함' | '관련' | '핵심'
}
const BRIDGE_LEVEL_STYLE: Record<BridgeCandidate['level'], string> = {
  '핵심': 'bg-[#E6F4EA] text-[#137333]',
  '관련': 'bg-[#E8F0FE] text-[#1A73E8]',
  '약함': 'bg-[#FEF7E0] text-[#B06000]',
  '무관': 'bg-[#F1F3F4] text-[#5F6368]',
}

/**
 * 두 행이 같은 핵심아이디어 묶음인지 — 학년군만 다른 줄, 또는 그 핵심아이디어에 붙은
 * 연결 줄(교과·핵심아이디어는 달라도 linkedCoreIdea가 원본을 가리킨다).
 */
function isSameCoreIdeaGroup(row: CurriculumSheetRow, prevRow?: CurriculumSheetRow): boolean {
  if (!prevRow) return false
  const rowIdea = (row.coreIdea ?? '').trim()
  const prevIdea = (prevRow.coreIdea ?? '').trim()
  if (row.subject && rowIdea && prevRow.subject === row.subject && prevIdea === rowIdea) return true
  const link = row.linkedCoreIdea
  if (!link) return false
  if (prevRow.subject === link.subject && prevIdea === link.coreIdea.trim()) return true
  const prevLink = prevRow.linkedCoreIdea
  return !!prevLink && prevLink.subject === link.subject && prevLink.coreIdea.trim() === link.coreIdea.trim()
}

/** 연결 후보의 교과명을 시트 과목 선택지(SUBJECTS) 값으로 맞춘다. */
function toSheetSubject(name?: string): string {
  const raw = (name ?? '').trim()
  if (!raw) return ''
  return SUBJECTS.find(subject => subject === raw)
    ?? SUBJECTS.find(subject => raw.includes(subject) || subject.includes(raw))
    ?? raw
}

/** 행별 Jev 채우기가 다루는 칸 — 핵심아이디어 → 성취기준 → 내용 요소 매핑 사슬. */
const ROW_FILL_FIELDS = ['standard', 'knowledge', 'processFunction', 'valueAttitude'] as const

let nanoidCounter = 0
function makeId() { return `cs_${Date.now()}_${++nanoidCounter}` }
function emptyRow(): CurriculumSheetRow {
  return { id: makeId(), session: '', subject: '', coreIdea: '', standard: '', knowledge: '', processFunction: '', valueAttitude: '', agentLessonExample: '', description: '' }
}
function splitValues(v: string): string[] { return v ? v.split(SEP).map(s => s.trim()).filter(Boolean) : [] }
function joinValues(arr: string[]): string { return arr.join(SEP) }
function unique<T>(arr: T[]): T[] { return [...new Set(arr)] }
function normalizeCurriculumText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[·⋅]/g, '⋅').trim()
}
function curriculumTextMatches(a: string, b: string): boolean {
  const na = normalizeCurriculumText(a)
  const nb = normalizeCurriculumText(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}
// 행 학년군 기준 내용 요소 필터. 인자는 프로젝트 학년그룹이 아니라 "행의 학년군"이다
// (1·3·5학년 혼성 팀에서 행마다 다른 학년군의 내용 요소를 불러오기 위함).
function filterByGradeBand(items: string[], gradeBand?: string): string[] {
  if (!gradeBand) return items
  const gradePrefixed = items.filter(item => /^\d+-\d+학년군:/.test(item))
  if (gradePrefixed.length === 0) {
    const gradeLabel = formatGradeGroupLabel(gradeBand)
    return gradeLabel ? items.map(item => withGradePrefix(item, gradeLabel)) : items
  }
  // 엄격 필터 — 그 학년군에 항목이 없으면 빈 배열. 공유 filterContentItemsByGrade의
  // "전체 접두어 항목으로 복구"는 성취기준이 없는 교과(1-2학년군의 사회 등)에 다른
  // 학년군 내용 요소를 채워 넣게 되므로 시트에서는 쓰지 않는다.
  return filterItemsByGradeBandStrict(items, gradeBand)
}
function extractStandardCodes(text: string): string[] {
  return [...(text ?? '').matchAll(STANDARD_CODE_RE)].map(match => match[1]).filter(Boolean)
}
function normalizeStandardCode(text: string): string {
  return extractStandardCodes(text)[0] ?? ''
}
function formatGradeGroupLabel(gradeGroup?: string): string {
  const normalized = (gradeGroup ?? '').replace(/^초/, '').replace(/~/g, '-').trim()
  if (!normalized) return ''
  if (/^\d-\d$/.test(normalized)) return `${normalized}학년군`
  if (/^\d-\d학년군$/.test(normalized)) return normalized
  return normalized
}
function stripGradePrefix(value: string): string {
  return value.replace(/^\d-\d학년군:\s*/, '').trim()
}
function withGradePrefix(value: string, gradeLabel: string): string {
  const trimmed = value.trim()
  if (!trimmed || /^\d-\d학년군:/.test(trimmed)) return trimmed
  return `${gradeLabel}: ${trimmed}`
}
function ensureGradePrefixesForValue(value: string, gradeLabel: string): string {
  if (!gradeLabel || !value.trim()) return value
  return splitValues(value)
    .map(item => withGradePrefix(item, gradeLabel))
    .join(SEP)
}
// 학년군 접두어 판정 순서(multi): 행에 저장된 학년군 → 성취기준 코드 → 시트 학년군.
// single 모드는 행 값을 건너뛰고 "코드 → 시트 학년군"만 본다.
// (학년군이 없는 기존 시트는 두 모드 모두 "코드 → 시트 학년군"이라 표시가 그대로 유지된다.)
function normalizeRowGradePrefixes(row: CurriculumSheetRow, mode: SheetGradeMode, sheetGradeBand?: string): CurriculumSheetRow {
  const gradeLabel = resolveGradePrefixBandForMode(row, mode, sheetGradeBand)
  return {
    ...row,
    knowledge: ensureGradePrefixesForValue(row.knowledge, gradeLabel),
    processFunction: ensureGradePrefixesForValue(row.processFunction, gradeLabel),
    valueAttitude: ensureGradePrefixesForValue(row.valueAttitude ?? '', gradeLabel),
  }
}
function samePickerOption(a: string, b: string): boolean {
  const ac = normalizeStandardCode(a)
  const bc = normalizeStandardCode(b)
  if (ac && bc) return ac === bc
  return normalizeCurriculumText(stripGradePrefix(a)) === normalizeCurriculumText(stripGradePrefix(b))
}
// 성취기준이 행 학년군에 속하는지 — 코드(선두 학년) 또는 원문 학년군 표기 중 하나라도
// 맞으면 통과(기존 standardMatchesTargetGrade의 OR 판정 유지).
function standardMatchesRowBand(standard: FlatStandard, gradeBand: string): boolean {
  if (!gradeBand) return true
  return standardMatchesGradeBand(standard.code, gradeBand)
    || standardMatchesGradeBand(standard.gradeBand, gradeBand)
}
const BROKEN_CORE_IDEA_PREFIX_RE = /^(?:인문적|공간적|시대적|경제적|환경적|해석|판단을|평가하여|통신|발전시키는|운영된다|공존을|태도)(?:\s|$)/
function isUsableCoreIdea(value: string): boolean {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length < 18) return false
  if (!/다[.!?]?$/.test(cleaned)) return false
  if (/^\[별표\s*\d+\]/.test(cleaned)) return false
  if (/(초등학교|중학교|고등학교)\s+(중학교|고등학교|\d~\d학년|\d-\d학년)/.test(cleaned)) return false
  if (BROKEN_CORE_IDEA_PREFIX_RE.test(cleaned)) return false
  return true
}
function sanitizeContentItems(items: ContentItem[]): ContentItem[] {
  return items
    .map(item => ({
      ...item,
      coreIdeas: unique(item.coreIdeas.filter(isUsableCoreIdea)),
    }))
    .filter(item => item.coreIdeas.length > 0)
}

// ─── 셀 선택 팝오버 ──────────────────────────────────────

interface OptionGroup { label: string; options: string[] }

interface CellPickerProps {
  options: string[]; value: string; onSelect: (v: string) => void; onClose: () => void
  anchorRect: DOMRect | null; placeholder?: string; color?: string; multi?: boolean
  optionGroups?: OptionGroup[]
}

function CellPicker({ options, value, onSelect, onClose, anchorRect, placeholder, color = '#1A73E8', multi, optionGroups }: CellPickerProps) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => new Set(splitValues(value)), [value])
  const selectedValues = useMemo(() => [...selected], [selected])
  const allOptions = useMemo(() => optionGroups ? optionGroups.flatMap(group => group.options) : options, [options, optionGroups])
  const selectedDisplayValues = useMemo(() => selectedValues.map(v => allOptions.find(opt => samePickerOption(opt, v)) ?? v), [allOptions, selectedValues])
  const isSelectedOption = useCallback((opt: string) => selectedValues.some(v => samePickerOption(v, opt)), [selectedValues])

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  // 그룹 또는 플랫 옵션 필터링
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (optionGroups) {
      return optionGroups
        .map(g => ({ label: g.label, options: q ? g.options.filter(o => o.toLowerCase().includes(q)) : g.options }))
        .filter(g => g.options.length > 0)
    }
    return q ? options.filter(o => o.toLowerCase().includes(q)) : options
  }, [options, optionGroups, search])

  const flatFiltered = useMemo(() => {
    if (Array.isArray(filtered) && filtered.length > 0 && typeof filtered[0] === 'string') return filtered as string[]
    return (filtered as OptionGroup[]).flatMap(g => g.options)
  }, [filtered])

  function toggle(opt: string) {
    if (multi) {
      const n = new Set(selected)
      const existing = [...n].find(v => samePickerOption(v, opt))
      if (existing) n.delete(existing)
      else n.add(opt)
      onSelect(joinValues([...n]))
    }
    else { onSelect(opt); onClose() }
  }

  if (!anchorRect) return null
  const pickerHeight = Math.min(560, window.innerHeight - 24)
  const top = Math.max(12, Math.min(anchorRect.bottom + 4, window.innerHeight - pickerHeight - 12))
  const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - 460 - 12))

  return createPortal(
    <div
      ref={ref}
      className="fixed bg-white rounded-2xl shadow-2xl border border-[#DADCE0] overflow-hidden flex flex-col"
      style={{ top, left, width: 460, maxHeight: pickerHeight, zIndex: 10050 }}
      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
    >
      {/* 헤더: 검색 + 닫기 */}
      <div className="p-3 border-b border-[#F1F3F4]">
        <div className="flex items-center gap-2">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder={placeholder ?? '검색...'} className="flex-1 px-3 py-2 text-base rounded-xl border border-[#DADCE0] focus:outline-none focus:border-[#1A73E8]" />
          {multi && selected.size > 0 && (
            <span className="text-sm font-bold px-2.5 py-1 rounded-full flex-shrink-0" style={{ color, backgroundColor: `${color}18` }}>{selected.size}개 선택</span>
          )}
          <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-[#F1F3F4] flex items-center justify-center text-[#9AA0A6] hover:text-[#5F6368] text-lg flex-shrink-0 transition">&times;</button>
        </div>
      </div>
      {/* 선택된 항목 미리보기 */}
      {multi && selected.size > 0 && (
        <div className="shrink-0 px-3 py-3 border-b border-[#D8E7FF] flex flex-col gap-2 max-h-[230px] overflow-y-auto bg-[#F5FAFF]">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-extrabold" style={{ color }}>현재 선택된 항목</div>
            <span className="rounded-full px-2 py-0.5 text-[13px] font-bold" style={{ color, backgroundColor: `${color}18` }}>{selected.size}개</span>
          </div>
          {selectedDisplayValues.map(v => (
            <div key={v} className="flex items-start gap-2 rounded-xl border-2 bg-white px-3 py-2 shadow-sm" style={{ borderColor: `${color}35` }}>
              <span className="mt-0.5 w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center border-2 text-base font-bold"
                style={{ borderColor: color, backgroundColor: color, color: '#fff' }}>✓</span>
              <span className="flex-1 text-base leading-relaxed font-bold" style={{ color }}>{v}</span>
              <button onClick={() => toggle(v)} className="w-6 h-6 rounded-full hover:bg-black/10 flex items-center justify-center text-lg flex-shrink-0 text-[#9AA0A6]">&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {flatFiltered.length === 0 ? (
          <div className="py-8 text-center text-base text-[#9AA0A6]">결과 없음</div>
        ) : optionGroups ? (
          // 그룹별 표시 (영역 라벨 포함)
          (filtered as OptionGroup[]).map(group => (
              <div key={group.label}>
              <div className="sticky top-0 z-[1] px-4 py-2 bg-[#F8F9FA] border-b border-[#F1F3F4]">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-bold tracking-wide" style={{ color }}>
                  <span className="px-1.5 py-0.5 rounded-md bg-white border border-current/20">영역</span>
                  {group.label}
                </span>
              </div>
              {group.options.map((opt, j) => {
                const isSel = isSelectedOption(opt)
                return (
                  <button key={j} onClick={() => toggle(opt)}
                    className={`w-full text-left px-4 py-3 text-base transition flex items-start gap-3 ${isSel ? 'bg-[#F3E5F5]' : 'hover:bg-[#F8F9FA]'}`}>
                    <span className="mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                      style={{ borderColor: isSel ? color : '#DADCE0', backgroundColor: isSel ? color : 'transparent' }}>
                      {isSel && <span className="w-2 h-2 rounded-full bg-white" />}
                    </span>
                    <span className="leading-relaxed text-[#202124]">{opt}</span>
                  </button>
                )
              })}
            </div>
          ))
        ) : flatFiltered.map((opt, i) => {
          const isSel = isSelectedOption(opt)
          return (
            <button key={i} onClick={() => toggle(opt)}
              className={`w-full text-left px-4 py-3 text-base transition flex items-start gap-3 ${isSel ? 'bg-[#F8F9FA]' : 'hover:bg-[#F8F9FA]'}`}>
              {multi ? (
                <span className="mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 text-sm font-bold"
                  style={{ borderColor: isSel ? color : '#DADCE0', backgroundColor: isSel ? color : 'transparent', color: isSel ? '#fff' : 'transparent' }}>✓</span>
              ) : (
                <span className="mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                  style={{ borderColor: isSel ? color : '#DADCE0', backgroundColor: isSel ? color : 'transparent' }}>
                  {isSel && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
              )}
              <span className="leading-relaxed text-[#202124]">{opt}</span>
            </button>
          )
        })}
      </div>
      <div className="p-3 border-t border-[#F1F3F4] flex justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-base font-bold text-white transition" style={{ backgroundColor: color }}>
          {multi ? '완료' : '닫기'}
        </button>
      </div>
    </div>,
    document.body,
  )
}

// ─── 태그 셀 ─────────────────────────────────────────────

interface TagCellProps {
  value: string; placeholder: string; color: string
  onClickAdd: (e: React.MouseEvent) => void; onRemove: (tag: string) => void
  otherEditor?: PresenceEntry; myEditing?: boolean; myColor?: string
}

function TagCell({ value, placeholder, color, onClickAdd, onRemove, otherEditor, myEditing, myColor }: TagCellProps) {
  const tags = splitValues(value)
  const borderStyle = otherEditor ? `2px solid ${otherEditor.color}` : myEditing && myColor ? `2px dashed ${myColor}` : '1px solid #E8EAED'
  return (
    <div className="w-full min-h-[44px] px-2 py-1.5 rounded-xl transition flex flex-col gap-1"
      style={{ border: borderStyle }}>
      {tags.map((tag, i) => (
        <div key={i} className="flex items-start gap-1 py-1 border-b last:border-b-0"
          style={{ borderColor: `${color}20` }}>
          <span className="flex-1 text-sm leading-relaxed break-words" style={{ color }}>{tag}</span>
          <button onClick={e => { e.stopPropagation(); onRemove(tag) }}
            className="w-5 h-5 rounded-full hover:bg-black/10 flex items-center justify-center text-base flex-shrink-0 text-[#9AA0A6] hover:text-[#C5221F]">&times;</button>
        </div>
      ))}
      <button onClick={onClickAdd}
        className="inline-flex items-center gap-1 px-1 py-1 rounded-lg text-sm font-semibold hover:bg-[#F1F3F4] transition self-start"
        style={{ color: tags.length ? '#9AA0A6' : color }}>
        + {tags.length ? '추가' : placeholder}
      </button>
    </div>
  )
}

// ─── 연결 줄: 유사 성취기준 찾기 팝오버 ──────────────────

interface BridgePickerProps {
  anchorRect: DOMRect | null
  sourceSubject: string
  sourceCoreIdea: string
  targetBand: string
  loading: boolean
  error?: string
  notes: string[]
  judge?: 'jev' | 'embedding'
  candidates: BridgeCandidate[]
  subjectsSearched: string[]
  subjectFilter: string
  onSubjectFilterChange: (subject: string) => void
  onSelect: (candidate: BridgeCandidate) => void
  onClose: () => void
}

function BridgePicker({
  anchorRect, sourceSubject, sourceCoreIdea, targetBand, loading, error, notes, judge,
  candidates, subjectsSearched, subjectFilter, onSubjectFilterChange, onSelect, onClose,
}: BridgePickerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const shown = subjectFilter
    ? candidates.filter(candidate => candidate.subject === subjectFilter)
    : candidates

  if (!anchorRect) return null
  const pickerHeight = Math.min(560, window.innerHeight - 24)
  const top = Math.max(12, Math.min(anchorRect.bottom + 4, window.innerHeight - pickerHeight - 12))
  const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - 520 - 12))

  return createPortal(
    <div
      ref={ref}
      className="fixed bg-white rounded-2xl shadow-2xl border border-[#DADCE0] overflow-hidden flex flex-col"
      style={{ top, left, width: 520, maxHeight: pickerHeight, zIndex: 10050 }}
      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
    >
      <div className="p-3 border-b border-[#F1F3F4] flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-base font-bold text-[#202124]">
            {targetBand} 유사 성취기준 찾기
          </h4>
          <p className="mt-0.5 text-[13px] leading-relaxed text-[#5F6368] line-clamp-2" title={sourceCoreIdea}>
            {sourceSubject} 핵심아이디어: {sourceCoreIdea}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {judge && (
            <span title={JUDGE_LABEL[judge]}
              className={cn('px-2 py-0.5 rounded-full text-[12px] font-bold', judge === 'jev' ? 'bg-[#E6F4EA] text-[#137333]' : 'bg-[#F1F3F4] text-[#5F6368]')}>
              {judge === 'jev' ? 'Jev' : '임베딩'}
            </span>
          )}
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-[#F1F3F4] flex items-center justify-center text-[#9AA0A6] hover:text-[#5F6368] text-lg transition">&times;</button>
        </div>
      </div>

      {notes.length > 0 && (
        <ul className="px-3 py-2 border-b border-[#FDD663] bg-[#FEF7E0] space-y-0.5">
          {notes.map((note, noteIdx) => (
            <li key={noteIdx} className="text-[13px] leading-relaxed text-[#8A5A00]">· {note}</li>
          ))}
        </ul>
      )}

      {subjectsSearched.length > 0 && (
        <div className="px-3 py-2 border-b border-[#F1F3F4] flex flex-wrap items-center gap-1.5">
          {['', ...subjectsSearched].map(subject => (
            <button
              key={subject || '전체'}
              onClick={() => onSubjectFilterChange(subject)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[13px] font-bold border transition',
                subjectFilter === subject
                  ? 'bg-[#E8F0FE] border-[#C2D7F8] text-[#1A73E8]'
                  : 'bg-white border-[#E8EAED] text-[#5F6368] hover:border-[#DADCE0]',
              )}
            >
              {subject || '전체'}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-4 py-8 text-center text-base text-[#9AA0A6]">유사 성취기준을 찾고 있습니다...</p>}
        {!loading && error && <p className="px-4 py-6 text-base font-semibold text-[#A50E0E]">{error}</p>}
        {!loading && !error && shown.length === 0 && (
          <p className="px-4 py-8 text-center text-base text-[#9AA0A6]">후보가 없습니다. 교과 필터를 넓혀 보세요.</p>
        )}
        {!loading && shown.map(candidate => (
          <button
            key={`${candidate.subject}:${candidate.code}`}
            onClick={() => onSelect(candidate)}
            className="w-full text-left px-4 py-3 border-b border-[#F1F3F4] hover:bg-[#F8F9FA] transition"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-bold text-[#5F6368]">{candidate.subject}</span>
              {candidate.area && <span className="text-[12px] font-semibold text-[#7B1FA2]">{candidate.area}</span>}
              <span className={cn('ml-auto px-2 py-0.5 rounded-full text-[12px] font-bold flex-shrink-0', BRIDGE_LEVEL_STYLE[candidate.level] ?? BRIDGE_LEVEL_STYLE['무관'])}>
                {candidate.level} {candidate.score.toFixed(2)}
              </span>
            </div>
            {/* code는 이미 '[2슬02-01]' 형태로 대괄호를 포함한다. standard('[코드] 본문')를 그대로 쓴다. */}
            <p className="text-base leading-relaxed text-[#1A73E8]">{candidate.standard || `${candidate.code} ${candidate.text}`.trim()}</p>
            {(candidate.contentCoreIdea || candidate.coreIdea) && (
              <p className="mt-1 text-[13px] leading-relaxed text-[#5F6368]">
                핵심아이디어: {candidate.contentCoreIdea || candidate.coreIdea}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

// ─── 메인 모달 ────────────────────────────────────────────

interface Props {
  open: boolean; onClose: () => void; rows: CurriculumSheetRow[]
  onSave: (rows: CurriculumSheetRow[]) => void
  onPatchSave?: (patch: CurriculumSheetPatch) => void | Promise<CurriculumSheetRow[] | void>
  onRequestArtifactSave?: (rows: CurriculumSheetRow[]) => void
  onPresenceUpdate?: (presence: PresenceEntry | null) => void
  onSwitchToGraph?: (rows: CurriculumSheetRow[]) => void; presence?: PresenceMap
  currentUserName?: string; currentUid?: string; currentUserColor?: string; projectId?: string
  // AI 자동 채우기용
  a12Artifact?: Record<string, unknown>
  graphSavedData?: { centerNode: { id: string; label: string; subjectId: string; text: string } | null; selectedStandards: Array<{ id: string; label: string; subjectId: string; text: string }> } | null
  targetGradeGroup?: string
  chatContext?: string
  // ─── 시트 학년군 설정 (프로젝트 문서 공유 값) ───
  gradeMode?: SheetGradeMode
  sheetGradeBand?: string
  onGradeSettingsChange?: (settings: { gradeMode?: SheetGradeMode; gradeBand?: string }) => void | Promise<void>
}

/** 한 행에서 동시에 갱신할 셀 묶음 — 필드별 실제 타입을 유지한다(isCenter는 boolean). */
type SheetFieldPatch = { [K in CurriculumSheetEditableField]?: CurriculumSheetRow[K] }
type PickerField = 'coreIdea' | 'standard' | 'knowledge' | 'processFunction' | 'valueAttitude'
type PickerTarget = { rowId: string; field: PickerField; rect: DOMRect } | null
const MULTI_FIELDS: PickerField[] = ['standard', 'knowledge', 'processFunction', 'valueAttitude']

export function CurriculumSheetModal({ open, onClose, rows: savedRows, onSave, onPatchSave, onRequestArtifactSave, onPresenceUpdate, onSwitchToGraph, presence, currentUserName, currentUid, currentUserColor, a12Artifact, graphSavedData, targetGradeGroup, chatContext, gradeMode, sheetGradeBand, onGradeSettingsChange }: Props) {
  const [rows, setRows] = useState<CurriculumSheetRow[]>([])
  const [contentItems, setContentItems] = useState<ContentItem[]>([])
  const [standards, setStandards] = useState<FlatStandard[]>([])
  const [loading, setLoading] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null)
  const [dirty, setDirty] = useState(false)
  const [showGraphPrompt, setShowGraphPrompt] = useState(false)
  const [dragRowId, setDragRowId] = useState<string | null>(null)
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null)
  const [autofillLoading, setAutofillLoading] = useState(false)
  const [autofillReview, setAutofillReview] = useState<AutofillReview | null>(null)
  const [coreIdeaSelections, setCoreIdeaSelections] = useState<Record<string, string>>({})
  // 교과별 학년군 선택 (AI 자동 채우기 확인 창) — 기본값은 프로젝트 학년군, 통합교과는 1~2학년군.
  const [coreIdeaGradeBands, setCoreIdeaGradeBands] = useState<Record<string, string[]>>({})
  // 학년군 설정 저장 왕복(Firestore) 동안 토글이 즉시 반응하도록 하는 낙관적 값.
  const [pendingGradeSettings, setPendingGradeSettings] = useState<{ gradeMode?: SheetGradeMode; gradeBand?: string } | null>(null)
  // 행별 Jev 채우기 상태 (판정기 배지 · 진행 · 오류)
  // 연결 줄 팝오버 — 한 번에 하나만 열린다.
  const [bridgeTarget, setBridgeTarget] = useState<{ rowId: string; rect: DOMRect } | null>(null)
  const [bridgeQuery, setBridgeQuery] = useState<{
    loading: boolean
    candidates: BridgeCandidate[]
    subjectsSearched: string[]
    notes: string[]
    judge?: 'jev' | 'embedding'
    error?: string
  }>({ loading: false, candidates: [], subjectsSearched: [], notes: [] })
  const [bridgeSubjectFilter, setBridgeSubjectFilter] = useState('')
  const [rowFillState, setRowFillState] = useState<Record<string, { loading?: boolean; judge?: 'jev' | 'embedding'; filled?: number; error?: string; notes?: string[] }>>({})
  const [autofillError, setAutofillError] = useState('')
  // 서버가 돌려준 교사 안내 문구(학년군 조정·교과 제외·핵심아이디어 대체 사유).
  const [autofillNotes, setAutofillNotes] = useState<string[]>([])
  const [autofillProgress, setAutofillProgress] = useState<AutofillProgress[]>([])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const patchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const dirtyCellVersionsRef = useRef<Record<string, number>>({})
  const pendingRowIdsRef = useRef<Set<string>>(new Set())
  const pendingStructuralCountRef = useRef(0)
  const rowsRef = useRef<CurriculumSheetRow[]>([])
  const serverRowIdsRef = useRef<Set<string>>(new Set())

  // ─── 시트 학년군 모드·기준 학년군 ───
  // 프로젝트 문서에 저장된 값이 우선이고, 없으면 시트 내용으로 기본값을 판정한다
  // (이미 학년군이 2개 이상 들어간 시트 = 혼성 학년 팀 → multi).
  const sheetMode: SheetGradeMode = pendingGradeSettings?.gradeMode
    ?? gradeMode
    ?? defaultGradeMode(savedRows.length > 0 ? savedRows : rows)
  const sheetBand = resolveSheetGradeBand(pendingGradeSettings?.gradeBand ?? sheetGradeBand, targetGradeGroup)
  // 행이 실제로 쓰는 학년군 — single이면 시트 학년군, multi면 행 값(없으면 시트 학년군).
  const rowBandOf = useCallback(
    (row: CurriculumSheetRow) => effectiveRowGradeBand(row, sheetMode, sheetBand),
    [sheetMode, sheetBand],
  )
  // 교과별로 성취기준이 실제로 있는 학년군 (사회=3-4·5-6, 실과=5-6, 통합교과=1-2 …).
  // 불러온 성취기준에서 판정하므로 데이터가 바뀌면 자동으로 따라간다.
  const bandsWithStandardsFor = useCallback(
    (subject?: string) => bandsWithStandards(standards, subject),
    [standards],
  )
  /** 행의 학년군에 그 교과 성취기준이 없으면 true — 성취기준·내용 요소가 모두 비는 상태. */
  const rowBandHasNoStandards = useCallback((row: CurriculumSheetRow) => {
    if (!row.subject || standards.length === 0) return false
    const band = rowBandOf(row)
    if (!band) return false
    return !bandsWithStandardsFor(row.subject).some(item => item === band)
  }, [bandsWithStandardsFor, rowBandOf, standards.length])

  // 학년군 모드·기준 학년군은 ref로도 들고 있는다.
  // mergeIncomingRows가 이 값을 deps로 받으면 identity가 바뀌어 savedRows 동기화 effect가
  // 재실행되고, 저장 전 로컬 편집이 서버 값(빈 시트)으로 덮여 사라진다.
  // 화면에 있는 행의 접두어는 다시 붙일 필요가 없다(이미 붙은 값은 건드리지 않으므로).
  const gradeCtxRef = useRef({ sheetMode, sheetBand })
  useEffect(() => { gradeCtxRef.current = { sheetMode, sheetBand } }, [sheetMode, sheetBand])

  // 디바운스 타이머 안에서 최신 rows를 읽기 위한 ref
  useEffect(() => { rowsRef.current = rows }, [rows])

  const hasPendingLocalChanges = useCallback(() => (
    Object.keys(dirtyCellVersionsRef.current).length > 0
    || pendingRowIdsRef.current.size > 0
    || pendingStructuralCountRef.current > 0
  ), [])

  const syncDirtyFromPending = useCallback(() => {
    setDirty(hasPendingLocalChanges())
  }, [hasPendingLocalChanges])

  // 서버에 실제로 저장된 행 id 집합을 추적한다.
  // 셀 단위 패치(update-cell)는 서버에 존재하는 행만 갱신하므로, 아직 저장되지 않은 행은
  // 전체 행 upsert로 보내야 한다. 서버에 반영된 pending 행은 여기서 정리한다.
  useEffect(() => {
    serverRowIdsRef.current = new Set(savedRows.map(row => row.id))
    let changed = false
    for (const id of [...pendingRowIdsRef.current]) {
      if (serverRowIdsRef.current.has(id)) { pendingRowIdsRef.current.delete(id); changed = true }
    }
    if (changed) syncDirtyFromPending()
  }, [savedRows, syncDirtyFromPending])

  const mergeIncomingRows = useCallback((incomingRows: CurriculumSheetRow[], currentRows: CurriculumSheetRow[]) => {
    const { sheetMode: ctxMode, sheetBand: ctxBand } = gradeCtxRef.current
    const incoming = (incomingRows.length > 0 ? incomingRows : [])
      .map(row => normalizeRowGradePrefixes(row, ctxMode, ctxBand))
    const currentById = new Map(currentRows.map(row => [row.id, row]))
    const incomingIds = new Set(incoming.map(row => row.id))
    const dirtyKeys = new Set(Object.keys(dirtyCellVersionsRef.current))
    const merged = incoming.map(incomingRow => {
      const localRow = currentById.get(incomingRow.id)
      if (!localRow) return incomingRow
      const nextRow: CurriculumSheetRow = { ...localRow, ...incomingRow }
      for (const field of SHEET_EDITABLE_FIELDS) {
        if (dirtyKeys.has(`${incomingRow.id}:${field}`)) {
          nextRow[field] = localRow[field] as never
        }
      }
      return nextRow
    })

    for (const localRow of currentRows) {
      if (!incomingIds.has(localRow.id) && pendingRowIdsRef.current.has(localRow.id)) {
        merged.push(localRow)
      }
    }

    return merged.length > 0 ? merged : [emptyRow()]
  }, [])

  const applySavedRows = useCallback((saved: CurriculumSheetRow[] | void) => {
    if (!saved) return
    setRows(current => mergeIncomingRows(saved, current))
  }, [mergeIncomingRows])

  // 외부 rows 동기화 — dirty 상태(로컬 편집 중)일 때는 덮어쓰지 않음
  // Firestore onSnapshot으로 다른 사용자의 변경만 반영
  const savedRowsJson = useMemo(() => JSON.stringify(savedRows.map(r => ({ ...r, updatedAt: undefined }))), [savedRows])
  useEffect(() => {
    if (!open) return
    const localJson = JSON.stringify(rows.map(r => ({ ...r, updatedAt: undefined })))
    // 로컬과 동일하면 무시 (자기 변경이 돌아온 경우)
    if (localJson === savedRowsJson) return
    // 로컬 편집 중에도 다른 사용자의 변경은 병합하되, 내가 수정 중인 셀만 보호한다.
    if (dirty || hasPendingLocalChanges()) {
      setRows(current => mergeIncomingRows(savedRows, current))
      syncDirtyFromPending()
      return
    }
    setRows((savedRows.length > 0 ? savedRows : [emptyRow()]).map(row => normalizeRowGradePrefixes(row, sheetMode, sheetBand)))
    setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, savedRowsJson, dirty, hasPendingLocalChanges, mergeIncomingRows, syncDirtyFromPending])

  // 모달 열릴 때 초기 로드
  useEffect(() => {
    if (!open) return
    setRows((savedRows.length > 0 ? savedRows : [emptyRow()]).map(row => normalizeRowGradePrefixes(row, sheetMode, sheetBand)))
    setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open && onPresenceUpdate) onPresenceUpdate(null)
    if (!open) {
      for (const timer of Object.values(patchTimersRef.current)) clearTimeout(timer)
      patchTimersRef.current = {}
      dirtyCellVersionsRef.current = {}
      pendingRowIdsRef.current.clear()
      pendingStructuralCountRef.current = 0
    }
  }, [open, onPresenceUpdate])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setContentItems([])
    const isElementaryTarget = !/(?:중학교|고등학교|^\s*[중고])/.test(targetGradeGroup ?? '')
    const params = new URLSearchParams()
    if (targetGradeGroup) params.set('gradeGroup', targetGradeGroup)
    // 초등은 세 학년군 내용 요소를 한 번에 받아 두고 행별 학년군으로 클라이언트에서 필터한다.
    // → 행 학년군을 바꿀 때 재요청이 필요 없다. (미지원 서버면 기존 단일 학년군 응답이 와도 동작)
    if (isElementaryTarget) params.set('allBands', '1')
    params.set('_ts', String(Date.now()))
    const p1 = fetch(`/api/core-ideas?${params.toString()}`, { cache: 'no-store' }).then(r => r.json()).then(d => {
      setContentItems(sanitizeContentItems(d.items ?? []))
    }).catch(() => {})
    const p2 = isElementaryTarget ? Promise.all(
      Object.entries(SUBJECT_FILE).map(async ([subj, file]) => {
        try {
          const data: CurriculumFile = await (await fetch(curriculumJsonAssetPath(file))).json()
          const flat: FlatStandard[] = []
          for (const g of data.core_idea_groups) for (const s of g.standard_sets) {
            if (!ELEMENTARY_LEVELS.some(lv => s.school_level.includes(lv))) continue
            for (const st of s.standards) flat.push({ code: st.code, text: st.text, subject: subj, area: g.area, gradeBand: s.grade_band, label: `${st.code} ${st.text}` })
          }
          return flat
        } catch { return [] }
      }),
    ).then(a => setStandards(a.flat())) : Promise.resolve(setStandards([]))
    Promise.all([p1, p2]).finally(() => setLoading(false))
  }, [open, targetGradeGroup])

  const triggerSave = useCallback((r: CurriculumSheetRow[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { onSave(r); setDirty(false) }, 1000)
  }, [onSave])

  const saveStructuralPatch = useCallback(async (patch: CurriculumSheetPatch) => {
    if (!onPatchSave) return
    pendingStructuralCountRef.current += 1
    setDirty(true)
    try {
      const saved = await onPatchSave(patch)
      applySavedRows(saved)
    } catch (e) {
      console.error('[curriculumSheet patch]', e)
    } finally {
      pendingStructuralCountRef.current = Math.max(0, pendingStructuralCountRef.current - 1)
      syncDirtyFromPending()
    }
  }, [applySavedRows, onPatchSave, syncDirtyFromPending])

  const scheduleCellPatch = useCallback((
    rowId: string,
    field: CurriculumSheetEditableField,
    value: CurriculumSheetRow[CurriculumSheetEditableField],
  ) => {
    if (!onPatchSave) return
    const cellKey = `${rowId}:${field}`
    const version = (dirtyCellVersionsRef.current[cellKey] ?? 0) + 1
    dirtyCellVersionsRef.current[cellKey] = version
    setDirty(true)

    if (patchTimersRef.current[cellKey]) clearTimeout(patchTimersRef.current[cellKey])
    patchTimersRef.current[cellKey] = setTimeout(async () => {
      delete patchTimersRef.current[cellKey]
      try {
        const saved = await onPatchSave({
          type: 'update-cell',
          rowId,
          field,
          value,
          updatedBy: currentUserName,
        })
        if (dirtyCellVersionsRef.current[cellKey] === version) {
          delete dirtyCellVersionsRef.current[cellKey]
        }
        applySavedRows(saved)
      } catch (e) {
        console.error('[curriculumSheet cell patch]', e)
      } finally {
        syncDirtyFromPending()
      }
    }, 700)
  }, [applySavedRows, currentUserName, onPatchSave, syncDirtyFromPending])

  // 아직 서버에 저장되지 않은 행(최초 기본 행 등)은 셀 단위 패치가 no-op이 되므로
  // 전체 행을 upsert한다. 디바운스 타이머가 끝날 때 최신 행 전체를 보낸다.
  const scheduleRowUpsert = useCallback((rowId: string) => {
    if (!onPatchSave) return
    const timerKey = `__row__:${rowId}`
    pendingRowIdsRef.current.add(rowId)
    setDirty(true)
    if (patchTimersRef.current[timerKey]) clearTimeout(patchTimersRef.current[timerKey])
    patchTimersRef.current[timerKey] = setTimeout(async () => {
      delete patchTimersRef.current[timerKey]
      const fullRow = rowsRef.current.find(row => row.id === rowId)
      if (!fullRow) { syncDirtyFromPending(); return }
      try {
        const saved = await onPatchSave({ type: 'upsert-row', row: fullRow, updatedBy: currentUserName })
        applySavedRows(saved)
      } catch (e) {
        console.error('[curriculumSheet row upsert]', e)
      } finally {
        // pendingRowIdsRef는 savedRows 동기화 effect가 서버 반영 확인 후 정리한다.
        syncDirtyFromPending()
      }
    }, 700)
  }, [applySavedRows, currentUserName, onPatchSave, syncDirtyFromPending])

  const clearPendingCellTimers = useCallback(() => {
    for (const timer of Object.values(patchTimersRef.current)) clearTimeout(timer)
    patchTimersRef.current = {}
    dirtyCellVersionsRef.current = {}
  }, [])

  const updatePresence = useCallback((cellKey: string | null) => {
    if (!onPresenceUpdate || !currentUid) return
    if (!cellKey) { onPresenceUpdate(null); return }
    const ci = (currentUid.charCodeAt(0) + currentUid.charCodeAt(Math.min(currentUid.length - 1, 5))) % PRESENCE_COLORS.length
    onPresenceUpdate({ uid: currentUid, displayName: currentUserName ?? '', color: currentUserColor ?? PRESENCE_COLORS[ci], cellKey, updatedAt: Date.now() })
    // 자동 해제 없음 — 다른 셀 클릭 또는 모달 닫기 시에만 해제
  }, [onPresenceUpdate, currentUid, currentUserName, currentUserColor])

  // 그래프 등 외부 경로에서 온 행의 빈 지식·이해/과정·기능을 내용체계 원문으로 자동 보강 — 빈 셀만, 사용자가 편집 중인 셀 제외.
  // 채워지면 재실행돼도 no-op이라 루프가 종료된다.
  useEffect(() => {
    if (!open || loading || contentItems.length === 0) return
    const CAPS = { knowledge: 3, processFunction: 2, valueAttitude: 2 } as const
    const changedCells: Array<{ rowId: string; field: 'knowledge' | 'processFunction' | 'valueAttitude'; value: string }> = []
    const changedRowIds = new Set<string>()
    const nextRows = rows.map(row => {
      if (!(row.coreIdea ?? '').trim()) return row
      let next = row
      for (const field of ['knowledge', 'processFunction', 'valueAttitude'] as const) {
        if ((row[field] ?? '').trim()) continue
        if (dirtyCellVersionsRef.current[`${row.id}:${field}`] !== undefined) continue
        const matched = matchContentElementsForRow(row, field).slice(0, CAPS[field])
        if (matched.length === 0) continue
        const value = joinValues(matched)
        next = { ...next, [field]: value }
        changedCells.push({ rowId: row.id, field, value })
        changedRowIds.add(row.id)
      }
      return next === row ? row : { ...next, updatedBy: currentUserName, updatedAt: Date.now() }
    })
    if (changedCells.length === 0) return
    rowsRef.current = nextRows
    setRows(nextRows)
    setDirty(true)
    if (onPatchSave) {
      for (const { rowId, field, value } of changedCells) {
        if (serverRowIdsRef.current.has(rowId)) scheduleCellPatch(rowId, field, value)
      }
      for (const rowId of changedRowIds) {
        if (!serverRowIdsRef.current.has(rowId)) scheduleRowUpsert(rowId)
      }
    } else {
      triggerSave(nextRows)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, contentItems, standards, rows, sheetMode, sheetBand])

  // 한 행의 여러 셀을 한 번에 갱신한다 (과목 ↔ 학년군처럼 함께 바뀌어야 하는 값).
  function updateRowFields(id: string, fields: SheetFieldPatch) {
    const entries = Object.entries(fields) as Array<[CurriculumSheetEditableField, CurriculumSheetRow[CurriculumSheetEditableField]]>
    if (entries.length === 0) return
    setRows(prev => {
      const n = prev.map(r => r.id === id ? { ...r, ...fields, updatedBy: currentUserName, updatedAt: Date.now() } : r)
      rowsRef.current = n
      setDirty(true)
      if (!onPatchSave) triggerSave(n)
      return n
    })
    if (onPatchSave) {
      // 서버에 저장된 행은 셀 단위로, 아직 저장 안 된 행은 전체 행 upsert로 보낸다.
      if (serverRowIdsRef.current.has(id)) for (const [field, value] of entries) scheduleCellPatch(id, field, value)
      else scheduleRowUpsert(id)
    }
    updatePresence(`${id}:${entries[0][0]}`)
  }
  function updateRow(id: string, field: CurriculumSheetEditableField, value: string) {
    updateRowFields(id, { [field]: value } as SheetFieldPatch)
  }
  // 과목 변경 — 새 교과에 그 학년군 성취기준이 없으면(통합교과=1-2학년군 전용, 사회=1-2학년군 없음 …)
  // 쓸 수 있는 학년군으로 옮긴다. 시트 학년군이 가능하면 그것, 아니면 첫 번째.
  // 사용 가능한 학년군이면 학년군을 건드리지 않는다(값이 없으면 시트 학년군이라는 뜻 유지).
  function updateRowSubject(row: CurriculumSheetRow, subject: string) {
    const available = bandsWithStandardsFor(subject)
    const fallback = allowedGradeBandsForSubject(subject)
    const options: readonly string[] = available.length > 0 ? available : fallback
    const effective = toGradeBandLabel(row.gradeBand) || sheetBand
    if (effective && options.some(band => band === effective)) {
      updateRowFields(row.id, { subject })
      return
    }
    const nextBand = options.some(band => band === sheetBand) ? sheetBand : options[0]
    updateRowFields(row.id, { subject, ...(nextBand ? { gradeBand: nextBand } : {}) })
  }
  function removeTag(rowId: string, field: CurriculumSheetEditableField, tag: string) {
    const row = rows.find(r => r.id === rowId); if (!row) return
    updateRow(rowId, field, joinValues(splitValues(row[field] as string).filter(t => t !== tag)))
  }
  function addRow() {
    const row = emptyRow()
    setRows(p => {
      const n = [...p, row]
      setDirty(true)
      if (!onPatchSave) triggerSave(n)
      return n
    })
    if (onPatchSave) {
      pendingRowIdsRef.current.add(row.id)
      void saveStructuralPatch({ type: 'upsert-row', row, updatedBy: currentUserName }).finally(() => {
        pendingRowIdsRef.current.delete(row.id)
        syncDirtyFromPending()
      })
    }
  }
  // ＋ 학년군 줄 — 같은 교과·핵심아이디어를 학년군별로 나눈다.
  // 바로 아래에 형제 행을 끼워 넣고 upsert + reorder로 팀원 화면에도 같은 위치로 반영한다.
  function addGradeBandRow(sourceRow: CurriculumSheetRow) {
    const band = nextUnusedGradeBand(rows, sourceRow.subject, sourceRow.coreIdea, sheetBand, bandsWithStandardsFor(sourceRow.subject))
    if (!band) return
    const row: CurriculumSheetRow = {
      ...emptyRow(),
      subject: sourceRow.subject,
      coreIdea: sourceRow.coreIdea,
      gradeBand: band,
      isCenter: false,
    }
    const sourceIdx = rows.findIndex(r => r.id === sourceRow.id)
    const next = [...rows]
    next.splice(sourceIdx < 0 ? next.length : sourceIdx + 1, 0, row)
    rowsRef.current = next
    setRows(next)
    setDirty(true)
    if (!onPatchSave) { triggerSave(next); return }
    const rowIds = next.map(r => r.id)
    pendingRowIdsRef.current.add(row.id)
    void (async () => {
      try {
        await saveStructuralPatch({ type: 'upsert-row', row, updatedBy: currentUserName })
        await saveStructuralPatch({ type: 'reorder', rowIds })
      } finally {
        pendingRowIdsRef.current.delete(row.id)
        syncDirtyFromPending()
      }
    })()
  }
  /**
   * ＋ N학년군 연결 줄 — 그 학년군에 성취기준이 없는 교과(1-2학년군의 사회 등)를 위해
   * 다른 교과의 그 학년군 성취기준을 붙일 빈 줄을 원본 바로 아래에 만든다.
   * 팀이 고른 핵심아이디어는 linkedCoreIdea로 남는다.
   */
  function addBridgeRow(sourceRow: CurriculumSheetRow, band: string) {
    if (!band || !sourceRow.subject || !(sourceRow.coreIdea ?? '').trim()) return
    const row: CurriculumSheetRow = { ...emptyRow(), ...makeBridgeRow(sourceRow, band) }
    const sourceIdx = rows.findIndex(r => r.id === sourceRow.id)
    const next = [...rows]
    next.splice(sourceIdx < 0 ? next.length : sourceIdx + 1, 0, row)
    rowsRef.current = next
    setRows(next)
    setDirty(true)
    if (!onPatchSave) { triggerSave(next); return }
    const rowIds = next.map(r => r.id)
    pendingRowIdsRef.current.add(row.id)
    void (async () => {
      try {
        await saveStructuralPatch({ type: 'upsert-row', row, updatedBy: currentUserName })
        await saveStructuralPatch({ type: 'reorder', rowIds })
      } finally {
        pendingRowIdsRef.current.delete(row.id)
        syncDirtyFromPending()
      }
    })()
  }

  /** 연결 줄의 '유사 성취기준 찾기' — 원본 핵심아이디어에 가까운 그 학년군 성취기준 후보. */
  async function openBridgePicker(row: CurriculumSheetRow, rect: DOMRect) {
    const link = row.linkedCoreIdea
    const band = rowBandOf(row)
    if (!link || !band) return
    setBridgeTarget({ rowId: row.id, rect })
    setBridgeSubjectFilter('')
    setBridgeQuery({ loading: true, candidates: [], subjectsSearched: [], notes: [] })
    try {
      const resp = await fetch('/api/curriculum-sheet/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'bridgeStandards',
          sourceSubject: link.subject,
          sourceCoreIdea: link.coreIdea,
          targetBand: band,
          topic: (a12Artifact?.selectedTopic as string | undefined) ?? undefined,
          chatContext,
        }),
      })
      const data = await resp.json().catch(() => ({})) as {
        candidates?: BridgeCandidate[]
        judge?: 'jev' | 'embedding'
        subjectsSearched?: string[]
        notes?: string[]
        error?: string
      }
      if (!resp.ok) {
        setBridgeQuery({
          loading: false,
          candidates: [],
          subjectsSearched: [],
          notes: data.notes ?? [],
          error: data.error ?? '유사 성취기준을 찾지 못했습니다',
        })
        return
      }
      const subjectsSearched = data.subjectsSearched ?? []
      // 기본 필터: 통합교과가 있으면 그것(1-2학년군 전용 교과라 연결 후보로 가장 적절), 없으면 전체.
      setBridgeSubjectFilter(subjectsSearched.includes('통합교과') ? '통합교과' : '')
      setBridgeQuery({
        loading: false,
        candidates: data.candidates ?? [],
        subjectsSearched,
        notes: data.notes ?? [],
        judge: data.judge,
      })
    } catch (e) {
      setBridgeQuery({ loading: false, candidates: [], subjectsSearched: [], notes: [], error: '요청 중 오류가 발생했습니다' })
      console.error('[bridge standards]', e)
    }
  }

  /**
   * 후보 적용 — 교과·핵심아이디어·성취기준·학년군을 한 번에 갱신한다.
   * 행의 핵심아이디어는 그 성취기준의 실제 학년군 핵심아이디어(내용체계 원문 우선)로 두어
   * 엄격 학년군 규칙과 DB 검증이 그대로 유지되고, 팀 핵심아이디어는 linkedCoreIdea에 남는다.
   * 지식·이해/과정·기능/가치·태도는 기존 자동 보강 effect가 이어서 채운다.
   */
  function applyBridgeCandidate(rowId: string, candidate: BridgeCandidate) {
    const row = rowsRef.current.find(r => r.id === rowId)
    const band = row ? rowBandOf(row) : ''
    updateRowFields(rowId, {
      subject: toSheetSubject(candidate.subject),
      coreIdea: candidate.contentCoreIdea || candidate.coreIdea,
      standard: candidate.standard,
      ...(band ? { gradeBand: band } : {}),
    })
    setBridgeTarget(null)
  }

  function removeRow(id: string) {
    setRows(p => {
      const n = p.filter(r => r.id !== id)
      if (n.length === 0) n.push(emptyRow())
      setDirty(true)
      if (!onPatchSave) triggerSave(n)
      return n
    })
    if (onPatchSave) void saveStructuralPatch({ type: 'delete-row', rowId: id })
  }
  // 드롭 — 핵심아이디어 묶음 전체를 대상 묶음의 대표 줄 앞으로 옮긴다.
  // (한 학년군 모드는 모든 묶음이 1줄이라 기존 동작과 같다.)
  function handleDrop(targetId: string) {
    if (!dragRowId || dragRowId === targetId) { setDragRowId(null); setDragOverRowId(null); return }
    setRows(prev => {
      const groupOf = (leaderId: string) => {
        const startIdx = prev.findIndex(r => r.id === leaderId)
        if (startIdx < 0) return []
        const groupRows = [prev[startIdx]]
        for (let i = startIdx + 1; i < prev.length; i += 1) {
          if (!groupingEnabled || !isSameCoreIdeaGroup(prev[i], prev[i - 1])) break
          groupRows.push(prev[i])
        }
        return groupRows
      }
      const moved = groupOf(dragRowId)
      if (moved.length === 0) return prev
      const movedIds = new Set(moved.map(r => r.id))
      if (movedIds.has(targetId)) return prev
      const remaining = prev.filter(r => !movedIds.has(r.id))
      const toIdx = remaining.findIndex(r => r.id === targetId)
      if (toIdx < 0) return prev
      const next = [...remaining]
      next.splice(toIdx, 0, ...moved)
      setDirty(true)
      if (!onPatchSave) triggerSave(next)
      else void saveStructuralPatch({ type: 'reorder', rowIds: next.map(r => r.id) })
      return next
    })
    setDragRowId(null); setDragOverRowId(null)
  }

  // 자동 채우기 확인 창의 학년군 기본값 — 시트 행에서 유도된 서버 값이 있으면 그것,
  // 없으면 프로젝트 학년군(통합교과는 1~2학년군 고정).
  function defaultGradeBandsForSubject(subject: string, serverBands?: string[]): string[] {
    const allowed = allowedGradeBandsForSubject(subject)
    if (allowed.length === 1) return [...allowed]
    const fromServer = ELEMENTARY_GRADE_BANDS.filter(band => (serverBands ?? []).some(value => toGradeBandLabel(value) === band))
    if (fromServer.length > 0) return fromServer
    return sheetBand ? [sheetBand] : [allowed[0]]
  }
  // 선택된 핵심아이디어에 성취기준이 실제로 있는 학년군만 고를 수 있게 한다.
  // (사회·실과처럼 학년군별로 후보가 갈리는 교과. 서버가 학년군을 주지 않으면 제한하지 않는다.)
  function availableGradeBandsForProposal(subject: string, option?: CoreIdeaOption): string[] {
    const allowed = allowedGradeBandsForSubject(subject)
    const fromOption = ELEMENTARY_GRADE_BANDS.filter(band => (option?.gradeBands ?? []).some(value => toGradeBandLabel(value) === band))
    const scoped = fromOption.length > 0 ? allowed.filter(band => fromOption.includes(band)) : [...allowed]
    return scoped.length > 0 ? scoped : [...allowed]
  }
  function proposalGradeBands(subject: string): string[] {
    const stored = coreIdeaGradeBands[subject]
    if (stored?.length) return stored
    const proposal = autofillReview?.proposals.find(item => item.subject === subject)
    return defaultGradeBandsForSubject(subject, proposal?.gradeBands)
  }
  // 학년군 칩 토글 — 마지막 하나는 해제할 수 없다(교과당 최소 1개 학년군 필요).
  function toggleProposalGradeBand(subject: string, band: string) {
    const current = proposalGradeBands(subject)
    const next = current.includes(band)
      ? current.filter(item => item !== band)
      : [...current, band]
    if (next.length === 0) return
    // 항상 학년군 순서(1-2 → 3-4 → 5-6)로 정렬해 보낸다.
    setCoreIdeaGradeBands(prev => ({ ...prev, [subject]: ELEMENTARY_GRADE_BANDS.filter(item => next.includes(item)) }))
  }
  function getAutofillExistingRows() {
    return rows.some(r => r.subject) ? rows.map(r => ({
      subject: r.subject,
      // 서버가 학년군을 다시 추정하지 않도록 정규 라벨로 확정해 보낸다(없으면 생략).
      ...(rowBandOf(r) ? { gradeBand: rowBandOf(r) } : {}),
      coreIdea: r.coreIdea, standard: r.standard,
      knowledge: r.knowledge, processFunction: r.processFunction,
      valueAttitude: r.valueAttitude,
      agentLessonExample: r.agentLessonExample, description: r.description, isCenter: r.isCenter,
    })) : undefined
  }

  // 자동 채우기 요청의 공통 본문 — 전체 채우기·행별 Jev 채우기가 같은 값을 쓴다.
  // targetGradeGroup은 시트 기준 학년군('3-4학년군')을 보낸다. 한 학년 팀이 프로젝트
  // 학년군과 다른 학년군을 고른 경우에도 서버가 그 학년군으로 판정하도록.
  function autofillCommonPayload() {
    return {
      existingRows: getAutofillExistingRows(),
      a12Artifact,
      graphSavedData,
      targetGradeGroup: sheetBand || targetGradeGroup,
      chatContext,
    }
  }

  // 교과별 선택 핵심아이디어 + 채울 학년군.
  // single 모드는 시트 학년군 하나, multi 모드는 칩으로 고른 학년군(가용 학년군과 교집합).
  function buildSelectedCoreIdeasPayload() {
    return Object.entries(coreIdeaSelections).map(([subject, coreIdea]) => {
      if (sheetMode === 'single') {
        const band = allowedGradeBandsForSubject(subject).length === 1
          ? allowedGradeBandsForSubject(subject)[0]
          : sheetBand
        return { subject, coreIdea, gradeBands: band ? [band] : [] }
      }
      const proposal = autofillReview?.proposals.find(item => item.subject === subject)
      const option = proposal?.options.find(item => item.idea === coreIdea)
      const available = availableGradeBandsForProposal(subject, option)
      const selected = proposalGradeBands(subject).filter(band => available.includes(band))
      return { subject, coreIdea, gradeBands: selected.length > 0 ? selected : available.slice(0, 1) }
    })
  }

  function setProgressStep(id: string, patch: Partial<AutofillProgress>) {
    setAutofillProgress(prev => prev.map(step => step.id === id ? { ...step, ...patch } : step))
  }

  async function handleAutofill() {
    setAutofillLoading(true)
    setAutofillError('')
    setAutofillNotes([])
    setAutofillProgress([{ id: 'coreIdeas', label: '핵심아이디어 판정 (Jev)', status: 'running' }])
    const started = performance.now()
    try {
      const resp = await fetch('/api/curriculum-sheet/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'coreIdeas', ...autofillCommonPayload() }),
      })
      if (resp.ok) {
        const data = await resp.json() as AutofillReview
        if (data.proposals?.length) {
          const defaults: Record<string, string> = {}
          const bandDefaults: Record<string, string[]> = {}
          for (const proposal of data.proposals) {
            defaults[proposal.subject] = proposal.selectedCoreIdea
            bandDefaults[proposal.subject] = defaultGradeBandsForSubject(proposal.subject, proposal.gradeBands)
          }
          setCoreIdeaSelections(defaults)
          setCoreIdeaGradeBands(bandDefaults)
          setAutofillReview(data)
        }
        setAutofillNotes(data.notes ?? [])
        const judge = data.judge ?? 'embedding'
        setProgressStep('coreIdeas', { status: 'done', label: `핵심아이디어 판정 (${JUDGE_LABEL[judge]})`, ms: Math.round(performance.now() - started), note: `${data.proposals?.length ?? 0}개 교과` })
      } else {
        const err = await resp.json().catch(() => ({})) as { error?: string; notes?: string[] }
        setAutofillError(err.error ?? '핵심아이디어 후보를 찾지 못했습니다.')
        setAutofillNotes(err.notes ?? [])
        setProgressStep('coreIdeas', { status: 'error', note: err.error })
        console.error('[autofill error]', err)
      }
    } catch (e) {
      setAutofillError('자동 채우기 요청 중 오류가 발생했습니다.')
      setProgressStep('coreIdeas', { status: 'error' })
      console.error('[autofill]', e)
    }
    finally { setAutofillLoading(false) }
  }

  // [2026-09-20] 판정(rows) → 설명 작성·검증(describe) 두 요청으로 나눠 단계를 그대로 보여주고,
  // 요청당 시간을 줄인다(Firebase Hosting 60초 제한). 설명 요청이 실패해도 판정된 행은 살린다.
  async function applyAutofillReview() {
    if (!autofillReview) return
    setAutofillLoading(true)
    setAutofillError('')
    setAutofillProgress(prev => [
      ...prev.filter(step => step.id === 'coreIdeas'),
      { id: 'rows', label: '성취기준 · 지식·이해 · 과정·기능 · 가치·태도 판정 (Jev)', status: 'running' },
      { id: 'describe', label: 'LLM 수업내용 설명 작성 (확정된 값만 사용)', status: 'pending' },
      { id: 'verify', label: 'Jev 설명 범위 검증', status: 'pending' },
    ])
    const common = autofillCommonPayload()
    try {
      const rowsStart = performance.now()
      const resp = await fetch('/api/curriculum-sheet/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'rows',
          selectedCoreIdeas: buildSelectedCoreIdeasPayload(),
          ...common,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string; notes?: string[] }
        setAutofillError(err.error ?? '분석표 생성에 실패했습니다.')
        setAutofillNotes(err.notes ?? [])
        setProgressStep('rows', { status: 'error', note: err.error })
        console.error('[autofill apply error]', err)
        return
      }
      const data = await resp.json() as { rows?: CurriculumSheetRow[]; judge?: 'jev' | 'embedding'; notes?: string[] }
      if (data.notes?.length) setAutofillNotes(data.notes)
      const judgedRows = (data.rows ?? []).map((r: CurriculumSheetRow) => ({ ...emptyRow(), ...r }))
      setProgressStep('rows', {
        status: 'done',
        label: `성취기준 · 지식·이해 · 과정·기능 · 가치·태도 판정 (${JUDGE_LABEL[data.judge ?? 'embedding']})`,
        ms: Math.round(performance.now() - rowsStart),
        note: `${judgedRows.length}행`,
      })
      if (judgedRows.length === 0) return

      // 판정된 행을 먼저 반영해 두고, 설명은 뒤이어 채운다.
      const commitRows = (next: CurriculumSheetRow[]) => {
        setRows(next)
        setDirty(true)
        if (onPatchSave) void saveStructuralPatch({ type: 'replace-all', rows: next, updatedBy: currentUserName })
        else triggerSave(next)
      }
      commitRows(judgedRows)
      setAutofillReview(null)

      setProgressStep('describe', { status: 'running' })
      const describeStart = performance.now()
      try {
        const descResp = await fetch('/api/curriculum-sheet/autofill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'describe', rows: judgedRows, ...common }),
        })
        if (!descResp.ok) throw new Error(`HTTP ${descResp.status}`)
        const desc = await descResp.json() as { descriptions?: Record<string, string>; verification?: Record<string, number>; steps?: AutofillStep[] }
        // 설명 키 우선순위: 보낸 행 id → '교과::학년군' → 교과명.
        // 교과명 키는 한 교과가 두 학년군에 있으면 충돌하므로 마지막 폴백으로만 쓴다.
        const descriptionFor = (row: CurriculumSheetRow): string | undefined => {
          const band = toGradeBandLabel(row.gradeBand)
          return desc.descriptions?.[row.id]
            ?? (band ? desc.descriptions?.[`${row.subject}::${band}`] : undefined)
            ?? desc.descriptions?.[row.subject]
        }
        const withDescriptions = judgedRows.map(row => ({ ...row, description: descriptionFor(row) ?? row.description ?? '' }))
        commitRows(withDescriptions)
        const serverStep = (id: string) => desc.steps?.find(step => step.id === id)
        setProgressStep('describe', { status: 'done', ms: serverStep('describe')?.ms ?? Math.round(performance.now() - describeStart) })
        const verifyStep = serverStep('verify')
        const rewriteStep = serverStep('rewrite')
        const lowest = Object.values(desc.verification ?? {})
        setProgressStep('verify', verifyStep
          ? { status: 'done', ms: (verifyStep.ms ?? 0) + (rewriteStep?.ms ?? 0), note: rewriteStep ? rewriteStep.label : (lowest.length ? `범위 내 ${Math.round(Math.min(...lowest) * 100)}% 이상` : undefined) }
          : { status: 'done', note: 'Jev 미사용' })
      } catch (e) {
        setProgressStep('describe', { status: 'error', note: '설명은 비워 두었습니다' })
        setProgressStep('verify', { status: 'error' })
        console.error('[autofill describe]', e)
      }
    } catch (e) {
      setAutofillError('분석표 생성 중 오류가 발생했습니다.')
      setProgressStep('rows', { status: 'error' })
      console.error('[autofill apply]', e)
    }
    finally { setAutofillLoading(false) }
  }

  /**
   * 행별 Jev 채우기 — 핵심아이디어 → (그 학년군의) 성취기준 → (그 성취기준의)
   * 지식·이해/과정·기능/가치·태도 매핑을 서버 판정(mode: 'rows')으로 한 행만 받아온다.
   * 비어 있는 칸만 채우고 교사가 직접 넣은 값은 절대 덮어쓰지 않는다. 선택창은 그대로 쓸 수 있다.
   */
  async function handleRowJevFill(row: CurriculumSheetRow) {
    const band = rowBandOf(row)
    setRowFillState(prev => ({ ...prev, [row.id]: { loading: true } }))
    try {
      const resp = await fetch('/api/curriculum-sheet/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'rows',
          selectedCoreIdeas: [{ subject: row.subject, coreIdea: row.coreIdea, gradeBands: band ? [band] : [] }],
          ...autofillCommonPayload(),
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string; notes?: string[] }
        // 404의 error 문구가 곧 사유("사회: 1-2학년군 성취기준이 … 제외했습니다.")다.
        // 행 칸은 좁아 잘리므로 상단 안내 스트립에 전문을 띄운다.
        const reasons = err.notes?.length ? err.notes : (err.error ? [err.error] : [])
        if (reasons.length > 0) setAutofillNotes(reasons)
        setRowFillState(prev => ({ ...prev, [row.id]: { error: err.error ?? '제안을 받지 못했습니다', notes: err.notes } }))
        console.error('[row jev fill]', err)
        return
      }
      const data = await resp.json() as { rows?: CurriculumSheetRow[]; judge?: 'jev' | 'embedding'; notes?: string[] }
      // 학년군 조정 같은 안내(통합교과 → 1-2학년군)도 전문을 상단에 띄운다.
      if (data.notes?.length) setAutofillNotes(data.notes)
      // 반드시 같은 교과의 행만 쓴다. 해당 학년군에 성취기준이 없어 교과가 제외되면
      // (예: 사회 1-2학년군) 응답에 다른 교과 행만 남는데, 그것을 채우면 완전히 틀린 값이 된다.
      // 서버가 교과명을 별칭으로 돌려줄 수 있어 비교는 포함 관계까지 허용한다.
      const candidates = data.rows ?? []
      const subjectRows = candidates.filter(r => curriculumTextMatches(r.subject ?? '', row.subject))
      const matched = subjectRows.find(r => !band || toGradeBandLabel(r.gradeBand) === band) ?? subjectRows[0]
      if (!matched) {
        setRowFillState(prev => ({
          ...prev,
          [row.id]: {
            judge: data.judge,
            error: data.notes?.length ? '제안 없음 (안내 참고)' : '연결할 성취기준을 찾지 못했습니다',
            notes: data.notes,
          },
        }))
        return
      }
      // 최신 로컬 값 기준으로 "빈 칸"을 판정한다(요청 중 다른 팀원이 채웠을 수 있다).
      const current = rowsRef.current.find(r => r.id === row.id) ?? row
      const prefixBand = resolveGradePrefixBandForMode({ ...current, standard: matched.standard }, sheetMode, sheetBand)
      const fields: SheetFieldPatch = {}
      for (const field of ROW_FILL_FIELDS) {
        if ((current[field] ?? '').trim()) continue
        const value = (matched[field] ?? '').trim()
        if (!value) continue
        fields[field] = field === 'standard' ? value : ensureGradePrefixesForValue(value, prefixBand)
      }
      const filled = Object.keys(fields).length
      if (filled > 0) updateRowFields(row.id, fields)
      setRowFillState(prev => ({ ...prev, [row.id]: { judge: data.judge, filled, notes: data.notes } }))
    } catch (e) {
      setRowFillState(prev => ({ ...prev, [row.id]: { error: '요청 중 오류가 발생했습니다' } }))
      console.error('[row jev fill]', e)
    }
  }

  // 시트 학년군 설정 변경 — 공동 편집이라 팀원 누구나 바꿀 수 있고, 저장되면 전원 화면에 반영된다.
  async function changeGradeSettings(next: { gradeMode?: SheetGradeMode; gradeBand?: string }) {
    setPendingGradeSettings(prev => ({ ...(prev ?? {}), ...next }))
    try {
      await onGradeSettingsChange?.(next)
    } catch (e) {
      console.error('[curriculumSheet grade settings]', e)
    } finally {
      // 저장 후에는 프로젝트 문서(prop)가 기준 — 낙관적 값을 놓는다.
      setPendingGradeSettings(null)
    }
  }

  // 핵심아이디어 확인 창에서 AI가 제안한 교과 중 원하지 않는 교과를 제외한다.
  function removeAutofillProposal(subject: string) {
    setAutofillReview(prev => {
      if (!prev) return prev
      const proposals = prev.proposals.filter(p => p.subject !== subject)
      return proposals.length > 0 ? { ...prev, proposals } : null
    })
    setCoreIdeaSelections(prev => {
      const next = { ...prev }
      delete next[subject]
      return next
    })
    setCoreIdeaGradeBands(prev => {
      const next = { ...prev }
      delete next[subject]
      return next
    })
  }

  // 행의 핵심아이디어에 매칭되는 내용체계 원문(지식·이해/과정·기능/가치·태도)만 반환 — getPickerOptions coreIdea 분기와 동일 스코핑.
  // STRICT: 핵심아이디어에 매칭되는 항목이 없으면 [] (자동 보강이 핵심아이디어와 무관한 값을 쓰지 않도록).
  function matchContentElementsForRow(row: CurriculumSheetRow, field: 'knowledge' | 'processFunction' | 'valueAttitude'): string[] {
    const subj = row.subject ?? ''; const ci = row.coreIdea ?? ''
    if (!ci) return []
    const si = subj ? contentItems.filter(i => i.subject.includes(subj)) : contentItems
    const selectedAreas = unique(splitValues(row.standard)
      .map(value => {
        const code = normalizeStandardCode(value)
        return standards.find(s => normalizeStandardCode(s.code) === code || normalizeStandardCode(s.label) === code)?.area ?? ''
      })
      .filter(Boolean))
    const scopedItems = selectedAreas.length
      ? si.filter(i => selectedAreas.some(area => curriculumTextMatches(i.area, area)))
      : si
    const areaScopedItems = scopedItems.length > 0 ? scopedItems : si
    const matched = areaScopedItems.filter(i => i.coreIdeas.some(c => curriculumTextMatches(c, ci)))
    if (matched.length === 0) return []
    matched.sort((a, b) => a.coreIdeas.length - b.coreIdeas.length)
    const rawItems = field === 'knowledge' ? matched[0].knowledge : field === 'processFunction' ? matched[0].functions : matched[0].attitudes
    const raw = filterByGradeBand(rawItems, rowBandOf(row))
    return [...new Set(raw)]
  }

  function getPickerOptions(rowId: string, field: PickerField): string[] {
    const row = rows.find(r => r.id === rowId); const subj = row?.subject ?? ''; const ci = row?.coreIdea ?? ''
    const si = subj ? contentItems.filter(i => i.subject.includes(subj)) : contentItems
    const rowBand = row ? rowBandOf(row) : sheetBand
    const gradeFiltered = (items: string[]) => filterByGradeBand(items, rowBand)
    const selectedAreas = row ? unique(splitValues(row.standard)
      .map(value => {
        const code = normalizeStandardCode(value)
        return standards.find(s => normalizeStandardCode(s.code) === code || normalizeStandardCode(s.label) === code)?.area ?? ''
      })
      .filter(Boolean)) : []
    const scopedItems = selectedAreas.length
      ? si.filter(i => selectedAreas.some(area => curriculumTextMatches(i.area, area)))
      : si
    const areaScopedItems = scopedItems.length > 0 ? scopedItems : si
    if (field === 'coreIdea') return [...new Set(si.flatMap(i => i.coreIdeas))]
    if (field === 'standard') {
      const s = subj ? standards.filter(s => s.subject === subj) : standards
      return s.filter(standard => standardMatchesRowBand(standard, rowBand)).map(s => s.label)
    }
    if (field === 'knowledge' || field === 'processFunction' || field === 'valueAttitude') {
      // 내용체계 JSON 원문만 사용한다. 보조 매핑/AI 생성값은 선택창 후보에서 제외한다.
      if (ci && row) {
        const matched = matchContentElementsForRow(row, field)
        if (matched.length > 0) return matched
      }

      // 폴백도 현재 교과/영역/학년군의 내용체계 원문으로만 제한
      return [...new Set(gradeFiltered(areaScopedItems.flatMap(i => field === 'knowledge' ? i.knowledge : field === 'processFunction' ? i.functions : i.attitudes)))]
    }
    return []
  }

  // 핵심아이디어: 영역별 그룹으로 반환
  function getCoreIdeaGroups(rowId: string): OptionGroup[] {
    const row = rows.find(r => r.id === rowId); const subj = row?.subject ?? ''
    const si = subj ? contentItems.filter(i => i.subject.includes(subj)) : contentItems
    const groupMap = new Map<string, string[]>()
    for (const item of si) {
      const key = item.area || '기타'
      if (!groupMap.has(key)) groupMap.set(key, [])
      for (const ci of item.coreIdeas) {
        if (!groupMap.get(key)!.includes(ci)) groupMap.get(key)!.push(ci)
      }
    }
    return [...groupMap.entries()].map(([label, options]) => ({ label, options }))
  }

  function getCoreIdeaArea(row: CurriculumSheetRow): string {
    if (!row.coreIdea) return ''
    const subjectItems = row.subject ? contentItems.filter(i => i.subject.includes(row.subject) || row.subject.includes(i.subject)) : contentItems
    return subjectItems.find(item => item.coreIdeas.some(coreIdea => curriculumTextMatches(coreIdea, row.coreIdea)))?.area ?? ''
  }

  function handleCellClick(rowId: string, field: PickerField, e: React.MouseEvent) {
    setPickerTarget({ rowId, field, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
    updatePresence(`${rowId}:${field}`)
  }
  async function handleManualSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    clearPendingCellTimers()
    let savedRows = rows
    if (onPatchSave) {
      try {
        const patched = await onPatchSave({ type: 'replace-all', rows, updatedBy: currentUserName })
        if (patched?.length) {
          savedRows = patched
          setRows(mergeIncomingRows(patched, rows))
        }
      } catch (e) {
        console.error('[curriculumSheet manual save]', e)
      }
    } else {
      onSave(rows)
    }
    setDirty(false)
    onRequestArtifactSave?.(savedRows)
    if (savedRows.some(r => r.isCenter && r.subject && r.standard)) setShowGraphPrompt(true)
  }
  // 해당 셀을 편집 중인 다른 사용자 (자기 제외)
  function getPresenceForCell(rowId: string, field: string): PresenceEntry | undefined {
    if (!presence) return undefined
    return Object.values(presence).find(p => p.cellKey === `${rowId}:${field}` && p.uid !== currentUid)
  }
  // 해당 셀을 편집 중인 자기 자신
  function getMyPresenceForCell(rowId: string, field: string): boolean {
    if (!presence || !currentUid) return false
    return Object.values(presence).some(p => p.cellKey === `${rowId}:${field}` && p.uid === currentUid)
  }

  if (!open) return null

  const FL: Record<string, string> = { coreIdea: '핵심아이디어', standard: '성취기준', knowledge: '지식·이해', processFunction: '과정·기능', valueAttitude: '가치·태도' }
  const FC: Record<string, string> = { coreIdea: '#7B1FA2', standard: '#1A73E8', knowledge: '#0D47A1', processFunction: '#137333', valueAttitude: '#8A5A00' }

  const allEditors = presence ? [...new Map(Object.values(presence).filter(p => Date.now() - p.updatedAt < 20000).map(p => [p.uid, p] as const)).values()] : []
  const myColor = currentUserColor ?? (currentUid ? PRESENCE_COLORS[(currentUid.charCodeAt(0) + currentUid.charCodeAt(Math.min(currentUid.length - 1, 5))) % PRESENCE_COLORS.length] : '#999')
  // 학년군 UI는 초등 학년군이 판정되는 시트에서만 노출한다(중·고는 기존 화면 그대로).
  const showGradeBandUI = !!sheetBand
  // 다양한 학년군 모드에서만 "핵심아이디어 1행 + 학년군별 줄" 묶음 렌더링을 쓴다.
  // (한 학년군 모드는 기존 표 그대로 — 모든 묶음이 1줄이고 학년군 열도 없다.)
  const groupingEnabled = showGradeBandUI && sheetMode === 'multi'
  const tableWidth = groupingEnabled ? 2755 : 2605
  // 연속한 같은 핵심아이디어 묶음(학년군만 다른 줄 + 연결 줄)을 하나의 시각적 행으로 묶는다.
  const rowGroups: CurriculumSheetRow[][] = []
  for (const row of rows) {
    const lastGroup = rowGroups[rowGroups.length - 1]
    const prevRow = lastGroup?.[lastGroup.length - 1]
    if (groupingEnabled && lastGroup && isSameCoreIdeaGroup(row, prevRow)) lastGroup.push(row)
    else rowGroups.push([row])
  }

  /**
   * 줄 단위 컨트롤 — 학년군 선택, 학년군 줄·연결 줄 추가(대표 줄), 유사 성취기준 찾기(연결 줄),
   * AI 성취기준 제안, 그리고 그 줄에 해당하는 안내. 다양한 학년군 모드에서는 학년군 칸에,
   * 한 학년군 모드에서는 (학년군 칸이 없으므로) 과목 칸에 렌더링한다.
   */
  function renderLineControls(row: CurriculumSheetRow, options: { isLeader: boolean; inBandCell: boolean }) {
    const { isLeader, inBandCell } = options
    const withStandards = bandsWithStandardsFor(row.subject)
    const rowBand = rowBandOf(row)
    // 성취기준이 있는 학년군만 제시하되, 이미 저장된 학년군은 목록에 남긴다
    // (선택지에서 빼면 select 값이 비어 기존 데이터를 조용히 덮어쓴다).
    const allowedBands = ELEMENTARY_GRADE_BANDS.filter(band =>
      withStandards.some(item => item === band) || band === rowBand)
    const nextBand = isLeader ? nextUnusedGradeBand(rows, row.subject, row.coreIdea, sheetBand, withStandards) : ''
    const canSplit = isLeader && !!row.subject && !!row.coreIdea?.trim() && !!nextBand
    const lackingBands = isLeader && !!row.subject && !!row.coreIdea?.trim()
      ? bandsLackingStandards(standards, row.subject)
        .filter(band => !usedGradeBands(rows, row.subject, row.coreIdea, sheetBand).includes(band))
      : []
    const fill = rowFillState[row.id]
    const noStandards = rowBandHasNoStandards(row)
    // AI 성취기준 제안 — 성취기준이 비어 있는 줄에만 보여 준다(채워진 줄에는 아예 없음).
    const showAiStandard = !!row.subject
      && !!(row.coreIdea ?? '').trim()
      && !(row.standard ?? '').trim()
      && !noStandards
    const noStandardsMessage = noStandards
      ? `${row.subject}는 ${rowBand} 성취기준이 없습니다${withStandards.length > 0 ? ` · ${withStandards.map(band => band.replace('학년군', '')).join('·')}학년군만` : ''}`
      : ''

    return (
      <div className={cn('flex flex-col gap-1', !inBandCell && 'mt-1.5')}>
        {inBandCell && (
          <select
            value={rowBand}
            disabled={allowedBands.length === 1}
            onChange={e => updateRow(row.id, 'gradeBand', e.target.value)}
            onFocus={() => updatePresence(`${row.id}:gradeBand`)}
            title={allowedBands.length === 1 ? '통합교과는 1~2학년군에만 있습니다' : '이 줄의 학년군 — 성취기준·내용 요소 후보가 이 학년군으로 바뀝니다'}
            className="w-full px-1.5 py-1 rounded-lg border border-[#E8EAED] hover:border-[#DADCE0] focus:border-[#1A73E8] focus:outline-none bg-white text-[13px] font-semibold text-[#5F6368] cursor-pointer disabled:cursor-default disabled:bg-[#F8F9FA]"
          >
            {allowedBands.map(band => (
              <option key={band} value={band}>
                {withStandards.some(item => item === band) ? band : `${band} (성취기준 없음)`}
              </option>
            ))}
          </select>
        )}
        {inBandCell && isLeader && (
          <button
            onClick={() => addGradeBandRow(row)}
            disabled={!canSplit}
            title={canSplit
              ? `${nextBand} 줄을 이 핵심아이디어 행에 추가`
              : !row.subject || !row.coreIdea?.trim()
                ? '과목과 핵심아이디어를 먼저 선택하세요'
                : '이 핵심아이디어의 학년군을 모두 사용했습니다'}
            className="w-full px-1.5 py-1 rounded-lg border border-[#C2D7F8] text-[11px] font-bold text-[#1A73E8] hover:bg-[#E8F0FE] disabled:opacity-40 disabled:hover:bg-transparent transition truncate"
          >
            ＋ 학년군 줄
          </button>
        )}
        {inBandCell && lackingBands.map(band => (
          <button
            key={band}
            onClick={() => addBridgeRow(row, band)}
            title={`${row.subject}는 ${band} 성취기준이 없습니다. 다른 교과의 ${band} 성취기준을 이 핵심아이디어에 연결하는 줄을 추가합니다`}
            className="w-full px-1.5 py-1 rounded-lg border border-[#D7C2E8] text-[11px] font-bold text-[#7B1FA2] hover:bg-[#F3E5F5] transition truncate"
          >
            ＋ {band} 연결 줄
          </button>
        ))}
        {inBandCell && !!row.linkedCoreIdea && !!rowBand && (
          <button
            onClick={e => { void openBridgePicker(row, (e.currentTarget as HTMLElement).getBoundingClientRect()) }}
            title={`${row.linkedCoreIdea.subject} 핵심아이디어에 맞는 ${rowBand} 성취기준 후보를 찾습니다`}
            className="w-full px-1.5 py-1 rounded-lg border border-[#D7C2E8] text-[11px] font-bold text-[#7B1FA2] hover:bg-[#F3E5F5] transition truncate"
          >
            유사 성취기준 찾기
          </button>
        )}
        {showAiStandard && (
          <button
            onClick={() => { void handleRowJevFill(row) }}
            disabled={!!fill?.loading}
            title="이 학년군의 성취기준과 비어 있는 내용 요소를 AI 판정(Jev)으로 제안받습니다"
            className="w-full px-1.5 py-1 rounded-lg border border-[#A8DAB5] text-[11px] font-bold text-[#137333] hover:bg-[#E6F4EA] disabled:opacity-40 disabled:hover:bg-transparent transition truncate"
          >
            {fill?.loading ? '판정 중...' : 'AI 성취기준 제안'}
          </button>
        )}
        {fill?.judge && !fill.error && (
          <span
            title={JUDGE_LABEL[fill.judge]}
            className={cn(
              'px-1.5 py-0.5 rounded-md text-[11px] font-bold text-center',
              fill.judge === 'jev' ? 'bg-[#E6F4EA] text-[#137333]' : 'bg-[#F1F3F4] text-[#5F6368]',
            )}
          >
            {fill.judge === 'jev' ? 'Jev' : '임베딩'} {fill.filled ? `${fill.filled}칸` : '추가 없음'}
          </span>
        )}
        {fill?.error && (
          <span title={[fill.error, ...(fill.notes ?? [])].join('\n')} className="px-1.5 py-0.5 rounded-md bg-[#FCE8E6] text-[11px] font-bold text-[#A50E0E] truncate">
            {fill.error}
          </span>
        )}
        {!fill?.error && fill?.notes?.length ? (
          <span title={fill.notes.join('\n')} className="px-1.5 py-0.5 rounded-md bg-[#FEF7E0] text-[11px] font-semibold text-[#8A5A00] leading-snug line-clamp-2">
            {fill.notes[0]}
          </span>
        ) : null}
        {/* 한 학년군 모드에서 통합교과 줄만 1~2학년군으로 동작함을 알린다 */}
        {showGradeBandUI && integratedBandMismatch(row, sheetMode, sheetBand) && (
          <p className="px-1 text-[11px] font-semibold leading-snug text-[#B06000]">이 줄만 1-2학년군</p>
        )}
        {/* 그 학년군에 교과 성취기준이 없음 — 성취기준·내용 요소가 모두 비는 이유 */}
        {showGradeBandUI && noStandards && (
          <p title={noStandardsMessage} className="px-1 text-[11px] font-semibold leading-snug text-[#B06000]">
            {noStandardsMessage}
          </p>
        )}
      </div>
    )
  }
  const hasGraphRows = rows.some(r => r.subject && r.standard)
  const hasCenterGraphRow = rows.some(r => r.isCenter && r.standard)
  // 과목·내용은 채웠지만 성취기준이 비어 지식 그래프에 표시되지 않을 교과들
  const subjectsMissingStandard = [...new Set(
    rows.filter(r => r.subject && !r.standard.trim()).map(r => r.subject),
  )]

  // 래퍼(CurriculumWorkspaceModal)가 portal을 관리. 여기서는 컨테이너를 채우는 div만 반환.
  return (
    <>
    <div className="w-full h-full flex flex-col bg-white rounded-2xl overflow-hidden">

        {/* ── 헤더 ── */}
        <div className="px-6 py-4 border-b border-[#DADCE0] bg-[#FAFAFA] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-[#202124]">교육과정 분석 시트</h2>
            {dirty && <span className="text-sm text-[#F9AB00] font-semibold animate-pulse">자동 저장 중...</span>}
            {!dirty && rows.some(r => r.subject) && <span className="text-sm text-[#137333] font-semibold">저장됨</span>}
          </div>
          <div className="flex items-center gap-3">
            {/* 프레즌스 아바타 */}
            <div className="flex items-center -space-x-1.5">
              {currentUid && (
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white border-2 border-white relative z-10"
                  style={{ backgroundColor: myColor }} title={`${currentUserName} (나)`}>{(currentUserName ?? '?').charAt(0)}</span>
              )}
              {allEditors.filter(p => p.uid !== currentUid).map(p => (
                <span key={p.uid} className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white border-2 border-white"
                  style={{ backgroundColor: p.color }} title={`${p.displayName} 편집 중`}>{p.displayName.charAt(0)}</span>
              ))}
            </div>
            <button onClick={handleManualSave}
              className="px-4 py-2 rounded-xl text-base font-bold bg-[#1A73E8] text-white hover:bg-[#1557B0] transition shadow-sm">저장</button>
            <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-[#F1F3F4] flex items-center justify-center text-[#5F6368] text-xl transition">&times;</button>
          </div>
        </div>

        {/* ── 학년군 모드 ── */}
        {showGradeBandUI && (
          <div className="px-6 py-2.5 border-b border-[#E8EAED] bg-white flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-[#DADCE0] overflow-hidden" role="group" aria-label="학년군 모드">
                {([['single', '한 학년군'], ['multi', '다양한 학년군']] as const).map(([mode, label], modeIdx) => (
                  <button
                    key={mode}
                    onClick={() => { if (sheetMode !== mode) void changeGradeSettings({ gradeMode: mode, ...(sheetBand ? { gradeBand: sheetBand } : {}) }) }}
                    aria-pressed={sheetMode === mode}
                    title={mode === 'single'
                      ? '시트 전체가 학년군 하나를 씁니다 (한 학년 팀)'
                      : '행마다 학년군을 고릅니다 (1·3·5학년처럼 여러 학년이 함께할 때)'}
                    className={cn(
                      'px-3 py-1.5 text-sm font-bold transition',
                      modeIdx > 0 && 'border-l border-[#DADCE0]',
                      sheetMode === mode ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'bg-white text-[#5F6368] hover:bg-[#F1F3F4]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {sheetMode === 'single' && (
                <select
                  value={sheetBand}
                  onChange={e => { void changeGradeSettings({ gradeMode: 'single', gradeBand: e.target.value }) }}
                  title="시트 전체가 사용할 학년군 — 프로젝트 학년군과 달라도 됩니다"
                  className="px-2.5 py-1.5 rounded-xl border border-[#DADCE0] hover:border-[#9AA0A6] focus:border-[#1A73E8] focus:outline-none bg-white text-sm font-bold text-[#202124] cursor-pointer"
                >
                  {ELEMENTARY_GRADE_BANDS.map(band => <option key={band} value={band}>{band}</option>)}
                </select>
              )}
              {sheetMode === 'multi' && (
                <span className="text-[13px] font-semibold text-[#5F6368]">
                  기본 학년군 {sheetBand} · 행마다 변경 가능
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-[#5F6368]">
              한 학년군 팀은 위에서 학년군을 고르면 됩니다. 여러 학년 선생님이 함께라면 &lsquo;다양한 학년군&rsquo;으로 바꾸고, 핵심아이디어 행 안에서 &lsquo;＋ 학년군 줄&rsquo;로 학년군별 줄을 나눠 성취기준을 연결하세요. 성취기준이 비어 있는 줄은 &lsquo;AI 성취기준 제안&rsquo;으로 받을 수도 있습니다.
            </p>
          </div>
        )}

        {/* ── 지식 그래프 안내 ── */}
        {showGraphPrompt && onSwitchToGraph && (
          <div className="px-6 py-3 bg-[#F3E5F5] border-b border-[#CE93D8] flex items-center justify-between gap-4">
            <p className="text-base text-[#4A148C]"><span className="font-bold">저장 완료!</span> 중심 교과를 기준으로 지식 그래프와 수업 예시를 생성할 수 있습니다.</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => { setShowGraphPrompt(false); onSwitchToGraph?.(rows) }}
                className="px-4 py-2 rounded-full text-base font-bold bg-[#7B1FA2] text-white hover:bg-[#6A1B9A] transition shadow-sm">지식 그래프 확인</button>
              <button onClick={() => setShowGraphPrompt(false)}
                className="px-3 py-2 rounded-full text-base font-semibold text-[#7B1FA2] hover:bg-[#E1BEE7] transition">닫기</button>
            </div>
          </div>
        )}

        {/* ── AI 자동 채우기: 핵심아이디어 확인 ── */}
        {(autofillReview || autofillError || autofillNotes.length > 0) && (
          <div className="px-6 py-4 bg-[#F8F9FA] border-b border-[#DADCE0]">
            {autofillError && (
              <div className="mb-3 rounded-xl border border-[#F28B82] bg-[#FCE8E6] px-4 py-3 text-base font-semibold text-[#A50E0E]">
                {autofillError}
              </div>
            )}
            {/* 서버 안내 — 학년군 조정·교과 제외·핵심아이디어 대체 사유 */}
            {autofillNotes.length > 0 && (
              <div className="mb-3 rounded-xl border border-[#FDD663] bg-[#FEF7E0] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <ul className="flex-1 space-y-1">
                    {autofillNotes.map((note, noteIdx) => (
                      <li key={noteIdx} className="text-sm leading-relaxed text-[#8A5A00]">· {note}</li>
                    ))}
                  </ul>
                  <button onClick={() => setAutofillNotes([])} title="안내 닫기"
                    className="w-7 h-7 rounded-full hover:bg-[#FDE9B8] flex items-center justify-center text-[#B06000] flex-shrink-0">&times;</button>
                </div>
              </div>
            )}
            {autofillReview && (
              <div className="rounded-2xl border border-[#DADCE0] bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-[#F1F3F4] flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-[#202124]">핵심아이디어 확인</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#5F6368]">
                      DB에서 찾은 핵심아이디어 후보입니다. 교과별 핵심 방향을 확인하면 같은 영역·학년군의 성취기준과 지식·이해/과정·기능을 자동으로 채웁니다.
                    </p>
                  </div>
                  <button onClick={() => setAutofillReview(null)}
                    className="w-10 h-10 rounded-full hover:bg-[#F1F3F4] flex items-center justify-center text-[#9AA0A6] hover:text-[#5F6368] text-lg flex-shrink-0">&times;</button>
                </div>
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
                  {autofillReview.proposals.map(proposal => {
                    const selected = coreIdeaSelections[proposal.subject] ?? proposal.selectedCoreIdea
                    const selectedOption = proposal.options.find(option => option.idea === selected) ?? proposal.options[0]
                    return (
                      <div key={proposal.subject} className="rounded-xl border border-[#E8EAED] p-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-[#202124]">{proposal.subject}</span>
                            {proposal.isCenter && <span className="px-2 py-0.5 rounded-full bg-[#FEF7E0] text-[#E65100] text-[12px] font-bold">중심</span>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {proposal.judge === 'jev' && proposal.mode && (
                              <span
                                title={`Jev confidence ${(proposal.confidence ?? 0).toFixed(2)} — 제시: 그대로 진행해도 됨 · 확인: 후보 비교 권장 · 명료화: 주제·맥락을 더 적어 주세요`}
                                className={`px-2 py-0.5 rounded-full text-[12px] font-bold ${proposal.mode === '제시' ? 'bg-[#E6F4EA] text-[#137333]' : proposal.mode === '확인' ? 'bg-[#FEF7E0] text-[#B06000]' : 'bg-[#F1F3F4] text-[#5F6368]'}`}
                              >
                                {proposal.mode} {(proposal.confidence ?? 0).toFixed(2)}
                              </span>
                            )}
                            <span className="text-[13px] font-semibold text-[#7B1FA2]">{selectedOption?.area ?? '영역'}</span>
                            <button
                              onClick={() => removeAutofillProposal(proposal.subject)}
                              title={`${proposal.subject} 제외`}
                              className="w-6 h-6 rounded-full hover:bg-[#FCE8E6] flex items-center justify-center text-[#9AA0A6] hover:text-[#C5221F] text-base leading-none transition"
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                        {proposal.focus && <p className="mb-2 text-sm text-[#5F6368]">{proposal.focus}</p>}
                        <select
                          value={selected}
                          onChange={e => setCoreIdeaSelections(prev => ({ ...prev, [proposal.subject]: e.target.value }))}
                          className="w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2 text-sm leading-relaxed text-[#202124] focus:outline-none focus:border-[#7B1FA2]"
                        >
                          {proposal.options.map(option => (
                            <option key={`${option.coreIdeaId}:${option.idea}`} value={option.idea}>
                              [{option.area}] {option.idea}
                            </option>
                          ))}
                        </select>
                        {showGradeBandUI && sheetMode === 'single' && (
                          <p className="mt-2 text-[12px] font-bold text-[#5F6368]">
                            학년군 {allowedGradeBandsForSubject(proposal.subject).length === 1 ? '1-2학년군 (통합교과)' : sheetBand}
                          </p>
                        )}
                        {showGradeBandUI && sheetMode === 'multi' && (() => {
                          const allowedBands = availableGradeBandsForProposal(proposal.subject, selectedOption)
                          const selectedBands = proposalGradeBands(proposal.subject)
                          return (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="text-[12px] font-bold text-[#5F6368]">학년군</span>
                              {ELEMENTARY_GRADE_BANDS.map(band => {
                                const disabled = !allowedBands.some(allowed => allowed === band)
                                const active = !disabled && selectedBands.includes(band)
                                return (
                                  <button
                                    key={band}
                                    disabled={disabled}
                                    onClick={() => toggleProposalGradeBand(proposal.subject, band)}
                                    title={disabled
                                      ? (allowedGradeBandsForSubject(proposal.subject).length === 1
                                        ? '통합교과는 1~2학년군에만 있습니다'
                                        : '선택한 핵심아이디어에는 이 학년군 성취기준이 없습니다')
                                      : `${band} 행 생성`}
                                    className={cn(
                                      'px-2 py-0.5 rounded-full text-[12px] font-bold border transition',
                                      active
                                        ? 'bg-[#E8F0FE] border-[#C2D7F8] text-[#1A73E8]'
                                        : 'bg-white border-[#E8EAED] text-[#9AA0A6] hover:border-[#DADCE0]',
                                      disabled && 'opacity-40 cursor-default hover:border-[#E8EAED]',
                                    )}
                                  >
                                    {band}
                                  </button>
                                )
                              })}
                            </div>
                          )
                        })()}
                        {selectedOption && (
                          <div className="mt-3 rounded-lg bg-[#F8F9FA] px-3 py-2">
                            <p className="text-[13px] font-bold text-[#5F6368] mb-1">
                              연결 성취기준 후보 {selectedOption.standardsCount}개
                            </p>
                            <div className="space-y-1">
                              {selectedOption.sampleStandards.slice(0, 2).map(standard => (
                                <p key={standard} className="text-[13px] leading-relaxed text-[#1A73E8]">{standard}</p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="px-5 py-4 border-t border-[#F1F3F4] flex items-center justify-end gap-2">
                  <button onClick={() => setAutofillReview(null)}
                    className="px-4 py-2 rounded-xl text-base font-bold text-[#5F6368] hover:bg-[#F1F3F4] transition">취소</button>
                  <button onClick={applyAutofillReview} disabled={autofillLoading}
                    className="px-4 py-2 rounded-xl text-base font-bold text-white bg-[#137333] hover:bg-[#0D5C27] disabled:opacity-40 transition shadow-sm">
                    {autofillLoading ? '분석표 생성 중...' : '성취기준 추천 및 분석표 생성'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 테이블 ── */}
        <div className="flex-1 min-h-0 overflow-hidden bg-white">
          {loading ? (
            <div className="py-20 text-center text-base text-[#9AA0A6]">교육과정 데이터 로딩 중...</div>
          ) : (
            <div className="h-full overflow-auto" style={{ scrollbarGutter: 'stable both-edges' }}>
              <table className="table-fixed border-collapse" style={{ width: tableWidth, minWidth: tableWidth }}>
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 125 }} />
                  <col style={{ width: 360 }} />
                  {groupingEnabled && <col style={{ width: 150 }} />}
                  <col style={{ width: 420 }} />
                  <col style={{ width: 285 }} />
                  <col style={{ width: 285 }} />
                  <col style={{ width: 285 }} />
                  <col style={{ width: 360 }} />
                  <col style={{ width: 390 }} />
                  <col style={{ width: 59 }} />
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F8F9FA] border-b-2 border-[#DADCE0]">
                    <th className="px-1 py-3 sticky left-0 z-20 bg-[#F8F9FA]" />
                    <th className="px-3 py-3 text-left text-base font-bold text-[#5F6368] whitespace-nowrap sticky left-[36px] z-20 bg-[#F8F9FA] border-r border-[#DADCE0]">과목</th>
                    <th className="px-3 py-3 text-left text-base font-bold text-[#7B1FA2] whitespace-nowrap">핵심아이디어</th>
                    {groupingEnabled && <th className="px-2 py-3 text-left text-base font-bold text-[#5F6368] whitespace-nowrap">학년군</th>}
                    <th className="px-3 py-3 text-left text-base font-bold text-[#1A73E8] whitespace-nowrap">성취기준</th>
                    <th className="px-3 py-3 text-left text-base font-bold text-[#0D47A1] whitespace-nowrap">지식·이해</th>
                    <th className="px-3 py-3 text-left text-base font-bold text-[#137333] whitespace-nowrap">과정·기능</th>
                    <th className="px-3 py-3 text-left text-base font-bold text-[#8A5A00] whitespace-nowrap">가치·태도</th>
                    <th className="px-3 py-3 text-left text-base font-bold text-[#7B1FA2] whitespace-nowrap">Agent 추천 수업 예시</th>
                    <th className="px-3 py-3 text-left text-base font-bold text-[#5F6368] whitespace-nowrap">수업내용 설명</th>
                    <th className="px-2 py-3 sticky right-0 z-20 bg-[#F8F9FA] border-l border-[#DADCE0]" />
                  </tr>
                </thead>
                <tbody>
                {rowGroups.map(group => {
                  // 묶음의 첫 줄(leader)이 과목·핵심아이디어 칸을 rowSpan으로 들고,
                  // 나머지 줄은 학년군별 칸만 렌더링해 "한 행 안의 학년군 줄"로 보이게 한다.
                  const leader = group[0]
                  const members = group.slice(1)
                  const memberSubjectChips = members
                    .filter(member => member.subject && member.subject !== leader.subject)
                    .map(member => ({ id: member.id, label: `＋ ${member.subject} ${rowBandOf(member).replace('학년군', '')}` }))
                  // 연결 줄은 자기 학년군의 실제 핵심아이디어로 성취기준·내용 요소를 찾으므로
                  // 핵심아이디어 칸에 그 줄의 핵심아이디어를 따로 보여 준다.
                  const bridgeMembers = members.filter(member => member.linkedCoreIdea && (member.coreIdea ?? '').trim())
                  const leaderSpanBorder = groupingEnabled ? 'border-b-2 border-b-[#DADCE0]' : ''
                  return group.map((row, lineIdx) => {
                    const isLeader = lineIdx === 0
                    const isLastLine = lineIdx === group.length - 1
                    return (
                  <tr
                    key={row.id}
                    draggable={isLeader}
                    onDragStart={isLeader ? () => setDragRowId(leader.id) : undefined}
                    onDragOver={isLeader ? (e => { e.preventDefault(); setDragOverRowId(leader.id) }) : undefined}
                    onDragEnd={isLeader ? (() => { setDragRowId(null); setDragOverRowId(null) }) : undefined}
                    onDrop={isLeader ? (() => handleDrop(leader.id)) : undefined}
                    className={cn(
                      'hover:bg-[#F8F9FA] group transition-colors',
                      !groupingEnabled && 'border-b border-[#E8EAED]',
                      groupingEnabled && isLastLine && 'border-b-2 border-b-[#DADCE0]',
                      groupingEnabled && !isLeader && 'border-t border-dashed border-t-[#E8EAED]',
                      isLeader && dragOverRowId === leader.id && dragRowId !== leader.id && 'border-t-2 border-t-[#1A73E8] bg-[#E8F0FE]',
                    )}
                  >
                    {/* 드래그 핸들 — 좌측 고정 (묶음 전체를 옮긴다) */}
                    {isLeader && (
                    <td rowSpan={group.length} className={cn('px-1 py-2 align-top text-center cursor-grab active:cursor-grabbing sticky left-0 z-[5] bg-white group-hover:bg-[#F8F9FA]', leaderSpanBorder)}>
                      <span className="text-[#DADCE0] hover:text-[#9AA0A6] text-base select-none">⠿</span>
                    </td>
                    )}

                    {/* 과목 + 중심교과 — 좌측 고정 (묶음 대표) */}
                    {isLeader && (
                    <td rowSpan={group.length} className={cn('px-2 py-2 align-top sticky left-[36px] z-[5] bg-white group-hover:bg-[#F8F9FA] border-r border-[#E8EAED]', leaderSpanBorder)}>
                      <select value={row.subject} onChange={e => updateRowSubject(row, e.target.value)}
                        className="w-full px-1.5 py-2 rounded-xl border border-[#E8EAED] hover:border-[#DADCE0] focus:border-[#1A73E8] focus:outline-none bg-white text-base font-semibold text-[#202124] cursor-pointer">
                        <option value="">선택</option>
                        {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {/* 묶음 안에 다른 교과 줄(연결 줄)이 있으면 읽기 전용 칩으로 알린다 */}
                      {memberSubjectChips.map(chip => (
                        <span key={chip.id} className="mt-1.5 inline-flex items-center rounded-md bg-[#F3E5F5] px-1.5 py-0.5 text-[12px] font-bold text-[#7B1FA2]">
                          {chip.label}
                        </span>
                      ))}
                      {/* 한 학년군 모드에서는 학년군 칸이 없으므로 안내·AI 제안을 과목 칸에 둔다 */}
                      {!groupingEnabled && renderLineControls(row, { isLeader: true, inBandCell: false })}
                      {row.subject && (
                        <label className="flex items-center gap-1 mt-1.5 px-1 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!row.isCenter}
                            onChange={() => {
                              // 중심 교과는 하나만 — 다른 행의 isCenter를 해제
                              setRows(prev => {
                                const nextCenterId = row.isCenter ? null : row.id
                                const next = prev.map(r => ({
                                  ...r,
                                  isCenter: nextCenterId ? r.id === nextCenterId : false,
                                  updatedBy: r.id === row.id ? currentUserName : r.updatedBy,
                                  updatedAt: r.id === row.id ? Date.now() : r.updatedAt,
                                }))
                                rowsRef.current = next
                                setDirty(true)
                                if (!onPatchSave) triggerSave(next)
                                else {
                                  void saveStructuralPatch({ type: 'set-center', rowId: nextCenterId, updatedBy: currentUserName })
                                  // set-center는 서버에 존재하는 행만 갱신하므로, 아직 저장 안 된 중심 행은 전체 행 upsert로 보장한다.
                                  if (nextCenterId && !serverRowIdsRef.current.has(nextCenterId)) scheduleRowUpsert(nextCenterId)
                                }
                                return next
                              })
                            }}
                            className="w-3.5 h-3.5 rounded accent-[#F9AB00] cursor-pointer"
                          />
                          <span className={cn('text-[12px] font-bold', row.isCenter ? 'text-[#E65100]' : 'text-[#9AA0A6]')}>
                            {row.isCenter ? '★ 중심 교과' : '중심 교과'}
                          </span>
                        </label>
                      )}
                    </td>
                    )}

                    {/* 핵심아이디어 — 묶음 대표 (연결 줄은 자기 핵심아이디어를 아래에 덧붙인다) */}
                    {isLeader && (
                    <td rowSpan={group.length} className={cn('px-3 py-2 align-top relative', leaderSpanBorder)}>
                      {(() => {
                        const oe = getPresenceForCell(row.id, 'coreIdea')
                        const isMy = getMyPresenceForCell(row.id, 'coreIdea')
                        const bdr = oe ? `2px solid ${oe.color}` : isMy ? `2px dashed ${myColor}` : '1px solid #E8EAED'
                        const coreIdeaArea = getCoreIdeaArea(row)
                        return (<>
                          <button onClick={e => handleCellClick(row.id, 'coreIdea', e)}
                            className="w-full text-left px-3 py-2 rounded-xl transition min-h-[44px] text-base leading-relaxed"
                            style={{ color: row.coreIdea ? '#202124' : '#9AA0A6', border: bdr }}>
                            <span className="mb-1 flex flex-wrap items-center gap-1">
                              {coreIdeaArea && (
                                <span className="inline-flex items-center rounded-md bg-[#F3E5F5] px-1.5 py-0.5 text-[12px] font-bold text-[#7B1FA2]">
                                  {coreIdeaArea}
                                </span>
                              )}
                              {row.linkedCoreIdea && (
                                <span
                                  title={`${row.linkedCoreIdea.subject} 핵심아이디어: ${row.linkedCoreIdea.coreIdea}`}
                                  className="inline-flex items-center rounded-md bg-[#F3E5F5] px-1.5 py-0.5 text-[12px] font-bold text-[#7B1FA2]"
                                >
                                  ↔ {row.linkedCoreIdea.subject} 핵심아이디어 연결
                                </span>
                              )}
                            </span>
                            <span className="block">{row.coreIdea || '핵심아이디어 선택...'}</span>
                          </button>
                          {bridgeMembers.map(member => (
                            <button
                              key={member.id}
                              onClick={e => handleCellClick(member.id, 'coreIdea', e)}
                              title={`${rowBandOf(member)} ${member.subject} 줄의 핵심아이디어 — 클릭하면 다시 고를 수 있습니다`}
                              className="mt-1.5 w-full text-left px-2 py-1.5 rounded-lg bg-[#FAF5FD] border border-[#EADDF3] hover:border-[#D7C2E8] transition"
                            >
                              <span className="text-[12px] font-bold text-[#7B1FA2]">↔ {rowBandOf(member)} · {member.subject}</span>
                              <span className="block text-[13px] leading-relaxed text-[#5F6368]">{member.coreIdea}</span>
                            </button>
                          ))}
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
                        </>)
                      })()}
                    </td>
                    )}

                    {/* 학년군 — 줄마다 (다양한 학년군 모드 전용) */}
                    {groupingEnabled && (
                      <td className="px-2 py-2 align-top">
                        {!isLeader && row.subject && row.subject !== leader.subject && (
                          <span className="mb-1 inline-flex items-center rounded-md bg-[#F3E5F5] px-1.5 py-0.5 text-[12px] font-bold text-[#7B1FA2]">
                            {row.subject}
                          </span>
                        )}
                        {renderLineControls(row, { isLeader, inBandCell: true })}
                      </td>
                    )}

                    {/* 성취기준 / 지식·이해 / 과정·기능 / 가치·태도 (다중 태그) */}
                    {(['standard', 'knowledge', 'processFunction', 'valueAttitude'] as const).map(field => {
                      const oe = getPresenceForCell(row.id, field)
                      const isMy = getMyPresenceForCell(row.id, field)
                      return (
                        <td key={field} className="px-3 py-2 align-top relative">
                          <TagCell value={row[field] ?? ''} placeholder={FL[field]} color={FC[field]}
                            onClickAdd={e => handleCellClick(row.id, field, e)} onRemove={tag => removeTag(row.id, field, tag)}
                            otherEditor={oe} myEditing={isMy} myColor={myColor} />
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
                        </td>
                      )
                    })}

                    {/* Agent 추천 수업 예시 */}
                    <td className="px-3 py-2 align-top relative">
                      {(() => {
                        const oe = getPresenceForCell(row.id, 'agentLessonExample')
                        const isMy = getMyPresenceForCell(row.id, 'agentLessonExample')
                        const bdr = oe ? `2px solid ${oe.color}` : isMy ? `2px dashed ${myColor}` : '1px solid #E8EAED'
                        return (<>
                          <textarea value={row.agentLessonExample ?? ''} onChange={e => updateRow(row.id, 'agentLessonExample', e.target.value)}
                            onFocus={() => updatePresence(`${row.id}:agentLessonExample`)} placeholder="그래프 저장 후 자동 입력" rows={2}
                            className="w-full px-3 py-2 rounded-xl focus:outline-none text-base leading-relaxed resize-none focus:border-[#7B1FA2] bg-[#FCF8FF]"
                            style={{ minHeight: 60, border: bdr }}
                            ref={el => { if (el && row.agentLessonExample) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                            onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }} />
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
                        </>)
                      })()}
                    </td>

                    {/* 수업내용 설명 */}
                    <td className="px-3 py-2 align-top relative">
                      {(() => {
                        const oe = getPresenceForCell(row.id, 'description')
                        const isMy = getMyPresenceForCell(row.id, 'description')
                        const bdr = oe ? `2px solid ${oe.color}` : isMy ? `2px dashed ${myColor}` : '1px solid #E8EAED'
                        return (<>
                          <textarea value={row.description} onChange={e => updateRow(row.id, 'description', e.target.value)}
                            onFocus={() => updatePresence(`${row.id}:description`)} placeholder="수업 내용 입력..." rows={2}
                            className="w-full px-3 py-2 rounded-xl focus:outline-none text-base leading-relaxed resize-none focus:border-[#1A73E8]"
                            style={{ minHeight: 60, border: bdr }}
                            ref={el => { if (el && row.description) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                            onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }} />
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
                        </>)
                      })()}
                    </td>

                    {/* 줄 삭제 — 우측 고정 (가로 스크롤 없이 항상 보임) */}
                    <td className="px-2 py-2 align-top text-center sticky right-0 z-[5] bg-white group-hover:bg-[#F8F9FA] border-l border-[#E8EAED]">
                      <button onClick={() => removeRow(row.id)} title={groupingEnabled ? '이 학년군 줄 삭제' : `${rows.indexOf(row) + 1}행 삭제`}
                        className="w-10 h-10 rounded-full border border-[#F1F3F4] hover:bg-[#FCE8E6] hover:border-[#F28B82] text-[#C5221F] flex items-center justify-center transition text-base">
                        &times;
                      </button>
                    </td>
                  </tr>
                    )
                  })
                })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 자동 채우기 진행 단계 ── */}
        {autofillProgress.length > 0 && (
          <div className="px-6 py-2 border-t border-[#DADCE0] bg-white flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
            <span className="font-bold text-[#5F6368]">AI 자동 채우기 진행</span>
            {autofillProgress.map(step => (
              <span key={step.id} className={`flex items-center gap-1.5 ${step.status === 'pending' ? 'text-[#9AA0A6]' : step.status === 'running' ? 'font-bold text-[#1A73E8]' : step.status === 'error' ? 'text-[#C5221F]' : 'text-[#202124]'}`}>
                {step.status === 'running'
                  ? <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  : step.status === 'done' ? <span className="text-[#137333]">✓</span>
                  : step.status === 'error' ? <span>✕</span>
                  : <span>○</span>}
                <span>{step.label}</span>
                {step.ms != null && <span className="text-[#9AA0A6]">{(step.ms / 1000).toFixed(1)}s</span>}
                {step.note && <span className="text-[#9AA0A6]">· {step.note}</span>}
              </span>
            ))}
            {!autofillLoading && (
              <button onClick={() => setAutofillProgress([])} className="ml-auto text-[#9AA0A6] hover:text-[#5F6368]" title="진행 표시 닫기">&times;</button>
            )}
          </div>
        )}

        {/* ── 하단 ── */}
        <div className="px-6 py-3 border-t border-[#DADCE0] bg-[#FAFAFA] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-base font-bold text-[#1A73E8] hover:bg-[#E8F0FE] border border-[#C2D7F8] transition">
              + 행 추가
            </button>
            <button onClick={handleAutofill} disabled={autofillLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-base font-bold text-white bg-[#137333] hover:bg-[#0D5C27] disabled:opacity-40 transition shadow-sm"
              title={!a12Artifact?.selectedTopic && !graphSavedData ? 'A-1-2 주제 선정 또는 지식 그래프 데이터 필요' : '핵심아이디어 후보를 먼저 확인하고 DB 기반으로 자동 채우기'}>
              {autofillLoading ? (
                <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> {({ coreIdeas: '핵심아이디어 판정 중...', rows: '성취기준·내용 요소 판정 중...', describe: '설명 작성·검증 중...' } as Record<string, string>)[autofillProgress.find(step => step.status === 'running')?.id ?? ''] ?? '진행 중...'}</>
              ) : 'AI 자동 채우기'}
            </button>
            {onSwitchToGraph && hasGraphRows && (
              <button onClick={() => onSwitchToGraph(rows)} disabled={!hasCenterGraphRow}
                title={hasCenterGraphRow ? '중심 교과를 중심 노드로 지식 그래프와 수업 예시를 생성합니다' : '먼저 중심 교과를 체크하고 성취기준을 선택하세요'}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-base font-bold text-white bg-[#7B1FA2] hover:bg-[#6A1B9A] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#7B1FA2] transition shadow-sm">
                지식 그래프·수업 예시 생성 →
              </button>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-[#9AA0A6]">
            {subjectsMissingStandard.length > 0 && (
              <span className="font-semibold text-[#C5221F]" title="지식 그래프 노드는 성취기준 기준으로 만들어집니다. 성취기준이 없는 교과는 그래프에 나타나지 않습니다.">
                ⚠ {subjectsMissingStandard.join('·')} — 성취기준을 선택해야 지식 그래프에 표시됩니다
              </span>
            )}
            {hasGraphRows && !hasCenterGraphRow && (
              <span className="font-semibold text-[#E65100]">중심 교과 체크 후 그래프를 생성할 수 있습니다.</span>
            )}
            <span className="font-semibold text-[#5F6368]">{rows.length}행</span>
          </div>
        </div>
      </div>

      {/* 팝오버 — createPortal 유지 (모달 위에서 독립 동작) */}
      {pickerTarget && (
        <CellPicker options={getPickerOptions(pickerTarget.rowId, pickerTarget.field)}
          value={rows.find(r => r.id === pickerTarget.rowId)?.[pickerTarget.field] ?? ''}
          onSelect={v => updateRow(pickerTarget.rowId, pickerTarget.field, v)} onClose={() => setPickerTarget(null)}
          anchorRect={pickerTarget.rect} placeholder={`${FL[pickerTarget.field]} 검색...`}
          color={FC[pickerTarget.field]} multi={MULTI_FIELDS.includes(pickerTarget.field)}
          optionGroups={pickerTarget.field === 'coreIdea' ? getCoreIdeaGroups(pickerTarget.rowId) : undefined} />
      )}

      {/* 연결 줄 — 유사 성취기준 후보 팝오버 */}
      {bridgeTarget && (() => {
        const row = rows.find(r => r.id === bridgeTarget.rowId)
        if (!row?.linkedCoreIdea) return null
        return (
          <BridgePicker
            anchorRect={bridgeTarget.rect}
            sourceSubject={row.linkedCoreIdea.subject}
            sourceCoreIdea={row.linkedCoreIdea.coreIdea}
            targetBand={rowBandOf(row)}
            loading={bridgeQuery.loading}
            error={bridgeQuery.error}
            notes={bridgeQuery.notes}
            judge={bridgeQuery.judge}
            candidates={bridgeQuery.candidates}
            subjectsSearched={bridgeQuery.subjectsSearched}
            subjectFilter={bridgeSubjectFilter}
            onSubjectFilterChange={setBridgeSubjectFilter}
            onSelect={candidate => applyBridgeCandidate(row.id, candidate)}
            onClose={() => setBridgeTarget(null)}
          />
        )
      })()}
    </>
  )
}
