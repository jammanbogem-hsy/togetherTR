import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectMapSourceFiles, preparePublicCurriculumMap } from './prepare-public-curriculum-map.mjs'

test('public map contains only the map API routes and no project/auth dependencies', () => {
  const files = collectMapSourceFiles()
  assert.deepEqual(files.filter(file => file.startsWith('src/app/')), [
    'src/app/api/curriculum-map/related/route.ts',
    'src/app/api/curriculum-map/search/route.ts',
  ])
  assert.ok(files.includes('src/components/curriculum-map/CurriculumMapWorkspace.tsx'))
  assert.ok(!files.some(file => /firebase|\/store\/|\/auth\//.test(file)))
})

test('standalone package is deployable, has curriculum data, and excludes local credentials', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tcid-public-map-test-'))
  try {
    preparePublicCurriculumMap(target)
    const readJson = file => JSON.parse(fs.readFileSync(path.join(target, file), 'utf8'))
    assert.equal(readJson('firebase.json').hosting.site, 'jammanbo-curriculum-map')
    assert.equal(readJson('package.json').scripts.build, 'next build')
    assert.ok(readJson('public/curriculum_map.json').nodes.length > 100)
    assert.ok(fs.readdirSync(path.join(target, 'public/curriculum-content-systems')).length > 5)
    assert.match(fs.readFileSync(path.join(target, 'src/app/page.tsx'), 'utf8'), /<CurriculumMapWorkspace standalone/)
    assert.ok(!fs.existsSync(path.join(target, 'src/app/(app)')))
    assert.ok(!fs.existsSync(path.join(target, '.env.local')))
    assert.throws(() => preparePublicCurriculumMap(target), /must be empty/)
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('preparation cannot overwrite the repository or an ancestor directory', () => {
  assert.throws(() => preparePublicCurriculumMap(process.cwd()), /outside the repository/)
  assert.throws(() => preparePublicCurriculumMap(path.dirname(process.cwd())), /outside the repository/)
})
