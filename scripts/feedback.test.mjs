// node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/feedback.test.mjs
// 2026-10-09 피드백 버튼: 글+오류 화면 → 서버 저장(firebase-admin, 규칙 변경 없음) → 관리자 메일·피드백함
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as model from '../src/lib/feedback/feedbackModel.ts'

const { validateFeedbackInput, isFeedbackAdmin, parseAdminEmails, nextRateWindow, buildFeedbackEmail, FEEDBACK_LIMITS } = model
const png = 'data:image/png;base64,iVBORw0KGgo='

test('입력 검사: 글이나 캡처 중 하나 필요, 캡처 형식·개수·크기 제한, 문맥·오류 기록 정리', () => {
  assert.equal(validateFeedbackInput({ message: '  ', images: [] }).ok, false)
  assert.equal(validateFeedbackInput({ images: ['data:text/html;base64,AAAA'] }).ok, false)
  assert.equal(validateFeedbackInput({ images: [png, png, png, png] }).ok, false)
  assert.equal(validateFeedbackInput({ images: ['data:image/jpeg;base64,' + 'A'.repeat(FEEDBACK_LIMITS.imageDataUrlMax)] }).ok, false)
  const ok = validateFeedbackInput({ message: '표가 사라졌어요', images: [png], context: { path: '/projects/p1', projectTitle: '3학년', activityCode: 'A-2-2', evil: 'x' }, recentErrors: Array.from({ length: 15 }, (_, i) => `e${i}`) })
  assert.equal(ok.ok, true)
  assert.deepEqual(Object.keys(ok.value.context).sort(), ['activityCode', 'path', 'projectTitle'])
  assert.equal(ok.value.recentErrors.length, FEEDBACK_LIMITS.errorsMax)
  assert.equal(ok.value.recentErrors.at(-1), 'e14')
})

test('관리자: 인증된 jammanbogem@gmail.com(기본)만, 환경변수로 바꿀 수 있음', () => {
  const admins = parseAdminEmails(undefined)
  assert.deepEqual(admins, ['jammanbogem@gmail.com'])
  assert.equal(isFeedbackAdmin({ email: 'JammanBogem@gmail.com', email_verified: true }, admins), true)
  assert.equal(isFeedbackAdmin({ email: 'jammanbogem@gmail.com', email_verified: false }, admins), false)
  assert.equal(isFeedbackAdmin({ email: 'teacher@school.kr', email_verified: true }, admins), false)
  assert.deepEqual(parseAdminEmails('a@x.kr, b@y.kr'), ['a@x.kr', 'b@y.kr'])
})

test('보내기 횟수: 1시간에 10번까지, 1시간이 지나면 다시', () => {
  let state = null
  for (let i = 0; i < 10; i++) { state = nextRateWindow(state, 1000 + i); assert.equal(state.allowed, true) }
  assert.equal(nextRateWindow(state, 2000).allowed, false)
  assert.equal(nextRateWindow(state, 1000 + 60 * 60 * 1000).allowed, true)
})

test('메일: 제목에 첫 줄과 위치, 본문에 보낸 사람·화면·오류 기록·피드백함 주소', () => {
  const mail = buildFeedbackEmail({ id: 'f1', message: '저장이 안 돼요\n자세히', images: [png], recentErrors: ['10:00:00 [오류] boom'],
    context: { path: '/projects/p1', projectTitle: '3학년', activityCode: 'A-2-2', activityLabel: '통합 수업목표' },
    senderName: '홍성용', senderEmail: 't@s.kr', appUrl: 'https://togethertr.web.app' })
  assert.equal(mail.subject, '[T-CID 피드백] 저장이 안 돼요 — 3학년 · A-2-2 통합 수업목표')
  for (const part of ['홍성용 <t@s.kr>', '/projects/p1', '캡처: 1장', '- 10:00:00 [오류] boom', 'https://togethertr.web.app/feedback']) assert.ok(mail.text.includes(part), part)
  assert.doesNotMatch(buildFeedbackEmail({ id: 'x', message: '<script>', images: [], recentErrors: [], context: { path: '/' } }).html, /<script>/)
})

test('오류 기록: window 오류·처리 안 된 거부·console.error 를 최근 10줄로', async () => {
  const { installClientErrorLog, recentClientErrors } = await import('../src/lib/feedback/errorLog.ts')
  const listeners = {}
  const logged = []
  const fakeWindow = { addEventListener: (type, fn) => { listeners[type] = fn }, console: { error: (...args) => logged.push(args) } }
  installClientErrorLog(fakeWindow)
  listeners.error({ message: 'x is undefined', filename: 'https://a/b/chunk.js', lineno: 12 })
  listeners.unhandledrejection({ reason: new Error('permission-denied') })
  fakeWindow.console.error('저장 실패', { code: 7 })
  const lines = recentClientErrors()
  assert.match(lines[0], /\[오류\] x is undefined \(chunk\.js:12\)/)
  assert.match(lines[1], /\[처리 안 된 오류\] Error: permission-denied/)
  assert.match(lines[2], /\[console\] 저장 실패 \{"code":7\}/)
  assert.equal(logged.length, 1, '원래 console.error 도 호출')
  for (let i = 0; i < 20; i++) fakeWindow.console.error(`e${i}`)
  assert.equal(recentClientErrors().length, 10)
})

// ── 서버 라우트: 실제 route.ts 를 mock firebase-admin·fetch 위에서 ──
function fakeDb() {
  const docs = new Map()
  let auto = 0
  const snap = (path, value) => ({ id:path.split('/').at(-1), exists:docs.has(path), data:()=>value })
  const ref = path => ({
    id:path.split('/').at(-1),path,get:async()=>snap(path,docs.get(path)),
    set:async value=>docs.set(path,value), update:async value=>docs.set(path,{...docs.get(path),...value}),
    collection:name=>collection(`${path}/${name}`),
  })
  function query(path, field, direction='asc', cursor=null, max=Infinity) {
    return {
      limit:n=>query(path,field,direction,cursor,n), startAfter:snapshot=>query(path,field,direction,snapshot.id,max),
      get:async()=>{
        let rows=[...docs.entries()].filter(([p])=>p.startsWith(`${path}/`)&&p.split('/').length===path.split('/').length+1)
          .sort(([a,x],[b,y])=>(x[field]-y[field]||a.localeCompare(b))*(direction==='desc'?-1:1))
        if(cursor)rows=rows.slice(rows.findIndex(([p])=>p.split('/').at(-1)===cursor)+1)
        return {docs:rows.slice(0,max).map(([p,v])=>snap(p,v))}
      },
    }
  }
  const collection=path=>({doc:id=>ref(`${path}/${id??`auto${++auto}`}`),orderBy:(field,direction)=>query(path,field,direction)})
  return { docs, collection, failBatch:false,
    batch(){const writes=[];return {set:(r,v)=>writes.push([r.path,v]),commit:async()=>{if(this.failBatch)throw Error('offline');for(const [p,v] of writes)docs.set(p,v)}}},
    runTransaction:async fn=>fn({get:async r=>r.get(),set:(r,v)=>docs.set(r.path,v)}),
  }
}
function loadRoute({ db, tokens, fetchCalls, env = {} }) {
  const source = fs.readFileSync(new URL('../src/app/api/feedback/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const admin = {
    getAdminDb: () => db, getFieldValue: () => ({ serverTimestamp: () => 'TS' }),
    getAdminAuth: () => ({ verifyIdToken: async token => { if (!tokens[token]) throw new Error('bad'); return tokens[token] } }),
  }
  const context = {
    exports: {}, Response, URL, JSON, Date, Promise, String, AbortSignal, console, process: { env },
    fetch: async (url, init) => { fetchCalls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => '' } },
    require: name => name === '@/lib/firebase/admin' ? admin : name === '@/lib/feedback/feedbackModel' ? model : {},
  }
  vm.runInNewContext(compiled, context)
  return context.exports
}
const request = (method, token, body, query = '') => new Request(`http://localhost/api/feedback${query}`, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
})
const tokens = {
  teacher: { uid: 'u1', email: 'teacher@school.kr', email_verified: true, name: '배주희' },
  admin: { uid: 'a1', email: 'jammanbogem@gmail.com', email_verified: true, name: '홍성용' },
}

test('POST: 로그인한 선생님 피드백을 저장하고 캡처는 하위 문서로, 메일 키가 있으면 관리자에게 첨부와 함께 보낸다', async () => {
  const db = fakeDb(), fetchCalls = []
  const route = loadRoute({ db, tokens, fetchCalls, env: { RESEND_API_KEY: 'k' } })
  assert.equal((await route.POST(request('POST', null, { message: 'x' }))).status, 401)
  const response = await route.POST(request('POST', 'teacher', { message: '저장이 안 돼요', images: [png], context: { path: '/projects/p1', activityCode: 'A-2-2' }, recentErrors: ['e'] }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.emailed, true)
  const saved = db.docs.get(`feedback/${body.id}`)
  assert.equal(saved.uid, 'u1'); assert.equal(saved.status, 'new'); assert.equal(saved.imageCount, 1); assert.equal(saved.emailed, true)
  assert.equal(db.docs.get(`feedback/${body.id}/images/0`).dataUrl, png)
  assert.equal(fetchCalls[0].url, 'https://api.resend.com/emails')
  assert.deepEqual(fetchCalls[0].body.to, ['jammanbogem@gmail.com'])
  assert.equal(fetchCalls[0].body.reply_to, 'teacher@school.kr')
  assert.equal(fetchCalls[0].body.attachments[0].filename, 'capture-1.png')
})

test('POST: 메일 키가 없어도 저장은 되고 피드백함에서 볼 수 있다, 1시간 10번 넘으면 429', async () => {
  const db = fakeDb(), fetchCalls = []
  const route = loadRoute({ db, tokens, fetchCalls })
  const first = await (await route.POST(request('POST', 'teacher', { message: '첫 번째' }))).json()
  assert.equal(first.emailed, false)
  assert.equal(fetchCalls.length, 0)
  assert.match(db.docs.get(`feedback/${first.id}`).emailError, /RESEND_API_KEY/)
  for (let i = 0; i < 9; i++) await route.POST(request('POST', 'teacher', { message: `m${i}` }))
  assert.equal((await route.POST(request('POST', 'teacher', { message: '열한 번째' }))).status, 429)
})

test('GET·PATCH: 관리자만 목록·상세(캡처)·처리 상태, 선생님은 403', async () => {
  const db = fakeDb(), fetchCalls = []
  const route = loadRoute({ db, tokens, fetchCalls })
  const { id } = await (await route.POST(request('POST', 'teacher', { message: '버그', images: [png] }))).json()
  assert.equal((await route.GET(request('GET', 'teacher'))).status, 403)
  const list = await (await route.GET(request('GET', 'admin'))).json()
  assert.deepEqual(list.items.map(item => item.id), [id])
  const detail = await (await route.GET(request('GET', 'admin', null, `?id=${id}`))).json()
  assert.deepEqual(detail.images, [png])
  assert.equal((await route.PATCH(request('PATCH', 'teacher', { id, status: 'done' }))).status, 403)
  assert.equal((await route.PATCH(request('PATCH', 'admin', { id, status: 'done' }))).status, 200)
  assert.equal(db.docs.get(`feedback/${id}`).status, 'done')
})

test('화면: 작은 말풍선 기본 자리는 오른쪽 아래(프로젝트 화면은 입력창 위·넓은 폭은 오른쪽 가운데로 패널 버튼을 피함), hover·focus 때 글자 펼침', () => {
  const layout = fs.readFileSync(new URL('../src/app/(app)/layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /return <>\{children\}<FeedbackButton \/><\/>/)
  const button = fs.readFileSync(new URL('../src/components/feedback/FeedbackButton.tsx', import.meta.url), 'utf8')
  assert.match(button, /!placed && \(inProject \? 'bottom-28 right-3 lg:bottom-auto lg:top-\[calc\(50%-22px\)\]' : 'bottom-3 right-3'\)/)
  assert.match(button, /h-\[44px\] w-\[44px\]/)
  assert.match(button, /hover:w-\[168px\][^']*focus-visible:w-\[168px\]/)
  assert.match(button, /transition-\[width,box-shadow\] duration-200/)
  assert.match(button, /motion-reduce:transition-none/)
  assert.match(button, /aria-label="피드백 보내기"/)
  assert.match(button, /onPaste=\{onPaste\}/)
  assert.match(button, /recentErrors: recentClientErrors\(\)/)
})

test('끌어 옮기기: 화면 안 고정·넓은 쪽으로 펼침·임계값·저장값 검사, 끌기 뒤 클릭은 창을 열지 않음', async () => {
  const pos = await import('../src/components/feedback/launcherPosition.ts')
  const vp = { width: 1200, height: 800 }
  assert.deepEqual(pos.clampLauncherPosition({ x: -50, y: 5000 }, vp), { x: 8, y: 800 - 44 - 8 })
  assert.deepEqual(pos.clampLauncherPosition({ x: 300.4, y: 200.6 }, vp), { x: 300, y: 201 })
  assert.equal(pos.expandsLeftward({ x: 1100, y: 10 }, vp), true)
  assert.equal(pos.expandsLeftward({ x: 20, y: 10 }, vp), false)
  assert.deepEqual(pos.launcherStyle({ x: 1100, y: 40 }, vp), { top: 40, right: 56 })
  assert.deepEqual(pos.launcherStyle({ x: 20, y: 40 }, vp), { top: 40, left: 20 })
  assert.equal(pos.exceededDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 }), false)
  assert.equal(pos.exceededDragThreshold({ x: 0, y: 0 }, { x: 6, y: 0 }), true)
  assert.deepEqual(pos.parseStoredLauncherPosition('{"x":10,"y":20}'), { x: 10, y: 20 })
  for (const bad of [null, '', 'oops', '{"x":"1","y":2}', '{"x":1}', '{"x":null,"y":1}']) assert.equal(pos.parseStoredLauncherPosition(bad), null)
  const button = fs.readFileSync(new URL('../src/components/feedback/FeedbackButton.tsx', import.meta.url), 'utf8')
  assert.match(button, /if \(suppressClickRef\.current\) \{ suppressClickRef\.current = false; return \}/)
  assert.match(button, /setPointerCapture\(event\.pointerId\)/)
  assert.match(button, /onPointerCancel=\{event => endLauncherDrag\(event, true\)\}/)
  assert.match(button, /touch-none select-none/)
  assert.match(button, /버튼 위치 처음으로/)
})


test('failed atomic submission leaves neither inbox item nor screenshots; retry succeeds',async()=>{
 const db=fakeDb(),route=loadRoute({db,tokens,fetchCalls:[]});db.failBatch=true
 assert.equal((await route.POST(request('POST','teacher',{message:'보존',images:[png]}))).status,503)
 assert.equal([...db.docs.keys()].filter(key=>key.startsWith('feedback/')).length,0)
 db.failBatch=false
 assert.equal((await route.POST(request('POST','teacher',{message:'보존',images:[png]}))).status,200)
})
test('inbox newest first and cursor retrieves older submissions including equal timestamps without loss',async()=>{
 const db=fakeDb(),route=loadRoute({db,tokens,fetchCalls:[]})
 for(let i=0;i<56;i++)db.docs.set(`feedback/f${String(i).padStart(3,'0')}`,{message:`m${i}`,createdAtMs:Math.floor(i/2),status:'new'})
 const first=await(await route.GET(request('GET','admin'))).json()
 assert.equal(first.items.length,50);assert.equal(first.items[0].id,'f055');assert.ok(first.nextCursor)
 const last=await(await route.GET(request('GET','admin',null,`?cursor=${first.nextCursor}`))).json()
 assert.equal(last.items.length,6);assert.equal(last.nextCursor,null)
 assert.equal(new Set([...first.items,...last.items].map(item=>item.id)).size,56)
 assert.equal((await route.GET(request('GET','teacher',null,`?cursor=${first.nextCursor}`))).status,403)
})

test('화면 캡처: 끌기 영역 정규화·경계 고정·원본 픽셀 환산·작은 선택 무시·배율 상한', async () => {
  const cap = await import('../src/lib/feedback/screenCapture.ts')
  const bounds = { width: 800, height: 450 }
  assert.deepEqual(cap.normalizeCrop({ x: 500, y: 300 }, { x: 100, y: 50 }, bounds), { x: 100, y: 50, width: 400, height: 250 })
  assert.deepEqual(cap.normalizeCrop({ x: -20, y: 10 }, { x: 9000, y: 900 }, bounds), { x: 0, y: 10, width: 800, height: 440 })
  assert.equal(cap.isUsableCrop({ x: 0, y: 0, width: 5, height: 300 }), false)
  assert.equal(cap.isUsableCrop(null), false)
  assert.equal(cap.isUsableCrop({ x: 0, y: 0, width: 40, height: 40 }), true)
  // 화면(CSS px)에서 고른 영역 → 2배 그림 픽셀
  assert.deepEqual(cap.cropToSource({ x: 10, y: 20, width: 300, height: 150 }, { width: 1440, height: 800 }, { width: 2880, height: 1600 }), { x: 20, y: 40, width: 600, height: 300 })
  assert.deepEqual(cap.cropToSource({ x: 700, y: 400, width: 100, height: 50 }, bounds, { width: 1601, height: 901 }), { x: 1401, y: 801, width: 200, height: 100 })
  assert.equal(cap.captureScale(3), 2)
  assert.equal(cap.captureScale(1.5), 1.5)
  assert.equal(cap.captureScale(undefined), 1)
  assert.equal(cap.isExcludedFromCapture({ nodeType: 1, hasAttribute: name => name === cap.CAPTURE_EXCLUDE_ATTR }), true)
  assert.equal(cap.isExcludedFromCapture({ nodeType: 1, hasAttribute: () => false }), false)
  assert.equal(cap.isExcludedFromCapture({ nodeType: 3 }), false)
})

test('화면 캡처 연결: 공유 허락 없이 누르면 바로 화면 위 끌기, 피드백 UI는 그림에서 빼고 기존 압축 경로로 넣음', () => {
  const button = fs.readFileSync(new URL('../src/components/feedback/FeedbackButton.tsx', import.meta.url), 'utf8')
  const capture = fs.readFileSync(new URL('../src/lib/feedback/screenCapture.ts', import.meta.url), 'utf8')
  const selector = fs.readFileSync(new URL('../src/components/feedback/ScreenRegionSelector.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(capture + button, /getDisplayMedia|openTabStream|preferCurrentTab/, '화면 공유 허락 경로를 쓰지 않음')
  assert.match(capture, /import\('modern-screenshot'\)/, '캡처 라이브러리는 누를 때만 불러옴')
  assert.match(capture, /filter: node => !isExcludedFromCapture\(node\)/)
  assert.match(capture, /restoreScrollPosition: true/, '스크롤된 영역도 보이는 그대로')
  assert.match(button, /function startScreenCapture\(\) \{[\s\S]{0,400}setSelectingRegion\(true\)/)
  assert.match(button, /<button ref=\{triggerRef\} type="button" \{\.\.\.\{ \[CAPTURE_EXCLUDE_ATTR\]: '' \}\}/)
  assert.match(button, /<dialog ref=\{dialogRef\} \{\.\.\.\{ \[CAPTURE_EXCLUDE_ATTR\]: '' \}\}/)
  assert.match(selector, /\[CAPTURE_EXCLUDE_ATTR\]: ''/)
  assert.match(button, /const dialogShown = open && !capturing/)
  assert.match(button, /const locked = busy \|\| preparing \|\| capturing/)
  assert.match(button, /const blob = await captureViewportRegion\(region\)/)
  assert.match(button, /await addFiles\(\[new File\(\[blob\]/, '압축·장수 제한을 지나는 기존 addFiles 경로')
  assert.match(button, /<ScreenRegionSelector busy=\{renderingCapture\}/)
  assert.match(selector, /if \(isUsableCrop\(region\)\) onSelect\(region\)/, '놓는 순간 바로 찍고, 그냥 클릭은 무시')
  assert.match(selector, /event\.key === 'Escape'/)
  assert.match(selector, /캡처하는 중/)
})
