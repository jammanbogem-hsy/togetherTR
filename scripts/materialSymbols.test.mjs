// Material Symbols 서브셋 URL 회귀 테스트
// 검증 대상: icon_names가 알파벳 오름차순이 아니면 Google Fonts가 400을 돌려주고
// 폰트가 통째로 로드되지 않아 모든 아이콘이 'assignment' 같은 글자로 노출되던 결함.
// 실행: node --experimental-strip-types --test scripts/materialSymbols.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const layout = readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8')

/** layout.tsx의 아이콘 배열 리터럴에서 이름을 뽑는다 */
function iconNamesFromLayout() {
  const start = layout.indexOf("'&icon_names=' + [")
  assert.ok(start > 0, 'icon_names 배열을 찾지 못했습니다')
  const end = layout.indexOf('].sort().join', start)
  assert.ok(end > start, '.sort().join() 형태가 아닙니다 — 정렬 보장이 사라졌습니다')
  return [...layout.slice(start, end).matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}

test('layout.tsx가 .sort()로 정렬을 보장한다', () => {
  assert.ok(layout.includes('].sort().join('),
    'icon_names를 sort() 없이 join하면 정렬 실수로 폰트 전체가 404/400이 됩니다')
})

test('아이콘 이름이 중복 없이 정의돼 있다', () => {
  const names = iconNamesFromLayout()
  assert.ok(names.length >= 15, `아이콘이 너무 적습니다: ${names.length}`)
  assert.equal(new Set(names).size, names.length, '중복된 아이콘 이름이 있습니다')
})

test('보고서에서 쓰는 아이콘이 모두 서브셋에 포함된다', () => {
  const src = readFileSync(new URL('../src/components/ui/ReportSectionIcon.tsx', import.meta.url), 'utf8')
  // 매핑 테이블 구간만 본다 (fontVariationSettings의 축 이름 wght/opsz를 잡지 않도록)
  const from = src.indexOf('const BY_EMOJI')
  const to = src.indexOf('export function pickReportIcon')
  assert.ok(from > 0 && to > from, '아이콘 매핑 구간을 찾지 못했습니다')
  const used = new Set(
    [...src.slice(from, to).matchAll(/'([a-z_]{3,})'/g)].map(m => m[1])
  )
  const declared = new Set(iconNamesFromLayout())
  const missing = [...used].filter(n => !declared.has(n))
  assert.deepEqual(missing, [],
    `layout.tsx의 icon_names에 빠진 아이콘: ${missing.join(', ')} — 글자로 노출됩니다`)
})

test('정렬된 icon_names는 Google Fonts에서 200을 받는다', { skip: !process.env.NET_TEST }, async () => {
  const names = iconNamesFromLayout().sort().join(',')
  const url = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded'
    + ':opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
    + `&icon_names=${names}&display=swap`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  assert.equal(res.status, 200, `Google Fonts가 ${res.status}를 반환했습니다`)
})
