// Curriculum linkage verification loop (elementary-only guarantee).
//
// The web app is for elementary teachers, so nothing that reaches a prompt,
// an API response or the UI may carry 중학교·고등학교 curriculum content, and
// every standard must link to the elementary content system of its own
// (subject, area, 학년군). This script checks the data files AND the real
// reader/prompt code paths, and exits 1 on any failure so `npm run build`
// and CI refuse a regression (e.g. a regenerated knowledge graph).
//
// Run: npm run verify:curriculum
//   (= node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/verify-curriculum-linkage.mjs)
// Options: --verbose  print every offending item (default: first 5 per check)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(REPO_ROOT)
const VERBOSE = process.argv.includes('--verbose')

const {
  GRAPH_SUBJECT_TO_CONTENT_SUBJECT,
  findElementaryContentEntries,
  getElementaryContentLists,
  loadElementaryContentEntries,
  normalizeCurriculumKey,
  toElementaryBand,
} = await import('../src/lib/curriculum/elementaryContentLists.ts')
const { loadGraph, searchStandards } = await import('../src/lib/curriculum/graphReader.ts')
const { findDuplicateCoreIdeaSentences } = await import('../src/lib/curriculum/coreIdeaDedupe.ts')
const { searchJsonStandards } = await import('../src/lib/curriculum/curriculumJsonReader.ts')
const {
  buildContentSystemContext,
  loadContentSystemsForGradeGroup,
  loadElementaryContentSystems,
  searchContentSystems,
} = await import('../src/lib/curriculum/contentSystemReader.ts')
const { filterContentItemsByGrade } = await import('../src/lib/curriculum/curriculumFilters.ts')
const { buildCurriculumContext } = await import('../src/lib/curriculum/contextInject.ts')

const GRADE_GROUPS = ['초1-2', '초3-4', '초5-6']
const CONTEXT_ACTIVITIES = ['A-1-2', 'A-2-1', 'A-2-2', 'A-2-3', 'Ds-1-1', 'Ds-1-3']
const SAMPLE_THEMES = ['환경', '물', '에너지', '지역', '건강', '소리', '이야기', '놀이', '안전', '가족', '우리 동네', '식물', '날씨', '문화유산', '친구']

// ───────────────────────────── reporting ─────────────────────────────
const results = []
function report(id, title, failures, { warn = false, total = null } = {}) {
  const status = failures.length === 0 ? 'PASS' : warn ? 'WARN' : 'FAIL'
  results.push({ id, title, status, failures })
  const count = total != null ? ` (${failures.length}/${total})` : failures.length ? ` (${failures.length})` : ''
  console.log(`[${status}] ${id} ${title}${count}`)
  const shown = VERBOSE ? failures : failures.slice(0, 5)
  for (const failure of shown) console.log(`        - ${failure}`)
  if (!VERBOSE && failures.length > shown.length) console.log(`        … ${failures.length - shown.length} more (--verbose)`)
}

// ───────────────────────────── ground truth ─────────────────────────────
const CS_DIR = path.join(REPO_ROOT, 'data', 'curriculum-content-systems')
const CUR_DIR = path.join(REPO_ROOT, 'public', 'curriculum_json')
const CATS = ['지식⋅이해', '과정⋅기능', '가치⋅태도']
const CAT_FIELD = { '지식⋅이해': 'knowledge', '과정⋅기능': 'functions', '가치⋅태도': 'attitudes' }

const nk = value => normalizeCurriculumKey(value ?? '')
const stripBandPrefix = item => item.replace(/^\s*[^:]{1,12}학년군\s*:\s*/, '').replace(/^\s*(중학교|고등학교)\s*:\s*/, '')
const bandPrefixOf = item => item.match(/^\s*([^:]{1,12}학년군|중학교|고등학교)\s*:/)?.[1] ?? null

/** subject → cat → Set(normalized items) for elementary bands / middle bands / flat-out-of-band lists. */
const elemSet = new Map()
const midSet = new Map()
const flatExtra = new Map()
const midRaw = new Map()
const flatRaw = new Map()
const groupRaw = new Map()
const rawCoreIdeas = new Map() // subject → Set(normalized core idea sentence)
for (const file of fs.readdirSync(CS_DIR).filter(name => name.endsWith('.json')).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(CS_DIR, file), 'utf-8'))
  const subject = data['메타']?.['교과'] ?? ''
  for (const record of data['내용체계'] ?? []) {
    for (const idea of record['핵심아이디어'] ?? []) setAdd(rawCoreIdeas, subject, '*', nk(idea))
    const bands = record['학년군별'] ?? {}
    for (const [band, cats] of Object.entries(bands)) {
      const mid = /중|고/.test(band)
      for (const cat of CATS) for (const item of itemStrings(cats[cat])) {
        setAdd(mid ? midSet : elemSet, subject, cat, nk(item))
        if (mid) setAdd(midRaw, subject, cat, item)
      }
    }
    if (Object.keys(bands).length > 0 && record['내용요소']) {
      for (const cat of CATS) for (const item of itemStrings(record['내용요소'][cat])) {
        setAdd(flatExtra, subject, cat, nk(item))
        setAdd(flatRaw, subject, cat, item)
      }
    }
  }
}
const CONTENT_SUBJECTS = [...elemSet.keys(), ...midSet.keys(), ...rawCoreIdeas.keys()].filter((s, i, a) => a.indexOf(s) === i)
// forbidden = anything the app could have copied that is NOT an elementary content item
const groupLists = new Map() // subject → cat → Set (curriculum_json core-idea group lists)
for (const file of fs.readdirSync(CUR_DIR).filter(name => name.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(CUR_DIR, file), 'utf-8'))
  const subject = contentSubjectOf(data.subject?.name ?? '')
  for (const group of data.core_idea_groups ?? []) {
    for (const [field, cat] of [['knowledge', '지식⋅이해'], ['functions', '과정⋅기능'], ['attitudes', '가치⋅태도']]) {
      for (const item of group[field] ?? []) {
        setAdd(groupLists, subject, cat, nk(item))
        setAdd(groupRaw, subject, cat, item)
      }
    }
  }
}
const forbidden = new Map() // subject → cat → Set(normalized)
const forbiddenRaw = new Map() // subject → cat → Set(raw text)
for (const [source, rawSource] of [[midSet, midRaw], [flatExtra, flatRaw], [groupLists, groupRaw]]) {
  for (const [subject, cats] of source) {
    for (const [cat, items] of cats) {
      for (const item of items) {
        if (!item || elemHas(subject, cat, item)) continue
        setAdd(forbidden, subject, cat, item)
        for (const raw of rawSource.get(subject)?.get(cat) ?? []) if (nk(raw) === item) setAdd(forbiddenRaw, subject, cat, raw)
      }
    }
  }
}
// Text-scan list: forbidden items long enough to be unambiguous and absent from the legitimate
// elementary corpus (content items, content-system 핵심아이디어, graph standard texts/ideas/areas).
const graphForCorpus = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'elementary_knowledge_graph.json'), 'utf-8'))
const legitCorpus = [
  ...[...elemSet.values()].flatMap(cats => [...cats.values()].flatMap(set => [...set])),
  ...[...rawCoreIdeas.values()].flatMap(cats => [...cats.values()].flatMap(set => [...set])),
  ...graphForCorpus.achievementStandards.map(s => nk(s.text)),
  ...graphForCorpus.coreIdeas.flatMap(ci => [nk(ci.area), ...(ci.ideas ?? []).map(nk)]),
  ...graphForCorpus.subjects.map(s => nk(s.name_ko)),
].join('\n')
// Items are stored normalized; comma-joined pairs ('중력, 마찰력') are also scanned as fragments so a
// single leaked term is caught. Prompt text is normalized with list separators preserved (SEP) so two
// adjacent legitimate items never concatenate into a forbidden phrase.
const SEP = '\u0001'
const forbiddenText = []
const seenFragments = new Set()
for (const [subject, cats] of forbiddenRaw) {
  for (const [cat, items] of cats) {
    for (const raw of items) {
      for (const fragment of [raw, ...raw.split(/[,/]/)]) {
        const item = nk(fragment)
        if (item.length < 3 || seenFragments.has(`${cat}|${item}`)) continue
        if (legitCorpus.includes(item)) continue
        seenFragments.add(`${cat}|${item}`)
        forbiddenText.push({ subject, cat, item })
      }
    }
  }
}

function itemStrings(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return [item]
    if (item && typeof item === 'object') {
      const question = typeof item['질문'] === 'string' ? item['질문'] : ''
      const elements = itemStrings(item['요소'])
      return question && elements.length ? [`${question}: ${elements.join(', ')}`] : elements
    }
    return []
  })
}
function setAdd(map, subject, cat, value) {
  if (!map.has(subject)) map.set(subject, new Map())
  const cats = map.get(subject)
  if (!cats.has(cat)) cats.set(cat, new Set())
  cats.get(cat).add(value)
}
function has(map, subject, cat, value) {
  return map.get(subject)?.get(cat)?.has(value) ?? false
}
function elemHas(subject, cat, value) {
  return has(elemSet, subject, cat, value)
}
function contentSubjectOf(subjectIdOrName) {
  if (GRAPH_SUBJECT_TO_CONTENT_SUBJECT[subjectIdOrName]) return GRAPH_SUBJECT_TO_CONTENT_SUBJECT[subjectIdOrName]
  const key = nk(subjectIdOrName)
  if (/바른생활|슬기로운생활|즐거운생활|통합/.test(key)) return '통합교과'
  if (key.startsWith('창의적체험')) return '창의적 체험활동'
  const stripped = key.replace(/과$/, '')
  return CONTENT_SUBJECTS.find(s => nk(s) === key || nk(s).replace(/과$/, '') === stripped)
    ?? CONTENT_SUBJECTS.find(s => key.startsWith(nk(s)))
    ?? subjectIdOrName
}
function bandOf(gradeBand) {
  return toElementaryBand(gradeBand)
}
function itemsInBand(subjectId, area, gradeBand, field) {
  return new Set(getElementaryContentLists(subjectId, area, gradeBand)[field].map(nk))
}
function scanText(text, label, failures) {
  const normalized = nk(text.replace(/[,;/\n|]/g, SEP))
  for (const { subject, cat, item } of forbiddenText) {
    if (normalized.includes(item)) failures.push(`${label}: 중학교/학년군 밖 항목 노출 → [${subject}/${cat}] ${item}`)
  }
}
function fieldOf(cat) {
  return CAT_FIELD[cat]
}

// ───────────────────────────── D. data files ─────────────────────────────
const DATA_GRAPH = path.join(REPO_ROOT, 'data', 'elementary_knowledge_graph.json')
const PUBLIC_GRAPH = path.join(REPO_ROOT, 'public', 'elementary_knowledge_graph.json')
const rawGraph = JSON.parse(fs.readFileSync(DATA_GRAPH, 'utf-8'))

{
  const failures = []
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (!fs.existsSync(PUBLIC_GRAPH)) failures.push('public/elementary_knowledge_graph.json 없음 (앱은 public/을 먼저 읽음)')
  else if (sha(DATA_GRAPH) !== sha(PUBLIC_GRAPH)) failures.push('data/ 와 public/ 의 elementary_knowledge_graph.json 내용이 다름 → npm run sanitize:knowledge-graph')
  const publicCs = path.join(REPO_ROOT, 'public', 'curriculum-content-systems')
  if (fs.existsSync(publicCs)) {
    for (const name of fs.readdirSync(CS_DIR).filter(n => n.endsWith('.json'))) {
      const mirrored = path.join(publicCs, name)
      if (!fs.existsSync(mirrored)) failures.push(`public/curriculum-content-systems/${name} 없음 → npm run sync:runtime-assets`)
      else if (sha(path.join(CS_DIR, name)) !== sha(mirrored)) failures.push(`public/curriculum-content-systems/${name} 가 data/ 와 다름 → npm run sync:runtime-assets`)
    }
  }
  report('D1', 'data/ 와 public/ 사본 일치', failures)
}

{
  const failures = []
  for (const std of rawGraph.achievementStandards) {
    if (!bandOf(std.grade_band)) failures.push(`${std.code} grade_band=${std.grade_band}`)
    if (std.school_level && !/^초/.test(std.school_level)) failures.push(`${std.code} school_level=${std.school_level}`)
  }
  for (const link of rawGraph.links_cross_subject) {
    if (!bandOf(link.grade_band)) failures.push(`${link.id} grade_band=${link.grade_band}`)
  }
  report('D2', '그래프 성취기준·교과간 엣지가 모두 초등 학년군', failures, { total: rawGraph.achievementStandards.length + rawGraph.links_cross_subject.length })
}

{
  const failures = []
  const bandGaps = []
  for (const std of rawGraph.achievementStandards) {
    if (std.subject_id === 'sub_extra') continue
    const entries = findElementaryContentEntries(std.subject_id, std.area)
    if (entries.length === 0) {
      failures.push(`${std.code} (${std.subject_id} / ${std.area}) → 내용체계 기록 없음`)
      continue
    }
    const band = bandOf(std.grade_band)
    const lists = getElementaryContentLists(std.subject_id, std.area, std.grade_band)
    if (!entries.some(entry => entry.bands[band])) bandGaps.push(`${std.code} → 내용체계에 ${band} 열 없음 (${std.area})`)
    else if (lists.knowledge.length === 0 && lists.functions.length === 0) bandGaps.push(`${std.code} → ${band} 열이 비어 있음 (${std.area})`)
  }
  report('D3', '창체 제외 모든 성취기준이 (교과, 영역)으로 내용체계 기록에 연결', failures, { total: rawGraph.achievementStandards.length })
  report('D3b', '연결된 내용체계 기록에 해당 학년군 열이 존재', bandGaps, { warn: true })
}

{
  const failures = []
  let total = 0
  for (const std of rawGraph.achievementStandards) {
    if (std.subject_id === 'sub_extra') continue
    const subject = contentSubjectOf(std.subject_id)
    for (const [field, cat] of [['knowledge', '지식⋅이해'], ['functions', '과정⋅기능'], ['competencies', '가치⋅태도']]) {
      const allowed = itemsInBand(std.subject_id, std.area, std.grade_band, fieldOf(cat))
      for (const item of std[field] ?? []) {
        total++
        const key = nk(item)
        if (allowed.has(key)) continue
        const kind = has(midSet, subject, cat, key) ? '중학교' : elemHas(subject, cat, key) ? '다른 학년군' : '내용체계에 없음'
        failures.push(`${std.code} ${cat}: "${item}" ← ${kind}`)
      }
    }
  }
  report('D4', '그래프 파일의 성취기준별 지식·이해/과정·기능/가치·태도가 해당 학년군 내용체계 항목', failures, { total })
}

{
  const failures = []
  let total = 0
  for (const ci of rawGraph.coreIdeas) {
    if (ci.subject_id === 'sub_extra') continue
    const subject = contentSubjectOf(ci.subject_id)
    for (const [field, cat] of [['knowledge', '지식⋅이해'], ['functions', '과정⋅기능']]) {
      for (const item of ci[field] ?? []) {
        total++
        const key = nk(item)
        if (elemHas(subject, cat, key)) continue
        failures.push(`${ci.id} ${cat}: "${item}" ← ${has(midSet, subject, cat, key) ? '중학교' : '초등 내용체계에 없음'}`)
      }
    }
  }
  report('D5', '그래프 파일의 핵심아이디어별 지식·이해/과정·기능이 초등 내용체계 항목', failures, { total })
}

{
  const failures = []
  const ids = new Set(rawGraph.nodes.map(n => n.id))
  let nullSource = 0
  for (const edge of rawGraph.edges) {
    if (edge.source === null) { nullSource++; continue }
    if (!ids.has(edge.source)) failures.push(`${edge.id} source ${edge.source} 없음`)
    if (!ids.has(edge.target)) failures.push(`${edge.id} target ${edge.target} 없음`)
  }
  const relTypes = new Set(Object.keys(rawGraph.metadata.relation_types ?? {}))
  for (const link of rawGraph.links_cross_subject) {
    if (!relTypes.has(link.relation_edu)) failures.push(`${link.id} relation_edu=${link.relation_edu} 미정의`)
  }
  report('D6', '엣지 참조 무결성 (관계 유형 정의, 노드 존재)', failures, { total: rawGraph.edges.length })
  report('D6b', '출발 노드가 null인 has_standard 엣지 (창체 핵심아이디어 미배정)', nullSource ? [`${nullSource}개 — 창의적 체험활동 성취기준은 핵심아이디어 없이 교과에 직접 매달림`] : [], { warn: true })
}

{
  const failures = []
  let total = 0
  for (const ci of rawGraph.coreIdeas) {
    if (ci.subject_id === 'sub_extra') continue
    const subject = contentSubjectOf(ci.subject_id)
    const pool = rawCoreIdeas.get(subject)?.get('*') ?? new Set()
    for (const idea of ci.ideas ?? []) {
      if (idea.length < 18 || !/다[.!?]?$/.test(idea.trim())) continue
      total++
      const key = nk(idea)
      if (![...pool].some(p => p.includes(key) || key.includes(p))) failures.push(`${ci.id}: "${idea.slice(0, 40)}…" 내용체계 핵심아이디어에 없음`)
    }
  }
  report('D7', '그래프 핵심아이디어 문장이 내용체계 핵심아이디어와 대응 (PDF 추출 차이는 경고)', failures, { warn: true, total })
}

{
  // 같은 교과·학년군 안에서 한 문장이 두 노드에 있으면 후보 목록 중복·Jev 확률 분산이 생긴다.
  // 파일은 sanitize 스크립트가 정리하고, 런타임(loadGraph)도 같은 규칙을 적용한다.
  const failures = findDuplicateCoreIdeaSentences(rawGraph)
    .map(dup => `${dup.subjectId} ${dup.band}: "${dup.idea.slice(0, 40)}…" ← ${[dup.keptNodeId, ...dup.removedNodeIds].join(' / ')}`)
  report('D8', '같은 교과·학년군 안에서 핵심아이디어 문장이 한 노드에만 있음 (npm run sanitize:knowledge-graph)', failures)
}

// ───────────────────────────── R. runtime code paths ─────────────────────────────
const graph = loadGraph()
{
  const failures = []
  if (!graph) failures.push('loadGraph() → null')
  else {
    if (graph.achievementStandards.length !== rawGraph.achievementStandards.length) failures.push(`loadGraph 성취기준 수 ${graph.achievementStandards.length} ≠ 파일 ${rawGraph.achievementStandards.length}`)
    for (const std of graph.achievementStandards) {
      if (std.subject_id === 'sub_extra') continue
      for (const [field, cat] of [['knowledge', '지식⋅이해'], ['functions', '과정⋅기능'], ['competencies', '가치⋅태도']]) {
        const allowed = itemsInBand(std.subject_id, std.area, std.grade_band, fieldOf(cat))
        for (const item of std[field] ?? []) {
          if (!allowed.has(nk(item))) failures.push(`${std.code} ${cat}: "${item}"`)
        }
      }
    }
  }
  report('R1', 'loadGraph()가 서빙하는 성취기준 목록이 학년군 내용체계 항목 (파일이 오염돼도 런타임 교체)', failures)
}

{
  const failures = []
  const records = loadElementaryContentSystems()
  if (records.length === 0) failures.push('loadElementaryContentSystems() → 0건')
  for (const record of records) {
    const subject = contentSubjectOf(record.subject)
    for (const band of record.gradeBands) if (!bandOf(band)) failures.push(`${record.id} gradeBands에 비초등 ${band}`)
    for (const [field, cat] of [['knowledge', '지식⋅이해'], ['functions', '과정⋅기능'], ['attitudes', '가치⋅태도']]) {
      for (const item of record[field]) {
        const prefix = bandPrefixOf(item)
        if (prefix && !bandOf(prefix)) { failures.push(`${record.subject}/${record.area} ${cat}: 비초등 접두사 "${item}"`); continue }
        const key = nk(stripBandPrefix(item))
        if (has(forbidden, subject, cat, key)) failures.push(`${record.subject}/${record.area} ${cat}: 금지 항목 "${item}"`)
        else if (prefix && !elemHas(subject, cat, key) && subject !== '창의적 체험활동') failures.push(`${record.subject}/${record.area} ${cat}: 초등 내용체계에 없는 "${item}"`)
      }
    }
  }
  report('R2', '초등 내용체계 레코드에 중학교 열·평면 목록 항목이 없음', failures, { total: records.length })
}

{
  const failures = []
  const mismatches = []
  for (const gradeGroup of GRADE_GROUPS) {
    const band = bandOf(gradeGroup)
    for (const record of loadContentSystemsForGradeGroup(gradeGroup)) {
      for (const field of ['knowledge', 'functions', 'attitudes']) {
        const items = filterContentItemsByGrade(record[field], gradeGroup)
        for (const item of items) {
          const prefix = bandPrefixOf(item)
          if (prefix && !bandOf(prefix)) failures.push(`${gradeGroup} ${record.subject}/${record.area} ${field}: "${item}"`)
          else if (prefix && prefix !== band) mismatches.push(`${gradeGroup} ${record.subject}/${record.area}: ${band} 열이 없어 다른 학년군 항목으로 복구`)
        }
      }
    }
  }
  report('R3', '/api/core-ideas 경로: 학년군 필터 결과에 비초등 항목 없음', failures)
  report('R3b', '학년군 필터가 빈 결과 대신 다른 초등 학년군으로 복구한 건 (설계상 허용, 참고)', dedupe(mismatches), { warn: true })
}

{
  const failures = []
  const bandMismatch = []
  const subjectsByName = [...new Set(loadElementaryContentEntries().map(e => e.subject))]
  for (const gradeGroup of GRADE_GROUPS) {
    const band = bandOf(gradeGroup)
    for (const subject of subjectsByName) {
      const entries = loadElementaryContentEntries().filter(e => e.subject === subject)
      const keywords = [...new Set(entries.flatMap(e => e.area.split(/[⋅·\s()]+/)).filter(k => k.length >= 2))].slice(0, 6)
      const hits = searchContentSystems({ keywords: [...keywords, ...SAMPLE_THEMES.slice(0, 4)], gradeGroup, targetSubjects: [subject], topK: 8, minScore: 1 })
      for (const hit of hits) {
        for (const field of ['knowledge', 'functions', 'attitudes']) {
          for (const item of hit[field].slice(0, 6)) {
            const prefix = bandPrefixOf(item)
            if (has(forbidden, contentSubjectOf(hit.subject), fieldCat(field), nk(stripBandPrefix(item)))) failures.push(`${gradeGroup} ${hit.subject}/${hit.area}: "${item}"`)
            if (prefix && prefix !== band) bandMismatch.push(`${gradeGroup} ${hit.subject}/${hit.area}: "${item}"`)
          }
        }
      }
      const text = buildContentSystemContext('A-2-1', [...keywords, ...SAMPLE_THEMES.slice(0, 4)], gradeGroup, [subject])
      scanText(text, `${gradeGroup} ${subject} [내용체계] 블록`, failures)
    }
  }
  report('R4', '채팅 [내용체계] 블록(searchContentSystems → 프롬프트)에 중학교·학년군 밖 항목 없음', dedupe(failures))
  report('R4b', '[내용체계] 블록의 항목이 프로젝트 학년군과 다른 초등 학년군', dedupe(bandMismatch), { warn: true })
}

{
  const failures = []
  const keywordSets = sampleKeywordSets(rawGraph)
  for (const gradeGroup of GRADE_GROUPS) {
    for (const keywords of keywordSets) {
      for (const std of searchStandards(keywords, gradeGroup, 20, 3)) {
        if (std.grade_band !== gradeGroup) failures.push(`${gradeGroup} 검색 결과에 ${std.code} (${std.grade_band})`)
        for (const [field, cat] of [['knowledge', '지식⋅이해'], ['functions', '과정⋅기능'], ['competencies', '가치⋅태도']]) {
          const allowed = itemsInBand(std.subject_id, std.area, std.grade_band, fieldOf(cat))
          for (const item of std[field] ?? []) if (std.subject_id !== 'sub_extra' && !allowed.has(nk(item))) failures.push(`${std.code} ${cat}: "${item}"`)
        }
      }
      for (const std of searchJsonStandards(keywords, gradeGroup, 20, 3)) {
        if (std.grade_band !== gradeGroup) failures.push(`${gradeGroup} JSON 검색 결과에 ${std.code} (${std.grade_band})`)
        for (const [field, cat] of [['knowledge', '지식⋅이해'], ['functions', '과정⋅기능'], ['competencies', '가치⋅태도']]) {
          const allowed = itemsInBand(std.subject_id, std.area, std.grade_band, fieldOf(cat))
          for (const item of std[field] ?? []) if (std.subject_id !== 'sub_extra' && !allowed.has(nk(item))) failures.push(`json ${std.code} ${cat}: "${item}"`)
        }
      }
    }
  }
  report('R5', '성취기준 검색(그래프·JSON)이 프로젝트 학년군만 반환하고 목록이 학년군 내용체계 항목', dedupe(failures))
}

{
  const failures = []
  const keywordSets = sampleKeywordSets(rawGraph)
  let generated = 0
  for (const gradeGroup of GRADE_GROUPS) {
    for (const activity of CONTEXT_ACTIVITIES) {
      for (const keywords of keywordSets) {
        const messages = [{ role: 'user', content: `이번 수업 주제는 ${keywords.join(' ')} 입니다. ${keywords.join(', ')} 관련 성취기준을 찾아주세요.` }]
        const text = buildCurriculumContext(activity, messages, gradeGroup, undefined, null, [])
        if (!text) continue
        generated++
        scanText(text, `${gradeGroup} ${activity} [${keywords.join(',')}]`, failures)
        for (const line of text.split('\n')) {
          const match = line.match(/→ (지식·이해|과정·기능|가치·태도): (.+)$/)
          if (!match) continue
          for (const item of match[2].split(', ')) {
            const hit = forbiddenText.find(f => f.cat === match[1].replace('·', '⋅') && f.item === nk(item))
            if (hit) failures.push(`${gradeGroup} ${activity}: "→ ${match[1]}" 줄에 금지 항목 "${item}" (${hit.subject})`)
          }
        }
      }
    }
  }
  report('R6', `채팅 컨텍스트(buildCurriculumContext, ${generated}건 생성)에 중학교·학년군 밖 항목 없음`, dedupe(failures))
}

{
  const failures = []
  const bySubject = new Map()
  for (const std of graph?.achievementStandards ?? []) {
    if (std.subject_id === 'sub_extra') continue
    const key = `${std.subject_id}|${std.grade_band}`
    if (!bySubject.has(key)) bySubject.set(key, std)
  }
  for (const [key, center] of bySubject) {
    const gradeGroup = key.split('|')[1]
    const partner = [...bySubject.values()].find(s => s.grade_band === gradeGroup && s.subject_id !== center.subject_id)
    const saved = {
      centerNode: { id: center.id, label: center.code, subjectId: center.subject_id, text: center.text },
      selectedStandards: partner ? [{ id: partner.id, label: partner.code, subjectId: partner.subject_id, text: partner.text }] : [],
      agentNotes: [],
    }
    const text = buildCurriculumContext('A-2-1', [], gradeGroup, undefined, saved, [])
    scanText(text, `${gradeGroup} A-2-1 그래프 저장 경로 (${center.code})`, failures)
    for (const line of text.split('\n')) {
      const match = line.match(/✅ (지식·이해|과정·기능|가치·태도): (.+)$/)
      if (!match || match[2].startsWith('(')) continue
      for (const item of match[2].split(', ')) {
        const prefix = bandPrefixOf(item)
        if (prefix && prefix !== bandOf(gradeGroup)) failures.push(`${gradeGroup} ${center.code}: 확정 매핑에 다른 학년군 "${item}"`)
        if (forbiddenText.some(f => f.cat === match[1].replace('·', '⋅') && f.item === nk(stripBandPrefix(item)))) failures.push(`${gradeGroup} ${center.code}: 확정 매핑에 금지 항목 "${item}"`)
      }
    }
  }
  report('R7', 'A-2-1 확정 매핑(그래프 저장 데이터 경로)이 프로젝트 학년군 내용체계 항목만 인용', dedupe(failures))
}

// ───────────────────────────── summary ─────────────────────────────
const failed = results.filter(r => r.status === 'FAIL')
const warned = results.filter(r => r.status === 'WARN')
console.log('')
console.log(`검증 결과: ${results.length - failed.length - warned.length} PASS / ${warned.length} WARN / ${failed.length} FAIL`)
if (failed.length > 0) {
  console.log('실패 항목: ' + failed.map(r => r.id).join(', '))
  process.exitCode = 1
}

function fieldCat(field) {
  return { knowledge: '지식⋅이해', functions: '과정⋅기능', attitudes: '가치⋅태도', competencies: '가치⋅태도' }[field]
}
function dedupe(items) {
  return [...new Set(items)]
}
/** Keyword sets: 2 standards per (subject, band) using their own keywords + generic themes. */
function sampleKeywordSets(g) {
  const sets = []
  const seen = new Map()
  for (const std of g.achievementStandards) {
    const key = `${std.subject_id}|${std.grade_band}`
    const n = seen.get(key) ?? 0
    if (n >= 2) continue
    seen.set(key, n + 1)
    const kws = (std.keywords ?? []).filter(k => k.length >= 2).slice(0, 3)
    if (kws.length) sets.push(kws)
  }
  for (const theme of SAMPLE_THEMES) sets.push([theme])
  return sets
}
