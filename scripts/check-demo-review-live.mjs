// Explicit, billable diagnostic: no Firestore writes and no project approvals.
// node --env-file=.env.local scripts/check-demo-review-live.mjs --live
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import OpenAI from 'openai'

if (!process.argv.includes('--live')) throw new Error('실제 모델 호출에는 --live가 필요합니다.')
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 필요합니다.')
function load(file, dependencies = {}) {
  const mod = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: name => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unknown dependency ${name}`)
  } })
  return mod.exports
}
const meta = load('src/types/index.ts')
const contracts = load('src/lib/activity/demo-contracts.ts', { '@/types': meta })
const types = load('src/lib/demo/engine/types.ts', { '@/types': meta, '@/lib/activity/demo-contracts': contracts })
const prompts = load('src/lib/demo/engine/prompts.ts', { '@/types': meta, '@/lib/activity/demo-contracts': contracts, './types': types })
const config = {
  personas: [
    ['김하늘 선생님', '과학·수학', '동일 조건의 측정과 자료 해석'],
    ['이도윤 선생님', '사회·국어', '역사적 필요와 근거 있는 표현'],
    ['박서연 선생님', '특수·통합교육', '다양한 표현 방식과 교사 부담 최소화'],
  ].map(([displayName, subject, priority], index) => ({ id: `teacher-${index + 1}`, displayName, subject, priority, career: '초등 교사 7년', strengths: [priority], collaborationStyle: '실제 근거를 비교하고 구체적인 수정안을 제안한다.', summary: priority, color: '#2F6FED', emoji: '🌱' })),
  lesson: { title: '측우기와 데이터', topic: '측정과 근거 있는 제안', overview: '동일 조건에서 강우를 비교하고 학교 텃밭 물 주기 계획을 제안한다.', schoolLevel: '초등학교', gradeGroup: '초5-6', subjects: ['과학', '수학', '사회'], totalSessions: 4, goals: ['측정 조건을 비교하고 자료를 근거로 설명한다.'], learnerContext: '표현 능력과 자료 해석 경험이 다양하다.', constraints: ['실제 학생 관찰 결과를 생성하지 않는다.'], dataPlan: '합성 강우 데이터임을 표시한다.' },
}
// Constructed regression fixture, NOT a copy of the project's saved artifact.
const candidateArtifact = { activityCode: 'T-1-2', title: '설계 방향', content: { '설계 방향': `| 번호 | 설계 원칙 | 비전 연결 근거 | 멈춤 신호 |
| --- | --- | --- | --- |
| 1 | 공정하게 비교하려면 측정 조건과 단위를 통일해야 한다. | 김하늘의 동일 조건 측정과 공동 비전의 근거 있는 판단을 연결한다. | 비교 불가능한 조건 차이가 확인되면 보류하고 조건을 재검토한다. |
| 2 | 역사와 자료를 연결하려면 측우기 기록의 필요를 설명하고 자료로 주장을 뒷받침해야 한다. | 이도윤의 역사적 맥락과 기록을 활용한 설명을 공동 탐구에 연결한다. | 자료 출처가 불명확하거나 합성 자료를 실제 기록으로 오인할 때 보류한다. |
| 3 | 모든 학생이 참여하는 수업이 되려면 말·글·그림 중 표현 방식을 선택하게 해야 한다. | 박서연의 접근성과 공동 비전의 참여 기회를 반영한다. | 표현 방식 때문에 판단 근거를 드러낼 기회가 배제되면 보류한다. |
| 4 | 실행 가능한 공동 수업이 되려면 네 차시 안에서 하나의 공통 산출물을 함께 설계해야 한다. | 교사 부담을 줄이고 교과를 따로 나누지 않는 공동 비전을 반영한다. | 특정 교사에게 과업이 쏠리거나 총 차시를 초과하면 보류한다. |

각 멈춤 조건은 교사 누구나 제기하고 해당 조건이 해결되었는지 팀이 재검토한다. 세부 업무 배분은 다음 활동, 학생용 자료·검증 도구의 구체화는 설계·개발 단계에서 협의한다.` } }
const discussion = []
for (const step of contracts.getDemoActivityContract('T-1-2').steps) {
  discussion.push({ phase: 'orchestrator-intro', speakerId: 'orchestrator', speakerName: '총괄 AI', stepId: step.id, content: '설계 원칙과 비전 근거, 멈춤 조건을 함께 제안해주세요.' })
  for (const teacher of config.personas) discussion.push({ phase: 'teacher-contribution', speakerId: teacher.id, speakerName: teacher.displayName, stepId: step.id, content: `${teacher.priority}를 원칙으로 삼고 그 조건이 깨질 때 멈추고 싶습니다.` })
}
for (const teacher of config.personas) discussion.push({ phase: 'teacher-response', speakerId: teacher.id, speakerName: teacher.displayName, content: '교과별로 따로 설계하기보다 하나의 학생 수행과 공동 산출물에 연결합시다.' })
discussion.push({ phase: 'orchestrator-synthesis', speakerId: 'orchestrator', speakerName: '총괄 AI', content: '공동 비전과 교사 제안을 반영한 원칙 4개입니다.', round: 0 })
for (const teacher of config.personas) discussion.push({ phase: 'teacher-review', speakerId: teacher.id, speakerName: teacher.displayName, content: '재개 제출 파일명, 확인자 이름과 날짜, 모의검증 인원을 원칙 표에 추가해주세요.', round: 0, review: { decision: 'revise', reason: '재개 심사 서식과 검증 인원 명시가 필요합니다.' } })
discussion.push({ phase: 'orchestrator-revision', speakerId: 'orchestrator', speakerName: '총괄 AI', content: '설계 원칙과 멈춤 조건은 보존했습니다. 파일명·심사 서식·검증 인원은 후속 활동의 제안으로 분리했습니다. 활동 기준에 따라 다시 검토해주세요.', round: 1 })
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 })
const model = process.env.OPENAI_DEMO_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o'
const results = await Promise.all(config.personas.map(async teacher => {
  const input = types.parseDemoTurnInput({ phase: 'teacher-review', activityCode: 'T-1-2', teacherId: teacher.id, config, priorArtifacts: {}, discussion, candidateArtifact, round: 1 })
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: prompts.buildDemoTurnInstructions(input) }, { role: 'user', content: prompts.buildDemoTurnInput(input) }],
    response_format: { type: 'json_schema', json_schema: { name: 'demo_review_regression', strict: true, schema: prompts.buildDemoTurnResponseSchema(input) } },
    ...(model.startsWith('gpt-5') ? { max_completion_tokens: 8192, reasoning_effort: 'medium' } : { max_tokens: 4096, temperature: 0.5 }),
  }, { timeout: 110_000 })
  const parsed = types.parseDemoTurnModelOutput(JSON.parse(response.choices[0]?.message?.content ?? ''), input)
  return { teacher: teacher.displayName, ...parsed.review }
}))
console.log(JSON.stringify({ diagnostic: 'constructed T-2 regression fixture; no project writes', model, reasoningEffort: model.startsWith('gpt-5') ? 'medium' : null, results }, null, 2))
if (results.some(result => result.decision !== 'approve')) process.exitCode = 1
