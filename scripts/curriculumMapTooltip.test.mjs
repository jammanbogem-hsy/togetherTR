import test from 'node:test'
import assert from 'node:assert/strict'
import { placeMapTooltip } from '../src/components/curriculum-map/mapMath.ts'
import { drawMap } from '../src/components/curriculum-map/drawMap.ts'

const viewport = { width: 1000, height: 700 }
const tooltip = { width: 340, height: 380 }

test('tooltip uses its full measured height at the bottom-right edge', () => {
  const anchor = { x: 970, y: 680 }
  const p = placeMapTooltip(anchor, tooltip, viewport)
  assert.ok(p.x + tooltip.width < anchor.x)
  assert.ok(p.y + tooltip.height < anchor.y)
  assert.ok(p.x >= 8 && p.y >= 8)
})

test('tooltip opens below-right when space is available', () => {
  assert.deepEqual(placeMapTooltip({ x: 30, y: 30 }, tooltip, viewport), { x: 48, y: 48 })
})

test('longer content is repositioned instead of extending below the canvas', () => {
  const anchor = { x: 600, y: 350 }
  const short = placeMapTooltip(anchor, { width: 340, height: 100 }, viewport)
  const long = placeMapTooltip(anchor, tooltip, viewport)
  assert.equal(short.y, 368)
  assert.ok(long.y + tooltip.height <= viewport.height - 8)
})

test('tooltip stays within narrow and resized viewports, including all corners', () => {
  for (const size of [{ width: 320, height: 450 }, { width: 390, height: 280 }, viewport]) {
    const measured = { width: Math.min(340, size.width - 16), height: Math.min(380, size.height - 16) }
    for (const x of [0, size.width / 2, size.width]) {
      for (const y of [0, size.height / 2, size.height]) {
        const p = placeMapTooltip({ x, y }, measured, size)
        assert.ok(p.x >= 8 && p.y >= 8)
        assert.ok(p.x + measured.width <= size.width - 8)
        assert.ok(p.y + measured.height <= size.height - 8)
      }
    }
  }
})

test('hovering a related node never paints the duplicate relation paragraph on the canvas', () => {
  const texts = []
  let lineCount = 0
  const ctx = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'measureText') return text => ({ width: text.length * 8 })
      if (key === 'fillText') return text => texts.push(text)
      if (key === 'lineTo') return () => { lineCount++ }
      return () => {}
    },
    set: () => true,
  })
  const node = (id, x) => ({ id, code: `[${id}]`, subjectId: 'sub_eng', subject: '영어', band: '3-4학년군', text: '자신과 주변 사람을 소개한다.', keywords: [], x, y: 200, degree: 1, r: 20 })
  const reason = '같은 핵심아이디어(표현) · 공통 키워드: 주변 사람이나 사물, 간단, 묘사'
  const result = drawMap(ctx, {
    width: 1000, height: 700, view: { x: 0, y: 0, scale: 1 },
    nodes: [node('6영02-02', 300), node('4영02-05', 600)], edges: [], sim: new Map(),
    ghostIds: new Set(['4영02-05']), subjectColors: { sub_eng: '#0891b2' }, degreeNorms: new Map(),
    radiusOf: () => 20, scoreById: new Map(), searchActive: false,
    selectedId: '6영02-02', focusId: '4영02-05', focusNeighbors: new Set(),
    relatedMeta: new Map([['4영02-05', { relationType: '의미연결', strength: 0.59, reason }]]),
    selectedNeighbors: new Set(), relatedPending: false, alwaysLabels: true, iconFontReady: false,
  })
  assert.equal(result.hits.length, 2)
  assert.ok(lineCount > 0, 'the relationship line should still render')
  assert.ok(texts.includes('[4영02-05]'), 'the standard label should still render')
  assert.ok(!texts.includes(reason), 'detailed explanation belongs only in the tooltip and side panel')
})
