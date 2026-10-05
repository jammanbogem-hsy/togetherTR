// TASK-R2: 공동 편집 참여자 표시 — 대비 4.5:1·같은 사람 같은 색·편집 칸 이름표/테두리/커서·이탈/만료
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

function loadTsx(relativePath, bindings) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const context = { exports: {}, setInterval, clearInterval, Date, Math, ...bindings, require(name) {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return jsxRuntime
    assert.ok(Object.hasOwn(bindings, name), name)
    return bindings[name]
  } }
  vm.runInNewContext(compiled, context)
  return context.exports
}

const presence = loadTsx('../src/components/artifacts/presence.tsx', {})
const helpers = loadTsx('../src/components/artifacts/workspaceHelpers.tsx', {
  '@/lib/utils': { cn: (...c) => c.filter(Boolean).join(' ') },
  './presence': presence,
})
// 앱 프로필 파스텔 색(auth.ts AVATAR_COLORS)
const PASTELS = [...fs.readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8').matchAll(/'(#[0-9A-F]{6})', \/\/ p/g)].map(m => m[1])

test('R2a: 파스텔 프로필 색도 이름표(흰 글자)·칩(연한 배경) 모두 대비 4.5:1 이상, 같은 색은 늘 같은 결과', () => {
  assert.ok(PASTELS.length >= 10)
  for (const color of [...PASTELS, '#A0BCE8', '#FFFFFF', '#000000', 'not-a-color', undefined]) {
    const ink = presence.presenceInk(color)
    assert.ok(presence.contrastRatio(ink, '#FFFFFF') >= 4.5, `${color} → ${ink}`)
    const chip = presence.presenceChipStyle(color)
    assert.ok(presence.contrastRatio(chip.color, chip.backgroundColor) >= 4.5, `${color} 칩`)
    assert.equal(presence.presenceTagStyle(color).color, '#FFFFFF')
    assert.equal(presence.presenceInk(color), ink) // 일관
  }
  // 파스텔의 원래 대비는 부족했다(결함 재현)
  assert.ok(presence.contrastRatio('#A0BCE8', '#FFFFFF') < 4.5)
  // 서로 다른 사람 색은 서로 다른 잉크로 남는다
  assert.equal(new Set(PASTELS.map(c => presence.presenceInk(c))).size, PASTELS.length)
  assert.match(presence.presenceAccentStyle('#A0BCE8').boxShadow, /^0 0 0 2px #[0-9A-F]{6}40$/)
})

test('R2b: 참여 상태 — 최근 신호는 표시, 끊긴 뒤 3분까지 잠시 비움, 그 뒤 숨김', () => {
  const now = 1_000_000
  const entries = [
    { uid: 'a', updatedAt: now - 5_000, cellKey: 'r1:c1' },
    { uid: 'b', updatedAt: now - 30_000, cellKey: 'modal:idle' },
    { uid: 'c', updatedAt: now - 100_000 },
    { uid: 'd', updatedAt: now - 20_000 - 180_000 - 1 },
    null,
  ]
  const { fresh, away } = presence.splitPresence(entries, now, 20_000)
  assert.equal(fresh.map(e => e.uid).join(), 'a')
  assert.equal(away.map(e => e.uid).join(), 'b,c')
  const wide = presence.splitPresence(entries, now, 60_000)
  assert.equal(wide.fresh.map(e => e.uid).join(), 'a,b')
  assert.equal(presence.presenceTitle({ uid: 'a', displayName: '홍성용', cellKey: 'r1:c1' }), '홍성용 — 편집 중')
  assert.equal(presence.presenceTitle({ uid: 'a', displayName: '홍성용', cellKey: 'modal:idle' }), '홍성용 — 보는 중')
  assert.equal(presence.presenceTitle({ uid: 'a', displayName: '홍성용' }, true), '홍성용 — 잠시 비움')
  const html = renderToStaticMarkup(React.createElement(presence.PresenceAwayChips, { entries: [{ uid: 'b', displayName: '캔바1', color: '#F4AAAA' }] }))
  assert.match(html, /캔바1 · 잠시 비움/)
  assert.match(html, /data-presence-state="away"/)
})

test('R2c: 편집 칸 커서 — 같은 글꼴로 겹쳐 그린 커서와 진한 이름표, 넘기지 않으면 기존 구조 그대로', () => {
  const cls = 'w-full px-2 py-1.5 text-[15px] leading-relaxed text-[#202124]'
  const withCaret = renderToStaticMarkup(React.createElement(helpers.AutoGrowTextarea, {
    value: '설계 원칙을 적어요', className: cls, onChange() {},
    caretEditors: [{ uid: 'b', displayName: '캔바1', color: '#A0BCE8', caretPos: 3 }],
  }))
  assert.match(withCaret, /^<div class="relative"><textarea/)
  assert.match(withCaret, /aria-hidden="true"/)
  const ink = presence.presenceInk('#A0BCE8')
  assert.match(withCaret, new RegExp(`background-color:${ink};color:#FFFFFF">캔바1<`))
  assert.match(withCaret, /!text-transparent/)
  const empty = renderToStaticMarkup(React.createElement(helpers.AutoGrowTextarea, { value: 'x', className: cls, onChange() {}, caretEditors: [] }))
  assert.match(empty, /^<div class="relative"><textarea/) // 편집자가 없어도 같은 구조(포커스 유지)
  const plain = renderToStaticMarkup(React.createElement(helpers.AutoGrowTextarea, { value: 'x', className: cls, onChange() {} }))
  assert.match(plain, /^<textarea/)
})

test('R2d: 13개 공동 편집 창이 공용 표시를 쓰고 파스텔 원색 표시가 남지 않는다', () => {
  const dir = new URL('../src/components/artifacts/', import.meta.url)
  const files = fs.readdirSync(dir).filter(f => f.endsWith('WorkspaceModal.tsx'))
  assert.equal(files.length, 13)
  for (const file of files) {
    const src = fs.readFileSync(new URL(file, dir), 'utf8')
    assert.match(src, /from '\.\/presence'/, file)
    assert.match(src, /usePresenceClock\(\)/, file)
    assert.doesNotMatch(src, /backgroundColor: (?:ed|editor|o)\.color|\$\{entry\.color\}18|<Avatar key=\{o\.uid\}/, file)
    if (file !== 'CoeditWorkspaceModal.tsx') {
      assert.match(src, /<PresenceAwayChips entries=\{awayEditors\} \/>/, file)
      assert.match(src, /caretEditors=\{/, file)
    }
  }
})
