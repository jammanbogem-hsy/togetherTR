#!/usr/bin/env node

import fs from 'fs'
import path from 'path'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const DEFAULT_TOP_K = 8
const SUBJECT_NAMES = {
  sub_kor: '국어',
  sub_math: '수학',
  sub_sci: '과학',
  sub_soc: '사회',
  sub_mor: '도덕',
  sub_art: '미술',
  sub_mus: '음악',
  sub_pe: '체육',
  sub_eng: '영어',
  sub_prac: '실과',
  sub_int: '통합교과',
  sub_extra: '창체',
}

function printHelp() {
  console.log(`Usage:
  node scripts/evaluate-knowledge-graph.mjs --theme "법의 의미와 역할" --grade-group 초5-6
  node scripts/evaluate-knowledge-graph.mjs --themes-file ./docs/knowledge-graph-eval.sample.json --base-url http://127.0.0.1:3000
  node scripts/evaluate-knowledge-graph.mjs --themes-file ./eval.json --gold-file ./gold.json --output ./tmp/eval-report.json

Options:
  --theme <text>               Single theme to evaluate. Can be repeated.
  --themes-file <path>         JSON file containing themes to evaluate.
  --grade-group <value>        Default grade group to apply when a theme item omits it.
  --base-url <url>             Running app base URL. Default: ${DEFAULT_BASE_URL}
  --top-k <number>             Max result size for keyword/hybrid API. Default: ${DEFAULT_TOP_K}
  --gold-file <path>           Optional gold labels file for precision-style scoring.
  --output <path>              Optional JSON output path.
  --timeout-ms <number>        Per-request timeout. Default: 120000
  --help                       Show this help.

themes-file JSON format:
[
  { "theme": "법의 의미와 역할", "gradeGroup": "초5-6" },
  { "theme": "기후 변화와 책임 있는 실천", "gradeGroup": "초5-6" }
]

gold-file JSON format:
[
  {
    "theme": "법의 의미와 역할",
    "gradeGroup": "초5-6",
    "expectedCenterCodes": ["6사03-01"],
    "expectedConnectionCodes": ["6사03-02", "6도03-02", "6국01-07"],
    "expectedSubjects": ["사회", "도덕", "국어"]
  }
]
`)
}

function parseArgs(argv) {
  const args = {
    themes: [],
    themesFile: null,
    gradeGroup: null,
    baseUrl: DEFAULT_BASE_URL,
    topK: DEFAULT_TOP_K,
    goldFile: null,
    output: null,
    timeoutMs: 120000,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    switch (token) {
      case '--theme':
        args.themes.push(argv[++i])
        break
      case '--themes-file':
        args.themesFile = argv[++i]
        break
      case '--grade-group':
        args.gradeGroup = argv[++i]
        break
      case '--base-url':
        args.baseUrl = argv[++i]
        break
      case '--top-k':
        args.topK = Number(argv[++i] || DEFAULT_TOP_K)
        break
      case '--gold-file':
        args.goldFile = argv[++i]
        break
      case '--output':
        args.output = argv[++i]
        break
      case '--timeout-ms':
        args.timeoutMs = Number(argv[++i] || 120000)
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  return args
}

function readJsonFile(filePath, label) {
  const absolute = path.resolve(filePath)
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf-8'))
  } catch (error) {
    throw new Error(`${label} JSON을 읽지 못했습니다: ${absolute}\n${String(error)}`)
  }
}

function normalizeThemeEntries(args) {
  const inlineThemes = args.themes.map((theme) => ({
    theme,
    gradeGroup: args.gradeGroup ?? undefined,
  }))

  const fileThemes = args.themesFile
    ? readJsonFile(args.themesFile, 'themes-file')
    : []

  const rawThemes = [...inlineThemes, ...fileThemes]
  const normalized = rawThemes
    .map((item) => {
      if (typeof item === 'string') {
        return { theme: item, gradeGroup: args.gradeGroup ?? undefined }
      }
      return {
        theme: String(item.theme ?? '').trim(),
        gradeGroup: item.gradeGroup ?? args.gradeGroup ?? undefined,
      }
    })
    .filter((item) => item.theme)

  if (normalized.length === 0) {
    throw new Error('평가할 theme이 없습니다. --theme 또는 --themes-file을 사용하세요.')
  }

  return normalized
}

function buildGoldMap(goldEntries) {
  const map = new Map()
  for (const entry of goldEntries ?? []) {
    const key = `${String(entry.theme ?? '').trim()}::${String(entry.gradeGroup ?? '').trim()}`
    map.set(key, {
      expectedCenterCodes: entry.expectedCenterCodes ?? [],
      expectedConnectionCodes: entry.expectedConnectionCodes ?? [],
      expectedSubjects: entry.expectedSubjects ?? [],
    })
  }
  return map
}

async function fetchJson(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let json
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`JSON 파싱 실패 (${url}): ${text.slice(0, 300)}`)
    }
    if (!response.ok) {
      throw new Error(json.error ? `${response.status} ${json.error}` : `${response.status} ${response.statusText}`)
    }
    return json
  } finally {
    clearTimeout(timeout)
  }
}

function scoreToPercent(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return null
  return value <= 1 ? Math.round(value * 100) : Math.round(value)
}

function extractKnowledgeGraphSummary(payload, algorithm, topK) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : []
  const edges = Array.isArray(payload.edges) ? payload.edges : []
  const standards = nodes.filter((node) => node.type === 'standard')
  const sorted = [...standards].sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0))
  const center = sorted[0] ?? null
  const connections = sorted
    .filter((node) => node.id !== center?.id)
    .slice(0, topK)

  const relationTypes = edges
    .filter((edge) => center && (edge.source === center.id || edge.target === center.id))
    .map((edge) => edge.relation)

  const crossSubjectCount = connections.filter((node) => node.subject_id && node.subject_id !== center?.subject_id).length
  const subjectDiversity = new Set(connections.map((node) => node.subject_id).filter(Boolean)).size + (center?.subject_id ? 1 : 0)
  const meanTopScore = connections.length > 0
    ? Math.round(
      (connections.reduce((sum, node) => sum + (scoreToPercent(node.similarityScore) ?? 0), 0) / connections.length) * 10
    ) / 10
    : null

  return {
    algorithm,
    center: center ? {
      id: center.id,
      code: center.label,
      subjectId: center.subject_id,
      subjectName: SUBJECT_NAMES[center.subject_id] ?? center.subject_id,
      scorePercent: scoreToPercent(center.similarityScore),
    } : null,
    connections: connections.map((node) => ({
      id: node.id,
      code: node.label,
      subjectId: node.subject_id,
      subjectName: SUBJECT_NAMES[node.subject_id] ?? node.subject_id,
      scorePercent: scoreToPercent(node.similarityScore),
    })),
    metrics: {
      nodeCount: standards.length,
      connectedCount: connections.length,
      crossSubjectCount,
      subjectDiversity,
      relationDiversity: new Set(relationTypes.filter(Boolean)).size,
      meanTopScore,
      agentCoverage: 0,
    },
  }
}

function extractOntologySummary(payload) {
  const centerStd = payload.center?.standard
  const connections = Array.isArray(payload.connections) ? payload.connections : []
  const relationTypes = connections.map((node) => node.relationType).filter(Boolean)
  const crossSubjectCount = connections.filter((node) => node.subjectId && node.subjectId !== centerStd?.subject_id).length
  const subjectDiversity = new Set(connections.map((node) => node.subjectId).filter(Boolean)).size + (centerStd?.subject_id ? 1 : 0)
  const meanTopScore = connections.length > 0
    ? Math.round(
      (connections.reduce((sum, node) => sum + (scoreToPercent(node.relationScore ?? node.linkScore ?? node.semanticScore) ?? 0), 0) / connections.length) * 10
    ) / 10
    : null
  const agentCoverage = connections.filter((node) => node.explanation || node.teachingNote).length

  return {
    algorithm: 'semantic',
    center: centerStd ? {
      id: centerStd.id,
      code: centerStd.code,
      subjectId: centerStd.subject_id,
      subjectName: SUBJECT_NAMES[centerStd.subject_id] ?? centerStd.subject_id,
      scorePercent: scoreToPercent(payload.center?.centerScore ?? payload.center?.semanticScore),
    } : null,
    connections: connections.map((node) => ({
      id: node.standard.id,
      code: node.standard.code,
      subjectId: node.subjectId,
      subjectName: SUBJECT_NAMES[node.subjectId] ?? node.subjectId,
      relationType: node.relationType ?? null,
      scorePercent: scoreToPercent(node.relationScore ?? node.linkScore ?? node.semanticScore),
      hasExplanation: Boolean(node.explanation),
      hasTeachingNote: Boolean(node.teachingNote),
    })),
    metrics: {
      nodeCount: 1 + connections.length,
      connectedCount: connections.length,
      crossSubjectCount,
      subjectDiversity,
      relationDiversity: new Set(relationTypes).size,
      meanTopScore,
      agentCoverage,
    },
  }
}

function evaluateAgainstGold(summary, gold) {
  if (!gold) return null

  const connectionCodes = summary.connections.map((node) => node.code)
  const subjectNames = summary.connections
    .map((node) => node.subjectName)
    .filter(Boolean)

  const expectedCenterCodes = new Set(gold.expectedCenterCodes ?? [])
  const expectedConnectionCodes = new Set(gold.expectedConnectionCodes ?? [])
  const expectedSubjects = new Set(gold.expectedSubjects ?? [])

  const centerHit = summary.center?.code && expectedCenterCodes.has(summary.center.code)
  const connectionHits = connectionCodes.filter((code) => expectedConnectionCodes.has(code))
  const subjectHits = subjectNames.filter((subjectId) => expectedSubjects.has(subjectId))

  return {
    centerHit: Boolean(centerHit),
    connectionPrecisionAtK: connectionCodes.length > 0
      ? Math.round((connectionHits.length / connectionCodes.length) * 1000) / 1000
      : null,
    connectionRecallAtK: expectedConnectionCodes.size > 0
      ? Math.round((connectionHits.length / expectedConnectionCodes.size) * 1000) / 1000
      : null,
    subjectCoverage: expectedSubjects.size > 0
      ? Math.round((new Set(subjectHits).size / expectedSubjects.size) * 1000) / 1000
      : null,
    connectionHits,
  }
}

function summarizeComparison(themeResult) {
  const keyword = themeResult.algorithms.keyword
  const hybrid = themeResult.algorithms.hybrid
  const semantic = themeResult.algorithms.semantic

  const bestByCrossSubject = [keyword, hybrid, semantic]
    .filter(Boolean)
    .sort((a, b) => (b.metrics.crossSubjectCount - a.metrics.crossSubjectCount))[0]

  const bestByAgentCoverage = [keyword, hybrid, semantic]
    .filter(Boolean)
    .sort((a, b) => (b.metrics.agentCoverage - a.metrics.agentCoverage))[0]

  return {
    bestCrossSubjectAlgorithm: bestByCrossSubject?.algorithm ?? null,
    bestAgentCoverageAlgorithm: bestByAgentCoverage?.algorithm ?? null,
    semanticVsHybridCrossSubjectDelta:
      (semantic?.metrics.crossSubjectCount ?? 0) - (hybrid?.metrics.crossSubjectCount ?? 0),
    semanticVsKeywordCrossSubjectDelta:
      (semantic?.metrics.crossSubjectCount ?? 0) - (keyword?.metrics.crossSubjectCount ?? 0),
  }
}

async function evaluateTheme(entry, args, goldMap) {
  const baseUrl = args.baseUrl.replace(/\/$/, '')
  const gradeGroup = entry.gradeGroup
  const encodedTheme = encodeURIComponent(entry.theme)

  const gradeGroupQuery = gradeGroup ? `&gradeGroup=${encodeURIComponent(gradeGroup)}` : ''
  const keywordUrl = `${baseUrl}/api/knowledge-graph?keyword=${encodedTheme}&algorithm=keyword&topK=${args.topK}${gradeGroupQuery}`
  const hybridUrl = `${baseUrl}/api/knowledge-graph?keyword=${encodedTheme}&algorithm=hybrid&topK=${args.topK}${gradeGroupQuery}`
  const ontologyUrl = `${baseUrl}/api/ontology/search`

  const [keywordPayload, hybridPayload, semanticPayload] = await Promise.all([
    fetchJson(keywordUrl, {}, args.timeoutMs),
    fetchJson(hybridUrl, {}, args.timeoutMs),
    fetchJson(ontologyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: entry.theme, gradeGroup }),
    }, args.timeoutMs),
  ])

  const algorithms = {
    keyword: extractKnowledgeGraphSummary(keywordPayload, 'keyword', args.topK),
    hybrid: extractKnowledgeGraphSummary(hybridPayload, 'hybrid', args.topK),
    semantic: extractOntologySummary(semanticPayload),
  }

  const goldKey = `${entry.theme}::${gradeGroup ?? ''}`
  const gold = goldMap.get(goldKey)

  return {
    theme: entry.theme,
    gradeGroup: gradeGroup ?? null,
    algorithms: {
      keyword: {
        ...algorithms.keyword,
        goldEvaluation: evaluateAgainstGold(algorithms.keyword, gold),
      },
      hybrid: {
        ...algorithms.hybrid,
        goldEvaluation: evaluateAgainstGold(algorithms.hybrid, gold),
      },
      semantic: {
        ...algorithms.semantic,
        goldEvaluation: evaluateAgainstGold(algorithms.semantic, gold),
      },
    },
    comparison: summarizeComparison({ algorithms }),
  }
}

function printThemeReport(result) {
  console.log(`\n=== ${result.theme} ${result.gradeGroup ? `(${result.gradeGroup})` : ''} ===`)
  for (const algorithmName of ['keyword', 'hybrid', 'semantic']) {
    const summary = result.algorithms[algorithmName]
    console.log(`\n[${algorithmName}]`)
    console.log(`- center: ${summary.center?.code ?? '없음'} (${summary.center?.subjectName ?? summary.center?.subjectId ?? '-'})`)
    console.log(`- connections: ${summary.connections.map((node) => `${node.code}${node.subjectName ? `(${node.subjectName})` : ''}`).join(', ') || '없음'}`)
    console.log(`- subjectDiversity: ${summary.metrics.subjectDiversity}`)
    console.log(`- crossSubjectCount: ${summary.metrics.crossSubjectCount}`)
    console.log(`- relationDiversity: ${summary.metrics.relationDiversity}`)
    console.log(`- agentCoverage: ${summary.metrics.agentCoverage}`)
    if (summary.goldEvaluation) {
      console.log(`- centerHit: ${summary.goldEvaluation.centerHit}`)
      console.log(`- precision@k: ${summary.goldEvaluation.connectionPrecisionAtK ?? 'n/a'}`)
      console.log(`- recall@k: ${summary.goldEvaluation.connectionRecallAtK ?? 'n/a'}`)
      console.log(`- subjectCoverage: ${summary.goldEvaluation.subjectCoverage ?? 'n/a'}`)
    }
  }

  console.log('\n[comparison]')
  console.log(`- bestCrossSubjectAlgorithm: ${result.comparison.bestCrossSubjectAlgorithm ?? 'n/a'}`)
  console.log(`- bestAgentCoverageAlgorithm: ${result.comparison.bestAgentCoverageAlgorithm ?? 'n/a'}`)
  console.log(`- semanticVsHybridCrossSubjectDelta: ${result.comparison.semanticVsHybridCrossSubjectDelta}`)
  console.log(`- semanticVsKeywordCrossSubjectDelta: ${result.comparison.semanticVsKeywordCrossSubjectDelta}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const themes = normalizeThemeEntries(args)
  const goldMap = buildGoldMap(args.goldFile ? readJsonFile(args.goldFile, 'gold-file') : [])

  const results = []
  for (const entry of themes) {
    console.log(`Evaluating: ${entry.theme}${entry.gradeGroup ? ` (${entry.gradeGroup})` : ''}`)
    const result = await evaluateTheme(entry, args, goldMap)
    results.push(result)
    printThemeReport(result)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    topK: args.topK,
    themeCount: results.length,
    results,
  }

  if (args.output) {
    const outputPath = path.resolve(args.output)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8')
    console.log(`\nJSON report written to ${outputPath}`)
  }
}

main().catch((error) => {
  console.error('\n[knowledge-graph-eval] failed')
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
