import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { seedDocument, mergedDocument, blocksToDocument, documentToBlocks } from '../src/lib/coedit/document.ts'

test('multi-paragraph formatting and lists survive persistence and re-import', () => {
  const document = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '첫 문단', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: '둘째 문단', marks: [{ type: 'bold' }, { type: 'underline' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '목록' }] }] }] },
  ] }
  const blocks = documentToBlocks(document)
  const saved = mergedDocument(seedDocument(blocks), new Uint8Array([0, 0])).blocks
  assert.deepEqual(saved[0].richContent.content[0].marks.map(mark => mark.type), ['bold'])
  assert.equal(saved[1].richContent.content[0].marks.length, 2)
  assert.equal(saved[2].richContent.type, 'bulletList')
  assert.equal(blocksToDocument(saved).content[2].type, 'bulletList')
})

test('T-2 artifact renders the saved document body and escapes HTML', () => {
  const source = fs.readFileSync(new URL('../src/components/artifacts/structured/T12Renderer.tsx', import.meta.url), 'utf8')
  const module = { exports: {} }
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX })
  new Function('require', 'module', 'exports', js)(createRequire(import.meta.url), module, module.exports)
  const html = renderToStaticMarkup(React.createElement(module.exports.T12Renderer, { data: {
    _schema: 'T-1-2', designPrinciples: [], manualWorkspace: { columns: [], rows: [], blocks: [{ id: 'p', type: 'paragraph', content: '공동 문서 내용 <script>alert(1)</script>', richContent: { type: 'paragraph', content: [{ type: 'text', text: '공동 문서 내용 <script>alert(1)</script>', marks: [{ type: 'bold' }, { type: 'underline' }] }] } }] },
  } }))
  assert.match(html, /공동 문서 내용/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /<u><strong>공동 문서 내용/)
})

test('legacy headings, quotes, checklist markers and table cells survive import/export', () => {
  const blocks = [
    { id: 'h', type: 'heading', content: '수업 설계' },
    { id: 'p', type: 'paragraph', content: '첫 문단\n둘째 문단' },
    { id: 'q', type: 'quote', content: '근거 하나\n근거 둘', includeInArtifact: false },
    { id: 'c', type: 'checklist', content: '- [x] 확인\n- [ ] 검토' },
    { id: 't', type: 'table', content: '', table: { columns: [{ id: 'a', label: '방향' }], rows: [{ id: 'r', cells: { a: '협력' } }] } },
  ]
  const converted = documentToBlocks(blocksToDocument(blocks))
  assert.equal(converted[0].type, 'heading')
  assert.equal(converted[3].content, '근거 하나\n근거 둘')
  assert.equal(converted[3].includeInArtifact, false)
  assert.equal(converted[4].content, '- [x] 확인')
  assert.equal(converted.at(-1).table.rows[0].cells['column-0'], '협력')
})

test('two independent editors inserting in the same sentence converge without overwriting', () => {
  const seed = seedDocument([{ id: 'p', type: 'paragraph', content: '함께 설계' }])
  const a = new Y.Doc(), b = new Y.Doc()
  Y.applyUpdate(a, seed); Y.applyUpdate(b, seed)
  a.getXmlFragment('default').get(0).get(0).insert(2, ' A교사')
  b.getXmlFragment('default').get(0).get(0).insert(2, ' B교사')
  const updateA = Y.encodeStateAsUpdate(a), updateB = Y.encodeStateAsUpdate(b)
  const ab = mergedDocument(mergedDocument(seed, updateA).state, updateB)
  const ba = mergedDocument(mergedDocument(seed, updateB).state, updateA)
  assert.deepEqual(ab.blocks, ba.blocks)
  assert.match(ab.blocks[0].content, /A교사/)
  assert.match(ab.blocks[0].content, /B교사/)
  assert.deepEqual(mergedDocument(ab.state, updateA).blocks, ab.blocks, 'retry is idempotent')
  a.destroy(); b.destroy()
})

test('concurrent delete and insertion preserve the other teacher insertion', () => {
  const seed = seedDocument([{ id: 'p', type: 'paragraph', content: '기존 문장' }])
  const a = new Y.Doc(), b = new Y.Doc()
  Y.applyUpdate(a, seed); Y.applyUpdate(b, seed)
  a.getXmlFragment('default').get(0).get(0).delete(0, 2)
  b.getXmlFragment('default').get(0).get(0).insert(0, '새로운 ')
  const result = mergedDocument(Y.encodeStateAsUpdate(a), Y.encodeStateAsUpdate(b))
  assert.equal(result.blocks[0].content, '새로운  문장')
  a.destroy(); b.destroy()
})
