// 하이브리드 전환 종단 점검 — 배포된 사이트의 실제 API 를 순서대로 호출해 Jev↔LLM 연결, 산출물 형식,
// 길이·지연, 오류를 한 표로 본다. 실행: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/eval/e2e-hybrid.mjs [BASE]
import path from 'node:path'
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
process.chdir(REPO)
const BASE = process.argv[2] ?? 'https://togethertr-curriculum-map.web.app'
const { parseArtifactUpdates, parseActivityAdvance } = await import(path.join(REPO, 'src/lib/chat/signals.ts'))
const { loadGraph } = await import(path.join(REPO, 'src/lib/curriculum/graphReader.ts'))
const validCodes = new Set(loadGraph().achievementStandards.map(s => s.code.replace(/[\[\]]/g, '')))

const rows = []
const project = { title: '우리 지역 물 문제 탐구 프로젝트', schoolLevel: '초등학교', targetGradeGroup: '초5-6', targetSubjects: ['사회', '과학', '국어'], mode: 'team', isA23Completed: false, currentCycle: 1 }
const team = '김교사(사회, 호스트), 이교사(과학), 박교사(국어)'
async function timed(name, fn) {
  const t0 = performance.now()
  try { const r = await fn(); rows.push({ name, ms: Math.round(performance.now() - t0), ok: r.ok !== false, note: r.note ?? '' }) }
  catch (e) { rows.push({ name, ms: Math.round(performance.now() - t0), ok: false, note: `오류 ${String(e.message ?? e).slice(0, 90)}` }) }
}
async function sse(url, body, maxMs = 90_000) {
  const r = await fetch(`${BASE}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(maxMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  let text = '', done = false, err = null; const t0 = performance.now(); let ttft = null
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) { const { value, done: d } = await reader.read(); if (d) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop(); for (const line of lines) { if (!line.startsWith('data: ')) continue; let j; try { j = JSON.parse(line.slice(6)) } catch { continue }; if (j.type === 'text') { if (ttft == null) ttft = Math.round(performance.now() - t0); text += j.text } if (j.type === 'done') done = true; if (j.type === 'error') err = j.message } }
  return { text, done, err, ttft }
}
async function json(url, body, maxMs = 90_000) {
  const r = await fetch(`${BASE}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(maxMs) })
  const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`HTTP ${r.status} ${data.error ?? ''}`); return data
}
const codesIn = t => [...new Set([...t.matchAll(/\[?(\d[가-힣A-Za-z]+\d{2}-\d{2})\]?/g)].map(m => m[1]))]

// 1) 채팅 — 논의 턴 (Luna)
await timed('chat/stream 논의 턴 (T-4 규칙 초안)', async () => {
  const r = await sse('/api/chat/stream', { projectId: 'e2e', stage: 'T', activityCode: 'T-2-2', actorType: 'teacher', project, teamMembers: team, messages: [{ role: 'user', content: '[김교사] 우리 팀 규칙 5개 정도 초안을 만들어 주세요. 갈등 상황 규칙도 하나 넣어 주세요.' }] })
  const leak = [...r.text.replace(/\[[A-Z_]+[^\]]*\]/g, '').matchAll(/\b(T|A|Ds|DI|E)-\d-\d\b/g)].length
  return { ok: r.done && !r.err && r.text.length > 100 && leak === 0, note: `ttft ${r.ttft}ms · ${r.text.length}자 · done=${r.done} · 내부코드 노출 ${leak}` }
})
// 2) 채팅 — 저장 턴: ARTIFACT_UPDATE 형식이 실제 파서·스키마 키와 맞는지
await timed('chat/stream 저장 턴 (A-2 주제 A안) → ARTIFACT_UPDATE 파싱', async () => {
  const r = await sse('/api/chat/stream', { projectId: 'e2e', stage: 'A', activityCode: 'A-1-2', actorType: 'teacher', project, teamMembers: team, confirmedArtifacts: { 'T-1-1': { title: '팀 비전', content: { '팀 공통 비전': '지역의 문제를 함께 탐구하고 실천하는 시민으로 자란다' } } }, messages: [{ role: 'assistant', content: '세 분이 "우리 지역의 물 문제와 해결 방안"을 최종 주제로 합의하셨습니다.\n**A안:** "이 내용으로 산출물에 저장하겠습니다"\n**B안:** "조금 더 다듬고 저장하겠습니다"' }, { role: 'user', content: '[김교사] A안: 이 내용으로 산출물에 저장하겠습니다' }] })
  const parsed = parseArtifactUpdates(r.text); const keys = parsed.updates.flatMap(u => Object.keys(u.sections))
  const hasTopic = keys.some(k => /선정 주제/.test(k)); const adv = parseActivityAdvance(r.text)
  return { ok: r.done && parsed.updates.length > 0 && hasTopic && !adv, note: `섹션 ${keys.join('|') || '없음'} · ADVANCE 동시방출=${Boolean(adv)}` }
})
// 3) 자동 채우기 체인 (Jev 판정 → Jev 판정 → LLM 설명 → Jev 검증)
let judgedRows = []
await timed('autofill coreIdeas (Jev 핵심아이디어 판정)', async () => {
  const d = await json('/api/curriculum-sheet/autofill', { mode: 'coreIdeas', a12Artifact: { selectedTopic: '학교 급식 잔반 줄이기 캠페인', targetSubjects: ['실과', '수학', '도덕'] }, targetGradeGroup: '초5-6', existingRows: [{ subject: '실과', isCenter: true }] })
  judgedRows = d.proposals.map(p => ({ subject: p.subject, coreIdea: p.selectedCoreIdea }))
  return { ok: d.judge === 'jev' && d.proposals.length === 3, note: `judge=${d.judge} · ${d.proposals.map(p => `${p.subject} ${p.mode} ${p.confidence}`).join(', ')}` }
})
let builtRows = []
await timed('autofill rows (Jev 성취기준·내용 요소 판정)', async () => {
  const d = await json('/api/curriculum-sheet/autofill', { mode: 'rows', a12Artifact: { selectedTopic: '학교 급식 잔반 줄이기 캠페인', targetSubjects: ['실과', '수학', '도덕'] }, targetGradeGroup: '초5-6', existingRows: [{ subject: '실과', isCenter: true }], selectedCoreIdeas: judgedRows })
  builtRows = d.rows
  const required = ['id', 'subject', 'coreIdea', 'standard', 'knowledge', 'processFunction', 'valueAttitude', 'description', 'updatedBy', 'updatedAt']
  const missing = d.rows.flatMap(r => required.filter(k => r[k] === undefined))
  const bad = d.rows.flatMap(r => codesIn(r.standard).filter(c => !validCodes.has(c)))
  return { ok: d.judge === 'jev' && d.rows.length === 3 && missing.length === 0 && bad.length === 0 && d.rows.every(r => r.knowledge && r.processFunction), note: `judge=${d.judge} · 행 ${d.rows.length} · 누락필드 ${missing.length} · 코드환각 ${bad.length} · ${d.rows.map(r => r.standard.slice(0, 11)).join(' ')}` }
})
await timed('autofill describe (LLM 설명 → Jev 범위 검증)', async () => {
  const d = await json('/api/curriculum-sheet/autofill', { mode: 'describe', a12Artifact: { selectedTopic: '학교 급식 잔반 줄이기 캠페인' }, targetGradeGroup: '초5-6', rows: builtRows })
  const v = Object.values(d.verification ?? {})
  return { ok: Object.keys(d.descriptions).length === 3 && v.length === 3 && Math.min(...v) >= 0.5, note: `설명 ${Object.keys(d.descriptions).length} · 검증 ${v.map(x => x.toFixed(2)).join('/')} · steps ${d.steps.map(s => s.id).join('→')}` }
})
// 4) 수업 예시 (Jev 관계 판정 → Claude → Jev 검증)
await timed('ontology/relate 수업 예시', async () => {
  const d = await json('/api/ontology/relate', { theme: '기후 변화와 탄소 중립 실천', gradeGroup: '초5-6', centerId: 'sub_soc_6사12-02', candidateIds: ['sub_sci_6과16-01', 'sub_prac_6실02-11'], force: true }, 120_000)
  return { ok: d.relations.length === 2 && d.relations.every(r => r.judge === 'jev' && r.teachingNote), note: d.relations.map(r => `${r.relationType} ${(+r.score).toFixed(2)} 검증 ${r.verified ?? '-'}`).join(' | ') }
})
// 5) 온톨로지 검색 (Jev 재순위)
await timed('ontology/search 중심 성취기준', async () => {
  const d = await json('/api/ontology/search', { theme: '우리 지역의 물 문제와 해결 방안', gradeGroup: '초5-6' }, 120_000)
  return { ok: Boolean(d.center?.standard?.code) && d.center.standard.subject_id !== 'sub_extra', note: `center ${d.center?.standard?.code} · 연결 ${(d.connections ?? []).length}` }
})
// 6) 제안 (sonnet-5 + 사후 검증)
await timed('topic-selection/suggest (sonnet-5 + verify)', async () => {
  const d = await json('/api/topic-selection/suggest', { projectTitle: '우리 지역 물 문제 탐구', targetGradeGroup: '초5-6', targetSubjects: ['사회', '과학', '국어'], teamVision: '지역의 문제를 함께 탐구하고 실천하는 시민으로 자란다', coreKeywords: ['협력', '탐구', '지역사회', '실천'] }, 120_000)
  return { ok: Array.isArray(d.criteria) && d.criteria.length >= 3 && d.verification && d.verification.invalidCodes.length === 0, note: `기준 ${d.criteria?.length} · 선정주제 ${Boolean(d.selectedTopic)} · verify ${JSON.stringify(d.verification?.jev ?? {})}` }
})
// 7) 단계 분석 (Luna SSE, 60초 한도)
await timed('analyze/stage (Luna SSE)', async () => {
  const r = await sse('/api/analyze/stage', { stage: 'T', project: { title: '우리 지역 물 문제 탐구', targetGradeGroup: '초5-6', targetSubjects: ['사회', '과학', '국어'] }, artifacts: { 'T-1-1': { title: '팀 비전', content: { vision: '지역의 문제를 함께 탐구하고 실천하는 시민으로 자란다' } }, 'T-2-2': { title: '팀 규칙', content: { rules: ['회의 전 안건 공유', '의견 충돌 시 비전 기준으로 재논의'] } } } }, 120_000)
  return { ok: r.done && !r.err && r.text.length > 300, note: `ttft ${r.ttft}ms · ${r.text.length}자 · done=${r.done}` }
})
// 8) 융합 (Luna JSON)
await timed('curriculum-sheet/fusion (Luna JSON)', async () => {
  const d = await json('/api/curriculum-sheet/fusion', { rows: [{ subject: '실과', coreIdea: '지속가능한 선택', standard: '[6실02-11] 생태 지향적 삶을 위해 자신의 의식주 생활에서 할 수 있는 구체적인 행동을 계획하여 실천한다.', knowledge: '지속가능한 의식주생활', processFunction: '실천 계획' }, { subject: '수학', coreIdea: '통계', standard: '[6수04-03] 탐구 문제를 설정하고, 그에 맞는 자료를 수집, 정리하여 적절한 그래프로 나타내고 해석할 수 있다.', knowledge: '띠그래프', processFunction: '자료 해석' }] }, 120_000)
  return { ok: Array.isArray(d.fusionIdeas) && d.fusionIdeas.length >= 1, note: `아이디어 ${d.fusionIdeas?.length}` }
})

console.log(`\n대상: ${BASE}`)
console.log('| 점검 | 결과 | 소요 | 비고 |\n|---|---|---|---|')
for (const r of rows) console.log(`| ${r.name} | ${r.ok ? '✅' : '❌'} | ${(r.ms / 1000).toFixed(1)}s | ${r.note} |`)
console.log(`\n통과 ${rows.filter(r => r.ok).length}/${rows.length}`)
