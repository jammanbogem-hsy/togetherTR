/**
 * Sheet subject ⇄ curriculum-source name resolution (pure, dependency-free).
 *
 * The curriculum analysis sheet stores a short subject name ('통합교과'), while
 * the two curriculum sources spell the same subject differently:
 *
 *  - knowledge graph (`public/elementary_knowledge_graph.json`): `subjects[].name_ko`
 *    is '바른 생활·슬기로운 생활·즐거운 생활' for `sub_int`, '사회과' for `sub_soc`,
 *    '실과(기술·가정)/정보' for `sub_prac`.
 *  - content systems (`data/curriculum-content-systems/*.json`): `메타.교과` is
 *    '통합교과' with `과목` '바른 생활' / '슬기로운 생활' / '즐거운 생활'.
 *
 * The autofill route used to resolve subjects with a bare
 * `name_ko.includes(subject)` test, which silently returned NO graph subject id
 * for 통합교과 ('바른 생활·슬기로운 생활·즐거운 생활' contains neither '통합교과'
 * nor the reverse). All 48 [2바..]/[2슬..]/[2즐..] standards were therefore
 * unreachable and 1-2학년군 rows could not be filled at all.
 *
 * This table makes every mapping explicit: ids for the graph (no name matching),
 * 교과/과목 names for the content systems, and the accepted spellings a teacher
 * may type into the sheet. '창의적 체험활동' is listed last and flagged as a
 * non-sheet subject so it can never be reached by a containment accident.
 */

export interface SubjectAliasEntry {
  /** Canonical sheet subject name. */
  canonical: string
  /** Other spellings accepted from the sheet, the graph or the content systems. */
  aliases: string[]
  /** `subjects[].id` in the elementary knowledge graph. */
  graphSubjectIds: string[]
  /** `메타.교과` / `과목` values in data/curriculum-content-systems. */
  contentSubjectNames: string[]
  /**
   * Grade bands this subject exists in, when the curriculum restricts it.
   * `undefined` = every elementary band. Only subjects whose band coverage is a
   * hard curriculum fact are listed; for the rest a missing band simply yields
   * no achievement standard and the route reports it.
   */
  gradeBands?: string[]
  /** False for subjects that must never be produced as a sheet row. */
  sheetSubject?: boolean
}

export const SUBJECT_ALIASES: readonly SubjectAliasEntry[] = [
  {
    canonical: '국어',
    aliases: ['국어과'],
    graphSubjectIds: ['sub_kor'],
    contentSubjectNames: ['국어'],
  },
  {
    canonical: '수학',
    aliases: ['수학과'],
    graphSubjectIds: ['sub_math'],
    contentSubjectNames: ['수학'],
  },
  {
    canonical: '과학',
    aliases: ['과학과'],
    graphSubjectIds: ['sub_sci'],
    contentSubjectNames: ['과학'],
  },
  {
    canonical: '사회',
    aliases: ['사회과'],
    graphSubjectIds: ['sub_soc'],
    contentSubjectNames: ['사회'],
  },
  {
    canonical: '도덕',
    aliases: ['도덕과'],
    graphSubjectIds: ['sub_mor'],
    contentSubjectNames: ['도덕'],
  },
  {
    canonical: '미술',
    aliases: ['미술과'],
    graphSubjectIds: ['sub_art'],
    contentSubjectNames: ['미술'],
  },
  {
    canonical: '음악',
    aliases: ['음악과'],
    graphSubjectIds: ['sub_mus'],
    contentSubjectNames: ['음악'],
  },
  {
    canonical: '체육',
    aliases: ['체육과'],
    graphSubjectIds: ['sub_pe'],
    contentSubjectNames: ['체육'],
  },
  {
    canonical: '영어',
    aliases: ['영어과'],
    graphSubjectIds: ['sub_eng'],
    contentSubjectNames: ['영어'],
  },
  {
    canonical: '실과',
    aliases: ['실과과', '실과(기술·가정)/정보', '실과(기술⋅가정)', '기술·가정', '기술⋅가정'],
    graphSubjectIds: ['sub_prac'],
    contentSubjectNames: ['실과', '실과(기술⋅가정)', '기술⋅가정'],
  },
  {
    // 1-2학년군 전용. 바른 생활·슬기로운 생활·즐거운 생활을 한 교과로 다룬다.
    canonical: '통합교과',
    aliases: [
      '바른 생활·슬기로운 생활·즐거운 생활',
      '바른 생활',
      '슬기로운 생활',
      '즐거운 생활',
      '바슬즐',
    ],
    graphSubjectIds: ['sub_int'],
    contentSubjectNames: ['통합교과', '바른 생활', '슬기로운 생활', '즐거운 생활'],
    gradeBands: ['1-2학년군'],
  },
  {
    // Intentionally last and not a sheet subject: 창체 has no achievement
    // standards of its own in the sheet's sense, and must never be picked up by
    // a containment match from another subject's name.
    canonical: '창의적 체험활동',
    aliases: ['창체', '창의적체험활동'],
    graphSubjectIds: ['sub_extra'],
    contentSubjectNames: ['창의적 체험활동'],
    sheetSubject: false,
  },
]

/** Canonical names of the subjects a sheet row may use. */
export const SHEET_SUBJECTS: readonly string[] = SUBJECT_ALIASES
  .filter(entry => entry.sheetSubject !== false)
  .map(entry => entry.canonical)

function normalize(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[()[\]{}"'`.,:;!?/\\|_\-·⋅•・]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function keysOf(entry: SubjectAliasEntry): string[] {
  return [entry.canonical, ...entry.aliases, ...entry.contentSubjectNames].map(normalize).filter(Boolean)
}

/**
 * Resolve any subject spelling (sheet input, graph `name_ko`, content-system
 * 교과/과목, graph subject id) to its table entry.
 *
 * Exact normalized match first. Then a guarded containment pass: the input may
 * contain a key ('실과(기술·가정)/정보' → '실과'), or a key may *start with* the
 * input ('통합교' → '통합교과'). A key merely containing the input elsewhere is
 * rejected, so '생활' does not become 통합교과 and '통합과학' stays 과학.
 */
export function resolveSubjectAlias(value: string): SubjectAliasEntry | undefined {
  const input = normalize(value)
  if (input.length < 2) return undefined

  const byId = SUBJECT_ALIASES.find(entry => entry.graphSubjectIds.includes((value ?? '').trim()))
  if (byId) return byId

  const exact = SUBJECT_ALIASES.find(entry => keysOf(entry).includes(input))
  if (exact) return exact

  return SUBJECT_ALIASES.find(entry =>
    keysOf(entry).some(key => key.length >= 2 && (input.includes(key) || key.startsWith(input))),
  )
}

/** Canonical sheet subject name, or '' when the value maps to no known subject. */
export function canonicalSubjectName(value: string): string {
  return resolveSubjectAlias(value)?.canonical ?? ''
}

/** Graph `subjects[].id` list for a subject. Empty when unknown. */
export function graphSubjectIdsForSubject(value: string): string[] {
  return [...(resolveSubjectAlias(value)?.graphSubjectIds ?? [])]
}

/** Content-system 교과/과목 names for a subject. Empty when unknown. */
export function contentSubjectNamesForSubject(value: string): string[] {
  return [...(resolveSubjectAlias(value)?.contentSubjectNames ?? [])]
}

/** Bands the subject exists in, or null when it is available in every band. */
export function gradeBandsForSubject(value: string): string[] | null {
  const bands = resolveSubjectAlias(value)?.gradeBands
  return bands ? [...bands] : null
}

/**
 * Clamp a requested band to one the subject actually exists in.
 * 통합교과 rows requested for 3-4/5-6학년군 are coerced to 1-2학년군 and the
 * caller surfaces `coerced` to the teacher instead of silently swapping bands.
 */
export function coerceGradeBandForSubject(
  subject: string,
  band: string,
): { band: string; coerced: boolean } {
  const allowed = gradeBandsForSubject(subject)
  if (!allowed || allowed.length === 0 || allowed.includes(band)) return { band, coerced: false }
  return { band: allowed[0], coerced: true }
}

/**
 * Subjects to search for a bridge standard.
 *
 * An explicit request wins (each entry canonicalized, unknown names dropped,
 * de-duplicated in request order); otherwise every sheet subject is searched
 * and the caller skips the ones with no standards in the target band.
 * 창의적 체험활동 is never searched: it carries no achievement standards the
 * analysis sheet can cite.
 */
export function resolveBridgeSubjects(requested?: readonly (string | null | undefined)[] | null): string[] {
  const asked = (requested ?? [])
    .map(value => canonicalSubjectName(String(value ?? '')))
    .filter(Boolean)
  const source = asked.length > 0 ? asked : SHEET_SUBJECTS
  const out: string[] = []
  for (const subject of source) {
    if (subject === '창의적 체험활동') continue
    if (!out.includes(subject)) out.push(subject)
  }
  return out
}

export interface SubjectBandPlan {
  /** Bands this subject will actually be filled for, de-duplicated, in request order. */
  gradeBands: string[]
  /** Bands that were asked for but swapped for one the subject exists in. */
  coerced: Array<{ requested: string; used: string }>
}

/**
 * Decide which grade bands a subject's rows should be built for.
 *
 * `requestedBands` are the bands the client asked for (already canonicalized;
 * empty entries are ignored). When nothing is requested the project's default
 * band is used, so a sheet that never sets a per-row band behaves exactly as
 * before. Bands the subject cannot have are coerced (통합교과 → 1-2학년군) and
 * reported, never dropped silently.
 */
export function planSubjectBands(
  subject: string,
  requestedBands: string[],
  defaultBand: string,
): SubjectBandPlan {
  const asked = requestedBands.filter(Boolean)
  const source = asked.length > 0 ? asked : [defaultBand]
  const gradeBands: string[] = []
  const coerced: Array<{ requested: string; used: string }> = []

  for (const requested of source) {
    const { band, coerced: wasCoerced } = coerceGradeBandForSubject(subject, requested)
    // An empty requested band means "no band was asked for", so filling in the
    // subject's own band is not a coercion worth reporting.
    if (wasCoerced && requested && !coerced.some(item => item.requested === requested)) {
      coerced.push({ requested, used: band })
    }
    if (!gradeBands.includes(band)) gradeBands.push(band)
  }

  return { gradeBands, coerced }
}
