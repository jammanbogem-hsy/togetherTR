// Production-bundle regression test for the empty 지식·이해 / 과정·기능 cells.
// Run: node --experimental-strip-types --test scripts/contentSystemBundle.test.mjs
//
// Reproduces the deployed Firebase SSR bundle, where Next 16 + Firebase
// frameworks drop the data/** tracing glob and ship ONLY public/. It builds an
// isolated temp bundle containing just public/ (no data/), runs the real
// prebuild sync into it, and asserts the source the reader falls back to
// (public/curriculum-content-systems) carries non-empty 학년군별 원문.
//
// Faithful to what contentSystemReader reads (findContentSystemDir now lists
// public/ as a fallback candidate + extractCategories reads 학년군별). The TS
// reader itself is not imported here: this repo uses extensionless relative
// imports (./graphReader) that raw Node's type-stripping cannot resolve, so the
// module graph is only loadable under Next/Turbopack. The reader's algorithm is
// unchanged by this fix — only the file location it resolves changed.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncRuntimeAssets } from './sync-runtime-assets.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

// The exact candidate order in contentSystemReader.findContentSystemDir():
// data/ first (dev), public/ fallback (prod bundle). Kept in sync deliberately.
function resolveContentSystemDir(cwd) {
  const candidates = [
    path.join(cwd, 'data/curriculum-content-systems'),
    path.join(cwd, 'public/curriculum-content-systems'),
  ]
  return candidates.find(c => fs.existsSync(c)) ?? null
}

test('deployed bundle (public only, no data/) still resolves content-system 원문', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcid-bundle-'))
  try {
    // Mirror the deployed function bundle: public/ present, data/ absent.
    const tmpPublic = path.join(tmp, 'public')
    fs.mkdirSync(tmpPublic, { recursive: true })
    // Run the real prebuild sync into the temp bundle (source = repo data/).
    syncRuntimeAssets({ repoRoot: REPO_ROOT, publicDir: tmpPublic })

    // Production topology invariant: no data/ dir, so the reader MUST use the
    // public/ fallback candidate (the regression was that it had none).
    assert.equal(fs.existsSync(path.join(tmp, 'data')), false)
    const dir = resolveContentSystemDir(tmp)
    assert.equal(dir, path.join(tmpPublic, 'curriculum-content-systems'),
      'reader would not fall back to public/ in a data-less bundle')

    // core-idea-area mapping (autofill route) also shipped.
    assert.ok(fs.existsSync(path.join(tmpPublic, 'core-idea-area-mapping.json')),
      'core-idea-area-mapping.json missing from bundle')

    // The 사회/정치 (공통) source the reader reads must carry non-empty
    // 5-6학년군 지식⋅이해 / 과정⋅기능 원문 — the exact cells that were blank.
    const entries = JSON.parse(fs.readFileSync(path.join(dir, '사회내용체계.json'), 'utf-8'))['내용체계'] ?? []
    const politics = entries.find(e => String(e['영역']).includes('정치') && String(e['교육과정']).includes('공통'))
    assert.ok(politics, 'no 공통 교육과정 정치 entry in shipped 사회내용체계.json')
    const band = politics['학년군별']?.['5-6학년군'] ?? {}
    assert.ok((band['지식⋅이해'] ?? []).length > 0, '사회/정치 5-6학년군 지식⋅이해 empty (bundle regression)')
    assert.ok((band['과정⋅기능'] ?? []).length > 0, '사회/정치 5-6학년군 과정⋅기능 empty (bundle regression)')
    assert.ok((band['지식⋅이해'] ?? []).includes('선거의 의미와 역할'), 'expected 5-6학년군 지식⋅이해 원문 missing')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
