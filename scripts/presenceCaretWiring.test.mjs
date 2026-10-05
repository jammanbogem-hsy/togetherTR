// Contract: in the four workspace modals, every shared field (its blur calls blurField) must
// report caretPos on focus/select/key/click/change and render remote carets for the same key.
// Before #R3 follow-up, these modals sent only the cellKey, so caretPos was always undefined.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const MODALS = ['EvaluationPlan', 'LessonDesignDirection', 'ProblemSituation', 'SupportTool']

function sharedFields(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fields = []
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties
      const named = name => attrs.find(a => ts.isJsxAttribute(a) && a.name.getText() === name)
      const onBlur = named('onBlur')
      if (onBlur && onBlur.getText().includes('blurField()')) {
        const spread = attrs.find(a => ts.isJsxSpreadAttribute(a) && /^caretProps\(/.test(a.expression.getText()))
        fields.push({
          tag: node.tagName.getText(),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          caretKey: spread ? spread.expression.arguments[0].getText() : null,
          editorsText: named('caretEditors')?.initializer?.getText() ?? null,
          changeText: named('onChange')?.initializer?.getText() ?? '',
          hasBareFocus: !!named('onFocus'),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return fields
}

for (const name of MODALS) {
  test(`${name}: every shared field sends and draws caret positions`, () => {
    const fields = sharedFields(`src/components/artifacts/${name}WorkspaceModal.tsx`)
    // main cell, column title, block-table cell, checklist item, plain block
    assert.ok(fields.length >= 5, `found only ${fields.length} shared fields`)
    for (const f of fields) {
      const where = `${name}:${f.line} <${f.tag}>`
      assert.notEqual(f.tag, 'input', `${where} plain <input> cannot draw remote carets; use PresenceInput`)
      assert.ok(f.caretKey, `${where} missing {...caretProps(key)}`)
      assert.equal(f.hasBareFocus, false, `${where} onFocus overrides caretProps`)
      assert.ok(f.editorsText, `${where} missing caretEditors`)
      const key = f.caretKey
      assert.ok(
        f.editorsText.includes(key) || f.editorsText === '{editor ? [editor] : []}',
        `${where} caretEditors is not keyed by ${key}`,
      )
      assert.ok(
        f.changeText.includes(`updatePresence(${key}, event.target.selectionStart`),
        `${where} onChange does not report caretPos for ${key}`,
      )
    }
  })
}

test('checklist items use a per-item presence key', () => {
  for (const name of MODALS) {
    const keys = sharedFields(`src/components/artifacts/${name}WorkspaceModal.tsx`).map(f => f.caretKey)
    assert.ok(keys.includes('`block:${block.id}:check:${idx}`'), `${name} checklist key`)
  }
})

for (const name of ['TeamVision', 'IntegratedGoal', 'RoleDistribution', 'TeamRules', 'TeamSchedule', 'TopicSelection', 'LearningActivity', 'Scaffolding']) {
  test(`${name}: paragraphs, checklist entries and headers keep the same caret wiring as cells`, () => {
    const file = `src/components/artifacts/${name}WorkspaceModal.tsx`
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let fields = 0
    function visit(node) {
      if (ts.isJsxSelfClosingElement(node)) {
        const named = key => node.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText() === key)
        const focus = named('onFocus')?.getText() ?? ''
        if (focus.includes('focusField(')) {
          fields++
          const where = `${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
          assert.notEqual(node.tagName.getText(), 'input', `${where}: needs a cursor layer`)
          assert.match(focus, /selectionStart/, `${where}: focus position`)
          for (const event of ['onSelect', 'onKeyUp', 'onClick']) assert.ok(named(event), `${where}: ${event}`)
          assert.match(named('onChange')?.getText() ?? '', /updatePresence\(/, `${where}: typing position`)
          assert.ok(named('caretEditors') || node.parent.getText().includes('<CaretOverlay'), `${where}: remote cursor`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(fields >= 5, `${name}: shared field coverage`)
    assert.match(readFileSync(file, 'utf8'), /block:\$\{block.id\}:check:\$\{idx\}/)
  })
}
