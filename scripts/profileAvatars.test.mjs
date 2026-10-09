import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { PROFILE_AVATARS, isProfileAvatarId, profileAvatarSrc } from '../src/lib/profile/avatars.ts'

test('30개의 고유 아바타 파일이 있고 임의 URL과 경로는 표시하지 않는다', () => {
  assert.equal(PROFILE_AVATARS.length, 30)
  assert.equal(new Set(PROFILE_AVATARS.map(([id]) => id)).size, 30)
  for (const [id] of PROFILE_AVATARS) assert.ok(fs.statSync(new URL('../public' + profileAvatarSrc(id), import.meta.url)).size > 0)
  for (const id of [undefined, 'initials', '../secret', 'https://example.com/a.png', 'missing']) assert.equal(profileAvatarSrc(id), undefined)
  assert.equal(isProfileAvatarId('initials'), true)
})

function fixture() {
  const writes = [], auth = { currentUser: { uid: 'a.b' } }
  let commits = 0, reject = false
  const context = { exports: {}, require(name) {
    if (name === './avatars') return { isProfileAvatarId }
    if (name === '@/lib/firebase/config') return { auth, db: {} }
    if (name === 'firebase/firestore') return {
      doc: (_db, ...path) => path, FieldPath: class { constructor(...parts) { this.parts = parts } }, serverTimestamp: () => 'server-time',
      writeBatch: () => ({ set: (...args) => writes.push(['set', ...args]), update: (...args) => writes.push(['update', ...args]), commit: async () => { commits++; if (reject) throw new Error('offline') } }),
    }
    throw new Error(name)
  } }
  const src = fs.readFileSync(new URL('../src/lib/profile/saveAvatar.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  return { run: context.exports.saveProfileAvatar, writes, auth, commits: () => commits, fail: () => { reject = true } }
}
test('아바타만 원자 저장하고 점이 있는 uid와 다른 팀원의 필드를 보존한다', async () => {
  const f = fixture(); await f.run('a.b', 'heart', 'room')
  assert.equal(f.commits(), 1)
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [
    ['set', ['users', 'a.b'], { avatarId: 'heart', updatedAt: 'server-time' }, { merge: true }],
    ['update', ['projects', 'room'], { parts: ['memberInfo', 'a.b', 'avatarId'] }, 'heart'],
  ])
})
test('본인 아닌 프로필·임의 이미지 거부, 실패 전달, 기본 이니셜 복구', async () => {
  const f = fixture()
  await assert.rejects(f.run('someone', 'smile'))
  await assert.rejects(f.run('a.b', '../bad'))
  assert.equal(f.writes.length, 0)
  await f.run('a.b', 'initials')
  assert.equal(f.writes.length, 1)
  f.fail(); await assert.rejects(f.run('a.b', 'wink'), /offline/)
})

test('프로젝트의 실제 프로필 동기화 effect는 저장한 아바타를 회원 정보로 전달한다', async () => {
  const source = fs.readFileSync(new URL('../src/app/(app)/projects/[id]/page.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0]?.getText(tree).includes('joinProject(projectId, uid')) effect = node.arguments[0].getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree); assert.ok(effect)
  const calls = []
  const profile = { uid: 'a', displayName: '김교사', color: '#blue', emoji: '👤', avatarId: 'heart' }
  const context = { projectId: 'room', project: { id: 'room', memberInfo: { a: { ...profile, avatarId: 'smile' } } }, userProfile: profile,
    joinProject: async (...args) => { calls.push(args) }, console,
    auth: { currentUser: null }, isAdminObserver: () => false }
  const js = ts.transpileModule(`(${effect})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, context)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][3].avatarId, 'heart')
  context.project.memberInfo.a.avatarId = 'heart'
  vm.runInNewContext(js, context)
  assert.equal(calls.length, 1, '이미 동기화된 프로필은 다시 쓰지 않음')
})

test('기존 회원의 프로필 갱신은 역할·강점·참여 시간을 보존한다', async () => {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('projects.ts', source, ts.ScriptTarget.Latest, true)
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'joinProject')
  const member = { uid: 'a', displayName: '김교사', role: '기록', expertise: '과학', joinedAt: 123, avatarId: 'smile' }
  let updates
  const context = { exports: {}, db: {}, doc: () => 'project-ref', getDoc: async () => ({ exists: () => true,
    data: () => ({ memberUids: ['a'], memberInfo: { a: member } }) }), arrayUnion: uid => [uid], serverTimestamp: () => 456,
    updateDoc: async (_ref, value) => { updates = value }, addJoinedProjectId() {}, isSoloProject: () => false }
  vm.runInNewContext(ts.transpileModule(fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  await context.exports.joinProject('room', 'a', '', { displayName: '김교사', color: '#blue', emoji: '👤', avatarId: 'heart' })
  assert.deepEqual(JSON.parse(JSON.stringify(updates['memberInfo.a'])), { ...member, color: '#blue', emoji: '👤', avatarId: 'heart' })
})
