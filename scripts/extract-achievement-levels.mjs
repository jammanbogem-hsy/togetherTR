// 2022 개정 교육과정 성취수준 PDF(학년군 3종) → data/achievement-levels/*.json
//
// 각 교과의 "가. 성취기준별 성취수준" 표에서 성취기준 코드별 A·B·C 서술을 뽑는다.
//
// 읽는 순서 주의: 표가 쪽을 넘어가면 "이어지는 행"이 텍스트 스트림에서는 그 쪽의
// 다른 표보다 뒤에 나온다. 스트림을 그대로 읽으면 이어지는 B·C 수준이 엉뚱한
// 성취기준에 붙는다(1~2학년군 p24에서 [2국05-03]의 이어지는 행이 [2국06-02]에 붙음).
// y로 정렬해도 성취기준 칸이 세로 가운데 정렬이라 자기 A보다 아래에 오는 등 행이
// 어긋난다. 그래서 스트림 순서를 유지하되, 블록의 x로 열을 구분해
// "수준이 이미 찬 성취기준 뒤에 코드 없는 왼쪽 칸이 오면 앞 쪽에서 넘어온 행"
// 으로 판정해 직전 쪽의 열린 성취기준으로 되돌린다.
//
// "나. 영역별 성취수준"(영역 단위 서술)과 "다. 예시 평가 도구"(문항 예시의
// '관련 성취기준' 인용)는 성취기준별 수준이 아니므로 제외한다 — 포함하면 다른
// 학년군 코드까지 섞인다(5~6 문서 안의 [4과02-01] 등).
//
// 실행: node scripts/extract-achievement-levels.mjs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const BANDS = [
  { band: '1-2학년군', file: 'data/2022개정교육과정에따른성취수준(1~2학년군).pdf' },
  { band: '3-4학년군', file: 'data/2022개정교육과정에따른성취수준(3~4학년군).pdf' },
  { band: '5-6학년군', file: 'data/2022개정교육과정에따른성취수준(5~6학년군).pdf' },
]
const OUT_DIR = 'data/achievement-levels'
const SUBJECTS = ['국어', '수학', '바른 생활', '슬기로운 생활', '즐거운 생활', '통합교과', '사회', '도덕', '과학', '체육', '음악', '미술', '영어', '실과']

// 성취기준 칸·제목은 x0≈79~90, 수준/서술 칸은 x0≥166 (세 학년군 공통).
const LEFT_COLUMN_MAX_X0 = 120

/** 페이지별 텍스트 블록(bbox + 텍스트). */
function pdfBlocks(file) {
  const py = `
import fitz, json, sys
d = fitz.open(sys.argv[1])
pages = []
for i in range(d.page_count):
    blocks = []
    for b in d[i].get_text('blocks'):
        text = b[4].strip()
        if text:
            blocks.append({'x0': b[0], 'y0': b[1], 'x1': b[2], 'y1': b[3], 'text': text})
    pages.append(blocks)
print(json.dumps(pages, ensure_ascii=False))
`
  return JSON.parse(execFileSync('python3', ['-c', py, file], { maxBuffer: 1 << 28 }).toString())
}

/** 한 쪽의 블록을 스트림 순서 그대로 줄 단위로 펴되, 열 정보(왼쪽 칸 여부)를 남긴다. */
function pageLines(blocks) {
  return blocks.flatMap(b => b.text.split('\n').map(line => ({ text: line.trim(), left: b.x0 < LEFT_COLUMN_MAX_X0 })))
}

const SECTION_ON = /^가\.\s*성취기준별 성취수준/
const SECTION_OFF = /^(나\.\s*영역별 성취수준|다\.\s*(수행평가\s*)?예시 평가\s*도구)/
const CODE_RE = /^\[(\d[가-힣]{1,3}\d{2}-\d{2})\]\s*(.*)$/
const TABLE_HEADER_RE = /^성취기준(\s+성취기준별 성취수준)?$|^성취기준별 성취수준$/
// 영역 제목은 두 단계다: "(1) 수와 연산"(대영역) 아래 "① 네 자리 이하의 수"(소영역).
const AREA_RE = /^\(\d+\)\s*(.+)$/
const SUB_AREA_RE = /^[\u{f02b1}-\u{f02b9}①-⑨]\s*(.+)$/u

function isChrome(t) {
  if (!t) return true
  if (/^\d{1,3}$/.test(t)) return true
  if (/^(성취기준|성취기준별 성취수준|성취기준별 성취수준 진술|영역별 성취수준|평가기준)$/.test(t)) return true
  if (/^Ⅲ\s*\.?\s*교과별 성취수준$/.test(t) || t === 'Ⅲ교과별 성취수준') return true
  if (/^2022 개정 교육과정에 따른/.test(t)) return true
  if (/^※/.test(t)) return true                       // 표 안 주석
  if (/^포함하여 성취수준 개발$/.test(t)) return true   // 위 주석의 둘째 줄
  return false
}

/** 수준 글자가 없는 표(사회 일부): 서술 3개가 이어진다 → 문장 단위로 A·B·C. */
function splitThree(text) {
  const parts = text.split(/(?<=다\.)\s+(?=[가-힣])/).map(s => s.trim()).filter(Boolean)
  return parts.length === 3 ? parts : null
}

const tidy = (t) => t.replace(/\s+/g, ' ').trim()

function extractBand({ band, file }) {
  const pages = pdfBlocks(file)
  const records = []
  let inSection = false
  let subject = ''
  let area = ''
  let subArea = ''
  let current = null
  let level = null
  let pending = []

  const flushLevel = () => {
    if (current && level && level.text.length) {
      const text = tidy(level.text.join(' '))
      if (text) current.levels[level.key] = current.levels[level.key] ? `${current.levels[level.key]} ${text}` : text
    }
    level = null
  }
  const closeRecord = () => {
    flushLevel()
    if (current && Object.keys(current.levels).length === 0 && pending.length) {
      const three = splitThree(tidy(pending.join(' ')))
      if (three) {
        current.levels = { A: three[0], B: three[1], C: three[2] }
        current.levelsInferred = true   // 원문에 A·B·C 글자가 없어 문장 순서로 배정
      }
    }
    pending = []
    current = null
  }

  for (let pi = 0; pi < pages.length; pi += 1) {
    const pageStartRecord = current   // 이 쪽을 시작할 때 열려 있던 성취기준(쪽을 넘어온 행의 주인)
    let tableJustStarted = false
    for (const { text: t, left } of pageLines(pages[pi])) {
      if (SECTION_ON.test(t)) { closeRecord(); inSection = true; continue }
      if (SECTION_OFF.test(t)) { closeRecord(); inSection = false; continue }
      if (!inSection) { if (SUBJECTS.includes(t)) subject = t; continue }
      if (SUBJECTS.includes(t)) { closeRecord(); subject = t; continue }
      // 표 머리글 = 새 표의 시작. 바로 뒤에 코드 없이 수준 칸이 오면 앞 쪽에서 넘어온 행이다
      // (3~4 p40: [4사04-02]의 C가 성취기준 칸 없이 새 표의 첫 행으로 인쇄된다).
      if (TABLE_HEADER_RE.test(t)) { tableJustStarted = true; continue }
      if (isChrome(t)) continue

      // 영역 제목은 성취기준을 닫지 않는다. 스트림에서 영역 제목이 그 쪽의 "이어지는 행"보다
      // 먼저 나오는 경우가 있어(3~4 p40의 [4사04-02] C 행), 닫아 버리면 이어지는 수준을 잃는다.
      const areaMatch = t.match(AREA_RE)
      if (areaMatch) { area = areaMatch[1].trim(); subArea = ''; continue }
      const subAreaMatch = t.match(SUB_AREA_RE)
      if (subAreaMatch) { subArea = subAreaMatch[1].trim(); continue }

      const codeMatch = t.match(CODE_RE)
      if (codeMatch) {
        tableJustStarted = false
        closeRecord()
        current = { code: `[${codeMatch[1]}]`, subject, area, subArea, standardText: [codeMatch[2]], levels: {}, pages: [pi + 1] }
        records.push(current)
        continue
      }
      if (/^[ABC]$/.test(t)) {
        // 새 표의 첫 행이 코드 없이 수준으로 시작하면 앞 쪽에서 넘어온 성취기준의 행이다.
        if (tableJustStarted && pageStartRecord && current !== pageStartRecord) { flushLevel(); current = pageStartRecord }
        tableJustStarted = false
        flushLevel()
        if (current) level = { key: t, text: [] }
        continue
      }

      // 코드 없는 왼쪽 칸: 지금 성취기준의 수준이 이미 찼다면 새 행 = 앞 쪽에서 넘어온 성취기준.
      if (left && current && Object.keys(current.levels).length > 0 && pageStartRecord && pageStartRecord !== current) {
        flushLevel()
        current = pageStartRecord
        area = current.area
        subArea = current.subArea ?? ''
      }

      if (level) { level.text.push(t); continue }
      if (!current) continue
      if (!current.pages.includes(pi + 1)) current.pages.push(pi + 1)
      // 수준 표시 전 구간: 성취기준 문장이 끝나기 전이면 문장에, 끝난 뒤면 (글자 없는 표의) 서술에.
      if (!/다\.$|다$|있다\.$/.test(tidy(current.standardText.join(' ')))) current.standardText.push(t)
      else pending.push(t)
    }
  }
  closeRecord()

  const byCode = {}
  for (const r of records) {
    r.standardText = tidy(r.standardText.join(' '))
    const prev = byCode[r.code]
    if (!prev) { byCode[r.code] = r; continue }
    for (const k of ['A', 'B', 'C']) if (r.levels[k] && !prev.levels[k]) prev.levels[k] = r.levels[k]
    for (const p of r.pages) if (!prev.pages.includes(p)) prev.pages.push(p)
  }
  return { band, source: path.basename(file), standards: Object.values(byCode) }
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const summary = []
for (const b of BANDS) {
  const { band, source, standards } = extractBand(b)
  const out = { band, source, builtAt: new Date().toISOString(), count: standards.length, standards }
  fs.writeFileSync(path.join(OUT_DIR, `성취수준-${band}.json`), JSON.stringify(out, null, 2) + '\n')
  summary.push({
    band,
    codes: standards.length,
    withABC: standards.filter(s => s.levels.A && s.levels.B && s.levels.C).length,
    inferred: standards.filter(s => s.levelsInferred).length,
    incomplete: standards.filter(s => !(s.levels.A && s.levels.B && s.levels.C)).length,
  })
}
console.table(summary)
