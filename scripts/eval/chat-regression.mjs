// 채팅 퍼실리테이션 회귀 (하이브리드 2단계 게이트): 실제 buildSystemPrompt + buildCurriculumContext +
// 실제 신호 파서(src/lib/chat/signals.ts)로 20 시나리오의 기대 신호·형식·환각·길이를 검사한다.
// 실행: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/eval/chat-regression.mjs [출력폴더] [모델=...]
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
process.chdir(REPO)
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }
const OUT_DIR = process.argv[2] ?? path.join(REPO, 'docs', 'eval-2026-09-20')
const ONLY = process.argv.find(a => a.startsWith('model='))?.slice(6)

const { buildSystemPrompt } = await import(path.join(REPO, 'src/lib/prompts/system.ts'))
const { buildCurriculumContext } = await import(path.join(REPO, 'src/lib/curriculum/contextInject.ts'))
const { loadGraph } = await import(path.join(REPO, 'src/lib/curriculum/graphReader.ts'))
const { parseActivityAdvance, parseActivityReturn, parseArtifactUpdates } = await import(path.join(REPO, 'src/lib/chat/signals.ts'))
const { generationParams } = await import(path.join(REPO, 'src/lib/llm/openai.ts'))
const OpenAI = (await import(path.join(REPO, 'node_modules/openai/index.mjs'))).default
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const validCodes = new Set(loadGraph().achievementStandards.map(s => s.code.replace(/[\[\]]/g, '')))

const project = { title: '우리 지역 물 문제 탐구 프로젝트', schoolLevel: '초등학교', targetGradeGroup: '초5-6', targetSubjects: ['사회', '과학', '국어'], mode: 'team', isA23Completed: false, currentCycle: 1, previousCycleImprovements: undefined }
const team = '김교사(사회, 호스트), 이교사(과학), 박교사(국어)'
const VISION = '지역의 문제를 함께 탐구하고 실천하는 시민으로 자란다'
const artT = { 'T-1-1': { title: '팀 비전', content: { '팀 공통 비전': VISION }, status: 'confirmed' } }
const artA = { ...artT, 'A-1-2': { title: '주제 선정', content: { selectedTopic: '우리 지역의 물 문제와 해결 방안', targetSubjects: ['사회', '과학', '국어'] }, status: 'confirmed' } }
const artDs = { ...artA, 'A-2-2': { title: '통합 목표', content: { goal: '지역 물 문제의 원인을 조사하고 해결 방안을 제안하는 캠페인을 실행한다' }, status: 'confirmed' } }
const ai = c => ({ role: 'assistant', content: c }); const u = c => ({ role: 'user', content: c })

// expect: advance(코드|null) · ret(코드|null) · artifact(true|false|undefined=무관) · minChars/maxChars · codesOnlyValid(항상)
const S = [
  { id: 'T11-keywords', stage: 'T', act: 'T-1-1', history: [ai('먼저 각자 비전 키워드를 3~5개씩 적어 주세요.'), u('[김교사] 협력, 탐구, 지역사회, 실천이요.')], expect: { advance: null, artifact: false } },
  { id: 'T11-cluster', stage: 'T', act: 'T-1-1', history: [ai('각자 비전 키워드를 3~5개씩 적어 주세요.'), u('[김교사] 협력, 탐구, 지역사회, 실천'), u('[이교사] 호기심, 실험, 데이터, 협력'), u('[박교사] 표현, 소통, 공감, 실천'), u('[김교사] 세 명 다 냈으니 묶어서 비전 후보를 제안해 주세요.')], expect: { advance: null, artifact: false, contains: /1안|후보|군집|묶|공통|구조/ } },
  { id: 'T11-saveA', stage: 'T', act: 'T-1-1', history: [ai(`세 분 모두 1안 "${VISION}"에 동의하셨습니다.\n> **지금 할 일**\n> 팀 비전을 산출물로 저장할까요?\n**A안:** "이 내용으로 산출물에 저장하겠습니다"\n**B안:** "조금 더 다듬고 저장하겠습니다"`), u('[김교사] A안: 이 내용으로 산출물에 저장하겠습니다')], expect: { advance: null, artifact: true, artifactKey: /비전/ } },
  { id: 'T11-next', stage: 'T', act: 'T-1-1', confirmed: artT, history: [ai('팀 비전을 저장했습니다. 확정 버튼으로 확정해 주세요.'), u('[김교사] 확정했어요. 다음 활동으로 넘어가요.')], expect: { advance: 'T-1-2', artifact: false, maxChars: 260 } },
  { id: 'T12-principles', stage: 'T', act: 'T-1-2', confirmed: artT, history: [u('[이교사] 비전을 이루려면 우리가 어떤 원칙을 지켜야 할지 초안을 같이 만들어 봐요. 저는 "학생이 직접 조사하려면 교사가 답을 먼저 주지 말아야 한다"부터요.')], expect: { advance: null, artifact: false } },
  { id: 'T21-roles', stage: 'T', act: 'T-2-1', confirmed: artT, history: [u('[박교사] 저는 글쓰기 지도와 발표 준비를 맡고 싶어요. [이교사] 저는 실험·데이터 정리요. [김교사] 저는 지역 조사와 일정 관리요. 과업을 정리해 주세요.')], expect: { advance: null, artifact: false } },
  { id: 'T22-rules', stage: 'T', act: 'T-2-2', confirmed: artT, history: [u('[김교사] 우리 팀 규칙 5개 정도 초안을 만들어 주세요. 갈등 상황 규칙도 하나 넣어 주세요.')], expect: { advance: null, artifact: false } },
  { id: 'T22-saveA', stage: 'T', act: 'T-2-2', confirmed: artT, history: [ai('세 분이 합의한 규칙 5개입니다.\n1. 회의 24시간 전 안건 공유\n2. 의견은 끝까지 듣고 반대할 때 대안 제시\n3. 회의 시간 60분 엄수\n4. 업무가 몰리면 솔직히 알리고 나누기\n5. 갈등 시 비전과 학생 이익을 기준으로 재논의\n**A안:** "이 내용으로 산출물에 저장하겠습니다"\n**B안:** "조금 더 다듬고 저장하겠습니다"'), u('[박교사] A안: 이 내용으로 산출물에 저장하겠습니다')], expect: { advance: null, artifact: true, artifactKey: /규칙/ } },
  { id: 'T23-schedule', stage: 'T', act: 'T-2-3', confirmed: artT, history: [u('[김교사] 수업 실행일은 11월 20일이에요. 역산해서 일정 잡아 주세요. 정기 회의는 매주 수요일 3시 30분이 좋겠어요.')], expect: { advance: null, artifact: false, contains: /11월|예비/ } },
  { id: 'T23-nextA', stage: 'T', act: 'T-2-3', confirmed: artT, history: [ai('일정을 저장했습니다. 확정 후 다음으로 갈 준비가 되면 말씀해 주세요.'), u('[김교사] 확정했습니다. 이제 A단계로 넘어가죠.')], expect: { advance: null, artifact: false, contains: /점검|체크리스트/ } },  // T-2-3 절차: 이동 의사 → 먼저 T단계 체크리스트, ADVANCE 는 다음 턴
  { id: 'A11-skip', stage: 'A', act: 'A-1-1', confirmed: artT, history: [u('[김교사] 우리 학교는 주제가 이미 "지역 물 문제"로 정해져 있어서 주제 선정 기준 활동은 건너뛰고 싶어요.')], expect: { advance: 'A-1-2', artifact: false } },
  { id: 'A12-topic', stage: 'A', act: 'A-1-2', confirmed: artT, history: [u('[이교사] 우리 지역 하천 물 문제를 주제로 하면 어떨까요? 비전이랑 잘 맞는지 봐 주세요.')], expect: { advance: null, artifact: false } },
  { id: 'A12-saveA', stage: 'A', act: 'A-1-2', confirmed: artT, history: [ai('세 분이 "우리 지역의 물 문제와 해결 방안"을 최종 주제로 합의하셨습니다. 선정 근거: 비전의 지역사회·탐구·실천과 직결.\n**A안:** "이 내용으로 산출물에 저장하겠습니다"\n**B안:** "조금 더 다듬고 저장하겠습니다"'), u('[김교사] A안: 이 내용으로 산출물에 저장하겠습니다')], expect: { advance: null, artifact: true, artifactKey: /주제/ } },
  { id: 'A21-standards', stage: 'A', act: 'A-2-1', confirmed: artA, curriculum: true, history: [u('[김교사] 이 주제에 맞는 사회과 5-6학년군 성취기준을 코드와 함께 3개 추천해 주세요.')], expect: { advance: null, artifact: false, minCodes: 1 } },
  { id: 'A22-goal', stage: 'A', act: 'A-2-2', confirmed: artA, curriculum: true, history: [u('[이교사] 세 교과를 아우르는 통합 목표 문장을 함께 만들어 봐요. 초안 하나 제안해 주세요.')], expect: { advance: null, artifact: false } },
  { id: 'Ds11-eval', stage: 'Ds', act: 'Ds-1-1', confirmed: artDs, history: [u('[박교사] 평가를 먼저 설계하라고 하셨는데, 우리 주제로 어떤 수행과제를 평가하면 좋을지 방향을 잡아 주세요.')], expect: { advance: null, artifact: false } },
  { id: 'Ds11-return', stage: 'Ds', act: 'Ds-1-1', confirmed: artDs, history: [u('[김교사] 잠깐요, 통합 목표를 다시 손보고 싶어요. A-4 통합 목표 활동으로 돌아가 주세요.')], expect: { advance: null, ret: 'A-2-2', artifact: false } },
  { id: 'Ds12-activities', stage: 'Ds', act: 'Ds-1-2', confirmed: artDs, history: [u('[이교사] 하천 수질 조사 실험을 학습활동으로 넣고 싶은데, 과학 관점에서 어떤 활동이 목표와 잘 이어질까요?')], expect: { advance: null, artifact: false } },
  { id: 'DI11-lesson', stage: 'DI', act: 'DI-1-1', confirmed: artDs, history: [u('[김교사] 1차시 도입 부분을 어떻게 시작하면 좋을지 아이디어를 주세요.')], expect: { advance: null, artifact: false } },
  { id: 'offtopic', stage: 'T', act: 'T-1-1', history: [u('[박교사] 오늘 회식 장소는 어디로 할까요?')], expect: { advance: null, artifact: false, maxChars: 600 } },
]

const MODELS = [
  { key: 'gpt-5-mini', model: 'gpt-5-mini', effort: { raw: 'minimal' } },
  { key: 'luna-low', model: 'gpt-5.6-luna', effort: { raw: 'low' } },
].filter(m => !ONLY || m.key === ONLY || m.model === ONLY)

function check(text, finish, s) {
  const problems = []
  const adv = parseActivityAdvance(text); const ret = parseActivityReturn(text); const art = parseArtifactUpdates(text)
  const e = s.expect
  if (e.advance !== undefined && (adv?.nextActivity ?? null) !== e.advance) problems.push(`advance=${adv?.nextActivity ?? 'none'} (기대 ${e.advance ?? 'none'})`)
  if (e.ret !== undefined && (ret?.targetActivity ?? null) !== e.ret) problems.push(`return=${ret?.targetActivity ?? 'none'} (기대 ${e.ret})`)
  if (e.artifact === true && art.updates.length === 0) problems.push('ARTIFACT_UPDATE 없음')
  if (e.artifact === false && art.updates.length > 0) problems.push('불필요한 ARTIFACT_UPDATE')
  if (e.artifactKey && art.updates.length && !art.updates.some(up => Object.keys(up.sections).some(k => e.artifactKey.test(k)))) problems.push(`산출물 키 불일치: ${art.updates.map(up => Object.keys(up.sections).join(',')).join(';')}`)
  if (adv && art.updates.length) problems.push('ADVANCE 와 ARTIFACT_UPDATE 동시 방출')
  if (finish === 'length') problems.push('출력 절단(length)')
  const clean = art.cleanText.replace(/\[(ACTIVITY_ADVANCE|ACTIVITY_RETURN|TEAM_DISCUSSION_READY|HELP_CARD|ACTION_CARD|ARTIFACT_CONFIRM)[^\]]*\]/g, '')
  if (/ARTIFACT_UPDATE|ACTIVITY_ADVANCE|ACTIVITY_RETURN/.test(clean)) problems.push('신호 이름을 본문에 언급')
  const leak = [...new Set([...clean.matchAll(/\b(T|A|Ds|DI|E)-\d-\d\b/g)].map(m => m[0]))]
  if (leak.length) problems.push(`내부 코드 노출 ${leak.join(',')}`)
  const codes = [...new Set([...clean.matchAll(/\[?(\d[가-힣A-Za-z]+\d{2}-\d{2})\]?/g)].map(m => m[1]))]
  const bad = codes.filter(c => !validCodes.has(c)); if (bad.length) problems.push(`성취기준 코드 환각 ${bad.join(',')}`)
  if (e.minCodes && codes.length < e.minCodes) problems.push(`성취기준 코드 ${codes.length}개 (기대 ≥${e.minCodes})`)
  if (e.contains && !e.contains.test(clean)) problems.push(`기대 내용 없음 ${e.contains}`)
  const len = clean.length
  // 전진·복귀·저장 응답은 절차상 한두 줄 + 신호만 허용되므로 최소 길이를 보지 않는다
  const signalled = Boolean(adv || ret || art.updates.length)
  if (!signalled && len < (e.minChars ?? 40)) problems.push(`너무 짧음 ${len}자`)
  if (len > (e.maxChars ?? 3200)) problems.push(`너무 김 ${len}자`)
  return { problems, len, adv: adv?.nextActivity ?? null, ret: ret?.targetActivity ?? null, artifactKeys: art.updates.flatMap(up => Object.keys(up.sections)), codes }
}

async function run(s, m) {
  const system = buildSystemPrompt(s.stage, s.act, project, 'teacher', undefined, null, team, s.confirmed, 'active')
    + (s.curriculum ? buildCurriculumContext(s.act, s.history, project.targetGradeGroup, s.confirmed, null, project.targetSubjects) : '')
  const t0 = performance.now(); let text = ''; let finish = null; let usage = null; let ttft = null; let error = null
  try {
    const stream = await openai.chat.completions.create({ ...generationParams(m.model, { maxTokens: 8192, effort: m.effort, stream: true, cacheKey: `tcid-chat-${s.act}` }), messages: [{ role: 'system', content: system }, ...s.history] })
    for await (const chunk of stream) { const d = chunk.choices?.[0]?.delta?.content ?? ''; if (d && ttft == null) ttft = Math.round(performance.now() - t0); text += d; if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason; if (chunk.usage) usage = chunk.usage }
  } catch (e) { error = e.message }
  const total = Math.round(performance.now() - t0)
  const c = error ? { problems: [`API 오류 ${error.slice(0, 80)}`], len: 0 } : check(text, finish, s)
  return { scenario: s.id, model: m.key, ttft, total, finish, usage, systemChars: system.length, text, ...c }
}

const results = []
for (const m of MODELS) {
  console.log(`\n===== ${m.key}`)
  const queue = [...S]; let pass = 0
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const s = queue.shift(); const r = await run(s, m); results.push(r); if (r.problems.length === 0) pass++; console.log(`${r.problems.length ? '✗' : '✓'} ${s.id.padEnd(15)} ${String(r.total).padStart(5)}ms in=${r.usage?.prompt_tokens ?? '-'} out=${r.usage?.completion_tokens ?? '-'} len=${r.len}${r.adv ? ' adv=' + r.adv : ''}${r.ret ? ' ret=' + r.ret : ''}${r.artifactKeys?.length ? ' art=' + r.artifactKeys.join('|') : ''}${r.problems.length ? '  ← ' + r.problems.join('; ') : ''}`) } }))
  console.log(`>>> ${m.key}: ${pass}/${S.length} 통과`)
}
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'chat-regression.json'), JSON.stringify(results, null, 2))
console.log('saved', path.join(OUT_DIR, 'chat-regression.json'))
