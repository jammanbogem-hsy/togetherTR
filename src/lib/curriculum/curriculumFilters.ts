/**
 * Curriculum grade-band / core-idea matching helpers (pure, dependency-free).
 *
 * Centralizes two failure-prone concerns that previously lived (duplicated and
 * slightly inconsistent) inside individual API routes:
 *
 *  1. Grade-group → band needle canonicalization. Callers pass grade groups in
 *     many shapes ('초5-6', '5~6', '초등학교 5-6학년', '5-6학년군'). The old
 *     `replace(/^초/,'').replace(/~/g,'-')` only stripped a leading '초' and
 *     '~', so a malformed value produced a bogus needle (e.g. '등학교 5-6학년')
 *     that matched no grade-band prefix — silently wiping populated 지식·이해 /
 *     과정·기능 to empty while 핵심아이디어(never grade-filtered) survived.
 *
 *  2. Grade filtering with deterministic recovery. When grade-prefixed items
 *     exist but none match the requested band, the old filters returned `[]`.
 *     We now fall back to the full set of grade-prefixed official items rather
 *     than an empty cell — official data beats a blank.
 *
 *  3. Usable core-idea predicate mirroring the client's isUsableCoreIdea so the
 *     server only proposes/echoes complete 2022-curriculum idea sentences (not
 *     PDF-extraction junk like '[별표 2] …' or bare vocabulary lists) that can
 *     resolve to an official content-system record.
 */

/**
 * Extract the canonical `N-M` grade-band needle from an arbitrary grade-group
 * label. Returns '' when no band can be derived (callers then skip filtering
 * rather than wipe data).
 */
export function gradeBandNeedle(gradeGroup?: string | null): string {
  const raw = (gradeGroup ?? '').trim()
  if (!raw) return ''
  const match = raw.match(/(\d)\s*[-~]\s*(\d)/)
  return match ? `${match[1]}-${match[2]}` : ''
}

/**
 * Whether a grade group / band label belongs to elementary school.
 *
 * Accepts both project `GradeGroup` values ('초3-4') and canonical band labels
 * ('3-4학년군'), which the sheet sends as `targetGradeGroup` in single-band
 * mode. Anything naming 중학교/고등학교 is rejected, and a label with no digits
 * in 1..6 ('고공통') is not elementary.
 *
 * Lives here (dependency-free) rather than in contentSystemReader so it can be
 * unit-tested without the filesystem readers; contentSystemReader re-exports it
 * for its existing callers.
 */
export function isElementaryGradeGroup(gradeGroup?: string | null): boolean {
  const raw = (gradeGroup ?? '').trim()
  if (!raw || /중학교|고등학교|^[중고]/.test(raw)) return false
  if (/초등학교|^초/.test(raw)) return true
  const grades = [...raw.matchAll(/\d/g)].map(match => Number(match[0]))
  return grades.length > 0 && grades.every(grade => grade >= 1 && grade <= 6)
}

/**
 * The three elementary grade bands, in the canonical label form used by the
 * curriculum analysis sheet (one band per row), the autofill API response and
 * the content-item prefixes ("3-4학년군: 무게").
 */
export const CANONICAL_GRADE_BANDS = ['1-2학년군', '3-4학년군', '5-6학년군'] as const
export type CanonicalGradeBand = (typeof CANONICAL_GRADE_BANDS)[number]

/**
 * Canonicalize an arbitrary band/grade-group label ('초3-4', '3~4학년군',
 * '초등학교 3-4학년') to one of CANONICAL_GRADE_BANDS. Returns '' for anything
 * that is not an elementary band (middle/high school, unparseable, empty), so
 * callers can fall back to a default band instead of trusting junk input.
 */
export function toCanonicalGradeBand(value?: string | null): CanonicalGradeBand | '' {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  if (/중학교|고등학교|^[중고]/.test(raw)) return ''
  const needle = gradeBandNeedle(raw)
  if (!needle) return ''
  const label = `${needle}학년군`
  return (CANONICAL_GRADE_BANDS as readonly string[]).includes(label) ? (label as CanonicalGradeBand) : ''
}

/**
 * Normalize the bands a client asked to fill.
 *
 * `selectedBands` (the teacher's per-subject choice in the confirm dialog) wins
 * over `rowBands` (the bands that subject's sheet rows carry); an entry that
 * cannot be canonicalized falls back to `defaultBand` (the project band), and
 * the result is de-duplicated in request order. An empty result means "use the
 * default band", which keeps a client that never sends bands on the old
 * single-band behavior.
 */
export function resolveRequestedBands(params: {
  selectedBands?: readonly (string | null | undefined)[] | null
  rowBands?: readonly (string | null | undefined)[] | null
  defaultBand: string
}): string[] {
  const { selectedBands, rowBands, defaultBand } = params
  const selected = (selectedBands ?? []).filter(Boolean)
  const source = selected.length > 0 ? selected : (rowBands ?? [])
  const out: string[] = []
  for (const value of source) {
    const band = toCanonicalGradeBand(value) || defaultBand
    if (band && !out.includes(band)) out.push(band)
  }
  return out
}

const BAND_PREFIX_RE = /^(\d+-\d+학년군):/

/**
 * Cap grade-prefixed content items at `limit` items *per band* instead of
 * globally, preserving input order.
 *
 * Why: a record's knowledge/functions/attitudes list concatenates all three
 * bands ('1-2학년군: …' → '3-4학년군: …' → '5-6학년군: …'). A global
 * `slice(0, 15)` therefore returns only the earliest bands and silently starves
 * 5-6학년군 rows of their own official items. Unprefixed items (records with no
 * per-band breakdown) are treated as a single extra group, so they are kept
 * once rather than counted against every band.
 */
export function sliceContentItemsPerBand(items: string[], limit: number): string[] {
  if (limit <= 0) return []
  const used = new Map<string, number>()
  const out: string[] = []
  for (const item of items) {
    const band = item.match(BAND_PREFIX_RE)?.[1] ?? ''
    const count = used.get(band) ?? 0
    if (count >= limit) continue
    used.set(band, count + 1)
    out.push(item)
  }
  return out
}

/**
 * Filter grade-prefixed content items ("3-4학년군: …") to the requested grade
 * band. If the band cannot be derived, returns items unchanged. If items carry
 * no grade prefixes, returns them unchanged. If the band matches nothing yet
 * prefixed items exist, recovers to the full prefixed set (deterministic
 * recovery to official data instead of an empty result).
 */
export function filterContentItemsByGrade(items: string[], gradeGroup?: string | null): string[] {
  const needle = gradeBandNeedle(gradeGroup)
  if (!needle) return items
  const prefixed = items.filter(item => /^\d+-\d+학년군:/.test(item))
  if (prefixed.length === 0) return items
  const filtered = prefixed.filter(item => item.includes(needle))
  return filtered.length > 0 ? filtered : prefixed
}

const BROKEN_CORE_IDEA_PREFIX_RE = /^(?:인문적|공간적|시대적|경제적|환경적|해석|판단을|평가하여|통신|발전시키는|운영된다|공존을|태도)(?:\s|$)/

/**
 * Whether a string is a complete, usable 2022-curriculum core idea (a full
 * sentence ending in '다'), not a stray fragment, an appendix/table header
 * ('[별표 …]'), a school-level header, or a vocabulary-list entry. Mirrors the
 * client-side predicate in CurriculumSheetModal so server proposals and the
 * A-2-1 recommended table stay consistent with what the sheet accepts.
 */
export function isUsableCoreIdea(value: string): boolean {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim()
  if (cleaned.length < 18) return false
  if (!/다[.!?]?$/.test(cleaned)) return false
  if (/^\[별표\s*\d+\]/.test(cleaned)) return false
  if (/(초등학교|중학교|고등학교)\s+(중학교|고등학교|\d~\d학년|\d-\d학년)/.test(cleaned)) return false
  if (BROKEN_CORE_IDEA_PREFIX_RE.test(cleaned)) return false
  return true
}

/**
 * Request paths for a `public/curriculum_json/*.json` static asset, in try order.
 *
 * Firebase Hosting serves the filename exactly as it is stored on disk, and the
 * on-disk forms are MIXED: files untouched since the macOS copy are NFD
 * (국어·영어·음악·통합교과…), files rewritten by scripts are NFC (수학·도덕·
 * 과학…, e.g. after the 2026-09 standard-text corrections). A URL whose
 * percent-encoded bytes do not match the stored form → 404, which silently
 * emptied those subjects' standards (every band looked "missing").
 * So callers try NFD first, then NFC. The filename is a single path segment,
 * so encodeURIComponent is the right encoder ('영어 교육과정.json' → '%20').
 */
export function curriculumJsonAssetPaths(fileName: string): string[] {
  const name = fileName ?? ''
  const forms = [name.normalize('NFD'), name.normalize('NFC')]
  return [...new Set(forms)].map(form => `/curriculum_json/${encodeURIComponent(form)}`)
}

/** Primary (NFD) request path — prefer fetchCurriculumJson, which also falls back to NFC. */
export function curriculumJsonAssetPath(fileName: string): string {
  return curriculumJsonAssetPaths(fileName)[0]
}

/**
 * Fetch a curriculum JSON asset, trying each normalization form until one is 2xx.
 * Throws with the last status when none succeeds (callers surface the failure).
 */
export async function fetchCurriculumJson<T = unknown>(fileName: string, init?: RequestInit): Promise<T> {
  let lastError: unknown = null
  for (const path of curriculumJsonAssetPaths(fileName)) {
    try {
      const res = await fetch(path, init)
      if (res.ok) return (await res.json()) as T
      lastError = new Error(`HTTP ${res.status} ${path}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error(`curriculum asset not found: ${fileName}`)
}
