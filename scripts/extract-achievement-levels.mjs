// 2022 개정 교육과정 성취수준 PDF(학년군 3종) → data/achievement-levels/*.json
//
// 각 교과의 "가. 성취기준별 성취수준" 표에서 성취기준 코드별 A·B·C 서술을 뽑는다.
//
// 읽는 순서 주의: 표가 쪽을 넘어가면 "이어지는 행"이 텍스트 스트림에서는 그 쪽의
// 다른 표보다 뒤에 나온다. 스트림을 그대로 읽으면 이어지는 B·C 수준이 엉뚱한
// 성취기준에 붙는다(1~2학년군 p24에서 [2국05-03]의 이어지는 행이 [2국06-02]에 붙음).
// y로 정렬해도 성취기준 칸이 세로 가운데 정렬이라 자기 A보다 아래에 오는 등 행이
// 어긋난다. 그래서 스트림 순서를 유지하되, 줄의 x로 열을 구분해
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
// 앱 런타임용 단일 파일(커밋됨). data/는 배포 번들에 실리지 않으므로 public/에 둔다
// (scripts/sync-runtime-assets.mjs 머리말 참고). 파일명은 NFC/NFD 문제를 피해 ASCII.
const RUNTIME_OUT = 'public/achievement-levels.json'
const SUBJECTS = ['국어', '수학', '바른 생활', '슬기로운 생활', '즐거운 생활', '통합교과', '사회', '도덕', '과학', '체육', '음악', '미술', '영어', '실과']

// 성취기준 칸·제목은 x0≈79~90, 수준/서술 칸은 x0≥166 (세 학년군 공통).
const LEFT_COLUMN_MAX_X0 = 120

/**
 * 페이지별 텍스트 줄(스트림 순서, 줄마다 x0).
 * 블록 단위 x0로는 열을 못 가른다: 성취기준 칸과 A 수준 칸이 한 블록으로 묶이는 표가 있어
 * (3~4 p193 [4영01-06]) 블록 x0만 보면 A 서술까지 왼쪽 칸으로 판정된다.
 */
function pdfLines(file) {
  const py = `
import fitz, json, sys
d = fitz.open(sys.argv[1])
pages = []
for i in range(d.page_count):
    lines = []
    for b in d[i].get_text('dict')['blocks']:
        for l in b.get('lines', []):
            raw = ''.join(s['text'] for s in l['spans'])
            text = raw.strip()
            if text:
                lines.append({'x0': l['bbox'][0], 'text': text, 'sp': raw != raw.rstrip()})
    pages.append(lines)
print(json.dumps(pages, ensure_ascii=False))
`
  return JSON.parse(execFileSync('python3', ['-c', py, file], { maxBuffer: 1 << 28 }).toString())
}

/**
 * 한 쪽의 줄에 열 정보(왼쪽 칸 여부)와 이음 문자열을 붙인다.
 * 줄 끝 공백 = 단어 경계. 공백 없이 끝난 줄은 단어 중간에서 끊긴 것이라("나타나는 긍⏎정적")
 * 다음 줄과 붙여 써야 한다. 모든 줄을 공백으로 이으면 "긍 정적"이 된다.
 */
function pageLines(lines) {
  return lines.map(l => ({ text: l.text, piece: l.sp ? `${l.text} ` : l.text, left: l.x0 < LEFT_COLUMN_MAX_X0 }))
}

const SECTION_ON = /^가\.\s*성취기준별 성취수준/
const SECTION_OFF = /^(나\.\s*영역별 성취수준|다\.\s*(수행평가\s*)?예시 평가\s*도구)/
const CODE_RE = /^\[(\d[가-힣]{1,3}\d{2}-\d{2})\]\s*(.*)$/
const TABLE_HEADER_RE = /^성취기준(\s+성취기준별 성취수준)?$|^성취기준별 성취수준$/
// 영역 제목은 두 단계다: "(1) 수와 연산"(대영역) 아래 "① 네 자리 이하의 수"(소영역).
// 소영역 번호는 사설 영역 글리프다(U+F02B1=①…). 10 이상은 글리프 두 개가 두 줄로 찍힌다
// (3~4 p74: "U+F02BA" 줄 + "U+F02C3 무게" 줄 = "⑩ 무게"). 글리프만 있는 줄은 버린다.
const AREA_RE = /^\(\d+\)\s*(.+)$/
const SUB_AREA_RE = /^[\u{f02b1}-\u{f02cf}①-⑳]\s*(.+)$/u
const GLYPH_ONLY_RE = /^[\u{f0000}-\u{fffff}\s]+$/u

function isChrome(t) {
  if (!t) return true
  if (GLYPH_ONLY_RE.test(t)) return true
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
  const parts = text.split(/(?<=다\.)\s*(?=[가-힣])/).map(s => s.trim()).filter(Boolean)
  return parts.length === 3 ? parts : null
}

const tidy = (t) => t.replace(/\s+/g, ' ').trim()

function extractBand({ band, file }) {
  const pages = pdfLines(file)
  const records = []
  let inSection = false
  let subject = ''
  let area = ''
  let subArea = ''
  let current = null
  let level = null
  let pending = []

  // 수준 서술 끝이 단어 중간인지 기억한다 — 다음 쪽에서 이어 붙일 때 공백 여부를 정한다.
  const levelOpenMidWord = new Map()
  const flushLevel = () => {
    if (current && level && level.text.length) {
      const raw = level.text.join('')
      const text = tidy(raw)
      if (text) {
        current.levels[level.key] = current.levels[level.key] ? `${current.levels[level.key]} ${text}` : text
        levelOpenMidWord.set(`${current.code}:${level.key}`, !/\s$/.test(raw))
      }
    }
    level = null
  }
  // 수준 글자 없이 남은 서술 = 쪽을 넘어간 수준 서술의 뒷부분(1~2 p24 [2국05-03] A,
  // 5~6 p59 [6도03-03] B). 문장이 끝나지 않은 수준에 이어 붙인다. 버리면 서술이 중간에 끊긴다.
  const settlePending = () => {
    if (!current || !pending.length || Object.keys(current.levels).length === 0) return
    const open = ['A', 'B', 'C'].find(k => current.levels[k] && !/다\.$/.test(current.levels[k]))
    if (open) {
      const glue = levelOpenMidWord.get(`${current.code}:${open}`) ? '' : ' '
      current.levels[open] = tidy(`${current.levels[open]}${glue}${pending.join('')}`)
      pending = []
    }
  }
  const closeRecord = () => {
    flushLevel()
    settlePending()
    if (current && Object.keys(current.levels).length === 0 && pending.length) {
      const three = splitThree(tidy(pending.join('')))
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
    for (const { text: t, piece, left } of pageLines(pages[pi])) {
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
        const first = piece.slice(piece.indexOf(']') + 1).replace(/^\s+/, '')
        current = { code: `[${codeMatch[1]}]`, subject, area, subArea, standardText: [first], levels: {}, pages: [pi + 1] }
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
        settlePending()
        pending = []
        current = pageStartRecord
        area = current.area
        subArea = current.subArea ?? ''
      }

      // 왼쪽 칸 줄은 성취기준 원문이다. 열려 있는 수준에 넣으면 원문 조각이 서술에 섞인다
      // (3~4 p193 [4영01-06] A 끝의 "정보를 파악한다.").
      if (level && !left) { level.text.push(piece); continue }
      if (!current) continue
      if (!current.pages.includes(pi + 1)) current.pages.push(pi + 1)
      // 수준 표시 전 구간: 성취기준 문장이 끝나기 전이면 문장에, 끝난 뒤면 (글자 없는 표의) 서술에.
      // "다$"로 끝을 판정하면 "우리 사회에 다⏎양한"처럼 단어 중간 줄바꿈에서 원문이 잘린다.
      // 원문이 끝난 뒤의 왼쪽 칸 줄은 부가 정보다(과학 "탐구 활동 •…", 수학 각주 "3) …") → 버린다.
      if (!/다\.$/.test(tidy(current.standardText.join('')))) current.standardText.push(piece)
      else if (!left) pending.push(piece)
    }
  }
  closeRecord()

  const byCode = {}
  for (const r of records) {
    // 각주 번호("덧셈과 뺄셈3)의")는 원문이 아니다 — 한글 바로 뒤 "숫자)"만 지운다.
    r.standardText = tidy(r.standardText.join('')).replace(/(?<=[가-힣])\d\)/g, '')
    const prev = byCode[r.code]
    if (!prev) { byCode[r.code] = r; continue }
    for (const k of ['A', 'B', 'C']) if (r.levels[k] && !prev.levels[k]) prev.levels[k] = r.levels[k]
    for (const p of r.pages) if (!prev.pages.includes(p)) prev.pages.push(p)
  }
  return { band, source: path.basename(file), standards: Object.values(byCode) }
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const summary = []
const runtime = {}
for (const b of BANDS) {
  const { band, source, standards } = extractBand(b)
  for (const s of standards) {
    runtime[s.code] = {
      band,
      subject: s.subject,
      A: s.levels.A,
      B: s.levels.B,
      C: s.levels.C,
      ...(s.levelsInferred ? { inferred: true } : {}),
    }
  }
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

const sources = BANDS.map(b => path.basename(b.file))
fs.writeFileSync(RUNTIME_OUT, JSON.stringify({
  source: '교육부·한국교육과정평가원, 2022 개정 교육과정에 따른 성취수준(초등 1~2·3~4·5~6학년군)',
  files: sources,
  count: Object.keys(runtime).length,
  standards: runtime,
}) + '\n')
console.log(`runtime: ${RUNTIME_OUT} (${Object.keys(runtime).length} codes)`)
