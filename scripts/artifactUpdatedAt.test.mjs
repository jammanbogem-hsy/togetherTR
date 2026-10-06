// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/artifactUpdatedAt.test.mjs
// R1: artifacts.<code>.updatedAt — 실제로 바뀐 저장만 시각을 찍는다. 모든 앱 쓰기는 setProjectArtifact 한 곳을 지난다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { nextArtifactUpdatedAt, sameArtifactSnapshot } from '../src/lib/artifacts/artifactUpdatedAt.ts'
import * as artifactUpdatedAt from '../src/lib/artifacts/artifactUpdatedAt.ts'
import * as projectMode from '../src/lib/project/projectMode.ts'
import * as memberAdmin from '../src/lib/project/memberAdmin.ts'
import * as presenceThrottle from '../src/lib/coedit/presenceThrottle.ts'
import * as presenceOwner from '../src/lib/coedit/presenceOwner.ts'
import * as schemas from '../src/lib/artifacts/schemas.ts'
import { ACTIVITY_META } from '../src/types/index.ts'

const saved = { title: '팀 비전', status: 'in_review', content: { 비전: '함께 배우는 교실', 키워드: ['협력', '탐구'] }, updatedAt: 1000 }

test('같은 내용 재저장(키 순서만 다름 포함)은 기존 시각 유지, 없으면 필드 생략', () => {
  const reordered = { status: 'in_review', content: { 키워드: ['협력', '탐구'], 비전: '함께 배우는 교실' }, title: '팀 비전' }
  assert.equal(sameArtifactSnapshot(saved, reordered), true)
  assert.equal(nextArtifactUpdatedAt(saved, reordered, 5000), 1000)
  assert.equal(nextArtifactUpdatedAt({ ...saved, updatedAt: undefined }, reordered, 5000), undefined)
  assert.equal(nextArtifactUpdatedAt(saved, { ...reordered, content: { ...reordered.content, 메모: undefined } }, 5000), 1000, 'undefined 키는 무시')
})

test('내용·제목·상태(확정·재편집)가 바뀌거나 처음 저장이면 now', () => {
  assert.equal(nextArtifactUpdatedAt(undefined, saved, 5000), 5000)
  assert.equal(nextArtifactUpdatedAt(saved, { ...saved, content: { ...saved.content, 비전: '바뀜' } }, 5000), 5000)
  assert.equal(nextArtifactUpdatedAt(saved, { ...saved, title: '새 제목' }, 5000), 5000)
  assert.equal(nextArtifactUpdatedAt(saved, { ...saved, status: 'confirmed' }, 5000), 5000, '확정')
  assert.equal(nextArtifactUpdatedAt({ ...saved, status: 'confirmed' }, saved, 5000), 5000, '재편집')
  assert.equal(nextArtifactUpdatedAt(saved, { ...saved, content: { ...saved.content, 키워드: ['협력'] } }, 5000), 5000)
})

function loadProjects(store) {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const firestore = {
    doc: (_db, ...segments) => segments.join('/'),
    collection: (_db, ...segments) => segments.join('/'),
    getDoc: async path => ({ exists: () => store.docs.has(path), data: () => structuredClone(store.docs.get(path)) }),
    getDocs: async () => ({ docs: [] }),
    updateDoc: async (path, updates) => { store.updates.push({ path, updates }) },
    serverTimestamp: () => ({ __op: 'serverTimestamp' }),
  }
  const modules = {
    'firebase/firestore': firestore, './config': { db: {}, auth: {} },
    '@/lib/project/projectMode': projectMode, '@/lib/project/memberAdmin': memberAdmin,
    '@/lib/coedit/presenceThrottle': presenceThrottle, '@/lib/coedit/presenceOwner': presenceOwner,
    '@/lib/artifacts/artifactUpdatedAt': artifactUpdatedAt, '@/lib/artifacts/schemas': schemas, '@/types': { ACTIVITY_META },
    '@/lib/training/trainingMode': { isTrainingActivity: () => false },
  }
  const context = { exports: {}, console, Date, setTimeout, clearTimeout, structuredClone, require: name => modules[name] ?? {} }
  vm.runInNewContext(compiled, context)
  return context.exports
}

test('setProjectArtifact: 실제 쓰기 경로에서 바뀐 저장만 updatedAt 을 찍고 undefined 를 쓰지 않는다', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 7000 })
  const project = { id: 'p', mode: 'solo', memberUids: ['me'], artifacts: { 'T-1-1': { ...saved, version: 2 } } }
  const store = { docs: new Map([['projects/p', project]]), updates: [] }
  const projects = loadProjects(store)
  const written = () => store.updates.at(-1).updates['artifacts.T-1-1']
  // 같은 내용 재저장
  await projects.setProjectArtifact('p', 'T-1-1', { title: saved.title, status: 'in_review', content: { ...saved.content }, version: 2 })
  assert.equal(written().updatedAt, 1000)
  // 확정
  await projects.setProjectArtifact('p', 'T-1-1', { title: saved.title, status: 'confirmed', content: { ...saved.content }, version: 2, confirmedBy: 'me', confirmedAt: 7000 })
  assert.equal(written().updatedAt, 7000)
  // 처음 저장되는 활동, 이전 시각이 없는 같은 내용 재저장은 필드 자체가 없다
  await projects.setProjectArtifact('p', 'T-1-2', { title: '방향', status: 'in_review', content: { 원칙: '하나' }, version: 1 })
  assert.equal(store.updates.at(-1).updates['artifacts.T-1-2'].updatedAt, 7000)
  store.docs.set('projects/p', { ...project, artifacts: { 'T-1-1': { title: 'x', status: 'in_review', content: { a: '1' }, version: 1 } } })
  await projects.setProjectArtifact('p', 'T-1-1', { title: 'x', status: 'in_review', content: { a: '1' }, version: 1 })
  assert.equal(Object.hasOwn(written(), 'updatedAt'), false)
})

test('모든 앱 산출물 쓰기는 setProjectArtifact 를 거친다(데모 엔진만 별도 경로이며 같은 규칙 사용)', () => {
  const offenders = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(path, 'utf8')
        if (/\[`artifacts\.\$\{[^}]+\}`\]\s*:/.test(text)) offenders.push(path.replace(/^.*\/src\//, 'src/'))
      }
    }
  }
  walk(new URL('../src', import.meta.url).pathname)
  assert.deepEqual(offenders.sort(), ['src/lib/demo/engine/project.ts', 'src/lib/firebase/projects.ts'])
  const demo = fs.readFileSync(new URL('../src/lib/demo/engine/project.ts', import.meta.url), 'utf8')
  assert.match(demo, /updatedAt: nextArtifactUpdatedAt\(previous, artifact, Date\.now\(\)\)/)
})
