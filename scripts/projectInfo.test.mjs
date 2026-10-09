import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as model from '../src/lib/projects/projectInfo.ts'
const project = {id:'p',title:'원래 이름',schoolLevel:'초등학교',hostUid:'host',createdBy:'creator',targetGradeGroup:'초3-4',targetSubjects:['국어'],currentStage:'Ds',artifacts:{keep:true},curriculumSheet:[{id:'row',subject:'국어',achievementStandards:['[4국01-01]']}]}
const input = {title:'  바꾼 이름  ',gradeGroups:['초5-6','초1-2'],targetSubjects:['수학','과학','수학']}

test('metadata edit normalizes grade order and preserves curriculum rows original grade without touching progress/artifacts',()=>{
 const patch=model.buildProjectInfoUpdate(project,input)
 assert.equal(patch.title,'바꾼 이름')
 assert.deepEqual(patch.targetSubjects,['수학','과학'])
 assert.deepEqual(patch.teamGradeBands,['1-2학년군','5-6학년군'])
 assert.equal(patch.targetGradeGroup,'초1-2');assert.equal(patch.curriculumSheetGradeMode,'multi')
 assert.equal(patch.curriculumSheet[0].gradeBand,'3-4학년군')
 assert.deepEqual(patch.curriculumSheet[0].achievementStandards,['[4국01-01]'])
 assert.equal('artifacts' in patch,false);assert.equal('currentStage' in patch,false)
 assert.equal('gradeBand' in project.curriculumSheet[0],false)
})
test('title/subjects-only edit does not rewrite sheet; existing custom subjects and legacy grade work',()=>{
 const legacy={...project,targetGradeGroup:'3-4학년군',targetSubjects:['학교자율시간']}
 const values=model.projectInfoInput(legacy)
 assert.deepEqual(values.gradeGroups,['초3-4'])
 const patch=model.buildProjectInfoUpdate(legacy,{...values,title:'새 이름'})
 assert.deepEqual(patch,{title:'새 이름',targetSubjects:['학교자율시간']})
})
test('empty title/grade and wrong school grades rejected; middle/high grade edit remains supported',()=>{
 for(const bad of [{...input,title:' '},{...input,gradeGroups:[]},{...input,gradeGroups:['중1-3']}])assert.throws(()=>model.buildProjectInfoUpdate(project,bad))
 assert.deepEqual(model.buildProjectInfoUpdate({...project,schoolLevel:'고등학교',targetGradeGroup:'고공통'}, {...input,gradeGroups:['고선택']}),{title:'바꾼 이름',targetSubjects:['수학','과학'],targetGradeGroup:'고선택'})
})
function transport({uid='host',data=project,fail=false}={}){
 let writes=[],committed=false
 const bindings={
 'firebase/firestore':{doc:(_db,...path)=>path.join('/'),serverTimestamp:()=> 'timestamp',runTransaction:async(_db,fn)=>{const result=await fn({get:async()=>({exists:()=>!!data,data:()=>data}),update:(ref,patch)=>writes.push({ref,patch})});if(fail)throw Error('offline');committed=true;return result}},
 './config':{auth:{currentUser:uid?{uid}:null},db:{}},'@/lib/projects/projectInfo':model,
 }
 const source=fs.readFileSync(new URL('../src/lib/firebase/projectInfo.ts',import.meta.url),'utf8')
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:key=>{assert.ok(key in bindings,key);return bindings[key]}})
 return {save:()=>exports.updateProjectInfo('p',input),writes,committed:()=>committed}
}
test('persistence reads latest project in transaction, validates host, awaits commit and propagates failure',async()=>{
 const live={...project,curriculumSheet:[{id:'new-row',subject:'국어',gradeBand:'5-6학년군'}]}
 const success=transport({data:live});await success.save();assert.equal(success.committed(),true)
 assert.equal(success.writes[0].ref,'projects/p');assert.equal(success.writes[0].patch.curriculumSheet[0].id,'new-row')
 for(const uid of [null,'member']){const f=transport({uid});await assert.rejects(f.save());assert.equal(f.writes.length,0)}
 const failed=transport({fail:true});await assert.rejects(failed.save(),/offline/);assert.equal(failed.committed(),false)
 const demo=transport({uid:'creator',data:{...project,demoExperience:{scenarioId:'demo'}}});await assert.rejects(demo.save(),/기록 담당/);assert.equal(demo.writes.length,0)
})
