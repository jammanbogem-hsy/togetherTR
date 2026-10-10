// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/memberAdmin.test.mjs
// TASK-M1: 저장값만 solo 인 팀원 있는 레거시 방은 협력 방으로 판단·참여 허용, 방장 전용 팀원 내보내기, 채팅 명령 해석.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { effectiveProjectMode, isSoloProject, needsProjectModeSync } from '../src/lib/project/projectMode.ts'
import * as projectMode from '../src/lib/project/projectMode.ts'
import * as memberAdmin from '../src/lib/project/memberAdmin.ts'
import * as presenceThrottle from '../src/lib/coedit/presenceThrottle.ts'
import * as presenceOwner from '../src/lib/coedit/presenceOwner.ts'
import { classifyMemberCommand, memberCommandText, memberRemovedText, planMemberRemoval, MEMBER_PRESENCE_COLLECTIONS } from '../src/lib/project/memberAdmin.ts'
import { buildSystemPrompt, SOLO_MODE_RULES } from '../src/lib/prompts/system.ts'
import { computePendingConfirmations } from '../src/lib/collab/artifactConfirmations.ts'

const SIX = ['host', 'u2', 'u3', 'u4', 'u5', 'u6']
const info = {
  host: { displayName: '홍성용' }, u2: { displayName: '김민지' }, u3: { displayName: '이수진' },
  u4: { displayName: '박지훈' }, u5: { displayName: '김민지' }, u6: { displayName: '최유나 선생님' },
}
const legacy = { id: 'VjWf', mode: 'solo', hostUid: 'host', createdBy: 'host', memberUids: SIX, memberInfo: info, inviteCode: 'ABC123' }
const realSolo = { id: 'solo1', mode: 'solo', hostUid: 'me', createdBy: 'me', memberUids: ['me'], memberInfo: { me: { displayName: '나' } }, inviteCode: 'SOLO11' }

test('effective mode: 6명 solo 방은 협력, 1명 solo 는 solo, 협력은 그대로', () => {
  assert.equal(effectiveProjectMode(legacy), 'collaborative')
  assert.equal(isSoloProject(legacy), false)
  assert.equal(effectiveProjectMode(realSolo), 'solo')
  assert.equal(effectiveProjectMode({ mode: 'solo', memberUids: ['me', 'me'] }), 'solo', '중복 uid 는 1명')
  assert.equal(effectiveProjectMode({ mode: 'collaborative', memberUids: ['me'] }), 'collaborative')
  assert.equal(effectiveProjectMode(undefined), 'collaborative')
})

test('mode sync: 방장만, 레거시 방일 때만 저장값을 맞춘다', () => {
  assert.equal(needsProjectModeSync(legacy, 'host'), true)
  assert.equal(needsProjectModeSync(legacy, 'u2'), false, '팀원은 저장하지 않음')
  assert.equal(needsProjectModeSync(realSolo, 'me'), false)
  assert.equal(needsProjectModeSync({ ...legacy, mode: 'collaborative' }, 'host'), false)
})

test('prompt: 레거시 6명 방에는 SOLO 규칙이 들어가지 않고, 1명 개인 방에는 들어간다', () => {
  const base = { title: '3학년 사회', schoolLevel: '초등', targetGradeGroup: '3-4학년군', targetSubjects: ['사회'], isA23Completed: false, currentCycle: 1 }
  const marker = SOLO_MODE_RULES.split('\n')[0]
  // ChatPanel 이 서버로 보내는 mode(서버는 memberUids 를 받지 않는다)
  const sentForLegacy = { ...base, mode: effectiveProjectMode(legacy) }
  assert.equal(buildSystemPrompt('T', 'T-1-1', sentForLegacy, '팀+AI').includes(marker), false)
  // memberUids 가 함께 와도 같은 판단
  assert.equal(buildSystemPrompt('T', 'T-1-1', { ...base, mode: 'solo', memberUids: SIX }, '팀+AI').includes(marker), false)
  const sentForSolo = { ...base, mode: effectiveProjectMode(realSolo) }
  assert.equal(buildSystemPrompt('T', 'T-1-1', sentForSolo, '개인+AI').includes(marker), true)
})

test('artifact confirmations: 레거시 6명 방도 부재 팀원 확인 대상을 만든다', () => {
  const pending = computePendingConfirmations({
    mode: 'solo', demoRun: false, hostUid: 'host', createdBy: 'host', memberUids: SIX, memberInfo: info,
    activityCode: 'T-1-1', version: 1, speakerUids: ['host', 'u2'], existing: {},
  })
  assert.ok(Object.keys(pending).length > 0)
})

// ── Firestore 경로: 실제 projects.ts 를 mock 위에서 실행 ──
function loadProjects(store) {
  const source = fs.readFileSync(new URL('../src/lib/firebase/projects.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const marker = (type, value) => (value === undefined ? { __op: type } : { __op: type, value })
  const firestore = {
    doc: (_db, ...segments) => segments.join('/'),
    collection: (_db, ...segments) => segments.join('/'),
    getDoc: async path => ({ exists: () => store.docs.has(path), data: () => structuredClone(store.docs.get(path)) }),
    updateDoc: async (path, updates) => { store.updates.push({ path, updates }) },
    deleteDoc: async path => {
      store.deletes.push(path)
      if (store.denyPresence && /Presence\//.test(path)) throw new Error('permission-denied')
    },
    runTransaction: async (_db, fn) => fn({
      get: async path => ({ exists: () => store.docs.has(path), data: () => structuredClone(store.docs.get(path)) }),
      update: (path, updates) => { store.updates.push({ path, updates }) },
    }),
    arrayUnion: value => marker('arrayUnion', value),
    arrayRemove: value => marker('arrayRemove', value),
    deleteField: () => marker('deleteField'),
    serverTimestamp: () => marker('serverTimestamp'),
  }
  const context = { exports: {}, console, Date, setTimeout, clearTimeout, structuredClone, require(name) {
    if (name === 'firebase/firestore') return firestore
    if (name === './config') return { db: {}, auth: {} }
    if (name === '@/lib/inviteCode') return { addJoinedProjectId() {}, generateInviteCode: () => 'X' }
    if (name === '@/lib/project/projectMode') return projectMode
    if (name === '@/lib/project/memberAdmin') return memberAdmin
    if (name === '@/lib/coedit/presenceThrottle') return presenceThrottle
    if (name === '@/lib/coedit/presenceOwner') return presenceOwner
    return {}
  } }
  vm.runInNewContext(compiled, context)
  return context.exports
}
const newStore = (...projects) => ({ docs: new Map(projects.map(p => [`projects/${p.id}`, p])), updates: [], deletes: [] })

test('joinProject: 6명 레거시 solo 방은 초대 코드로 참여, 1명 개인 방은 계속 차단', async () => {
  const store = newStore(legacy, realSolo)
  const projects = loadProjects(store)
  await projects.joinProject('VjWf', 'newbie', 'ABC123', { displayName: '새 선생님', color: '#000', emoji: '🙂' })
  assert.equal(store.updates.at(-1).path, 'projects/VjWf')
  assert.deepEqual(store.updates.at(-1).updates.memberUids, { __op: 'arrayUnion', value: 'newbie' })
  await assert.rejects(projects.joinProject('solo1', 'newbie', 'SOLO11'), /^Error: solo-project$/)
  await assert.rejects(projects.joinProject('VjWf', 'other', 'WRONG'), /invalid-invite-code/, '초대 코드 검사는 그대로')
})

test('syncProjectModeIfNeeded: 방장이 열면 한 번 collaborative 로 저장, 팀원은 저장 안 함', async () => {
  const store = newStore(legacy)
  const projects = loadProjects(store)
  assert.equal(await projects.syncProjectModeIfNeeded(legacy, 'u2'), false)
  assert.equal(store.updates.length, 0)
  assert.equal(await projects.syncProjectModeIfNeeded(legacy, 'host'), true)
  const { updates } = store.updates[0]
  assert.equal(updates.mode, 'collaborative')
  assert.equal(updates.modeChanges.value.from, 'solo')
  assert.equal(updates.modeChanges.value.byUid, 'host')
})

test('removeMember: 방장만, 멤버 필드만 지우고 대화·산출물은 건드리지 않으며 기록을 남긴다', async () => {
  const project = { ...legacy, artifactConfirmations: { u3: { 'T-1-1': { status: 'pending' } } }, artifacts: { 'T-1-1': { content: {} } } }
  const store = newStore(project)
  const projects = loadProjects(store)
  const result = await projects.removeMember('VjWf', 'host', 'u3')
  assert.equal(result.presenceCleanup, 'done')
  const { path, updates } = store.updates[0]
  assert.equal(path, 'projects/VjWf')
  assert.deepEqual(updates.memberUids, { __op: 'arrayRemove', value: 'u3' })
  assert.deepEqual(updates['memberInfo.u3'], { __op: 'deleteField' })
  assert.deepEqual(updates['artifactConfirmations.u3'], { __op: 'deleteField' })
  assert.equal(updates.memberRemovals.value.displayName, '이수진')
  assert.equal(updates.memberRemovals.value.byUid, 'host')
  assert.ok(!Object.keys(updates).some(key => key.startsWith('artifacts') || key.startsWith('conversations')), Object.keys(updates).join(','))
  assert.equal(store.deletes.length, MEMBER_PRESENCE_COLLECTIONS.length)
  assert.ok(store.deletes.every(p => p.startsWith('projects/VjWf/') && p.endsWith('/u3')))
})

test('removeMember: 팀원·자기 자신·방장·없는 사람은 거부, presence 삭제가 규칙에 막히면 partial', async () => {
  const store = newStore(legacy)
  const projects = loadProjects(store)
  await assert.rejects(projects.removeMember('VjWf', 'u2', 'u3'), /not-host/)
  await assert.rejects(projects.removeMember('VjWf', 'host', 'host'), /cannot-remove-self/)
  await assert.rejects(projects.removeMember('VjWf', 'host', 'ghost'), /target-not-member/)
  await assert.rejects(projects.removeMember('nope', 'host', 'u2'), /project-not-found/)
  assert.equal(store.updates.length, 0)
  store.denyPresence = true
  assert.equal((await projects.removeMember('VjWf', 'host', 'u2')).presenceCleanup, 'partial')
  assert.equal(store.updates.length, 1, '멤버 제거는 presence 실패와 무관하게 완료')
  const coHost = newStore({ ...legacy, hostUid: 'u4' })
  await assert.rejects(loadProjects(coHost).removeMember('VjWf', 'host', 'u4'), /cannot-remove-host/)
})

test('planMemberRemoval: 이름 없는 팀원도 내보낼 수 있다', () => {
  const plan = planMemberRemoval({ ...legacy, memberUids: [...SIX, 'noname'] }, 'host', 'noname')
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.deleteFieldPaths, ['memberInfo.noname'])
})

test('chat command: 방장의 내보내기 문장은 확인 카드, 팀원은 고정 안내', () => {
  for (const text of ['이수진 선생님 빼 줘', '이수진 선생님을 내보내 줘', '이수진 내보내기', '방에서 이수진 쌤 나가게 해 줘', '이수진 선생님 강퇴해 주세요.', '박지훈 빼줘']) {
    const command = classifyMemberCommand(text, legacy, 'host')
    assert.equal(command.kind, 'confirm', text)
    assert.ok(['이수진', '박지훈'].includes(command.target.displayName), text)
  }
  assert.equal(classifyMemberCommand('최유나 선생님 내보내 줘', legacy, 'host').target?.uid, 'u6', '저장 이름에 선생님이 붙어 있어도')
  assert.equal(classifyMemberCommand('이수진 선생님 빼 줘', legacy, 'u2').kind, 'not-host')
  assert.equal(memberCommandText({ kind: 'not-host' }), '팀원 내보내기는 기록 담당만 할 수 있어요.')
  const confirm = classifyMemberCommand('이수진 선생님 빼 줘', legacy, 'host')
  assert.equal(memberCommandText(confirm), '이수진 선생님을 이 방에서 내보낼까요? 남긴 대화와 산출물은 남습니다.')
  assert.equal(memberRemovedText(confirm.target), '이수진 선생님이 방에서 나갔어요.')
})

test('chat command: 동명이인은 선택지, 없는 이름·자기 자신·방장은 안내', () => {
  const choose = classifyMemberCommand('김민지 선생님 내보내 줘', legacy, 'host')
  assert.equal(choose.kind, 'choose')
  assert.deepEqual(choose.candidates.map(c => c.uid).sort(), ['u2', 'u5'])
  assert.equal(classifyMemberCommand('정다은 선생님 내보내 줘', legacy, 'host').kind, 'not-found')
  assert.equal(classifyMemberCommand('홍성용 내보내 줘', legacy, 'host').kind, 'self')
  assert.equal(classifyMemberCommand('이수진 내보내 줘', { ...legacy, hostUid: 'u3' }, 'host').kind, 'host-target')
})

test('chat command: 수업 설계 요청 문장은 명령으로 오인하지 않는다', () => {
  for (const text of ['이 문장 빼 줘', '1번 활동은 제외해 줘', '김 선생님 의견은 빼 줘', '평가 기준에서 태도 항목 빼 줘', '빼 줘', '모둠 활동 시간을 줄이고 발표는 빼 주세요', '학생들이 교실에서 나가게 하는 활동은 어때요?', '모둠에서 한 명씩 나가게 해 줘', '중복 항목 제외해 주세요']) {
    assert.equal(classifyMemberCommand(text, legacy, 'host').kind, 'none', text)
  }
})

test('handleSend: 내보내기 명령은 AI·저장 없이 로컬 카드로만, 일반 문장은 그대로 진행', async () => {
  const chat = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('ChatPanel.tsx', chat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleSend') found = node; ts.forEachChild(node, visit) }
  visit(tree)
  const source = ts.transpileModule(`exports.fn = ${found.getText(tree)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const run = async (input, uid) => {
    const calls = { cards: [], inputs: [], reachedNormalFlow: false }
    const context = {
      exports: {}, input, chatDraft: { getSnapshot: () => ({ input }) }, project: legacy, userProfile: { uid }, sendBlockReason: null, pendingFiles: [], attaching: false, withAttachmentContext: content => content,
      classifyMemberCommand, setMemberCommand: value => calls.cards.push(value), setInput: value => calls.inputs.push(value),
      // 일반 흐름에 들어서면 여기서 멈춘다(AI·저장 경로)
      isLoading: true, remoteBusy: false, isTeamMode: false, isWaitingForChoice: false, replyTo: null,
      enqueueTrainingSend: () => { calls.reachedNormalFlow = true }, setReplyTo: () => {},
    }
    vm.runInNewContext(source, context)
    await context.exports.fn()
    return calls
  }
  const host = await run('이수진 선생님 빼 줘', 'host')
  assert.equal(host.cards[0].command.kind, 'confirm')
  assert.equal(host.cards[0].state, 'pending')
  assert.deepEqual(host.inputs, [''])
  assert.equal(host.reachedNormalFlow, false)
  const member = await run('이수진 선생님 빼 줘', 'u2')
  assert.equal(member.cards[0].command.kind, 'not-host')
  assert.equal(member.reachedNormalFlow, false)
  const normal = await run('평가 기준에서 태도 항목 빼 줘', 'host')
  assert.equal(normal.cards.length, 0)
  assert.equal(normal.reachedNormalFlow, true)
})
