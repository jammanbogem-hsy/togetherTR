// v2 성취기준 임베딩 생성기 → public/embeddings_v2.json
//
// v1(public/embeddings_cache.json)은 성취기준 "문장만" 임베딩했다. 그래서 문장에
// 없는 낱말로 찾으면 코사인이 거의 무의미해지고("이슬" 검색에 수학·영어가 섞임)
// 교과 무관 성취기준과 점수 차가 사라졌다. v2 는 성취기준마다 수업 설계용 문서
// (교과·영역·학년군 / 핵심아이디어 / 성취기준 / 지식·이해 / 과정·기능 / 키워드 / 성취수준 A)를
// 만들어 임베딩한다. 문서 조립은 buildStandardDocument 가 담당한다.
//
// v1 파일은 건드리지 않는다 — /api/knowledge-graph 등 다른 라우트가 계속 쓴다.
//
// 저장 위치가 public/ 인 이유: Next 16 + Firebase frameworks 는 data/** 를 함수
// 번들에 넣지 않는다(scripts/sync-runtime-assets.mjs 머리말에 실측 기록).
// data/ 에 두면 배포 후 조용히 v1 로 폴백해 이 개선이 사라진다.
//
// 실행: npm run build:curriculum-embeddings   (627건 × text-embedding-3-small)
import fs from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'

// 빌드 스크립트는 Next 환경 밖이라 .env.local 이 주입되지 않는다
// (scripts/eval/luna-run.mjs 와 같은 방식). 이미 설정된 값은 덮어쓰지 않는다.
try {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local 없으면 셸 환경변수를 그대로 쓴다 */ }

import { loadGraph } from '@/lib/curriculum/graphReader'
import { loadElementaryContentSystems } from '@/lib/curriculum/contentSystemReader'
import { canonicalSubjectName } from '@/lib/curriculum/subjectAliases'
import {
  buildStandardDocument,
  coreIdeaSentence,
  pickStandardLevels,
  standardBandLabel,
  subjectDisplayName,
} from '@/lib/curriculum/curriculumMap'

const OUT_PATH = path.join(process.cwd(), 'public', 'embeddings_v2.json')
const MODEL = 'text-embedding-3-small'
const BATCH_SIZE = 64
/** 좌표 소수점 — 5자리면 코사인 차이가 1e-5 미만이고 파일이 절반으로 줄어든다. */
const VECTOR_PRECISION = 5
const HARD_CAP_BYTES = 12 * 1024 * 1024

function fail(message) {
  console.error(`[build-curriculum-embeddings] ${message}`)
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')
if (!dryRun && !process.env.OPENAI_API_KEY) {
  fail('OPENAI_API_KEY 가 없습니다. 문서만 확인하려면 --dry-run 을 쓰세요.')
}

const startedAt = performance.now()
const graph = loadGraph()
if (!graph) fail('elementary_knowledge_graph.json 을 찾을 수 없습니다.')

// ─── 내용체계 조회표 (교과·영역 → 지식·이해 / 과정·기능) ────────────────────

const contentSystems = loadElementaryContentSystems()
const contentBySubjectArea = new Map()
for (const record of contentSystems) {
  const key = `${canonicalSubjectName(record.subject)}\u0000${(record.area ?? '').trim()}`
  // 같은 키가 여러 레코드로 쪼개져 있으면 항목을 합친다(중복은 제거).
  const existing = contentBySubjectArea.get(key)
  if (existing) {
    existing.knowledge.push(...record.knowledge)
    existing.functions.push(...record.functions)
  } else {
    contentBySubjectArea.set(key, {
      knowledge: [...record.knowledge],
      functions: [...record.functions],
    })
  }
}

function contentFor(subjectName, area) {
  const key = `${canonicalSubjectName(subjectName)}\u0000${(area ?? '').trim()}`
  return contentBySubjectArea.get(key) ?? { knowledge: [], functions: [] }
}

// ─── 성취수준 (코드로만 매칭) ───────────────────────────────────────────────

const LEVELS_PATH = path.join(process.cwd(), 'public', 'achievement-levels.json')
if (!fs.existsSync(LEVELS_PATH)) fail(`성취수준 파일이 없습니다: ${path.relative(process.cwd(), LEVELS_PATH)}`)
const levelStandards = JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf-8')).standards ?? {}

// ─── 문서 조립 ──────────────────────────────────────────────────────────────

const standards = graph.achievementStandards
const documents = standards.map(std => {
  const subject = subjectDisplayName(std.subject_id, graph.subjects.find(s => s.id === std.subject_id)?.name_ko)
  const band = standardBandLabel(std)
  const group = std.core_idea_id ? graph.coreIdeas.find(ci => ci.id === std.core_idea_id) : undefined
  const content = contentFor(subject, std.area)
  // 내용체계 원문(학년군 접두사 포함)이 1순위. 없으면 그래프 핵심아이디어 노드의
  // 목록(접두사 없음, applyElementaryContentLists 가 이미 정화한 것)을 쓴다.
  const knowledge = content.knowledge.length > 0 ? content.knowledge : (group?.knowledge ?? [])
  const functions = content.functions.length > 0 ? content.functions : (group?.functions ?? [])
  return {
    id: std.id,
    text: buildStandardDocument({
      subject,
      area: std.area ?? '',
      band,
      coreIdea: coreIdeaSentence(std, graph),
      code: std.code ?? '',
      text: std.text ?? '',
      knowledge,
      functions,
      keywords: std.keywords ?? [],
      levels: pickStandardLevels(levelStandards, std.code ?? ''),
    }),
  }
})

const emptyDocs = documents.filter(doc => !doc.text.trim())
if (emptyDocs.length > 0) fail(`문서가 빈 성취기준 ${emptyDocs.length}건: ${emptyDocs.slice(0, 3).map(d => d.id).join(', ')}`)

const docChars = documents.reduce((sum, doc) => sum + doc.text.length, 0)
console.log(`[build-curriculum-embeddings] 문서 ${documents.length}건 · 평균 ${Math.round(docChars / documents.length)}자 · 최대 ${Math.max(...documents.map(d => d.text.length))}자`)

if (dryRun) {
  console.log('--- 예시 문서 ---')
  for (const id of ['sub_sci_6과06-02', 'sub_math_6수01-08']) {
    const doc = documents.find(d => d.id === id)
    if (doc) console.log(`\n[${doc.id}]\n${doc.text}`)
  }
  console.log('\n(--dry-run: 임베딩 호출 없이 종료)')
  process.exit(0)
}

// ─── 임베딩 ─────────────────────────────────────────────────────────────────

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const vectors = new Map()
let calls = 0

for (let start = 0; start < documents.length; start += BATCH_SIZE) {
  const batch = documents.slice(start, start + BATCH_SIZE)
  let response
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await client.embeddings.create({ model: MODEL, input: batch.map(doc => doc.text) })
      break
    } catch (error) {
      if (attempt === 2) fail(`임베딩 실패 (배치 ${start}): ${error instanceof Error ? error.message : String(error)}`)
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
    }
  }
  calls += 1
  if (response.data.length !== batch.length) fail(`배치 ${start}: 응답 ${response.data.length} ≠ 요청 ${batch.length}`)
  batch.forEach((doc, index) => {
    const vector = response.data[index].embedding
    vectors.set(doc.id, vector.map(value => Number(value.toFixed(VECTOR_PRECISION))))
  })
  process.stdout.write(`\r  임베딩 ${Math.min(start + BATCH_SIZE, documents.length)}/${documents.length}`)
}
process.stdout.write('\n')

// ─── 쓰기 ───────────────────────────────────────────────────────────────────

const docs = {}
// 성취기준 순서를 고정해 재빌드 시 파일 순서가 흔들리지 않게 한다.
for (const doc of documents) {
  const vector = vectors.get(doc.id)
  if (!vector) fail(`벡터 누락: ${doc.id}`)
  docs[doc.id] = { vector, text: doc.text }
}

const asset = { model: MODEL, builtAt: new Date().toISOString(), docs }
fs.writeFileSync(OUT_PATH, JSON.stringify(asset), 'utf-8')
const bytes = fs.statSync(OUT_PATH).size
const dims = new Set(Object.values(docs).map(d => d.vector.length))

console.log('[build-curriculum-embeddings] 완료')
console.log(`  출력      : ${path.relative(process.cwd(), OUT_PATH)} (${(bytes / 1024 / 1024).toFixed(2)} MB / 한도 12 MB)`)
console.log(`  문서      : ${Object.keys(docs).length} · 차원 ${[...dims].join(',')} · 소수 ${VECTOR_PRECISION}자리`)
console.log(`  API 호출  : ${calls}회 (배치 ${BATCH_SIZE}) · 모델 ${MODEL}`)
console.log(`  총 소요   : ${Math.round((performance.now() - startedAt) / 1000)}s`)

if (bytes > HARD_CAP_BYTES) fail(`12MB 한도를 넘었습니다 (${(bytes / 1024 / 1024).toFixed(2)} MB).`)
