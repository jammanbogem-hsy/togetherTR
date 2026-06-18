'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { CurriculumSheetRow } from '@/types'
import type { CurriculumSheetEditableField, CurriculumSheetPatch } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'

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

const SUBJECTS = ['국어', '수학', '과학', '사회', '도덕', '미술', '음악', '체육', '영어', '실과'] as const
const SEP = ' | '
const SUBJECT_FILE: Record<string, string> = {
  '국어': '국어교육과정.json', '도덕': '도덕교육과정.json', '사회': '사회교육과정.json',
  '수학': '수학교육과정.json', '과학': '과학교육과정.json', '실과': '실과교육과정.json',
  '체육': '체육교육과정.json', '음악': '음악교육과정.json', '미술': '미술교육과정.json',
  '영어': '영어 교육과정.json',
}
const PRESENCE_COLORS = ['#EA4335', '#4285F4', '#34A853', '#FBBC04', '#FF6D01', '#46BDC6', '#E040FB', '#00BCD4']
const ELEMENTARY_LEVELS = ['초등학교', '초']
const STANDARD_CODE_RE = /\[?(\d[가-힣]{1,3}[\d가-힣]*\d{2}-\d{2})\]?/g
const SHEET_EDITABLE_FIELDS: CurriculumSheetEditableField[] = [
  'session',
  'subject',
  'isCenter',
  'coreIdea',
  'standard',
  'knowledge',
  'processFunction',
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
}
interface CoreIdeaProposal {
  subject: string
  focus: string
  isCenter: boolean
  selectedCoreIdea: string
  options: CoreIdeaOption[]
}
interface AutofillReview {
  proposals: CoreIdeaProposal[]
  message?: string
}

let nanoidCounter = 0
function makeId() { return `cs_${Date.now()}_${++nanoidCounter}` }
function emptyRow(): CurriculumSheetRow {
  return { id: makeId(), session: '', subject: '', coreIdea: '', standard: '', knowledge: '', processFunction: '', agentLessonExample: '', description: '' }
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
function filterByTargetGrade(items: string[], gradeGroup?: string): string[] {
  if (!gradeGroup) return items
  const needle = gradeGroup.replace(/^초/, '').replace(/~/g, '-').trim()
  if (!needle) return items
  const gradePrefixed = items.filter(item => /^\d+-\d+학년군:/.test(item))
  if (gradePrefixed.length === 0) {
    const gradeLabel = formatGradeGroupLabel(gradeGroup)
    return gradeLabel ? items.map(item => withGradePrefix(item, gradeLabel)) : items
  }
  return gradePrefixed.filter(item => item.includes(needle))
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
function inferGradeLabelFromStandard(standard?: string, fallbackGradeGroup?: string): string {
  const codeGrade = normalizeStandardCode(standard ?? '').match(/^(\d)/)?.[1]
  if (codeGrade === '1' || codeGrade === '2') return '1-2학년군'
  if (codeGrade === '3' || codeGrade === '4') return '3-4학년군'
  if (codeGrade === '5' || codeGrade === '6') return '5-6학년군'
  return formatGradeGroupLabel(fallbackGradeGroup)
}
function ensureGradePrefixesForValue(value: string, standard?: string, fallbackGradeGroup?: string): string {
  const gradeLabel = inferGradeLabelFromStandard(standard, fallbackGradeGroup)
  if (!gradeLabel || !value.trim()) return value
  return splitValues(value)
    .map(item => withGradePrefix(item, gradeLabel))
    .join(SEP)
}
function normalizeRowGradePrefixes(row: CurriculumSheetRow, fallbackGradeGroup?: string): CurriculumSheetRow {
  return {
    ...row,
    knowledge: ensureGradePrefixesForValue(row.knowledge, row.standard, fallbackGradeGroup),
    processFunction: ensureGradePrefixesForValue(row.processFunction, row.standard, fallbackGradeGroup),
  }
}
function samePickerOption(a: string, b: string): boolean {
  const ac = normalizeStandardCode(a)
  const bc = normalizeStandardCode(b)
  if (ac && bc) return ac === bc
  return normalizeCurriculumText(stripGradePrefix(a)) === normalizeCurriculumText(stripGradePrefix(b))
}
function standardMatchesTargetGrade(standard: FlatStandard, gradeGroup?: string): boolean {
  if (!gradeGroup) return true
  const gradeDigits = [...gradeGroup.matchAll(/\d/g)].map(match => match[0])
  if (gradeDigits.length === 0) return true
  const codeGrade = standard.code.match(/^(\d)/)?.[1]
  if (codeGrade && gradeDigits.includes(codeGrade)) return true
  return gradeDigits.some(grade => standard.gradeBand.includes(grade))
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
            placeholder={placeholder ?? '검색...'} className="flex-1 px-3 py-2 text-sm rounded-xl border border-[#DADCE0] focus:outline-none focus:border-[#1A73E8]" />
          {multi && selected.size > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0" style={{ color, backgroundColor: `${color}18` }}>{selected.size}개 선택</span>
          )}
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#F1F3F4] flex items-center justify-center text-[#9AA0A6] hover:text-[#5F6368] text-lg flex-shrink-0 transition">&times;</button>
        </div>
      </div>
      {/* 선택된 항목 미리보기 */}
      {multi && selected.size > 0 && (
        <div className="shrink-0 px-3 py-3 border-b border-[#D8E7FF] flex flex-col gap-2 max-h-[230px] overflow-y-auto bg-[#F5FAFF]">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-extrabold" style={{ color }}>현재 선택된 항목</div>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color, backgroundColor: `${color}18` }}>{selected.size}개</span>
          </div>
          {selectedDisplayValues.map(v => (
            <div key={v} className="flex items-start gap-2 rounded-xl border-2 bg-white px-3 py-2 shadow-sm" style={{ borderColor: `${color}35` }}>
              <span className="mt-0.5 w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center border-2 text-sm font-bold"
                style={{ borderColor: color, backgroundColor: color, color: '#fff' }}>✓</span>
              <span className="flex-1 text-sm leading-relaxed font-bold" style={{ color }}>{v}</span>
              <button onClick={() => toggle(v)} className="w-6 h-6 rounded-full hover:bg-black/10 flex items-center justify-center text-lg flex-shrink-0 text-[#9AA0A6]">&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {flatFiltered.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#9AA0A6]">결과 없음</div>
        ) : optionGroups ? (
          // 그룹별 표시 (영역 라벨 포함)
          (filtered as OptionGroup[]).map(group => (
              <div key={group.label}>
              <div className="sticky top-0 z-[1] px-4 py-2 bg-[#F8F9FA] border-b border-[#F1F3F4]">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide" style={{ color }}>
                  <span className="px-1.5 py-0.5 rounded-md bg-white border border-current/20">영역</span>
                  {group.label}
                </span>
              </div>
              {group.options.map((opt, j) => {
                const isSel = isSelectedOption(opt)
                return (
                  <button key={j} onClick={() => toggle(opt)}
                    className={`w-full text-left px-4 py-3 text-sm transition flex items-start gap-3 ${isSel ? 'bg-[#F3E5F5]' : 'hover:bg-[#F8F9FA]'}`}>
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
              className={`w-full text-left px-4 py-3 text-sm transition flex items-start gap-3 ${isSel ? 'bg-[#F8F9FA]' : 'hover:bg-[#F8F9FA]'}`}>
              {multi ? (
                <span className="mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 text-xs font-bold"
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
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-white transition" style={{ backgroundColor: color }}>
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
          <span className="flex-1 text-xs leading-relaxed break-words" style={{ color }}>{tag}</span>
          <button onClick={e => { e.stopPropagation(); onRemove(tag) }}
            className="w-5 h-5 rounded-full hover:bg-black/10 flex items-center justify-center text-sm flex-shrink-0 text-[#9AA0A6] hover:text-[#C5221F]">&times;</button>
        </div>
      ))}
      <button onClick={onClickAdd}
        className="inline-flex items-center gap-1 px-1 py-1 rounded-lg text-xs font-semibold hover:bg-[#F1F3F4] transition self-start"
        style={{ color: tags.length ? '#9AA0A6' : color }}>
        + {tags.length ? '추가' : placeholder}
      </button>
    </div>
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
}

type PickerField = 'coreIdea' | 'standard' | 'knowledge' | 'processFunction'
type PickerTarget = { rowId: string; field: PickerField; rect: DOMRect } | null
const MULTI_FIELDS: PickerField[] = ['standard', 'knowledge', 'processFunction']

export function CurriculumSheetModal({ open, onClose, rows: savedRows, onSave, onPatchSave, onRequestArtifactSave, onPresenceUpdate, onSwitchToGraph, presence, currentUserName, currentUid, currentUserColor, a12Artifact, graphSavedData, targetGradeGroup, chatContext }: Props) {
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
  const [autofillError, setAutofillError] = useState('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const patchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const dirtyCellVersionsRef = useRef<Record<string, number>>({})
  const pendingRowIdsRef = useRef<Set<string>>(new Set())
  const pendingStructuralCountRef = useRef(0)
  const rowsRef = useRef<CurriculumSheetRow[]>([])
  const serverRowIdsRef = useRef<Set<string>>(new Set())

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
    const incoming = (incomingRows.length > 0 ? incomingRows : [])
      .map(row => normalizeRowGradePrefixes(row, targetGradeGroup))
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
  }, [targetGradeGroup])

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
    setRows((savedRows.length > 0 ? savedRows : [emptyRow()]).map(row => normalizeRowGradePrefixes(row, targetGradeGroup)))
    setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, savedRowsJson, dirty, hasPendingLocalChanges, mergeIncomingRows, syncDirtyFromPending])

  // 모달 열릴 때 초기 로드
  useEffect(() => {
    if (!open) return
    setRows((savedRows.length > 0 ? savedRows : [emptyRow()]).map(row => normalizeRowGradePrefixes(row, targetGradeGroup)))
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
    const params = new URLSearchParams()
    if (targetGradeGroup) params.set('gradeGroup', targetGradeGroup)
    params.set('_ts', String(Date.now()))
    const p1 = fetch(`/api/core-ideas?${params.toString()}`, { cache: 'no-store' }).then(r => r.json()).then(d => {
      setContentItems(sanitizeContentItems(d.items ?? []))
    }).catch(() => {})
    const p2 = Promise.all(
      Object.entries(SUBJECT_FILE).map(async ([subj, file]) => {
        try {
          const data: CurriculumFile = await (await fetch(`/curriculum_json/${file}`)).json()
          const flat: FlatStandard[] = []
          for (const g of data.core_idea_groups) for (const s of g.standard_sets) {
            if (!ELEMENTARY_LEVELS.some(lv => s.school_level.includes(lv))) continue
            for (const st of s.standards) flat.push({ code: st.code, text: st.text, subject: subj, area: g.area, gradeBand: s.grade_band, label: `${st.code} ${st.text}` })
          }
          return flat
        } catch { return [] }
      }),
    ).then(a => setStandards(a.flat()))
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

  function updateRow(id: string, field: CurriculumSheetEditableField, value: string) {
    setRows(prev => {
      const n = prev.map(r => r.id === id ? { ...r, [field]: value, updatedBy: currentUserName, updatedAt: Date.now() } : r)
      rowsRef.current = n
      setDirty(true)
      if (!onPatchSave) triggerSave(n)
      return n
    })
    if (onPatchSave) {
      // 서버에 저장된 행은 셀 단위로, 아직 저장 안 된 행은 전체 행 upsert로 보낸다.
      if (serverRowIdsRef.current.has(id)) scheduleCellPatch(id, field, value)
      else scheduleRowUpsert(id)
    }
    updatePresence(`${id}:${field}`)
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
  function handleDrop(targetId: string) {
    if (!dragRowId || dragRowId === targetId) { setDragRowId(null); setDragOverRowId(null); return }
    setRows(prev => {
      const fromIdx = prev.findIndex(r => r.id === dragRowId)
      const toIdx = prev.findIndex(r => r.id === targetId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      setDirty(true)
      if (!onPatchSave) triggerSave(next)
      else void saveStructuralPatch({ type: 'reorder', rowIds: next.map(r => r.id) })
      return next
    })
    setDragRowId(null); setDragOverRowId(null)
  }

  function getAutofillExistingRows() {
    return rows.some(r => r.subject) ? rows.map(r => ({
      subject: r.subject, coreIdea: r.coreIdea, standard: r.standard,
      knowledge: r.knowledge, processFunction: r.processFunction,
      agentLessonExample: r.agentLessonExample, description: r.description, isCenter: r.isCenter,
    })) : undefined
  }

  async function handleAutofill() {
    setAutofillLoading(true)
    setAutofillError('')
    try {
      const resp = await fetch('/api/curriculum-sheet/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'coreIdeas',
          existingRows: getAutofillExistingRows(),
          a12Artifact,
          graphSavedData,
          targetGradeGroup,
          chatContext,
        }),
      })
      if (resp.ok) {
        const data = await resp.json() as AutofillReview
        if (data.proposals?.length) {
          const defaults: Record<string, string> = {}
          for (const proposal of data.proposals) defaults[proposal.subject] = proposal.selectedCoreIdea
          setCoreIdeaSelections(defaults)
          setAutofillReview(data)
        }
      } else {
        const err = await resp.json().catch(() => ({}))
        setAutofillError(err.error ?? '핵심아이디어 후보를 찾지 못했습니다.')
        console.error('[autofill error]', err)
      }
    } catch (e) {
      setAutofillError('자동 채우기 요청 중 오류가 발생했습니다.')
      console.error('[autofill]', e)
    }
    finally { setAutofillLoading(false) }
  }

  async function applyAutofillReview() {
    if (!autofillReview) return
    setAutofillLoading(true)
    setAutofillError('')
    try {
      const resp = await fetch('/api/curriculum-sheet/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'complete',
          existingRows: getAutofillExistingRows(),
          selectedCoreIdeas: Object.entries(coreIdeaSelections).map(([subject, coreIdea]) => ({ subject, coreIdea })),
          a12Artifact,
          graphSavedData,
          targetGradeGroup,
          chatContext,
        }),
      })
      if (resp.ok) {
        const data = await resp.json()
        const newRows = (data.rows ?? []).map((r: CurriculumSheetRow) => ({ ...emptyRow(), ...r }))
        if (newRows.length > 0) {
          setRows(newRows)
          setDirty(true)
          if (onPatchSave) void saveStructuralPatch({ type: 'replace-all', rows: newRows, updatedBy: currentUserName })
          else triggerSave(newRows)
          setAutofillReview(null)
        }
      } else {
        const err = await resp.json().catch(() => ({}))
        setAutofillError(err.error ?? '분석표 생성에 실패했습니다.')
        console.error('[autofill apply error]', err)
      }
    } catch (e) {
      setAutofillError('분석표 생성 중 오류가 발생했습니다.')
      console.error('[autofill apply]', e)
    }
    finally { setAutofillLoading(false) }
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
  }

  function getPickerOptions(rowId: string, field: PickerField): string[] {
    const row = rows.find(r => r.id === rowId); const subj = row?.subject ?? ''; const ci = row?.coreIdea ?? ''
    const si = subj ? contentItems.filter(i => i.subject.includes(subj)) : contentItems
    const gradeFiltered = (items: string[]) => filterByTargetGrade(items, targetGradeGroup)
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
      return s.filter(standard => standardMatchesTargetGrade(standard, targetGradeGroup)).map(s => s.label)
    }
    if (field === 'knowledge' || field === 'processFunction') {
      // 내용체계 JSON 원문만 사용한다. 보조 매핑/AI 생성값은 선택창 후보에서 제외한다.
      if (ci) {
        const matched = areaScopedItems.filter(i => i.coreIdeas.some(c => curriculumTextMatches(c, ci)))
        if (matched.length > 0) {
          matched.sort((a, b) => a.coreIdeas.length - b.coreIdeas.length)
          const raw = gradeFiltered(field === 'knowledge' ? matched[0].knowledge : matched[0].functions)
          return [...new Set(raw)]
        }
      }

      // 폴백도 현재 교과/영역/학년군의 내용체계 원문으로만 제한
      return [...new Set(gradeFiltered(areaScopedItems.flatMap(i => field === 'knowledge' ? i.knowledge : i.functions)))]
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

  const FL: Record<string, string> = { coreIdea: '핵심아이디어', standard: '성취기준', knowledge: '지식·이해', processFunction: '과정·기능' }
  const FC: Record<string, string> = { coreIdea: '#7B1FA2', standard: '#1A73E8', knowledge: '#0D47A1', processFunction: '#137333' }

  const allEditors = presence ? [...new Map(Object.values(presence).filter(p => Date.now() - p.updatedAt < 20000).map(p => [p.uid, p] as const)).values()] : []
  const myColor = currentUserColor ?? (currentUid ? PRESENCE_COLORS[(currentUid.charCodeAt(0) + currentUid.charCodeAt(Math.min(currentUid.length - 1, 5))) % PRESENCE_COLORS.length] : '#999')
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
            {dirty && <span className="text-xs text-[#F9AB00] font-semibold animate-pulse">자동 저장 중...</span>}
            {!dirty && rows.some(r => r.subject) && <span className="text-xs text-[#137333] font-semibold">저장됨</span>}
          </div>
          <div className="flex items-center gap-3">
            {/* 프레즌스 아바타 */}
            <div className="flex items-center -space-x-1.5">
              {currentUid && (
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-white relative z-10"
                  style={{ backgroundColor: myColor }} title={`${currentUserName} (나)`}>{(currentUserName ?? '?').charAt(0)}</span>
              )}
              {allEditors.filter(p => p.uid !== currentUid).map(p => (
                <span key={p.uid} className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-white"
                  style={{ backgroundColor: p.color }} title={`${p.displayName} 편집 중`}>{p.displayName.charAt(0)}</span>
              ))}
            </div>
            <button onClick={handleManualSave}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[#1A73E8] text-white hover:bg-[#1557B0] transition shadow-sm">저장</button>
            <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#F1F3F4] flex items-center justify-center text-[#5F6368] text-xl transition">&times;</button>
          </div>
        </div>

        {/* ── 지식 그래프 안내 ── */}
        {showGraphPrompt && onSwitchToGraph && (
          <div className="px-6 py-3 bg-[#F3E5F5] border-b border-[#CE93D8] flex items-center justify-between gap-4">
            <p className="text-sm text-[#4A148C]"><span className="font-bold">저장 완료!</span> 중심 교과를 기준으로 지식 그래프와 수업 예시를 생성할 수 있습니다.</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => { setShowGraphPrompt(false); onSwitchToGraph?.(rows) }}
                className="px-4 py-2 rounded-full text-sm font-bold bg-[#7B1FA2] text-white hover:bg-[#6A1B9A] transition shadow-sm">지식 그래프 확인</button>
              <button onClick={() => setShowGraphPrompt(false)}
                className="px-3 py-2 rounded-full text-sm font-semibold text-[#7B1FA2] hover:bg-[#E1BEE7] transition">닫기</button>
            </div>
          </div>
        )}

        {/* ── AI 자동 채우기: 핵심아이디어 확인 ── */}
        {(autofillReview || autofillError) && (
          <div className="px-6 py-4 bg-[#F8F9FA] border-b border-[#DADCE0]">
            {autofillError && (
              <div className="mb-3 rounded-xl border border-[#F28B82] bg-[#FCE8E6] px-4 py-3 text-sm font-semibold text-[#A50E0E]">
                {autofillError}
              </div>
            )}
            {autofillReview && (
              <div className="rounded-2xl border border-[#DADCE0] bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-[#F1F3F4] flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#202124]">핵심아이디어 확인</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#5F6368]">
                      DB에서 찾은 핵심아이디어 후보입니다. 교과별 핵심 방향을 확인하면 같은 영역·학년군의 성취기준과 지식·이해/과정·기능을 자동으로 채웁니다.
                    </p>
                  </div>
                  <button onClick={() => setAutofillReview(null)}
                    className="w-8 h-8 rounded-full hover:bg-[#F1F3F4] flex items-center justify-center text-[#9AA0A6] hover:text-[#5F6368] text-lg flex-shrink-0">&times;</button>
                </div>
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
                  {autofillReview.proposals.map(proposal => {
                    const selected = coreIdeaSelections[proposal.subject] ?? proposal.selectedCoreIdea
                    const selectedOption = proposal.options.find(option => option.idea === selected) ?? proposal.options[0]
                    return (
                      <div key={proposal.subject} className="rounded-xl border border-[#E8EAED] p-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[#202124]">{proposal.subject}</span>
                            {proposal.isCenter && <span className="px-2 py-0.5 rounded-full bg-[#FEF7E0] text-[#E65100] text-[10px] font-bold">중심</span>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[11px] font-semibold text-[#7B1FA2]">{selectedOption?.area ?? '영역'}</span>
                            <button
                              onClick={() => removeAutofillProposal(proposal.subject)}
                              title={`${proposal.subject} 제외`}
                              className="w-6 h-6 rounded-full hover:bg-[#FCE8E6] flex items-center justify-center text-[#9AA0A6] hover:text-[#C5221F] text-base leading-none transition"
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                        {proposal.focus && <p className="mb-2 text-xs text-[#5F6368]">{proposal.focus}</p>}
                        <select
                          value={selected}
                          onChange={e => setCoreIdeaSelections(prev => ({ ...prev, [proposal.subject]: e.target.value }))}
                          className="w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2 text-xs leading-relaxed text-[#202124] focus:outline-none focus:border-[#7B1FA2]"
                        >
                          {proposal.options.map(option => (
                            <option key={`${option.coreIdeaId}:${option.idea}`} value={option.idea}>
                              [{option.area}] {option.idea}
                            </option>
                          ))}
                        </select>
                        {selectedOption && (
                          <div className="mt-3 rounded-lg bg-[#F8F9FA] px-3 py-2">
                            <p className="text-[11px] font-bold text-[#5F6368] mb-1">
                              연결 성취기준 후보 {selectedOption.standardsCount}개
                            </p>
                            <div className="space-y-1">
                              {selectedOption.sampleStandards.slice(0, 2).map(standard => (
                                <p key={standard} className="text-[11px] leading-relaxed text-[#1A73E8]">{standard}</p>
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
                    className="px-4 py-2 rounded-xl text-sm font-bold text-[#5F6368] hover:bg-[#F1F3F4] transition">취소</button>
                  <button onClick={applyAutofillReview} disabled={autofillLoading}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#137333] hover:bg-[#0D5C27] disabled:opacity-40 transition shadow-sm">
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
              <table className="w-[2320px] min-w-[2320px] table-fixed border-collapse">
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 125 }} />
                  <col style={{ width: 360 }} />
                  <col style={{ width: 420 }} />
                  <col style={{ width: 285 }} />
                  <col style={{ width: 285 }} />
                  <col style={{ width: 360 }} />
                  <col style={{ width: 390 }} />
                  <col style={{ width: 59 }} />
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F8F9FA] border-b-2 border-[#DADCE0]">
                    <th className="px-1 py-3 sticky left-0 z-20 bg-[#F8F9FA]" />
                    <th className="px-3 py-3 text-left text-sm font-bold text-[#5F6368] whitespace-nowrap sticky left-[36px] z-20 bg-[#F8F9FA] border-r border-[#DADCE0]">과목</th>
                    <th className="px-3 py-3 text-left text-sm font-bold text-[#7B1FA2] whitespace-nowrap">핵심아이디어</th>
                    <th className="px-3 py-3 text-left text-sm font-bold text-[#1A73E8] whitespace-nowrap">성취기준</th>
                    <th className="px-3 py-3 text-left text-sm font-bold text-[#0D47A1] whitespace-nowrap">지식·이해</th>
                    <th className="px-3 py-3 text-left text-sm font-bold text-[#137333] whitespace-nowrap">과정·기능</th>
                    <th className="px-3 py-3 text-left text-sm font-bold text-[#7B1FA2] whitespace-nowrap">Agent 추천 수업 예시</th>
                    <th className="px-3 py-3 text-left text-sm font-bold text-[#5F6368] whitespace-nowrap">수업내용 설명</th>
                    <th className="px-2 py-3 sticky right-0 z-20 bg-[#F8F9FA] border-l border-[#DADCE0]" />
                  </tr>
                </thead>
                <tbody>
                {rows.map((row, rowIdx) => (
                  <tr
                    key={row.id}
                    draggable
                    onDragStart={() => setDragRowId(row.id)}
                    onDragOver={e => { e.preventDefault(); setDragOverRowId(row.id) }}
                    onDragEnd={() => { setDragRowId(null); setDragOverRowId(null) }}
                    onDrop={() => handleDrop(row.id)}
                    className={cn(
                      'border-b border-[#E8EAED] hover:bg-[#F8F9FA] group transition-colors',
                      dragOverRowId === row.id && dragRowId !== row.id && 'border-t-2 border-t-[#1A73E8] bg-[#E8F0FE]',
                    )}
                  >
                    {/* 드래그 핸들 — 좌측 고정 */}
                    <td className="px-1 py-2 align-top text-center cursor-grab active:cursor-grabbing sticky left-0 z-[5] bg-white group-hover:bg-[#F8F9FA]">
                      <span className="text-[#DADCE0] hover:text-[#9AA0A6] text-sm select-none">⠿</span>
                    </td>

                    {/* 과목 + 중심교과 — 좌측 고정 */}
                    <td className="px-2 py-2 align-top sticky left-[36px] z-[5] bg-white group-hover:bg-[#F8F9FA] border-r border-[#E8EAED]">
                      <select value={row.subject} onChange={e => updateRow(row.id, 'subject', e.target.value)}
                        className="w-full px-1.5 py-2 rounded-xl border border-[#E8EAED] hover:border-[#DADCE0] focus:border-[#1A73E8] focus:outline-none bg-white text-sm font-semibold text-[#202124] cursor-pointer">
                        <option value="">선택</option>
                        {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
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
                          <span className={cn('text-[10px] font-bold', row.isCenter ? 'text-[#E65100]' : 'text-[#9AA0A6]')}>
                            {row.isCenter ? '★ 중심 교과' : '중심 교과'}
                          </span>
                        </label>
                      )}
                    </td>

                    {/* 핵심아이디어 (단일) */}
                    <td className="px-3 py-2 align-top relative">
                      {(() => {
                        const oe = getPresenceForCell(row.id, 'coreIdea')
                        const isMy = getMyPresenceForCell(row.id, 'coreIdea')
                        const bdr = oe ? `2px solid ${oe.color}` : isMy ? `2px dashed ${myColor}` : '1px solid #E8EAED'
                        const coreIdeaArea = getCoreIdeaArea(row)
                        return (<>
                          <button onClick={e => handleCellClick(row.id, 'coreIdea', e)}
                            className="w-full text-left px-3 py-2 rounded-xl transition min-h-[44px] text-sm leading-relaxed"
                            style={{ color: row.coreIdea ? '#202124' : '#9AA0A6', border: bdr }}>
                            {coreIdeaArea && (
                              <span className="mb-1 inline-flex items-center rounded-md bg-[#F3E5F5] px-1.5 py-0.5 text-[10px] font-bold text-[#7B1FA2]">
                                {coreIdeaArea}
                              </span>
                            )}
                            <span className="block">{row.coreIdea || '핵심아이디어 선택...'}</span>
                          </button>
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
                        </>)
                      })()}
                    </td>

                    {/* 성취기준 / 지식이해 / 과정기능 (다중 태그) */}
                    {(['standard', 'knowledge', 'processFunction'] as const).map(field => {
                      const oe = getPresenceForCell(row.id, field)
                      const isMy = getMyPresenceForCell(row.id, field)
                      return (
                        <td key={field} className="px-3 py-2 align-top relative">
                          <TagCell value={row[field]} placeholder={FL[field]} color={FC[field]}
                            onClickAdd={e => handleCellClick(row.id, field, e)} onRemove={tag => removeTag(row.id, field, tag)}
                            otherEditor={oe} myEditing={isMy} myColor={myColor} />
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
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
                            className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm leading-relaxed resize-none focus:border-[#7B1FA2] bg-[#FCF8FF]"
                            style={{ minHeight: 60, border: bdr }}
                            ref={el => { if (el && row.agentLessonExample) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                            onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }} />
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
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
                            className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm leading-relaxed resize-none focus:border-[#1A73E8]"
                            style={{ minHeight: 60, border: bdr }}
                            ref={el => { if (el && row.description) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                            onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }} />
                          {oe && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: oe.color }}>{oe.displayName}</span>}
                          {!oe && isMy && <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: myColor }}>{currentUserName}</span>}
                        </>)
                      })()}
                    </td>

                    {/* 행 삭제 — 우측 고정 (가로 스크롤 없이 항상 보임) */}
                    <td className="px-2 py-2 align-top text-center sticky right-0 z-[5] bg-white group-hover:bg-[#F8F9FA] border-l border-[#E8EAED]">
                      <button onClick={() => removeRow(row.id)} title={`${rowIdx + 1}행 삭제`}
                        className="w-8 h-8 rounded-full border border-[#F1F3F4] hover:bg-[#FCE8E6] hover:border-[#F28B82] text-[#C5221F] flex items-center justify-center transition text-base">
                        &times;
                      </button>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 하단 ── */}
        <div className="px-6 py-3 border-t border-[#DADCE0] bg-[#FAFAFA] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-[#1A73E8] hover:bg-[#E8F0FE] border border-[#C2D7F8] transition">
              + 행 추가
            </button>
            <button onClick={handleAutofill} disabled={autofillLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-white bg-[#137333] hover:bg-[#0D5C27] disabled:opacity-40 transition shadow-sm"
              title={!a12Artifact?.selectedTopic && !graphSavedData ? 'A-1-2 주제 선정 또는 지식 그래프 데이터 필요' : '핵심아이디어 후보를 먼저 확인하고 DB 기반으로 자동 채우기'}>
              {autofillLoading ? (
                <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> 후보 찾는 중...</>
              ) : 'AI 자동 채우기'}
            </button>
            {onSwitchToGraph && hasGraphRows && (
              <button onClick={() => onSwitchToGraph(rows)} disabled={!hasCenterGraphRow}
                title={hasCenterGraphRow ? '중심 교과를 중심 노드로 지식 그래프와 수업 예시를 생성합니다' : '먼저 중심 교과를 체크하고 성취기준을 선택하세요'}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-white bg-[#7B1FA2] hover:bg-[#6A1B9A] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#7B1FA2] transition shadow-sm">
                지식 그래프·수업 예시 생성 →
              </button>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-[#9AA0A6]">
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
    </>
  )
}
