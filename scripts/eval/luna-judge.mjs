// Fable 블라인드 심사: 시나리오별 3개 응답(순서 섞음)을 5개 기준으로 채점.
import fs from 'node:fs'
import path from 'node:path'
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }
const Anthropic = (await import(path.join(REPO, 'node_modules/@anthropic-ai/sdk/index.mjs'))).default
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const DIR = process.argv[2] ?? path.dirname(new URL(import.meta.url).pathname)
const results = JSON.parse(fs.readFileSync(path.join(DIR, 'chat-results.json'), 'utf8'))
const scenarios = [...new Set(results.map(r => r.scenario))]

const RUBRIC = `당신은 초등 교사 협력 수업설계 플랫폼(T-CID)의 AI 퍼실리테이터 응답을 심사하는 전문가입니다. 같은 대화 맥락에 대한 응답 3개(A/B/C, 무작위 순서)를 아래 5기준으로 각각 1~5점 채점하고 순위를 매기세요.
기준:
1. 절차 준수 — 현재 활동 스텝에 맞는 행동을 했는가(먼저 팀원 생각을 꺼내게 하기 #활성화, 한 번에 한 가지 요청). 특정 팀원 실명 지목·대리 입력 재확인·기록 완료 후 추가 질문은 감점. 매 턴 활동 소개·표를 반복하는 것은 감점.
2. 간결성·밀도 — 교사가 읽기에 적절한 길이인가. 장황·반복 감점, 지나치게 빈약해 안내가 부족해도 감점.
3. 정확성 — 교육과정 성취기준 코드를 지어내지 않았는가(제공 자료 없으면 만들지 말아야 함). 활동 번호는 문서 표기(T-1, T-4, A-2, A-3, Ds-1)를 써야 하고 내부 코드(T-1-1, A-2-1, Ds-1-1)를 노출하면 감점.
4. 협력 촉진 — 다른 교사의 발언을 끌어내고 합의로 이끄는가.
5. 신호 태그 적절성 — [TEAM_DISCUSSION_READY: …]/[HELP_CARD: …] 등 시스템 신호를 상황에 맞게 썼는가(불필요한 남발이나 필요한데 누락 모두 감점; 대화만으로 충분하면 없어도 만점 가능).
사용자 요청을 절차상 이유로 거절하는 것은, 그 이유가 타당하고 대안을 주면 감점하지 마세요.
반드시 JSON만 출력: {"scores":{"A":{"c1":n,"c2":n,"c3":n,"c4":n,"c5":n},"B":{...},"C":{...}},"ranking":["A","B","C"],"rationale":"3~4문장, 한국어"}`

async function judge(scenario) {
  const items = results.filter(r => r.scenario === scenario)
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  const letters = ['A', 'B', 'C']
  const history = JSON.parse(fs.readFileSync(path.join(DIR, 'chat-results.json'), 'utf8')).find(r => r.scenario === scenario)
  const body = `## 활동: ${items[0].label} (activity ${scenario})
## 대화 맥락
${(items[0].historyText ?? '(아래 참조)')}
## 응답
${shuffled.map((r, i) => `### 응답 ${letters[i]}\n${r.text}`).join('\n\n')}`
  const call = async (model) => client.messages.create({ model, max_tokens: 1500, system: RUBRIC, messages: [{ role: 'user', content: body }] })
  let resp
  try { resp = await call('claude-fable-5-1') } catch (e) { console.error('fable failed → opus-5:', e.message?.slice(0, 80)); resp = await call('claude-opus-5') }
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const json = JSON.parse(text.match(/\{[\s\S]*\}/)[0])
  return { scenario, model: resp.model, mapping: Object.fromEntries(shuffled.map((r, i) => [letters[i], r.model])), ...json }
}

const out = []
for (const s of scenarios) { const j = await judge(s); out.push(j); const line = j.ranking.map(l => `${j.mapping[l]}(${Object.values(j.scores[l]).reduce((a, b) => a + b, 0)})`).join(' > '); console.log(`${s.padEnd(14)} ${line}`); console.log('   ' + j.rationale) }
fs.writeFileSync(path.join(DIR, 'judge-results.json'), JSON.stringify(out, null, 2))
const totals = {}
for (const j of out) for (const [l, m] of Object.entries(j.mapping)) { totals[m] = totals[m] ?? { sum: 0, n: 0, wins: 0, c: [0, 0, 0, 0, 0] }; const sc = j.scores[l]; totals[m].sum += sc.c1 + sc.c2 + sc.c3 + sc.c4 + sc.c5; totals[m].n++; if (j.ranking[0] === l) totals[m].wins++; ;[sc.c1, sc.c2, sc.c3, sc.c4, sc.c5].forEach((v, i) => totals[m].c[i] += v) }
console.log('\n=== 합계 (25점 만점 평균 · 1위 횟수 · 기준별 평균: 절차/간결/정확/협력/신호)')
for (const [m, t] of Object.entries(totals)) console.log(`${m.padEnd(26)} avg=${(t.sum / t.n).toFixed(1)} wins=${t.wins}/${t.n}  ${t.c.map(v => (v / t.n).toFixed(1)).join(' / ')}`)
