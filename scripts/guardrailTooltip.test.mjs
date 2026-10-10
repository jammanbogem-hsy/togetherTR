// node --test --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/guardrailTooltip.test.mjs
// 단계 막대 가드레일 툴팁이 카드 밖으로 잘리고 ** 가 그대로 보이던 피드백(2026-10-10).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../src/components/stage/StageBar.tsx', import.meta.url), 'utf8')
const fnStart = src.indexOf('export function plainGuardrailSummary')
const fnSrc = src.slice(fnStart, src.indexOf('\n}\n', fnStart) + 2).replace('export function', 'function').replace(/\(summary: string\): string/, '(summary)')
const plainGuardrailSummary = new Function(`${fnSrc}; return plainGuardrailSummary`)()

test('summary drops markdown symbols', () => {
  assert.equal(plainGuardrailSummary('· 학습자 프로필: **팀 공통 학습자 프로필** 선수지식'), '· 학습자 프로필: 팀 공통 학습자 프로필 선수지식')
  assert.equal(plainGuardrailSummary('## 제목\n- 항목 `코드`'), '제목\n· 항목 코드')
})

test('tooltip is portaled to body with fixed position clamped inside the viewport', () => {
  const badge = src.slice(src.indexOf('export function GuardrailBadge'), src.indexOf('// ─── E→T 순환 화살표'))
  assert.match(badge, /createPortal\(/)
  assert.match(badge, /document\.body/)
  assert.match(badge, /className="pointer-events-none fixed z-\[300\]"/)
  assert.match(badge, /Math\.max\(VIEWPORT_GUTTER, Math\.min\(rect\.right - GUARDRAIL_TIP_WIDTH, window\.innerWidth - GUARDRAIL_TIP_WIDTH - VIEWPORT_GUTTER\)\)/)
  assert.match(badge, /onFocus=\{show\}/)
  assert.match(badge, /plainGuardrailSummary\(summary\)/)
  assert.doesNotMatch(badge, /group-hover\/badge/)
})
