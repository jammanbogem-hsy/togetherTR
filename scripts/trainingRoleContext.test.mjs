import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { currentArtifactForChat } from '../src/lib/chat/currentArtifactForChat.ts'
import { buildSystemPrompt } from '../src/lib/prompts/system.ts'
import { STAGES, ACTIVITY_META } from '../src/types/index.ts'

const code = 'T-2-1'
const content = { '역할 배분': '홍성용은 담당 교과 사회, 회의 주최, 장점은 데이터 연결 수업을 좋아함\n\n홍지안은 담당 교과 국어, 자료 조사, 장점은 국어 교과를 사랑함' }
const project = { id: 'room', title: '연수', schoolLevel: '초등학교', mode: 'collaborative', currentCycle: 1, trainingMode: { enabled: true, coreFormal: false }, artifacts: { [code]: { title: '역할', status: 'in_review', version: 1, content: { '역할 배분': '홍성용만 있던 이전 초안' } } } }
const local = { activityCode: code, title: '역할', currentVersion: 2, status: 'in_review', aiDraft: content }
const source = fs.readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ChatPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let stream
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'streamFromAPI') stream = node.getText(tree); ts.forEachChild(node, visit) }
visit(tree)

test('실제 채팅 요청은 프로젝트 snapshot보다 먼저 저장된 최신 연수 양식의 두 담당자를 전송한다', async () => {
  let payload
  const context = { proj: project, project, currentActivity: code, currentArtifactForChat, ACTIVITY_META, STAGES,
    activityMeta: ACTIVITY_META[code], teamMembersList: "홍성용", useProjectStore: { getState: () => ({ project, currentArtifact: local }) },
    hasDeferredDecision: () => false, buildApiMessages: value => value, effectiveProjectMode: value => value.mode,
    AbortController, setTimeout, clearTimeout,
    fetch: async (_url, options) => { payload = JSON.parse(options.body); throw new Error('payload captured') },
  }
  vm.runInNewContext(ts.transpileModule(stream + '\nthis.run=streamFromAPI', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await assert.rejects(context.run([{ role: 'user', content: '이 역할을 표로 정리' }], () => {}, () => {}), /payload captured/)
  assert.deepEqual(payload.currentArtifact.content, content)
  assert.equal(payload.currentArtifact.version, 2)
})

test('다른 활동·오래된 로컬 산출물은 최신 서버 산출물을 덮지 않는다', () => {
  assert.equal(currentArtifactForChat(project, code, { ...local, activityCode: 'T-1-1' }), project.artifacts[code])
  assert.equal(currentArtifactForChat(project, code, { ...local, currentVersion: 1 }), project.artifacts[code])
  assert.deepEqual(currentArtifactForChat(project, code, { ...local, status: 'confirmed', confirmedContent: content }).content, content)
})

test('실제 시스템 프롬프트는 접속자가 한 명이어도 저장된 두 사람과 역할을 보존한다', () => {
  const artifact = currentArtifactForChat(project, code, local)
  for (const mode of ['collaborative', 'solo']) {
    const prompt = buildSystemPrompt('T', code, { ...project, mode }, '팀+AI', undefined, artifact, '홍성용')
    assert.ok(prompt.includes(content['역할 배분']))
    assert.match(prompt, /접속자 명단은 앱 계정 목록/)
    assert.match(prompt, /기록자의 이름으로 바꾸지 않는다/)
    assert.match(prompt, /대리 입력을 해당 교사의 직접 발언인 것처럼 인용하지 않는다/)
  }
})
