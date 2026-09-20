import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'

function load(file, dependencies = {}) {
  const loadedModule = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loadedModule, exports: loadedModule.exports, require: name => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  } })
  return loadedModule.exports
}
const meta = load('src/types/index.ts')
const contracts = load('src/lib/activity/demo-contracts.ts', { '@/types': meta })
const names = ['김하늘', '이도윤', '박서연']
const table = (headers, rows) => [headers.join(' | '), headers.map(() => '---').join(' | '), ...rows.map(row => row.join(' | '))].map(row => `| ${row} |`).join('\n')

test('all 19 activities have distinct ordered work and exact artifact section guidance', () => {
  for (const code of meta.STAGES.flatMap(stage => stage.activities)) {
    const contract = contracts.getDemoActivityContract(code)
    assert.ok(contract.steps.length >= 2, code)
    assert.equal(new Set(contract.steps.map(step => step.id)).size, contract.steps.length)
    assert.ok(contract.completionCriteria.length >= 2, code)
    for (const section of meta.ACTIVITY_META[code].requiredSections ?? meta.ACTIVITY_META[code].recommendedSections) {
      assert.ok(contract.artifactGuidance.includes(section.key), `${code}: ${section.key}`)
    }
  }
})

test('vision preserves each teacher and the candidate-selection process', () => {
  const contract = contracts.getDemoActivityContract('T-1-1')
  assert.match(contract.steps.map(step => step.instruction).join('\n'), /3.{0,5}후보|후보.{0,5}3/)
  const content = {
    '개인 비전': table(['교사', '키워드', '개인 비전'], names.map(name => [name, '탐구, 근거, 협력', '학생이 근거를 나누어 공동 판단한다.'])),
    '팀 공통 비전': '학생이 서로 다른 관점의 근거를 연결하여 함께 판단한다.',
    '핵심 키워드': '탐구, 근거, 협력',
  }
  assert.equal(contracts.validateDemoArtifactContent('T-1-1', content, names).length, 0)
  assert.ok(contracts.validateDemoArtifactContent('T-1-1', { ...content, '개인 비전': content['개인 비전'].replace('박서연', '누군가') }, names).length)
})

test('design principles must be 3–5 conditional principles with a stop condition', () => {
  const valid = { '설계 방향': table(['번호', '원칙', '근거', '멈춤 신호'], [
    ['1', '근거 있는 수업이 되려면 출처를 비교해야 한다', '비전의 근거', '출처가 없으면 멈춤'],
    ['2', '협력하려면 모든 교사가 검토해야 한다', '공동 판단', '이견 시 보류'],
    ['3', '접근 가능한 수업이 되려면 대체 표현을 허용해야 한다', '참여 보장', '참여 배제 시 재검토'],
  ]) }
  assert.equal(contracts.validateDemoArtifactContent('T-1-2', valid, names).length, 0)
  const invalid = valid['설계 방향'].replace('협력하려면 모든 교사가 검토해야 한다', '협력할 때 모두 검토한다')
  const feedback = contracts.validateDemoArtifactContent('T-1-2', { '설계 방향': invalid }, names).join(' ')
  assert.match(feedback, /2행/)
  assert.match(feedback, /협력할 때 모두 검토한다/)
  assert.ok(contracts.validateDemoArtifactContent('T-1-2', { '설계 방향': '자료를 활용하는 재미있는 수업을 함께 만들기로 했습니다.' }, names).length)
})

test('role allocation requires a table covering every teacher', () => {
  const valid = { '역할 배분': table(['담당자', '과업', '기한', '공동 검토'], names.map(name => [name, '학생 탐구 자료 검토', '수업 3일 전', '서로의 자료 교차 검토'])) }
  assert.equal(contracts.validateDemoArtifactContent('T-2-1', valid, names).length, 0)
  assert.ok(contracts.validateDemoArtifactContent('T-2-1', { '역할 배분': '교사들이 각자 자료를 만든다. 책임과 일정은 추후 정한다.' }, names).length)
})

test('materials are usable bodies rather than a development to-do list', () => {
  const list = '자료명: 활동지, 데이터, 평가표. 담당 교사가 추후 개발하고 학생 관점에서 점검한다.'
  assert.ok(contracts.validateDemoArtifactContent('DI-1-1', { '개발 자료 목록': list }, names).length)
  const body = `${list}\n## 학생용 활동지 v1\n안내: 두 날짜의 강우량을 읽고 비교하세요.\n1. 어느 날 비가 더 많이 왔나요? 근거를 표에서 찾아 쓰세요.\n2. 측정 위치가 달라지면 비교가 공정할까요?\n## 합성 예시 데이터\n\`\`\`csv\n날짜,강우량_mm\n1일,12\n2일,8\n3일,14\n\`\`\`\n## 평가 기준\n${table(['요소', '도달', '보완 필요'], [['근거', '두 자료를 인용한다', '자료가 없다'], ['판단', '측정 조건을 고려한다', '숫자만 비교한다']])}\n학생 관점 검토: 문항을 짧게 나누고 선택 응답을 허용한다.`
  assert.equal(contracts.validateDemoArtifactContent('DI-1-1', { '개발 자료 목록': body }, names).length, 0)
  assert.equal(contracts.validateDemoArtifactContent('DI-1-1', { '개발 자료 목록': body.replace('1. 어느', '**1.** 어느').replace('2. 측정', '### 2. 측정').replace('도달 |', '상 |') }, names).length, 0)
})

test('simulated observation records require three evidence-located scenes', () => {
  const valid = {
    '주요 상황 기록': '시뮬레이션: 실제 수업에서 수집한 자료가 아닙니다.\n' + table(['장면 ID', '시점', '기록자', '관찰', '증거 위치'], [
      ['SIM-1', '1차시 10분', '김하늘', '예시 학생이 두 수치를 인용했다', '활동지 문항 1'],
      ['SIM-2', '1차시 20분', '이도윤', '예시 학생이 단위를 혼동했다', '활동지 문항 2'],
      ['SIM-3', '2차시 10분', '박서연', '예시 학생이 그림으로 비교했다', '활동지 문항 3'],
    ]),
    'E단계 확인 질문': 'SIM-2의 단위 혼동이 안내 문항의 표현과 관련되는지 확인한다.',
  }
  assert.equal(contracts.validateDemoArtifactContent('DI-2-1', valid, names).length, 0)
  assert.ok(contracts.validateDemoArtifactContent('DI-2-1', { ...valid, '주요 상황 기록': '학생들이 열심히 참여하여 데이터 해석 능력이 향상되었다.' }, names).length)
})

test('blank, placeholder, missing, and unknown sections cannot pass', () => {
  assert.ok(contracts.validateDemoArtifactContent('A-2-2', {}, names).length)
  assert.ok(contracts.validateDemoArtifactContent('T-1-2', { '설계 방향': '추후 작성', '임의 섹션': '내용' }, names).length)
})

test('shared guidance does not replace normal teacher authority or solo procedures', () => {
  const source = fs.readFileSync(new URL('../src/lib/prompts/system.ts', import.meta.url), 'utf8')
  assert.match(source, /getDemoActivityContract/)
  assert.match(source, /isSolo \? '' :/)
  assert.match(source, /실제 교사의 동의/)
  assert.doesNotMatch(source, /설계 원칙.*방법론 이름과 구체적 행동이 드러나야 함/)
})

test('later activity checks accept complete work and reject missing required structures', () => {
  const fixtures = {
    'T-2-2': { '팀 규칙': table(['규칙명', '필요 배경', '실천 방법'], [['균형 발언', '편중 예방', '모두 말한 후 정리'], ['갈등 조정', '이견 해결', '근거로 돌아가 재검토'], ['공동 기록', '기억 보존', '회의 뒤 기록'], ['자료 검토', '상호의존', '교차 검토 후 반영']]) },
    'T-2-3': { '팀 일정': table(['기간', '활동', '내용', '담당자'], [['수업 5일 전', '자료 제작', '공동 자료 초안', '김하늘'], ['수업 3일 전', '정기 회의', '자료 검토 준비', '이도윤'], ['수업 2일 전', '예비일', '1일 보완 시간', '박서연']]) },
    'A-1-1': { '주제 선정 기준': '핵심 기준: 공동 비전 부합, 교과 간 연결, 학생에게 의미 있음. 참고 기준: 가용 자료와 시간.' },
    'A-1-2': { '주제 선정 기준': '공동 비전과 학생의 실제 경험을 우선한다.', '최종 선정 주제': '측우기와 데이터', '주제 유형': '내용·기능 혼합', '선정 근거': '역사적 맥락과 측정의 공정성을 연결하여 자료를 함께 판단하기 때문이다.' },
    'A-2-1': { '성취기준분석표': table(['교과', '지식·이해', '과정·기능', '가치·태도', '근거·확인'], [['과학', '강우량', '측정', '공정성', '원문 확인 필요'], ['공통 팀 조정', '측정과 기록', '근거 비교', '협력', '원문 확인 필요']]) },
    'A-2-2': { '공통 핵심 아이디어': '같은 조건의 기록은 공정한 판단을 돕는다.', '탐구 질문': '비의 양을 어떻게 공정하게 비교할까?', '통합 수업목표': '측정 조건과 역사적 기록을 연결하여 근거를 들어 비교한다.', '교과별 수업목표': table(['교과', '목표', '기여'], [['과학', '조건을 비교한다', '공정한 측정'], ['수학', '수치를 비교한다', '근거 판단']]) },
    'A-2-3': { '학습자 프로필': '팀 공통: 읽기 수준 차이가 있다. 김하늘: 측정 경험 확인. 이도윤: 역사 용어 지원. 박서연: 그림 표현 선택권. 아직 확인하지 않은 상황은 가정이다.' },
    'Ds-1-1': { '평가 계획': table(['확인 지점·목표', '평가 요소', '방법·증거', '시점', '주체'], [['조건 비교', '측정 조건', '활동지 문항1', '1차시', '교사'], ['근거 판단', '자료 인용', '발표', '2차시', '동료']]) },
    'Ds-1-2': { '문제상황': '역할: 학생들은 마을 기록 조사자이다. 서로 다른 측정 조건의 기록을 비교하고 청중인 친구들에게 근거를 들어 공유한다.', '핵심 질문': '측정 조건이 다른 비의 기록을 그대로 비교해도 될까?' },
    'Ds-1-3': { '학습 활동': table(['흐름 단계', '활동', '차시·시간', '평가'], ['문제 이해', '탐색', '분석', '판단', '생산', '공유·수정'].map(stage => [stage, '근거를 비교한다', '1차시 10분', '자료 인용 확인'])), 'AI 점검': '전체 시간과 평가 연결을 점검하고 문항 읽기의 대체 표현을 제공한다.' },
    'Ds-2-1': { '활동별 자료 설계': table(['활동', '자료·기능', '담당', '기한', '검토자'], [['탐색', '강우량 표', '김하늘', '수업 3일 전', '이도윤'], ['판단', '근거 문장틀', '이도윤', '수업 3일 전', '박서연']]), 'Human-AI Agency': '학생은 자료로 판단한다. AI는 문장 표현을 돕는다. 교사는 안전과 출처를 검토한다.', 'AI 점검': '합성 자료로 개인정보 노출이 없고 출처와 접근성을 확인한다.' },
    'Ds-2-2': { '지원 방안 정리': '읽기 부담은 탐색 활동에서 문장을 나누고 그림 표현을 허용한다.', '스캐폴딩 계획': table(['활동', '지원 내용', '대상', '제거 기준'], [['탐색', '단위 그림', '단위 혼동 학생', '스스로 단위 설명'], ['판단', '근거 문장틀', '표현이 어려운 학생', '독립적으로 근거 표현']]), 'AI 점검': '정답을 대신 주지 않고 독립 수행 시 지원을 점진적으로 제거한다.' },
    'E-1-1': { '사실': '시뮬레이션 SIM-1에서 예시 학생이 두 날짜의 수치를 인용했다.', '해석': '자료의 위치가 명료해 비교하기 쉬웠을 수 있으나 실제 효과는 확인되지 않았다.', '수정안': '기존 문항 “비교해 보자”에서 변경 후 “어느 날 비가 더 왔는지 두 수치를 쓰고 설명하세요”로 수정한다.' },
    'E-2-1': { '협력 과정 성찰': '김하늘의 T-2 근거 원칙에 이도윤이 표현 접근성을 보완한 결정이 공동 자료에 반영되었다.', '팀 개선안': table(['운영 원칙', '변경 내용', '근거', '담당·시점'], [['교차 검토', '본문을 먼저 제시', '내용 기반 협의 필요', '모두 초안 직후'], ['균형 발언', '독립 의견 먼저', '쏠림 예방', '총괄 AI 매 회의']]), '다음 주기 선택': '데모 종료, 다음 주기는 사용자 선택 대기' },
  }
  for (const [code, content] of Object.entries(fixtures)) {
    assert.deepEqual(Array.from(contracts.validateDemoArtifactContent(code, content, names)), [], code)
    assert.ok(contracts.validateDemoArtifactContent(code, {}, names).length, code)
  }
})

test('normal T-2 renderer preserves reordered principle columns and stop conditions', () => {
  const schemas = load('src/lib/artifacts/schemas.ts')
  const reordered = table(['번호', '멈춤 신호', '근거', '설계 원칙'], [
    ['1', '근거가 없으면 보류', '공동 판단을 위해', '판단하려면 근거를 비교해야 한다'],
    ['2', '학생이 배제되면 재검토', '참여를 보장하기 위해', '참여하려면 표현 대안을 제공해야 한다'],
  ])
  const result = schemas.buildT12Structured({ '설계 방향': reordered }, [])
  assert.equal(result.designPrinciples[0].principle, '판단하려면 근거를 비교해야 한다')
  assert.equal(result.designPrinciples[0].rationale, '공동 판단을 위해\n멈춤 신호: 근거가 없으면 보류')
  assert.equal(result.designPrinciples[1].rationale, '참여를 보장하기 위해\n멈춤 신호: 학생이 배제되면 재검토')
  const legacy = schemas.buildT12Structured({ '설계 방향': table(['설계 원칙', '근거'], [['기존 원칙', '기존 근거']]) }, [])
  assert.equal(legacy.designPrinciples[0].principle, '기존 원칙')
  assert.equal(legacy.designPrinciples[0].rationale, '기존 근거')
})

test('table validation explains missing columns and row counts for model repair', () => {
  const malformed = { '역할 배분': table(['담당자', '과업'], names.map(name => [name, '공동 자료 검토'])) }
  assert.match(contracts.validateDemoArtifactContent('T-2-1', malformed, names).join('\n'), /기한|언제|일정|마감/)
  const tooShort = { '역할 배분': table(['담당자', '과업', '기한'], [['김하늘, 이도윤, 박서연', '공동 자료 검토', '수업 3일 전']]) }
  assert.match(contracts.validateDemoArtifactContent('T-2-1', tooShort, names).join('\n'), /현재 1행/)
})

test('legitimate GFM short delimiters, strong headers, and escaped pipes are accepted', () => {
  const rows = names.map(name => `${name} | 탐구, 근거, 협력 \\| 참여 | 근거를 함께 나누는 공동 판단`).join('\n')
  for (const delimiter of ['| - | - | - |', '| -- | -- | -- |', ':- | --: | :-:']) {
    const markdown = `**교사명** | **키워드** | **개인 비전**\n${delimiter}\n${rows}`
    const ast = fromMarkdown(markdown, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] })
    assert.equal(ast.children[0].type, 'table', 'installed GFM parser establishes legitimate format')
    assert.equal(ast.children[0].children.length, names.length + 1)
    const errors = contracts.validateDemoArtifactContent('T-1-1', {
      '개인 비전': markdown, '팀 공통 비전': '학생이 서로 다른 근거를 나누어 함께 판단하는 수업', '핵심 키워드': '탐구, 근거, 협력',
    }, names)
    assert.deepEqual(Array.from(errors), [], delimiter)
  }
})

test('missing or mismatched table headers remain invalid', () => {
  const data = names.map(name => `| ${name} | 탐구, 근거, 협력 | 함께 판단하는 수업 |`).join('\n')
  for (const markdown of [`| - | - | - |\n${data}`, `| 교사명 | 키워드 | 개인 비전 |\n| - | - |\n${data}`]) {
    assert.ok(contracts.validateDemoArtifactContent('T-1-1', {
      '개인 비전': markdown, '팀 공통 비전': '학생이 서로 다른 근거를 나누어 함께 판단하는 수업', '핵심 키워드': '탐구, 근거, 협력',
    }, names).length)
  }
})
