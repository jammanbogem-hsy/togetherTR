import { Extension, getSchema, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { TeamVisionWorkspaceBlock } from '../../types/index'

const ArtifactVisibility = Extension.create({
  name: 'artifactVisibility',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading', 'blockquote', 'table'], attributes: { includeInArtifact: { default: true, rendered: false } } }]
  },
})
export const documentExtensions = () => [StarterKit.configure({ undoRedo: false }), TableKit, ArtifactVisibility]
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
export function blocksToDocument(blocks: TeamVisionWorkspaceBlock[]): JSONContent {
  const content: JSONContent[] = blocks.flatMap(block => {
    const annotate = (nodes: JSONContent[]) => nodes.map(node => ({ ...node, attrs: { ...node.attrs, includeInArtifact: block.includeInArtifact !== false } }))
    if (block.richContent) return annotate([block.richContent])
    if (block.type === 'table' && block.table) {
      const { columns, rows } = block.table
      return annotate([{ type: 'table', content: [
        { type: 'tableRow', content: columns.map(c => ({ type: 'tableHeader', content: [paragraph(c.label)] })) },
        ...rows.map(row => ({ type: 'tableRow', content: columns.map(c => ({ type: 'tableCell', content: [paragraph(row.cells[c.id] ?? '')] })) })),
      ] }])
    }
    if (block.type === 'heading' || block.type === 'subheading') return annotate([{ ...paragraph(block.content), type: 'heading', attrs: { level: block.type === 'heading' ? 1 : 2 } }])
    if (block.type === 'quote') return annotate([{ type: 'blockquote', content: block.content.split('\n').map(paragraph) }])
    // Keep checklist markers losslessly; editing is plain paragraphs initially.
    return annotate(block.content.split('\n').map(paragraph))
  })
  return { type: 'doc', content: content.length ? content : [paragraph('')] }
}
function textOf(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\n'
  const blockChildren = (node.content ?? []).some(child => ['paragraph', 'listItem', 'bulletList', 'orderedList'].includes(child.type ?? ''))
  return node.text ?? (node.content ?? []).map(textOf).join(blockChildren ? '\n' : '')
}
export function documentToBlocks(document: JSONContent): TeamVisionWorkspaceBlock[] {
  return (document.content ?? []).map((node, i) => {
    const id = `document-${i}`
    const includeInArtifact = node.attrs?.includeInArtifact !== false
    if (node.type === 'table') {
      const [header, ...body] = node.content ?? []
      const columns = (header?.content ?? []).map((cell, j) => ({ id: `column-${j}`, label: textOf(cell) }))
      return { id, includeInArtifact, richContent: node, type: 'table', content: '', table: { columns, rows: body.map((row, j) => ({ id: `row-${j}`, cells: Object.fromEntries(columns.map((c, k) => [c.id, textOf(row.content?.[k] ?? {})])) })) } }
    }
    return { id, includeInArtifact, richContent: node, type: node.type === 'heading' ? (node.attrs?.level === 1 ? 'heading' : 'subheading') : node.type === 'blockquote' ? 'quote' : 'paragraph', content: textOf(node) }
  })
}
export function seedDocument(blocks: TeamVisionWorkspaceBlock[]): Uint8Array {
  const doc = prosemirrorJSONToYDoc(getSchema(documentExtensions()), blocksToDocument(blocks), 'default')
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}
export function mergedDocument(state: Uint8Array, update: Uint8Array) {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    Y.applyUpdate(doc, update)
    return { state: Y.encodeStateAsUpdate(doc), blocks: documentToBlocks(yDocToProsemirrorJSON(doc, 'default') as JSONContent) }
  } finally { doc.destroy() }
}
