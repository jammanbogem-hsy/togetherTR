import test from 'node:test'
import assert from 'node:assert/strict'

// 문제상황 2단계 생성(outline → detail)의 순수 로직 계약.
// 배경: Firebase Hosting의 60초 요청 제한 때문에 한 번에 받던 생성을 나눴다.
const lib = await import('../src/lib/problem-situation/generation.ts')
const { recoverTruncatedJson } = await import('../src/lib/llm/recoverJson.ts')
const parseOutline = (raw) => lib.parseOutline(raw, recoverTruncatedJson)
const parseCandidateDetail = (raw, part = 'scenario') => lib.parseCandidateDetail(raw, part, recoverTruncatedJson)

const outlineRaw = `\`\`\`json
{
  "drivingQuestion": "우리 학교 급식 잔반을 어떻게 줄일 수 있을까?",
  "essentialQuestions": ["잔반은 왜 생길까?", "", "데이터로 무엇을 알 수 있을까?"],
  "recommended": { "index": 1 },
  "candidates": [
    { "title": "급식 잔반 탐구", "scenario": "요약 1.", "dataSources": "급식 잔반량 기록" },
    { "title": "교실 에너지 절약", "scenario": "요약 2.", "dataSources": "전기 사용량" },
    { "title": "학교 앞 안전", "scenario": "요약 3.", "dataSources": "교통사고 통계" },
    { "title": "네 번째는 버린다", "scenario": "요약 4.", "dataSources": "" }
  ]
}
\`\`\``

test('resolveGeneratePhase: phase 미지정은 outline, detail은 후보 검증', () => {
  assert.deepEqual(lib.resolveGeneratePhase({}), { phase: 'outline' })
  assert.deepEqual(lib.resolveGeneratePhase({ phase: 'outline' }), { phase: 'outline' })

  const outline = parseOutline(outlineRaw)
  assert.deepEqual(
    lib.resolveGeneratePhase({ phase: 'detail', candidateIndex: 2, part: 'scenario', outline }),
    { phase: 'detail', candidateIndex: 2, part: 'scenario' },
  )
  assert.deepEqual(
    lib.resolveGeneratePhase({ phase: 'detail', candidateIndex: 0, part: 'plan', outline }),
    { phase: 'detail', candidateIndex: 0, part: 'plan' },
  )
  assert.ok('error' in lib.resolveGeneratePhase({ phase: 'detail', candidateIndex: 3, part: 'scenario', outline }))
  assert.ok('error' in lib.resolveGeneratePhase({ phase: 'detail', candidateIndex: 0, part: 'scenario' }), 'outline 없음')
  assert.ok('error' in lib.resolveGeneratePhase({ phase: 'detail', candidateIndex: 0, outline }), 'part 없음')
  assert.ok('error' in lib.resolveGeneratePhase({ phase: 'full' }))
  assert.deepEqual(lib.DETAIL_PARTS, ['scenario', 'plan'])
})

test('parseOutline: 코드 블록 제거, 후보 3개 제한, 빈 질문 제거, 추천 자리표시자', () => {
  const outline = parseOutline(outlineRaw)
  assert.ok(outline)
  assert.equal(outline.candidates.length, 3)
  assert.equal(outline.candidates[0].title, '급식 잔반 탐구')
  assert.equal(outline.candidates[0].fullScenario, undefined)
  assert.equal(outline.drivingQuestion, '우리 학교 급식 잔반을 어떻게 줄일 수 있을까?')
  assert.deepEqual(outline.essentialQuestions, ['잔반은 왜 생길까?', '데이터로 무엇을 알 수 있을까?'])
  assert.equal(outline.recommended.index, 1)
  assert.equal(outline.recommended.title, '교실 에너지 절약')
  assert.equal(outline.recommended.fullScenario, '')
  assert.equal(lib.hasCandidateDetail(outline, 1), false)
})

test('parseOutline: 추천 인덱스 범위 밖이면 마지막 후보로 고정, 후보 없으면 null', () => {
  const outline = parseOutline(JSON.stringify({
    drivingQuestion: 'q?',
    recommended: { index: 9 },
    candidates: [{ title: 'A', scenario: 's', dataSources: 'd' }, { title: '', scenario: 'x', dataSources: '' }],
  }))
  assert.equal(outline.candidates.length, 1)
  assert.equal(outline.recommended.index, 0)
  assert.equal(parseOutline('{"candidates": []}'), null)
  assert.equal(parseOutline('응답이 JSON이 아님'), null)
})

test('parseOutline: 잘린 응답도 완결된 후보까지 복구한다', () => {
  const truncated = `{
  "drivingQuestion": "q?",
  "essentialQuestions": ["a?"],
  "recommended": { "index": 0 },
  "candidates": [
    { "title": "완결 후보", "scenario": "s", "dataSources": "d" },
    { "title": "잘린 후보", "scenario": "여기서 끊`
  const outline = parseOutline(truncated)
  assert.ok(outline)
  assert.equal(outline.candidates.length, 1)
  assert.equal(outline.candidates[0].title, '완결 후보')
})

test('parseCandidateDetail(scenario): 정규화 (url null 제거, 문자열 realData 허용, 전문 없으면 null)', () => {
  const detail = parseCandidateDetail(JSON.stringify({
    fullScenario: '  전문입니다.  ',
    standardsAlignment: [
      { standardId: '6사03-01', subject: '사회', isCenter: true, connection: 'c1' },
      { standardId: '', subject: '국어', isCenter: false, connection: '버림' },
      { standardId: '6국02-04', subject: '국어', isCenter: 'no', connection: 'c2' },
    ],
    realData: [
      { label: '교육부 통계', url: null },
      { label: '환경부 자료', url: 'https://me.go.kr' },
      '문자열 출처',
      { label: '' },
    ],
    learningContent: '다른 조각의 필드는 무시',
  }), 'scenario')
  assert.ok(detail)
  assert.equal(detail.fullScenario, '전문입니다.')
  assert.equal(detail.learningContent, undefined)
  assert.deepEqual(detail.standardsAlignment.map(a => [a.standardId, a.isCenter]), [['6사03-01', true], ['6국02-04', false]])
  assert.deepEqual(detail.realData, [
    { label: '교육부 통계' },
    { label: '환경부 자료', url: 'https://me.go.kr' },
    { label: '문자열 출처' },
  ])
  assert.equal(parseCandidateDetail('{"standardsAlignment": []}', 'scenario'), null)
})

test('parseCandidateDetail(plan): 세 필드만 담고, 전부 비면 null', () => {
  const plan = parseCandidateDetail(JSON.stringify({ learningContent: ' lc ', artifacts: 'af', alignmentCheck: '', fullScenario: '무시' }), 'plan')
  assert.deepEqual(plan, { learningContent: 'lc', artifacts: 'af', alignmentCheck: '' })
  assert.equal(parseCandidateDetail('{"fullScenario": "전문만"}', 'plan'), null)
})

test('applyCandidateDetail: 조각을 순서 무관하게 병합하고 추천 후보면 recommended도 채운다', () => {
  const outline = parseOutline(outlineRaw)
  const scenarioPart = {
    fullScenario: '전문',
    standardsAlignment: [{ standardId: '6사03-01', subject: '사회', isCenter: true, connection: 'c' }],
    realData: [{ label: 'L' }],
  }
  const planPart = { learningContent: 'lc', artifacts: 'af', alignmentCheck: 'ac' }

  // 추천이 아닌 후보(0): plan 조각이 먼저 와도 recommended는 그대로
  const afterPlan0 = lib.applyCandidateDetail(outline, 0, planPart)
  assert.equal(afterPlan0.candidates[0].artifacts, 'af')
  assert.equal(afterPlan0.candidates[0].fullScenario, undefined)
  assert.equal(lib.hasCandidateDetail(afterPlan0, 0), false, '전문이 없으면 아직 미완')
  assert.equal(afterPlan0.recommended.fullScenario, '')
  assert.equal(outline.candidates[0].artifacts, undefined, '원본은 변경하지 않는다')

  const afterBoth0 = lib.applyCandidateDetail(afterPlan0, 0, scenarioPart)
  assert.equal(lib.hasCandidateDetail(afterBoth0, 0), true)
  assert.equal(afterBoth0.candidates[0].fullScenario, '전문')
  assert.equal(afterBoth0.candidates[0].artifacts, 'af', '먼저 온 조각을 잃지 않는다')

  // 추천 후보(1): 두 조각이 모두 recommended에 반영된다
  const afterScenario1 = lib.applyCandidateDetail(afterBoth0, 1, scenarioPart)
  assert.equal(afterScenario1.recommended.index, 1)
  assert.equal(afterScenario1.recommended.title, '교실 에너지 절약')
  assert.equal(afterScenario1.recommended.fullScenario, '전문')
  assert.equal(afterScenario1.recommended.alignmentCheck, '')
  const afterPlan1 = lib.applyCandidateDetail(afterScenario1, 1, planPart)
  assert.equal(afterPlan1.recommended.fullScenario, '전문')
  assert.equal(afterPlan1.recommended.alignmentCheck, 'ac')
  assert.deepEqual(afterPlan1.recommended.realData, [{ label: 'L' }])
  assert.equal(afterPlan1.candidates[2].fullScenario, undefined)

  assert.equal(lib.applyCandidateDetail(outline, 7, scenarioPart), outline, '없는 후보는 무시')
})

test('프롬프트: outline은 요약만, detail은 선택 후보와 확정 질문을 담고 출력 상한이 60초 안에 맞는다', () => {
  const ctx = {
    projectTitle: 'P', targetGradeGroup: '5-6학년', targetSubjects: ['사회', '국어'],
    nodeContext: '중심 성취기준: [6사03-01]',
  }
  const outline = parseOutline(outlineRaw)

  const o = lib.buildOutlinePrompts(ctx)
  assert.match(o.system, /요약만/)
  assert.doesNotMatch(o.system, /"fullScenario"/)
  assert.match(o.user, /6사03-01/)

  const s = lib.buildDetailPrompts(ctx, outline, 2, 'scenario')
  assert.match(s.system, /"fullScenario"/)
  assert.doesNotMatch(s.system, /"alignmentCheck"/)
  assert.match(s.user, /학교 앞 안전/)
  assert.match(s.user, /급식 잔반을 어떻게 줄일 수 있을까/)
  assert.match(s.user, /급식 잔반 탐구/, '다른 후보는 중복 방지용으로만 포함')

  const p = lib.buildDetailPrompts(ctx, outline, 2, 'plan')
  assert.match(p.system, /"alignmentCheck"/)
  assert.doesNotMatch(p.system, /"fullScenario"/)
  assert.match(p.user, /학교 앞 안전/)

  // 실측 약 50 tok/s 기준 60초 = 3,000토큰. 모든 요청의 출력 상한이 그 아래여야 한다.
  assert.ok(lib.OUTLINE_MAX_TOKENS <= 3000)
  assert.ok(lib.DETAIL_MAX_TOKENS <= 3000)
})
