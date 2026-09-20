// gpt-5-mini(현재, reasoning minimal) vs gpt-5.6-luna 성능 비교 — 실제 앱 프롬프트(buildSystemPrompt) 사용.
// 측정: TTFT, 총 지연, 토큰(입력/출력/추론/캐시), finish_reason, 신호 태그, 성취기준 코드 환각, 내부 코드 누출.
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
process.chdir(REPO)
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const { buildSystemPrompt } = await import(path.join(REPO, 'src/lib/prompts/system.ts'))
const { loadGraph } = await import(path.join(REPO, 'src/lib/curriculum/graphReader.ts'))
const OpenAI = (await import(path.join(REPO, 'node_modules/openai/index.mjs'))).default
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const OUT_DIR = process.argv[2] ?? '.'

const graph = loadGraph()
const validCodes = new Set(graph.achievementStandards.map(s => s.code.replace(/[\[\]]/g, '')))

const project = { title: '우리 지역 물 문제 탐구 프로젝트', schoolLevel: '초등학교', targetGradeGroup: '초5-6', targetSubjects: ['사회', '과학', '국어'], mode: 'team', isA23Completed: false, currentCycle: 1, previousCycleImprovements: undefined }
const team = '김교사(사회, 호스트), 이교사(과학), 박교사(국어)'

const SCENARIOS = [
  { id: 'T11-keywords', stage: 'T', activity: 'T-1-1', label: 'T-1 비전 키워드 수집 중', history: [
    { role: 'assistant', content: '먼저 각자 우리 팀 수업의 비전을 떠올리게 하는 키워드를 3~5개씩 적어 주세요.' },
    { role: 'user', content: '[김교사] 저는 협력, 탐구, 지역사회, 실천 네 가지요.' },
  ] },
  { id: 'T11-confirm', stage: 'T', activity: 'T-1-1', label: 'T-1 비전 확정 → 다음 활동 신호', history: [
    { role: 'assistant', content: '세 분의 키워드를 묶어 비전 후보 3안을 제안합니다.\n1안: "지역의 문제를 함께 탐구하고 실천하는 시민으로 자란다" (협력·탐구·지역사회·실천 반영)\n2안: "질문으로 시작해 행동으로 끝나는 배움" (탐구·실천·주도성 반영)\n3안: "서로의 다름을 힘으로 바꾸는 협력 학습" (협력·존중·소통 반영)\n어느 안이 가장 마음에 드시나요? 수정 의견도 좋습니다.' },
    { role: 'user', content: '[김교사] 1안이 좋아요. [이교사] 저도 1안이요. [박교사] 1안으로 확정하고 다음으로 가죠.' },
  ] },
  { id: 'T22-rules', stage: 'T', activity: 'T-2-2', label: 'T-4 팀 규칙 초안 요청', history: [
    { role: 'user', content: '[김교사] 우리 팀 규칙 5개 정도 초안을 만들어 주세요. 갈등 상황 규칙도 하나 넣어 주세요.' },
  ] },
  { id: 'A12-topic', stage: 'A', activity: 'A-1-2', label: 'A-2 주제 제안 평가', history: [
    { role: 'user', content: '[이교사] 우리 지역 하천 물 문제를 주제로 하면 어떨까요? 비전이랑 잘 맞는지 봐 주세요.' },
  ], confirmedArtifacts: { 'T-1-1': { title: '팀 비전', content: { vision: '지역의 문제를 함께 탐구하고 실천하는 시민으로 자란다', keywords: ['협력', '탐구', '지역사회', '실천'] }, status: 'confirmed' } } },
  { id: 'A21-standards', stage: 'A', activity: 'A-2-1', label: 'A-3 성취기준 추천 (환각 검사)', history: [
    { role: 'user', content: '[김교사] 이 주제에 맞는 사회과 5-6학년군 성취기준을 코드와 함께 3개 추천해 주세요.' },
  ], confirmedArtifacts: { 'A-1-2': { title: '주제 선정', content: { selectedTopic: '우리 지역의 물 문제와 해결 방안', targetSubjects: ['사회', '과학', '국어'] }, status: 'confirmed' } } },
  { id: 'Ds11-eval', stage: 'Ds', activity: 'Ds-1-1', label: 'Ds-1 평가 설계 시작', history: [
    { role: 'user', content: '[박교사] 평가를 먼저 설계하라고 하셨는데, 우리 주제로 어떤 수행과제를 평가하면 좋을지 방향을 잡아 주세요.' },
  ], confirmedArtifacts: { 'A-1-2': { title: '주제 선정', content: { selectedTopic: '우리 지역의 물 문제와 해결 방안' }, status: 'confirmed' }, 'A-2-2': { title: '통합 목표', content: { goal: '지역 물 문제의 원인을 조사하고 해결 방안을 제안하는 캠페인을 실행한다' }, status: 'confirmed' } } },
]

const MODELS = [
  { id: 'gpt-5-mini', label: 'gpt-5-mini(minimal, 현재)', params: { max_completion_tokens: 8192, reasoning_effort: 'minimal' } },
  { id: 'gpt-5.6-luna', label: 'luna(none)', params: { max_completion_tokens: 8192, reasoning_effort: 'none' } },
  { id: 'gpt-5.6-luna', label: 'luna(low)', params: { max_completion_tokens: 8192, reasoning_effort: 'low' } },
]

function analyze(text, scenario) {
  const signals = [...text.matchAll(/\[(ACTIVITY_ADVANCE|ACTIVITY_RETURN|ARTIFACT_UPDATE|TEAM_DISCUSSION_READY)[^\]]*\]/g)].map(m => m[0].slice(0, 60))
  const codes = [...new Set([...text.matchAll(/\[?(\d[가-힣A-Za-z]+\d{2}-\d{2})\]?/g)].map(m => m[1]))]
  const hallucinated = codes.filter(c => !validCodes.has(c))
  const stripped = text.replace(/\[(ACTIVITY_ADVANCE|ACTIVITY_RETURN|ARTIFACT_UPDATE|TEAM_DISCUSSION_READY)[^\]]*\]/g, '')
  const internalLeak = [...new Set([...stripped.matchAll(/\b(T|A|Ds|DI|E)-\d-\d\b/g)].map(m => m[0]))]
  return { signals, codes, hallucinated, internalLeak, chars: text.length }
}

async function runOne(scenario, model) {
  const system = buildSystemPrompt(scenario.stage, scenario.activity, project, 'teacher', undefined, null, team, scenario.confirmedArtifacts, 'active')
  const t0 = performance.now(); let ttft = null; let text = ''; let finish = null; let usage = null; let error = null
  try {
    const stream = await openai.chat.completions.create({ model: model.id, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'system', content: system }, ...scenario.history], ...model.params })
    for await (const chunk of stream) {
      const d = chunk.choices?.[0]?.delta?.content ?? ''
      if (d && ttft == null) ttft = Math.round(performance.now() - t0)
      text += d
      if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason
      if (chunk.usage) usage = chunk.usage
    }
  } catch (e) { error = e?.message ?? String(e) }
  const total = Math.round(performance.now() - t0)
  return { scenario: scenario.id, label: scenario.label, model: model.label, modelId: model.id, params: model.params, ttft, total, finish, error, usage, text, ...analyze(text, scenario), systemChars: system.length }
}

const results = []
const queue = []
for (const s of SCENARIOS) for (const m of MODELS) queue.push([s, m])
const CONCURRENCY = 3
async function worker() { while (queue.length) { const [s, m] = queue.shift(); const r = await runOne(s, m); results.push(r); console.log(`${s.id.padEnd(14)} ${m.label.padEnd(24)} ttft=${r.ttft}ms total=${r.total}ms finish=${r.finish} in=${r.usage?.prompt_tokens} cached=${r.usage?.prompt_tokens_details?.cached_tokens ?? '-'} out=${r.usage?.completion_tokens} reason=${r.usage?.completion_tokens_details?.reasoning_tokens ?? '-'} chars=${r.chars} signals=${r.signals.length} halluc=${r.hallucinated.length} leak=${r.internalLeak.length}${r.error ? ' ERROR ' + r.error.slice(0, 80) : ''}`) } }
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
fs.writeFileSync(path.join(OUT_DIR, 'chat-results.json'), JSON.stringify(results, null, 2))
console.log('saved chat-results.json')
