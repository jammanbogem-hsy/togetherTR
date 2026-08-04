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
 * Build the request path for a `public/curriculum_json/*.json` static asset.
 *
 * The stored filenames are NFD-normalized (macOS canonical form, preserved
 * through git and Firebase Hosting — e.g. '영어 교육과정.json'), while the
 * `SUBJECT_FILE` literals in the source are NFC. Fetching the NFC form yields
 * a URL whose percent-encoded bytes do not match the NFD file on disk → 404.
 *
 * Normalizing to NFD before percent-encoding makes the first request match the
 * stored filename, so no failing NFC request is issued (avoids a logged 404).
 * The filename is a single path segment (no '/'), so encodeURIComponent is the
 * correct encoder — it also turns the literal space in '영어 교육과정.json' into
 * '%20'.
 */
export function curriculumJsonAssetPath(fileName: string): string {
  return `/curriculum_json/${encodeURIComponent((fileName ?? '').normalize('NFD'))}`
}
