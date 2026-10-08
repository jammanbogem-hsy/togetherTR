import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Render the actual dashboard with a small hook/JSX double; only transport and routing are mocked.
function fixture() {
  const state = [], effects = [], writes = [], routes = []
  let cursor = 0
  const profile = {uid:'teacher',displayName:'김교사'}
  const projects = ['one','two','three'].map(id=>({id,title:id,currentStage:'T',createdBy:'teacher'}))
  const initialFolders = [{id:'folder',name:'연수',color:'#1A73E8',projectIds:['one','two']},{id:'other',name:'다른 폴더',color:'#1A73E8',projectIds:['three']}]
  const react = {
    useState: initial => {const i=cursor++; if(!(i in state))state[i]=initial; return [state[i],update=>{state[i]=typeof update==='function'?update(state[i]):update}]},
    useRef: initial => {const i=cursor++; return state[i]??=( {current:initial} )},
    useCallback: fn=>fn,
    useEffect: (fn,deps)=>{const i=cursor++;if(!state[i]||deps.some((d,j)=>d!==state[i][j])){state[i]=deps;effects.push(fn)}},
  }
  const jsx = (type,props)=>({type,props})
  const bindings = {
    react, 'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'}, 'next/navigation':{useRouter:()=>({push:p=>routes.push(p),replace:p=>routes.push(p)})},
    '@/lib/firebase/projects':{
      getUserProjects:async()=>projects, getUserFolders:async()=>initialFolders, getUserHiddenProjects:async()=>[],
      saveUserFolders:(uid,folders)=>new Promise((resolve,reject)=>writes.push({uid,folders:JSON.parse(JSON.stringify(folders)),resolve,reject})),
      deleteProject:()=>assert.fail('Moving must not delete the project'),hideProjectFromDashboard:()=>assert.fail('Moving must not hide the project'),
    },
    '@/store/project':{useProjectStore:()=>({userProfile:profile,setUserProfile:()=>{}})},
    '@/components/dashboard/DashboardCards':{ProjectCard:'ProjectCard',FolderCard:'FolderCard',FOLDER_COLORS:['#1A73E8']},
    '@/components/ui/MD3Button':{MD3Button:'MD3Button'},
    '@/lib/utils':{cn:(...s)=>s.join(' ')},'lucide-react':new Proxy({}, {get:(_t,key)=>key}), '@/lib/auth':{signOut:async()=>{}},
  }
  const source=fs.readFileSync(new URL('../src/app/(app)/dashboard/page.tsx',import.meta.url),'utf8')
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const exports={}
  vm.runInNewContext(js,{exports,console:{error(){}},require:name=>{assert.ok(name in bindings,name);return bindings[name]}})
  const render=()=>{cursor=0;const tree=exports.default();while(effects.length)effects.shift()();return tree}
  const find=(tree,predicate)=>{if(!tree)return [];if(Array.isArray(tree))return tree.flatMap(t=>find(t,predicate));if(typeof tree!=='object')return [];return [...(predicate(tree)?[tree]:[]),...find(tree.props?.children,predicate)]}
  const cards=()=>find(render(),n=>n.type==='ProjectCard')
  const flush=()=>new Promise(resolve=>setImmediate(resolve))
  const open=async()=>{render();await flush();find(render(),n=>n.type==='FolderCard')[0].props.onOpen()}
  return {render,find,cards,flush,open,writes,routes}
}

test('move to main removes only folder membership, saves user settings, and announces success',async()=>{
  const f=fixture();await f.open()
  assert.equal(f.cards().length,2)
  f.cards()[0].props.onMoveToMain();await f.flush()
  assert.equal(f.cards().length,1)
  assert.equal(f.writes.length,1)
  assert.equal(f.writes[0].uid,'teacher')
  assert.deepEqual(f.writes[0].folders.map(x=>x.projectIds),[['two'],['three']])
  f.writes[0].resolve();await f.flush()
  const success=f.find(f.render(),n=>n.props?.role==='status')[0]
  assert.match(success.props.children,/one.*메인 화면으로 이동했습니다/)
  f.find(f.render(),n=>n.type==='button'&&n.props.children==='메인 화면 보기')[0].props.onClick()
  const rootCards=f.cards();assert.equal(rootCards.length,1);assert.equal(rootCards[0].props.project.id,'one')
  assert.equal(rootCards[0].props.onMoveToMain,undefined,'main screen does not offer another move out')
  assert.deepEqual(f.routes,[],'context action must not open the project')
})

test('rapid moves are persisted in order, preserving both requested moves and unrelated folders',async()=>{
  const f=fixture();await f.open();const cards=f.cards()
  cards[0].props.onMoveToMain();cards[1].props.onMoveToMain();await f.flush()
  assert.equal(f.writes.length,1)
  f.writes[0].resolve();await f.flush();assert.equal(f.writes.length,2)
  assert.deepEqual(f.writes[1].folders.map(x=>x.projectIds),[[],['three']])
  f.writes[1].resolve();await f.flush();assert.equal(f.cards().length,0)
})

test('failed move restores the last saved location and reports failure; retry remains available',async()=>{
  const f=fixture();await f.open()
  f.cards()[0].props.onMoveToMain();await f.flush();f.writes[0].resolve();await f.flush()
  f.cards()[0].props.onMoveToMain();await f.flush();f.writes[1].reject(new Error('offline'));await f.flush()
  assert.equal(f.cards().length,1);assert.equal(f.cards()[0].props.project.id,'two')
  assert.match(f.find(f.render(),n=>n.props?.role==='alert')[0].props.children,/이전 위치로 복원/)
  f.cards()[0].props.onMoveToMain();await f.flush();f.writes[2].resolve();await f.flush()
  assert.equal(f.cards().length,0)
})

test('failed older save cannot undo a newer queued move',async()=>{
  const f=fixture();await f.open();const cards=f.cards()
  cards[0].props.onMoveToMain();cards[1].props.onMoveToMain();await f.flush()
  f.writes[0].reject(new Error('first request failed'));await f.flush()
  assert.equal(f.cards().length,0)
  f.writes[1].resolve();await f.flush()
  assert.deepEqual(f.writes[1].folders.map(x=>x.projectIds),[[],['three']])
  assert.equal(f.find(f.render(),n=>n.props?.role==='alert').length,0)
})
