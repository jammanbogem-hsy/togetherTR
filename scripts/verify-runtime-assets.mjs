// Production-bundle regression check. Fails (exit 1) when the files the SSR
// routes read at runtime are NOT physically present under public/ — the only
// place Next 16 + Firebase frameworks reliably ships into the function bundle.
//
// This guards against the empty-cell regression: if the prebuild sync is
// removed, a subject file is dropped, or the core-idea-area mapping is missing,
// the build fails loudly instead of deploying blank 지식·이해 / 과정·기능 cells.
//
// Runs against public/ (what the framework bundles) rather than .firebase/*,
// so it needs no deploy. It also asserts real content (사회/정치 5-6학년군
// 지식⋅이해 non-empty) at the physical bundle location.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const PUBLIC_DIR = path.join(REPO_ROOT, 'public')

const CONTENT_SYSTEMS_SUBDIR = 'curriculum-content-systems'
const MAPPING_FILENAME = 'core-idea-area-mapping.json'

const errors = []
function check(cond, message) {
  if (!cond) errors.push(message)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

// 1) Every committed source subject file must be present in the bundle dir.
const srcCsDir = path.join(REPO_ROOT, 'data', CONTENT_SYSTEMS_SUBDIR)
const dstCsDir = path.join(PUBLIC_DIR, CONTENT_SYSTEMS_SUBDIR)

check(fs.existsSync(dstCsDir), `missing bundle dir: public/${CONTENT_SYSTEMS_SUBDIR}/ (run npm run sync:runtime-assets)`)

if (fs.existsSync(srcCsDir) && fs.existsSync(dstCsDir)) {
  const expected = fs.readdirSync(srcCsDir).filter(n => n.endsWith('.json') && !n.endsWith('.bak'))
  const shipped = fs.readdirSync(dstCsDir)
  for (const name of expected) {
    check(shipped.includes(name), `bundle missing content-system file: public/${CONTENT_SYSTEMS_SUBDIR}/${name}`)
  }
  // No .bak must leak into the bundle.
  check(!shipped.some(n => n.endsWith('.bak')), `.bak file leaked into public/${CONTENT_SYSTEMS_SUBDIR}/`)
  // Each shipped file must parse and carry a 내용체계 array.
  for (const name of shipped.filter(n => n.endsWith('.json'))) {
    try {
      const doc = readJson(path.join(dstCsDir, name))
      check(Array.isArray(doc['내용체계']) && doc['내용체계'].length > 0, `empty/invalid 내용체계 in public/${CONTENT_SYSTEMS_SUBDIR}/${name}`)
    } catch (e) {
      check(false, `unparseable public/${CONTENT_SYSTEMS_SUBDIR}/${name}: ${e.message}`)
    }
  }
}

// 2) End-to-end content assertion at the bundle location: 사회 / 정치 (공통)
//    must carry non-empty 5-6학년군 지식⋅이해 and 과정⋅기능 원문.
const socFile = path.join(dstCsDir, '사회내용체계.json')
if (fs.existsSync(socFile)) {
  try {
    const entries = readJson(socFile)['내용체계'] ?? []
    const politics = entries.find(e => String(e['영역']).includes('정치') && String(e['교육과정']).includes('공통'))
    check(Boolean(politics), 'no 공통 교육과정 정치 entry in shipped 사회내용체계.json')
    const band = politics?.['학년군별']?.['5-6학년군'] ?? {}
    check((band['지식⋅이해'] ?? []).length > 0, 'shipped 사회/정치 5-6학년군 지식⋅이해 is empty')
    check((band['과정⋅기능'] ?? []).length > 0, 'shipped 사회/정치 5-6학년군 과정⋅기능 is empty')
  } catch (e) {
    check(false, `failed to validate shipped 사회내용체계.json: ${e.message}`)
  }
}

// 3) core-idea-area mapping must be present in the bundle (autofill route reads it).
const shippedMapping = path.join(PUBLIC_DIR, MAPPING_FILENAME)
const sourceMapping = path.join(REPO_ROOT, 'data', MAPPING_FILENAME)
if (fs.existsSync(sourceMapping)) {
  check(fs.existsSync(shippedMapping), `bundle missing public/${MAPPING_FILENAME} (sync did not run)`)
  if (fs.existsSync(shippedMapping)) {
    try {
      const mapping = readJson(shippedMapping)
      check(Array.isArray(mapping) && mapping.length > 0, `public/${MAPPING_FILENAME} is empty`)
    } catch (e) {
      check(false, `unparseable public/${MAPPING_FILENAME}: ${e.message}`)
    }
  }
} else {
  console.warn(`[verify-runtime-assets] WARNING: data/${MAPPING_FILENAME} absent (generated file). /api/curriculum-sheet/autofill will fall back to empty mapping. Run npm run build:core-idea-mapping to generate it.`)
}

if (errors.length > 0) {
  console.error('[verify-runtime-assets] FAILED — SSR bundle would ship empty curriculum data:')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log('[verify-runtime-assets] OK — content-system JSON + core-idea-area mapping present in public/ bundle.')
