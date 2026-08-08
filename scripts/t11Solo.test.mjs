// T-1-1 산출물 빌더 회귀 테스트
// 검증 대상: 개인 설계(solo) 모드에서 AI가 표가 아닌 '한 문장'으로 보낸 '개인 비전'이
// 저장되지 않아 산출물 칸이 계속 "입력 없음"으로 남던 결함.
// 실행: node --experimental-strip-types --test scripts/t11Solo.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildT11Structured } = await import('../src/lib/artifacts/schemas.ts')

const VISION = '데이터 기반 증거로 문제를 정의하고 팀 프로젝트로 해결책을 설계·검증하는 학습을 추구한다'

test('solo: 한 문장 개인 비전이 personalVisions에 저장된다', () => {
  const out = buildT11Structured(
    { '개인 비전': VISION, '팀 공통 비전': VISION, '핵심 키워드': '문제 해결, 데이터 기반, 프로젝트' },
    [],
    { teacherName: '홍성용' },
  )
  assert.equal(out.personalVisions.length, 1)
  assert.equal(out.personalVisions[0].teacherName, '홍성용')
  assert.equal(out.personalVisions[0].refinedVision, VISION)
  assert.deepEqual(out.personalVisions[0].keywords, ['문제 해결', '데이터 기반', '프로젝트'])
})

test('solo: "키워드:" 줄이 함께 오면 키워드가 분리된다', () => {
  const out = buildT11Structured(
    { '개인 비전': `키워드: 책임감, 비판적 사고\n비전: ${VISION}` },
    [],
    { teacherName: '홍성용' },
  )
  assert.equal(out.personalVisions.length, 1)
  assert.deepEqual(out.personalVisions[0].keywords, ['책임감', '비판적 사고'])
  assert.equal(out.personalVisions[0].refinedVision, VISION)
})

test('solo: 개인 비전 신호가 없어도 확정 비전 문장을 미러링한다', () => {
  const out = buildT11Structured({ '팀 공통 비전': VISION }, [], { teacherName: '홍성용' })
  assert.equal(out.personalVisions.length, 1)
  assert.equal(out.personalVisions[0].refinedVision, VISION)
})

test('solo: 절차 문구는 개인 비전으로 저장하지 않는다', () => {
  const out = buildT11Structured(
    { '개인 비전': '이 내용으로 저장하겠습니다' },
    [],
    { teacherName: '홍성용' },
  )
  assert.equal(out.personalVisions.length, 0)
})

test('팀 모드: 표 파싱 동작이 종전과 동일하다', () => {
  const table = [
    '| 교사명 | 개인 비전 키워드 | AI 정교화 비전 |',
    '| --- | --- | --- |',
    '| 홍성용 | 협력, 탐구 | 학생이 협력하여 탐구하는 수업 |',
    '| 김영희 | 실천 | 배운 것을 실천으로 옮기는 수업 |',
  ].join('\n')
  const out = buildT11Structured({ '개인 비전': table, '팀 공통 비전': VISION }, [])
  assert.equal(out.personalVisions.length, 2)
  assert.equal(out.personalVisions[0].teacherName, '홍성용')
  assert.deepEqual(out.personalVisions[0].keywords, ['협력', '탐구'])
})

test('팀 모드: 한 문장 개인 비전에는 solo 경로가 적용되지 않는다', () => {
  const out = buildT11Structured({ '개인 비전': VISION, '팀 공통 비전': VISION }, [])
  assert.equal(out.personalVisions.length, 0)
})
