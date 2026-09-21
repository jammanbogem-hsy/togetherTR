// A-2-1 산출물 표의 '핵심아이디어 묶음' 왕복 검증.
// 분석시트의 학년군 줄·연결 줄이 마크다운 표(교과 칸 '↳ ')를 거쳐도
// parseA21Table에서 groupWithPrevious로 되살아나는지 확인한다.
// Run: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/a21GroupRows.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  A21_GROUP_MARKER,
  buildCurriculumSheetArtifactProposal,
} from '../src/lib/curriculum/graphSheetBridge.ts'
import { parseA21Table } from '../src/lib/artifacts/schemas.ts'

/** 사회(5-6, 중심) → 통합교과(1-2, 연결 줄) → 국어(5-6) 3행 시트. */
function fixtureRows() {
  const socialIdea = '사회는 지역 문제를 자료로 탐구해 해결 방안을 제안한다'
  return [
    {
      id: 'r1',
      subject: '사회',
      coreIdea: socialIdea,
      standard: '[6사01-01] 지역의 문제를 조사한다',
      knowledge: '지역 문제',
      processFunction: '자료 조사하기',
      valueAttitude: '공동체 의식',
      agentLessonExample: '우리 지역 문제 지도 만들기',
      description: '중심 교과에서 문제 정의를 담당한다',
      gradeBand: '5-6학년군',
      isCenter: true,
    },
    {
      id: 'r2',
      subject: '통합교과',
      coreIdea: '우리가 사는 곳을 살펴보고 가꾼다',
      standard: '[2슬01-03] 우리가 사는 곳을 살펴본다',
      knowledge: '우리가 사는 곳',
      processFunction: '살펴보기',
      valueAttitude: '관심 가지기',
      agentLessonExample: '학교 주변 한 바퀴 살펴보기',
      description: '1-2학년군은 관찰로 참여한다',
      gradeBand: '1-2학년군',
      linkedCoreIdea: { subject: '사회', coreIdea: socialIdea },
    },
    {
      id: 'r3',
      subject: '국어',
      coreIdea: '국어는 문제 해결을 위한 설득 글을 쓴다',
      standard: '[6국03-04] 적절한 근거로 주장하는 글을 쓴다',
      knowledge: '주장과 근거',
      processFunction: '글쓰기',
      valueAttitude: '책임감',
      agentLessonExample: '해결 방안 제안서 쓰기',
      description: '결과를 글로 정리한다',
      gradeBand: '5-6학년군',
    },
  ]
}

function analysisTable(rows) {
  const proposal = buildCurriculumSheetArtifactProposal(rows, { gradeMode: 'multi', sheetGradeBand: '5-6학년군' })
  assert.ok(proposal, '제안이 만들어져야 한다')
  return proposal.sections['성취기준분석표']
}

test('표 생성: 연결 줄의 교과 칸에만 묶음 표시가 붙는다', () => {
  const table = analysisTable(fixtureRows())
  const dataLines = table.split('\n').slice(2)

  assert.equal(dataLines.length, 3)
  assert.match(dataLines[0], /\| 사회 \(5-6학년군\) ★중심 \|/)
  assert.match(dataLines[1], new RegExp(`\\| ${A21_GROUP_MARKER}통합교과 \\(1-2학년군\\) \\|`))
  assert.match(dataLines[2], /\| 국어 \(5-6학년군\) \|/)
  // 열 구성·연결 설명 접두어는 그대로 유지된다.
  assert.match(table.split('\n')[0], /^\| 교과 \| 핵심 아이디어 \| 성취기준 \| 지식·이해 \| 과정·기능 \| 가치·태도 \| Agent 추천 수업아이디어 \| 수업내용 설명 \|$/)
  assert.match(dataLines[1], /\(사회 핵심아이디어 '.+'와 연결\)/)
  assert.equal(dataLines.filter(line => line.includes(A21_GROUP_MARKER.trim())).length, 1)
})

test('왕복: 파서가 묶음 표시를 떼고 groupWithPrevious로 되살린다', () => {
  const parsed = parseA21Table(analysisTable(fixtureRows()))

  assert.equal(parsed.length, 3)
  assert.deepEqual(parsed.map(r => r.groupWithPrevious), [false, true, false])
  assert.deepEqual(parsed.map(r => r.subject), [
    '사회 (5-6학년군) ★중심',
    '통합교과 (1-2학년군)',
    '국어 (5-6학년군)',
  ])
  assert.ok(parsed.every(r => !r.subject.includes(A21_GROUP_MARKER.trim())), '교과명에 묶음 표시가 남지 않아야 한다')
  assert.deepEqual(parsed.map(r => r.isCommon), [false, false, false])
  // 나머지 칸은 기존과 동일하게 실린다.
  assert.match(parsed[1].standard, /2슬01-03/)
  assert.equal(parsed[1].knowledgeUnderstanding, '1-2학년군: 우리가 사는 곳')
  assert.match(parsed[1].description, /^\(사회 핵심아이디어/)
})

test('한 학년군 시트: 묶음 표시가 없으면 groupWithPrevious는 모두 false', () => {
  const rows = fixtureRows().filter(row => row.subject !== '통합교과')
  const proposal = buildCurriculumSheetArtifactProposal(rows, { gradeMode: 'single', sheetGradeBand: '5-6학년군' })
  const parsed = parseA21Table(proposal.sections['성취기준분석표'])

  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed.map(r => r.groupWithPrevious), [false, false])
  assert.deepEqual(parsed.map(r => r.subject), ['사회 ★중심', '국어'])
})
