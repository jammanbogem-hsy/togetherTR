// Run in Firebase's local Firestore emulator; never connects to production.
// Set TCID_RULES_TESTING_ROOT to a temporary npm install of @firebase/rules-unit-testing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
test('Firestore enforces host confirmation, including first-time field creation and self-join', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST || !process.env.TCID_RULES_TESTING_ROOT,
}, async () => {
  const require = createRequire(`${process.env.TCID_RULES_TESTING_ROOT}/package.json`)
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import(pathToFileURL(require.resolve('@firebase/rules-unit-testing')))
  const { doc, setDoc, updateDoc, getDoc } = await import(pathToFileURL(require.resolve('firebase/firestore')))
  const env = await initializeTestEnvironment({ projectId: 'demo-tcid-grade-bands', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } })
  try {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'projects/p'), { hostUid: 'host', createdBy: 'host', memberUids: ['host', 'member'], targetGradeGroup: '초5-6', curriculumSheetGradeMode: 'single' })
    })
    const member = doc(env.authenticatedContext('member').firestore(), 'projects/p')
    const host = doc(env.authenticatedContext('host').firestore(), 'projects/p')
    await assertFails(updateDoc(member, { teamGradeBands: ['1-2학년군', '5-6학년군'] }))
    await assertFails(updateDoc(member, { teamGradeBands: ['1-2학년군'], memberUids: ['host', 'member'] }))
    await assertSucceeds(updateDoc(member, { 'teamGradeBandProposals.member': { id: 'proposal', bands: ['1-2학년군'], proposedByName: '교사', proposedAt: 1 } }))
    await assertFails(updateDoc(member, { 'teamGradeBandProposals.someoneElse': { id: 'forged', bands: ['3-4학년군'] } }))
    await assertSucceeds(updateDoc(host, { teamGradeBands: ['1-2학년군', '5-6학년군'], targetGradeGroup: '초1-2', curriculumSheetGradeMode: 'multi' }))
    assert.equal((await getDoc(member)).data().curriculumSheetGradeMode, 'multi')
    const newcomer = doc(env.authenticatedContext('newcomer').firestore(), 'projects/p')
    await assertFails(updateDoc(newcomer, { memberUids: ['host', 'member', 'newcomer'], teamGradeBands: ['3-4학년군'] }))
    await assertSucceeds(updateDoc(newcomer, { memberUids: ['host', 'member', 'newcomer'], 'memberInfo.newcomer': { displayName: '신규' } }))
  } finally { await env.cleanup() }
})
