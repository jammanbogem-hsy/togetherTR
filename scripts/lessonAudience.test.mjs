import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { lessonAudienceBands, lessonAudiencePrompt, lessonDifficultyIssues, buildLessonTeachingContext } from '../src/lib/curriculum/lessonAudience.ts'
import { normalizeGraphRelationType, DEFAULT_GRAPH_RELATION_TYPE } from '../src/lib/knowledge-graph/domain.ts'

const bad = '3차시 국어에서 NASA와 과학 논문 요약본을 읽고 주장 근거를 수집한다. 4차시 기후변화 원인 찬반 입장에 따라 의견문(600자)을 작성한다.'
const good = '교사가 준비한 우리 지역의 기온 그림 자료 두 장을 보고 달라진 점을 이야기한다. 과학에서는 간단한 기온 표를 읽고, 국어에서는 문장 틀을 참고해 학교에서 실천할 일과 그 이유를 짧게 써서 친구와 나눈다.'
const center = { id: 'science', code: '4과16-03', grade_band: '초3-4', subject_id: 'sub_sci', text: '기후변화 대응 방법을 조사하고, 생활 속에서 기후변화 대응 방법을 실천할 수 있다.', keywords: [], functions: [], competencies: [] }
const candidate = { id: 'korean', code: '4국03-03', grade_band: '초3-4', subject_id: 'sub_kor', text: '대상에 대한 자신의 의견과 그렇게 생각한 이유가 드러나게 글을 쓴다.', keywords: [], functions: [], competencies: [] }
function load(file, bindings, extra = {}) {
  const exports = {}
  const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(js, { exports, console: { error() {} }, performance, process: { env: { ANTHROPIC_API_KEY: 'mock-key' }, cwd: () => '/fixture' }, require: name => { assert.ok(name in bindings, name); return bindings[name] }, ...extra })
  return exports
}
function fixture({ drafts = [good], audienceScores = [1], judge = true, oldCache = {} } = {}) {
  const prompts = [], judgeCalls = [], cacheWrites = []
  let call = 0, verification = 0
  const audienceModule = { lessonAudienceBands, lessonAudiencePrompt, lessonDifficultyIssues, LESSON_AUDIENCE_VERSION: 'elementary-lesson-v2' }
  const fakeJev = {
    isJevConfigured: () => judge,
    systemOne: async (state, questions, options) => {
      judgeCalls.push({ state, questions, options })
      const audience = audienceScores[Math.min(verification, audienceScores.length - 1)]
      if (questions.a0) verification++
      return { elapsedMs: 1, answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => [key,
        q.type === 'choice' ? { type: 'choice', choice: 'r3', confidence: 1 } :
        q.type === 'score' ? { type: 'score', score: 3, confidence: 1 } :
        { type: 'noul', noul: key.startsWith('a') ? audience : 1 }])) }
    },
  }
  const judges = load('src/lib/curriculum/jevJudge.ts', { '@/lib/curriculum/jev': fakeJev, './lessonAudience': audienceModule })
  const FakeAnthropic = class {
    messages = { create: async ({ messages }) => {
      prompts.push(messages[0].content)
      const draft = drafts[Math.min(call++, drafts.length - 1)]
      if (draft instanceof Error) throw draft
      return { content: [{ type: 'text', text: JSON.stringify({ relations: [{ index: 1, relationType: '내용-표현', score: .8, explanation: '기후변화 대응을 생활 속 실천 의견 쓰기로 연결한다.', ideas: ['기온 그림 자료로 실천할 일 고르기'], teachingNote: draft }] }) }] }
    } }
  }
  const relation = load('src/lib/curriculum/ontologyRelation.ts', {
    '@anthropic-ai/sdk': FakeAnthropic, '@/lib/llm/anthropic': { resolveClaudeModel: () => 'mock-model' },
    fs: { existsSync: () => true, readFileSync: () => JSON.stringify(oldCache), writeFileSync: (_p, data) => cacheWrites.push(JSON.parse(data)) }, path, 'node:crypto': crypto,
    '@/lib/knowledge-graph/domain': { normalizeGraphRelationType, DEFAULT_GRAPH_RELATION_TYPE }, '@/lib/curriculum/jevJudge': judges, './lessonAudience': audienceModule,
  })
  const graph = { achievementStandards: [center, candidate], coreIdeas: [] }
  const route = load('src/app/api/ontology/relate/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/curriculum/graphReader': { loadGraph: () => graph }, '@/lib/curriculum/ontologyRelation': relation,
  })
  const post = async (body = {}) => {
    const response = await route.POST({ json: async () => ({ theme: '기후위기', gradeGroup: '초3-4', centerId: 'science', candidateIds: ['korean'], artifactContext: '최종 선정 주제: 우리 학교의 기후위기 대응. 기온 자료를 읽고 실천할 일을 짧게 제안한다.', ...body }) })
    assert.equal(response.status, 200)
    return response.body.relations[0]
  }
  return { post, prompts, judgeCalls, cacheWrites, graph }
}

test('lesson audience: grade-band aliases and standards supply explicit, distinct elementary activity guidance', () => {
  assert.deepEqual(lessonAudienceBands('초3-4', [{ code: '[4국03-03]' }]), ['3-4학년군'])
  assert.deepEqual(lessonAudienceBands(undefined, [{ code: '2슬01-03' }, { code: '6국03-03' }]), ['1-2학년군', '5-6학년군'])
  assert.match(lessonAudiencePrompt('초1-2'), /놀이·그림·말하기/)
  assert.match(lessonAudiencePrompt('초3-4'), /자료 2~3개/)
  assert.match(lessonAudiencePrompt('초5-6'), /근거를 든 문단/)
  assert.match(lessonAudiencePrompt(), /학년군 미확인/)
})

test('lesson audience: screenshot overload is caught without rejecting teacher-adapted NASA pictures', () => {
  assert.equal(lessonDifficultyIssues(bad, '3-4학년군').length, 2)
  assert.deepEqual(lessonDifficultyIssues('교사가 NASA의 사진과 기상청 기온 표를 쉬운 한국어로 제공하고 학생이 달라진 점을 말한다.', '3-4학년군'), [])
  assert.deepEqual(lessonDifficultyIssues('교사가 과학 논문을 참고해 어린이용 그림 카드로 재구성한다.', '3-4학년군'), [])
  assert.deepEqual(lessonDifficultyIssues('과학 논문을 직접 읽게 하지 않는다.', '3-4학년군'), [])
  assert.equal(lessonDifficultyIssues('의견문(600자)을 쓴다.', undefined, [{ code: '4국03-03' }]).length, 1)
})

test('actual relate route → generator → verifier repairs the screenshot example using transmitted audience and context', async () => {
  const f = fixture({ drafts: [bad, good] })
  const result = await f.post()
  assert.equal(result.teachingNote, good)
  assert.equal(result.source, 'claude')
  assert.equal(f.prompts.length, 2)
  for (const prompt of f.prompts) {
    assert.match(prompt, /3-4학년군/)
    assert.match(prompt, /문장 틀/)
    assert.match(prompt, /최종 선정 주제: 우리 학교의 기후위기 대응/)
    assert.doesNotMatch(prompt, /TV 시청률|가짜뉴스 사례 3건|천편일률 금지/)
  }
  const verify = f.judgeCalls.find(c => c.questions.a0)
  assert.match(verify.questions.a0.instructions.학년별_기준, /3-4학년군/)
  assert.match(verify.state.교사_수업맥락, /기온 자료/)
  assert.equal(verify.options.maxRetries, 0)
  assert.doesNotMatch(JSON.stringify(f.cacheWrites.at(-1)), /논문 요약본|600자/)
})

test('semantic age/topic rejection causes repair even when both standards are covered', async () => {
  const f = fixture({ drafts: ['전문 용어가 많은 부적합한 탐구 수업', good], audienceScores: [.1, 1] })
  const result = await f.post()
  assert.equal(f.prompts.length, 2)
  assert.equal(result.teachingNote, good)
  assert.equal(result.verified, 1)
})

test('failed or still-inappropriate repairs never return/cache the rejected lesson, and can retry', async () => {
  for (const drafts of [[bad, bad], [bad, new Error('provider unavailable')]]) {
    const f = fixture({ drafts, judge: false })
    const result = await f.post()
    assert.equal(result.source, 'rule'); assert.equal(result.verified, 0)
    assert.match(result.teachingNote, /다시 생성/)
    assert.doesNotMatch(result.teachingNote, /논문|600자/)
    assert.deepEqual(Object.keys(f.cacheWrites.at(-1)), [])
    const count = f.prompts.length; await f.post(); assert.ok(f.prompts.length > count)
  }
  const f = fixture({ audienceScores: [.1, .1] })
  assert.equal((await f.post()).source, 'rule')
})

test('cache is versioned and varies with grade, full topic, curriculum and teacher context', async () => {
  const f = fixture({ oldCache: { '기후위기::korean||science': { teachingNote: bad, source: 'claude' } } })
  await f.post(); assert.equal(f.prompts.length, 1, 'legacy unrestricted lesson ignored')
  await f.post(); assert.equal(f.prompts.length, 1, 'same inputs reuse checked result')
  await f.post({ gradeGroup: '초5-6' }); assert.equal(f.prompts.length, 2)
  await f.post({ artifactContext: '같은 주제, 다른 학생 활동과 도움 수준' }); assert.equal(f.prompts.length, 3)
  await f.post({ theme: '기후위기'.repeat(50) + '폭염' }); await f.post({ theme: '기후위기'.repeat(50) + '폭우' }); assert.equal(f.prompts.length, 5)
  f.graph.achievementStandards[1] = { ...candidate, text: '교사가 새로 선택한 성취기준 원문' }
  await f.post(); assert.equal(f.prompts.length, 6)
  await f.post({ force: true }); assert.equal(f.prompts.length, 7)
})

test('server falls back to standard grade metadata when legacy request omitted the audience', async () => {
  const f = fixture()
  await f.post({ gradeGroup: undefined })
  assert.match(f.prompts[0], /선택 학년군: 3-4학년군/)
  assert.match(f.prompts[0], /4과16-03: 3-4학년군/)
})


test('teacher sheet descriptions are retained alongside final topic, without recycling the old AI example', () => {
  const context = buildLessonTeachingContext('최종 선정 주제: 우리 학교의 기후위기 대응', [{subject:'국어', standard:'[4국03-03] 의견과 이유', description:'실천할 일을 골라 짧은 문장으로 적기', agentLessonExample:bad}])
  assert.match(context, /최종 선정 주제/)
  assert.match(context, /4국03-03.*실천할 일/)
  assert.doesNotMatch(context, /논문|600자/)
  assert.equal(buildLessonTeachingContext(undefined, []), undefined)
})

test('actual graph hook forwards audience and teacher context through automatic, manual and popup generation', async () => {
  const requests = []
  const state = []
  const react = {useCallback: fn => fn, useEffect: () => {}, useRef: value => ({current:value}), useState: initial => {
    const index = state.push(initial) - 1
    return [initial, next => {state[index] = typeof next === 'function' ? next(state[index]) : next}]
  }}
  const {useGraphData} = load('src/components/knowledge-graph/useGraphData.ts', {
    react, '@/lib/knowledge-graph/domain': {normalizeGraphRelationType, DEFAULT_GRAPH_RELATION_TYPE}, './constants': {normCode:s=>s},
  }, {fetch:async (_url, init) => {requests.push(JSON.parse(init.body)); return {json:async()=>({relations:[{sourceId:'science',targetId:'korean',standardId:'korean',source:'rule',teachingNote:'다시 생성해 주세요.'}]})}}})
  const graph = useGraphData({keyword:'기후위기', gradeGroup:'3-4학년군', artifactContext:'최종 선정 주제: 학교 실천', algoMode:'keyword',svgWidth:800,svgHeight:600,nodesRef:{current:[{id:'science',type:'standard'},{id:'korean',type:'standard'}]},edgesRef:{current:[]},chatMentionedCodes:[],applyCheckedStandards:()=>{}})
  graph.runClaudeAnalysis('science')
  graph.runAnalysis('science')
  graph.analyzePopupNode('korean','science',true)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(requests.length,3)
  for(const request of requests) {
    assert.equal(request.gradeGroup,'3-4학년군')
    assert.equal(request.artifactContext,'최종 선정 주제: 학교 실천')
    assert.equal(request.theme,'기후위기')
  }
  assert.equal(state[4].get('korean||science').source,'rule','failed generation is not relabeled as successful AI output')
})
