import test from 'node:test'
import assert from 'node:assert/strict'
import { needsRowBridge, rowBridgeSource, rowBridgeSelection, canApplyRowBridge, filterContentByStandardCourse } from '../src/lib/curriculum/rowBridge.ts'
import { selectBridgeCandidates } from '../src/lib/curriculum/bridgeStandards.ts'

const row = { id: 'art-low', subject: '미술', coreIdea: '다양한 발상은 아이디어와 주제를 발전시키고 표현의 토대가 된다.', gradeBand: '1-2학년군', isCenter: true, standard: '', knowledge: '', processFunction: '', valueAttitude: '', description: '교사가 작성한 설명' }
const candidate = { subject: '즐거운 생활', coreIdea: '우리는 놀면서 배운다.', contentCoreIdea: '우리는 놀면서 배운다.', standard: '[2즐01-01] 즐겁게 놀이하며 건강하고 안전하게 생활한다.' }

test('ordinary low-grade rows bridge missing subjects even before curriculum JSON loads', () => {
  for (const subject of ['미술', '사회', '과학', '음악', '체육', '도덕', '영어', '실과']) {
    assert.equal(needsRowBridge({subject}, '1-2학년군'), true, subject)
  }
  for (const subject of ['국어', '수학', '통합교과']) assert.equal(needsRowBridge({subject}, '1-2학년군'), false)
  assert.equal(needsRowBridge(row, '5-6학년군'), false)
  assert.equal(needsRowBridge({subject: '실과'}, '3-4학년군'), true)
})

test('ordinary and explicit bridge rows use the original shared core idea', () => {
  const source = { subject: row.subject, coreIdea: row.coreIdea }
  assert.deepEqual(rowBridgeSource(row), source)
  assert.deepEqual(rowBridgeSource({ ...row, subject: '통합교과', coreIdea: '우리는 놀면서 배운다.', linkedCoreIdea: source }), source)
  assert.equal(rowBridgeSource({ subject: '미술', coreIdea: '' }), null)
})

test('selecting a low-grade candidate changes the actual subject and preserves the original link, identity, center and teacher explanation', () => {
  const fields = rowBridgeSelection(row, candidate, '1-2학년군')
  assert.equal(fields.subject, '통합교과')
  assert.equal(fields.gradeBand, '1-2학년군')
  assert.equal(fields.coreIdea, candidate.contentCoreIdea)
  assert.deepEqual(fields.linkedCoreIdea, { subject: row.subject, coreIdea: row.coreIdea })
  const updated = { ...row, ...fields }
  for (const key of ['id', 'isCenter', 'description']) assert.equal(updated[key], row[key])
})

test('cross-band, nonexistent-subject and unrecognizable standards cannot enter the row', () => {
  for (const invalid of [
    { ...candidate, subject: '미술' },
    { ...candidate, standard: '[6미02-05] 고학년 기준' },
    { ...candidate, standard: '임의 생성된 기준' },
    { ...candidate, subject: '알 수 없는 교과' },
    { ...candidate, coreIdea: '', contentCoreIdea: '' },
  ]) assert.equal(rowBridgeSelection(row, invalid, '1-2학년군'), null)
})

test('stale search selections cannot overwrite changed curriculum inputs; freeform explanations remain editable', () => {
  assert.equal(canApplyRowBridge({...row}, row), true)
  for (const key of ['subject', 'gradeBand', 'coreIdea', 'standard', 'knowledge', 'processFunction', 'valueAttitude']) {
    assert.equal(canApplyRowBridge({...row, [key]: '수정한 값'}, row), false, key)
  }
  assert.equal(canApplyRowBridge({...row, description: '검색 중 새로 작성'}, row), true)
  assert.equal(canApplyRowBridge({...row, id:'different-row'}, row), false)
})

test('shortlisting retains integrated-subject candidates instead of filtering an all-Korean top eight to an empty list', () => {
  const list = [
    ...Array.from({length:10}, (_,i) => ({ subject:'국어', code:`2국${i}`, score:1-i*.01 })),
    ...Array.from({length:5}, (_,i) => ({ subject:'통합교과', code:`2즐${i}`, score:.8-i*.01 })),
  ]
  const selected = selectBridgeCandidates(list, 8, '통합교과')
  assert.equal(selected.length, 8)
  assert.equal(new Set(selected.map(c=>c.code)).size, 8)
  assert.equal(selected.filter(c=>c.subject==='통합교과').length, 4)
  assert.equal(selected[0].code, '2국0')
  for (const item of selected) assert.equal(item.score,list.find(c=>c.code===item.code).score)
  assert.equal(selectBridgeCandidates(list, 1, '통합교과')[0].code,'2즐0')
  assert.equal(selectBridgeCandidates(list, 8)[7].code,'2국7')
})

test('integrated-subject content follows the selected standard course, even when core ideas match', () => {
  const items = ['바른 생활', '슬기로운 생활', '즐거운 생활'].map(course=>({course,coreIdea:'공통 핵심아이디어'}))
  for (const [prefix,course] of [['바','바른 생활'],['슬','슬기로운 생활'],['즐','즐거운 생활']]) {
    assert.deepEqual(filterContentByStandardCourse(items,{subject:'통합교과',standard:`[2${prefix}04-02] 기준`}).map(i=>i.course),[course])
  }
  assert.deepEqual(filterContentByStandardCourse(items,{subject:'통합교과',standard:'[2슬04-02] 기준 | [2즐02-04] 기준'}).map(i=>i.course),['슬기로운 생활','즐거운 생활'])
  assert.deepEqual(filterContentByStandardCourse(items.slice(0,1),{subject:'통합교과',standard:'[2즐02-04] 기준'}),[])
  assert.equal(filterContentByStandardCourse(items,{subject:'미술',standard:'[6미02-05] 기준'}),items)
})
