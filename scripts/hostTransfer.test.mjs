// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/hostTransfer.test.mjs
// TASK-H1: 기록 권한(host) 넘기기·요청, 사용자 노출 문구 '방장' → '기록'/'기록 담당'.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import * as hostTransfer from '../src/lib/project/hostTransfer.ts'
import * as memberAdmin from '../src/lib/project/memberAdmin.ts'
import * as projectMode from '../src/lib/project/projectMode.ts'
import * as presenceThrottle from '../src/lib/coedit/presenceThrottle.ts'
import * as presenceOwner from '../src/lib/coedit/presenceOwner.ts'
import * as artifactUpdatedAt from '../src/lib/artifacts/artifactUpdatedAt.ts'

const { planHostTransfer, pendingHostRequests, canRequestHost, myHostRequestState, hostTransferErrorText } = hostTransfer
const { isProjectHost, planMemberRemoval } = memberAdmin
const base = () => ({
  id: 'p', hostUid: 'host', createdBy: 'host', memberUids: ['host', 'kim', 'lee'],
  memberInfo: { host: { displayName: '홍성용' }, kim: { displayName: '김민지' }, lee: { displayName: '이수진' } },
})

test('넘기기 계획: hostUid·createdBy 를 함께 바꾸고 처음 만든 사람은 한 번만 남긴다', () => {
  const plan = planHostTransfer(base(), 'host', 'kim', 100)
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.updates, { hostUid: 'kim', createdBy: 'kim', originalCreatedBy: 'host' })
  assert.deepEqual(plan.record, { from: 'host', to: 'kim', byUid: 'host', at: 100, via: 'transfer' })
  const after = { ...base(), ...plan.updates }
  assert.equal(isProjectHost(after, 'host'), false, '이전 기록 담당은 일반 팀원')
  assert.equal(isProjectHost(after, 'kim'), true)
  const again = planHostTransfer(after, 'kim', 'lee', 200)
  assert.equal(again.updates.originalCreatedBy, undefined, '처음 만든 사람 기록은 덮지 않음')
})

test('넘기기 거부: 팀원·없는 사람·이미 기록 담당', () => {
  assert.equal(planHostTransfer(base(), 'kim', 'lee', 1).error, 'not-host')
  assert.equal(planHostTransfer(base(), 'host', 'ghost', 1).error, 'target-not-member')
  assert.equal(planHostTransfer(base(), 'host', 'host', 1).error, 'already-host')
  assert.equal(planHostTransfer(null, 'host', 'kim', 1).error, 'project-not-found')
  assert.match(hostTransferErrorText(new Error('not-host')), /기록 담당만 넘길 수 있어요/)
})

test('요청: 팀원만, 기록 담당이 오프라인이어도 문서에 남아 접속하면 보이고, 거절한 것은 빠진다', () => {
  const project = { ...base(), hostRequests: {
    lee: { at: 20, name: '이수진' }, kim: { at: 10, name: '김민지' },
    gone: { at: 5, name: '나간 사람' }, host: { at: 1, name: '홍성용' },
  } }
  assert.deepEqual(pendingHostRequests(project, 'host').map(r => r.uid), ['kim', 'lee'], '먼저 요청한 순서, 나간 사람·기록 담당 제외')
  assert.deepEqual(pendingHostRequests(project, 'kim'), [], '팀원 화면에는 배너 없음')
  project.hostRequests.kim.rejectedAt = 30
  assert.deepEqual(pendingHostRequests(project, 'host').map(r => r.uid), ['lee'])
  assert.equal(myHostRequestState(project, 'kim'), 'rejected')
  assert.equal(myHostRequestState(project, 'lee'), 'pending')
  assert.equal(myHostRequestState(project, 'host'), 'none')
  assert.equal(canRequestHost(project, 'kim'), true)
  assert.equal(canRequestHost(project, 'host'), false)
  assert.equal(canRequestHost({ ...project, demoRun: { id: 'x' } }, 'kim'), false)
  assert.equal(planHostTransfer(project, 'host', 'lee', 1).record.via, 'request')
})

test('내보내기는 그 팀원의 기록 권한 요청도 정리한다', () => {
  const plan = planMemberRemoval({ ...base(), hostRequests: { lee: { at: 1, name: '이수진' } } }, 'host', 'lee')
  assert.ok(plan.deleteFieldPaths.includes('hostRequests.lee'))
})

// ── 실제 projects.ts 를 낙관적 동시성 트랜잭션 mock 위에서 실행 ──
function loadProjects(store) {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const marker = (op, value) => (value === undefined ? { __op: op } : { __op: op, value })
  const apply = (data, updates) => {
    for (const [key, value] of Object.entries(updates)) {
      const parts = key.split('.')
      let target = data
      for (const part of parts.slice(0, -1)) target = target[part] ??= {}
      const last = parts.at(-1)
      if (value?.__op === 'deleteField') delete target[last]
      else if (value?.__op === 'arrayUnion') target[last] = [...(target[last] ?? []), value.value]
      else if (value?.__op === 'serverTimestamp') target[last] = 'ts'
      else target[last] = value
    }
  }
  const firestore = {
    doc: (_db, ...segments) => segments.join('/'),
    updateDoc: async (path, updates) => { const d = store.docs.get(path); apply(d.value, updates); d.version++ },
    async runTransaction(_db, fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map(), ops = []
        try {
          await fn({
            get: async path => {
              const d = store.docs.get(path)
              reads.set(path, d?.version ?? 0)
              if (store.gate) await store.gate
              return { exists: () => !!d, data: () => d && structuredClone(d.value) }
            },
            update: (path, updates) => ops.push({ path, updates }),
          })
        } catch (error) { if (ops.length === 0) throw error }
        if ([...reads].some(([path, version]) => (store.docs.get(path)?.version ?? 0) !== version)) { store.retries++; continue }
        for (const { path, updates } of ops) { const d = store.docs.get(path); apply(d.value, updates); d.version++ }
        return
      }
      throw new Error('retries exhausted')
    },
    arrayUnion: value => marker('arrayUnion', value), deleteField: () => marker('deleteField'), serverTimestamp: () => marker('serverTimestamp'),
  }
  const modules = {
    'firebase/firestore': firestore, './config': { db: {}, auth: {} },
    '@/lib/project/hostTransfer': hostTransfer, '@/lib/project/memberAdmin': memberAdmin, '@/lib/project/projectMode': projectMode,
    '@/lib/coedit/presenceThrottle': presenceThrottle, '@/lib/coedit/presenceOwner': presenceOwner, '@/lib/artifacts/artifactUpdatedAt': artifactUpdatedAt,
  }
  const context = { exports: {}, console, Date, setTimeout, clearTimeout, structuredClone, require: name => modules[name] ?? {} }
  vm.runInNewContext(compiled, context)
  return context.exports
}
const storeOf = project => ({ docs: new Map([['projects/p', { value: project, version: 1 }]]), retries: 0, gate: null })

test('transferHostTo: 요청을 정리하고 이력을 남기며, 이전 기록 담당은 다시 넘기지 못한다', async () => {
  const store = storeOf({ ...base(), hostRequests: { kim: { at: 1, name: '김민지' } } })
  const projects = loadProjects(store)
  await projects.transferHostTo('p', 'host', 'kim')
  const saved = store.docs.get('projects/p').value
  assert.equal(saved.hostUid, 'kim'); assert.equal(saved.createdBy, 'kim'); assert.equal(saved.originalCreatedBy, 'host')
  assert.equal(saved.hostRequests.kim, undefined)
  assert.equal(saved.hostTransfers.length, 1)
  assert.equal(saved.hostTransfers[0].via, 'request')
  await assert.rejects(projects.transferHostTo('p', 'host', 'lee'), /not-host/)
})

test('동시 넘기기 경합: 두 창이 같은 시점에 다른 팀원에게 넘겨도 한 번만 적용된다', async () => {
  const store = storeOf(base())
  const projects = loadProjects(store)
  let open
  store.gate = new Promise(resolve => { open = resolve })
  const toKim = projects.transferHostTo('p', 'host', 'kim')
  const toLee = projects.transferHostTo('p', 'host', 'lee')
  await new Promise(resolve => setTimeout(resolve, 0))
  store.gate = null; open()
  const results = await Promise.allSettled([toKim, toLee])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.match(String(results.find(r => r.status === 'rejected').reason), /not-host/)
  const saved = store.docs.get('projects/p').value
  assert.equal(saved.hostTransfers.length, 1)
  assert.equal(saved.hostUid, saved.hostTransfers[0].to)
  assert.ok(store.retries >= 1, '늦은 쪽은 최신 문서로 다시 판정했다')
})

test('요청·취소·거절 쓰기 경로', async () => {
  const store = storeOf(base())
  const projects = loadProjects(store)
  await projects.requestHostRole('p', 'lee', '이수진')
  assert.equal(store.docs.get('projects/p').value.hostRequests.lee.name, '이수진')
  await projects.rejectHostRequest('p', 'lee')
  assert.equal(typeof store.docs.get('projects/p').value.hostRequests.lee.rejectedAt, 'number')
  await projects.requestHostRole('p', 'lee', '이수진')
  assert.equal(store.docs.get('projects/p').value.hostRequests.lee.rejectedAt, undefined, '다시 요청하면 거절 표시가 지워진다')
  await projects.cancelHostRequest('p', 'lee')
  assert.equal(store.docs.get('projects/p').value.hostRequests.lee, undefined)
})

test('규칙 준비: 팀원은 hostRequests 의 자기 항목만, 넘기기 이력·처음 만든 사람은 못 바꾼다', () => {
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  assert.match(rules, /get\('hostRequests', \{\}\)\.diff\(resource\.data\.get\('hostRequests', \{\}\)\)\s*\.affectedKeys\(\)\.hasOnly\(\[request\.auth\.uid\]\)/)
  const forbidden = rules.match(/changedKeys\(\)\.hasAny\(\[([^\]]+)\]\)/)[1]
  for (const key of ['hostUid', 'createdBy', 'originalCreatedBy', 'hostTransfers']) assert.match(forbidden, new RegExp(`'${key}'`))
})

test("문구: AI 프롬프트 밖 사용자 노출 문자열에 '방장'이 남지 않는다", () => {
  const root = new URL('../src/', import.meta.url).pathname
  const left = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      if (!/\.(ts|tsx)$/.test(entry.name) || file.includes('/lib/prompts/')) continue
      const text = fs.readFileSync(file, 'utf8')
      if (!text.includes('방장')) continue
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = node => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralLikeNode?.(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && node.text.includes('방장')) {
          left.push(`${path.relative(root, file)}: ${node.text.trim().slice(0, 40)}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
  }
  walk(root)
  assert.deepEqual(left, [])
})
