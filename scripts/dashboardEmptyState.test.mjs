// 2026-10-08 사용자 요청: 대시보드 빈 화면 — 데모 체험하기 버튼 제거, 제목·주 버튼을 크게 MD3 로.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../src/app/(app)/dashboard/page.tsx', import.meta.url), 'utf8')
const start = page.indexOf('data-testid="dashboard-empty"')
const empty = page.slice(start, page.indexOf('</MD3Button>', start))

test('빈 화면: 데모 체험하기 버튼이 없고 주 버튼 하나만 있다(데모는 머리말에서)', () => {
  assert.ok(start > 0)
  assert.doesNotMatch(empty, /데모 체험하기|router\.push\('\/demo'\)/)
  assert.match(page.slice(0, start), /데모/, '머리말 데모 진입은 유지')
})

test('빈 화면: MD3 headline-small 제목·설명·큰 filled 버튼', () => {
  assert.match(empty, /<h2 className="text-\[28px\] leading-9 font-semibold text-\[#1F1F1F\]">아직 프로젝트가 없습니다<\/h2>/)
  assert.match(empty, /text-\[16px\] leading-6 text-\[#444746\]/)
  assert.match(empty, /<MD3Button size="md" variant="filled" onClick=\{\(\) => router\.push\('\/projects\/new'\)\}/)
  assert.match(empty, /className="px-8 text-\[18px\] font-semibold"/)
  assert.match(page, /첫 프로젝트 시작하기\n\s*<\/MD3Button>/)
  assert.match(empty, /w-24 h-24[^"]*bg-\[#D3E3FD\] text-\[#0842A0\]/, 'MD3 primary-container 도형 아이콘')
})
