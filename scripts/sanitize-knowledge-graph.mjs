// Rewrite the elementary knowledge graph's 지식⋅이해 / 과정⋅기능 / 가치⋅태도 lists
// from the elementary content systems (data/curriculum-content-systems, 학년군별).
//
// Why: the graph builder (~/교육과정/curri/scripts/build_elementary_graph.py)
// copies the 초·중 common core-idea group lists onto every standard, which are
// mostly 중학교 items. graphReader.loadGraph() applies the same replacement at
// runtime; this script keeps the on-disk JSON (and every tool that reads it,
// e.g. the Excel export) consistent with what the app serves.
//
// Run: npm run sanitize:knowledge-graph
//   (= node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/sanitize-knowledge-graph.mjs)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyElementaryContentLists } from '../src/lib/curriculum/elementaryContentLists.ts'
import { dedupeCoreIdeaSentences } from '../src/lib/curriculum/coreIdeaDedupe.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = [
  path.join(REPO_ROOT, 'data', 'elementary_knowledge_graph.json'),
  path.join(REPO_ROOT, 'public', 'elementary_knowledge_graph.json'),
]

process.chdir(REPO_ROOT)

const source = TARGETS.find(target => fs.existsSync(target))
if (!source) {
  console.error('[sanitize] elementary_knowledge_graph.json not found under data/ or public/')
  process.exit(1)
}

const graph = JSON.parse(fs.readFileSync(source, 'utf-8'))
const before = countItems(graph)
applyElementaryContentLists(graph)
// 같은 교과·학년군 안에서 여러 노드에 중복된 핵심아이디어 문장은 성취기준이 많은 노드에만 남긴다.
const duplicates = dedupeCoreIdeaSentences(graph)
const after = countItems(graph)

graph.metadata = {
  ...graph.metadata,
  content_lists_source: 'data/curriculum-content-systems (학년군별, 초등 학년군만)',
  content_lists_sanitized_at: new Date().toISOString().slice(0, 10),
}

const serialized = JSON.stringify(graph, null, 2)
for (const target of TARGETS) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, serialized)
  console.log(`[sanitize] wrote ${path.relative(REPO_ROOT, target)}`)
}
console.log(`[sanitize] standards: knowledge ${before.knowledge} → ${after.knowledge}, functions ${before.functions} → ${after.functions}, competencies ${before.competencies} → ${after.competencies}`)
console.log(`[sanitize] coreIdeas: knowledge ${before.ciKnowledge} → ${after.ciKnowledge}, functions ${before.ciFunctions} → ${after.ciFunctions}`)
for (const dup of duplicates) {
  console.log(`[sanitize] core idea dedupe ${dup.subjectId} ${dup.band}: "${dup.idea.slice(0, 40)}…" → ${dup.keptNodeId} 유지, ${dup.removedNodeIds.join(', ')} 에서 제거`)
}

function countItems(g) {
  const sum = (arr, key) => arr.reduce((acc, item) => acc + (item[key]?.length ?? 0), 0)
  return {
    knowledge: sum(g.achievementStandards ?? [], 'knowledge'),
    functions: sum(g.achievementStandards ?? [], 'functions'),
    competencies: sum(g.achievementStandards ?? [], 'competencies'),
    ciKnowledge: sum(g.coreIdeas ?? [], 'knowledge'),
    ciFunctions: sum(g.coreIdeas ?? [], 'functions'),
  }
}
