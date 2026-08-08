// HWPX 테두리 굵기 회귀 테스트
// 검증 대상: HWP가 허용하지 않는 굵기('0.18 mm' 등)를 쓰면 한글이 선을 그리지 못해
// 표 테두리가 사라지거나 일부만 그려지던 결함.
// 실행: node --experimental-strip-types --test scripts/hwpxBorders.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

const { HWP_LINE_WIDTHS, snapLineWidth, buildBorderFill } = await import('../src/lib/hwpx/xml.ts')

const ALLOWED = new Set(HWP_LINE_WIDTHS.map(n => (n < 1 ? `${n} mm` : `${n.toFixed(1)} mm`)))

test('허용 열거값은 그대로 유지된다', () => {
  for (const w of ALLOWED) assert.equal(snapLineWidth(w), w)
})

test('비허용 굵기는 가장 가까운 허용값으로 스냅된다', () => {
  assert.equal(snapLineWidth('0.18 mm'), '0.2 mm')
  assert.equal(snapLineWidth('0.22 mm'), '0.2 mm')
  assert.equal(snapLineWidth('1.2 mm'), '1.0 mm')
  assert.equal(snapLineWidth('0.35 mm'), '0.3 mm')
})

test('파싱 불가 값은 최소 굵기로 폴백한다', () => {
  assert.equal(snapLineWidth('굵게'), '0.1 mm')
})

test('buildBorderFill이 내보내는 모든 width가 허용값이다', () => {
  const xml = buildBorderFill({
    id: 99,
    left: { type: 'SOLID', width: '0.18 mm', color: '#000000' },
    right: { type: 'SOLID', width: '0.22 mm', color: '#000000' },
    top: { type: 'SOLID', width: '1.2 mm', color: '#000000' },
    bottom: { type: 'SOLID', width: '0.15 mm', color: '#000000' },
  })
  for (const m of xml.matchAll(/width="([^"]+)"/g)) {
    assert.ok(ALLOWED.has(m[1]), `비허용 굵기가 XML에 남음: ${m[1]}`)
  }
})

// snapLineWidth가 런타임 안전망이지만, 소스에 비허용 값이 남아 있으면
// 의도한 굵기와 실제 출력이 달라지므로(0.22 → 0.2) 정의 자체를 허용값으로 유지한다.
test('header.ts에 선언된 모든 테두리 굵기가 허용값이다', () => {
  const src = readFileSync(new URL('../src/lib/hwpx/header.ts', import.meta.url), 'utf8')
  const widths = [...src.matchAll(/width:\s*'([\d.]+ mm)'/g)].map(m => m[1])
  assert.ok(widths.length > 0, '테두리 정의를 찾지 못함')
  for (const w of widths) {
    assert.ok(ALLOWED.has(w), `비허용 굵기가 header.ts에 남음: ${w}`)
  }
})
