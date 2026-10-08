import test from 'node:test'
import assert from 'node:assert/strict'
import { groupStandardsByArea, standardClipboardLine } from '../src/lib/curriculum/standardFinder.ts'

test('clipboard contains bracketed code and complete standard in one line without duplicated brackets', () => {
  assert.equal(standardClipboardLine('[4수01-13]', '자리값의 원리를 바탕으로\n 소수 두 자리 수와\t소수 세 자리 수를 이해하고 읽고 쓸 수 있다.'), '[4수01-13] 자리값의 원리를 바탕으로 소수 두 자리 수와 소수 세 자리 수를 이해하고 읽고 쓸 수 있다.')
  assert.equal(standardClipboardLine('4수01-13', ' 내용 '), '[4수01-13] 내용')
})
test('area grouping preserves source order, every standard, and separate subjects with identical area labels', () => {
  const rows = [{ subject:'수학',area:'수와 연산',code:'a' },{ subject:'수학',area:'변화와 관계',code:'b' },{ subject:'과학',area:'변화와 관계',code:'c' },{ subject:'수학',area:'수와 연산',code:'d' },{ subject:'수학',area:'',code:'e' }]
  const groups = groupStandardsByArea(rows)
  assert.deepEqual(groups.map(g=>[g.subject,g.area,g.standards.map(st=>st.code)]), [['수학','수와 연산',['a','d']],['수학','변화와 관계',['b']],['과학','변화와 관계',['c']],['수학','영역 미분류',['e']]])
  assert.equal(new Set(groups.map(g=>g.key)).size,4)
  assert.equal(groups[0].standards[0],rows[0])
})
