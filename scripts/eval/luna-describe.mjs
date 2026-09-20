// gpt-4o(현재) vs gpt-5-mini vs luna — 자동 채우기 "수업내용 설명" 작성 비교, Jev Noul(확정 범위 내) 로 객관 검증
import fs from 'node:fs'
import path from 'node:path'
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
process.chdir(REPO)
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }
const OpenAI = (await import(path.join(REPO, 'node_modules/openai/index.mjs'))).default
const { verifyDescriptions } = await import(path.join(REPO, 'src/lib/curriculum/jevJudge.ts'))
const openai = new OpenAI()
const rows = [
  { subject: '실과', isCenter: true, coreIdea: '일상생활에서 지속가능한 선택을 지향하는 것은 현재 생활공동체와의 공존과 함께 미래 세대의 건강한 삶을 위한 책임 있는 행동이다.', standard: '[6실02-11] 생태 지향적 삶을 위해 자신의 의식주 생활에서 할 수 있는 구체적인 행동을 계획하여 실천한다.', knowledge: '5-6학년군: 지속가능한 의식주생활 | 5-6학년군: 음식의 마련과 섭취 | 5-6학년군: 생활자원의 특징', processFunction: '5-6학년군: 일상생활에서의 지속가능한 행동을 계획하여 실천하기 | 5-6학년군: 자신의 선택이 공동체의 삶과 환경에 미치는 영향 설명하기', valueAttitude: '5-6학년군: 생태 지향적 삶의 태도 | 5-6학년군: 일상생활 속 선택에 대한 책임과 성찰' },
  { subject: '수학', isCenter: false, coreIdea: '자료를 수집, 정리, 해석하는 통계는 자료의 특징을 파악하고 두 집단을 비교하며 자료의 관계를 탐구하는 데 활용된다.', standard: '[6수04-03] 탐구 문제를 설정하고, 그에 맞는 자료를 수집, 정리하여 적절한 그래프로 나타내고 해석할 수 있다.', knowledge: '5-6학년군: 평균 | 5-6학년군: 띠그래프, 원그래프 | 5-6학년군: 가능성', processFunction: '5-6학년군: 탐구 문제를 설정하고 그에 맞는 자료를 수집하기 | 5-6학년군: 자료를 표나 그래프로 나타내고 해석하기', valueAttitude: '5-6학년군: 표와 그래프의 편리함 인식 | 5-6학년군: 자료를 이용한 통계적 문제해결 과정의 가치 인식' },
  { subject: '도덕', isCenter: false, coreIdea: '자연을 아끼고 생명을 소중히 여기는 마음은 환경 위기의 극복을 돕는다.', standard: '[6도04-01] 지구의 환경 위기 상황을 이해하고, 이를 극복하기 위한 다양한 방안을 찾아 자신의 일상에서 실천하고자 노력한다.', knowledge: '5-6학년군: 환경 위기를 극복하기 위해 어떻게 해야 하는가?', processFunction: '5-6학년군: 환경 위기를 극복하기 위한 방안 살펴보기', valueAttitude: '5-6학년군: 환경 위기를 극복하는 자세 | 5-6학년군: 미래 세대에 대한 책임의식 함양' },
]
const topic = '학교 급식 잔반 줄이기 캠페인', gradeGroup = '초5-6'
const prompt = `초등학교 ${gradeGroup} 융합 수업의 교과별 "수업내용 설명"만 작성하세요.

중요:
- 핵심아이디어, 성취기준, 지식이해, 과정기능, 가치태도 값은 이미 DB에서 확정되었습니다.
- 아래 값들을 바꾸거나 새로 만들지 말고, 각 교과가 수업에서 맡을 역할만 1~2문장으로 설명하세요.
- 확정된 성취기준·내용 요소 밖의 다른 성취기준이나 내용을 끌어오지 마세요.

주제: ${topic}
대화 맥락: (없음)

${rows.map(r => `[${r.subject}${r.isCenter ? ' ★중심' : ''}]\n핵심아이디어: ${r.coreIdea}\n성취기준: ${r.standard}\n지식이해: ${r.knowledge}\n과정기능: ${r.processFunction}\n가치태도: ${r.valueAttitude}`).join('\n\n')}

JSON: { "descriptions": { "교과명": "설명" } }`
const CONFIGS = [
  { id: 'gpt-4o', label: 'gpt-4o(현재)', params: { max_tokens: 1500, temperature: 0.3 } },
  { id: 'gpt-5-mini', label: 'gpt-5-mini(minimal)', params: { max_completion_tokens: 1500, reasoning_effort: 'minimal' } },
  { id: 'gpt-5.6-luna', label: 'luna(low)', params: { max_completion_tokens: 1500, reasoning_effort: 'low' } },
]
for (const c of CONFIGS) {
  const t0 = performance.now()
  let desc = {}, usage = null, err = null
  try {
    const r = await openai.chat.completions.create({ model: c.id, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }], ...c.params })
    usage = r.usage; desc = JSON.parse(r.choices[0].message.content ?? '{}').descriptions ?? {}
  } catch (e) { err = e.message }
  const ms = Math.round(performance.now() - t0)
  const v = err ? null : await verifyDescriptions(topic, gradeGroup, rows, desc)
  const cost = usage ? (usage.prompt_tokens * { 'gpt-4o': 2.5, 'gpt-5-mini': 0.25, 'gpt-5.6-luna': 0.2 }[c.id] + usage.completion_tokens * { 'gpt-4o': 10, 'gpt-5-mini': 2, 'gpt-5.6-luna': 1.2 }[c.id]) / 1e6 : 0
  console.log(`\n## ${c.label}  ${ms}ms  in=${usage?.prompt_tokens} out=${usage?.completion_tokens} reason=${usage?.completion_tokens_details?.reasoning_tokens ?? 0}  cost=$${cost.toFixed(5)}${err ? '  ERROR ' + err.slice(0, 100) : ''}`)
  for (const r of rows) console.log(`  ${r.subject} (Jev 범위내 ${v?.inScope?.[r.subject]?.toFixed(2) ?? '-'}): ${desc[r.subject] ?? '(없음)'}`)
}
