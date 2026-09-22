// Build a separate deployable app from the SAME map source. Never copies the
// original app routes, authentication, Firestore access, or local credentials.
// Usage: node scripts/prepare-public-curriculum-map.mjs /absolute/empty/directory
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = path.join(ROOT, 'deploy/curriculum-map')
const ENTRY_POINTS = [
  'src/components/curriculum-map/CurriculumMapWorkspace.tsx',
  'src/app/api/curriculum-map/search/route.ts',
  'src/app/api/curriculum-map/related/route.ts',
]
const PUBLIC_ASSETS = [
  'curriculum_map.json',
  'elementary_knowledge_graph.json',
  'embeddings_cache.json',
  'embeddings_v2.json',
]

function resolveImport(specifier, importer) {
  const base = specifier.startsWith('@/')
    ? path.join(ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(importer), specifier) : null
  if (!base) return null // package imports are installed from the shared lockfile
  const candidates = [base, ...['.ts', '.tsx', '.js', '.mjs', '.json'].map(ext => base + ext),
    ...['.ts', '.tsx'].map(ext => path.join(base, 'index' + ext))]
  const resolved = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile())
  if (!resolved) throw new Error(`Unresolved import ${specifier} in ${path.relative(ROOT, importer)}`)
  return resolved
}

export function collectMapSourceFiles() {
  const files = new Set()
  const queue = ENTRY_POINTS.map(file => path.join(ROOT, file))
  while (queue.length) {
    const file = queue.pop()
    if (files.has(file)) continue
    const relative = path.relative(ROOT, file)
    if (!relative.startsWith('src/') || relative.startsWith('src/lib/firebase/') ||
        relative.startsWith('src/store/') ||
        (relative.startsWith('src/app/') && !ENTRY_POINTS.includes(relative))) {
      throw new Error(`Private or unexpected dependency in public map: ${relative}`)
    }
    files.add(file)
    const source = fs.readFileSync(file, 'utf8')
    for (const { fileName } of ts.preProcessFile(source, true, true).importedFiles) {
      const dependency = resolveImport(fileName, file)
      if (dependency) queue.push(dependency)
    }
  }
  return [...files].map(file => path.relative(ROOT, file)).sort()
}

export function preparePublicCurriculumMap(destination) {
  const target = path.resolve(destination)
  if (target === ROOT || target.startsWith(ROOT + path.sep) || ROOT.startsWith(target + path.sep)) {
    throw new Error('Use a separate directory outside the repository for deployment.')
  }
  if (fs.existsSync(target) && fs.readdirSync(target).length) {
    throw new Error('Destination must be empty; existing files are never removed.')
  }
  const sources = collectMapSourceFiles()
  fs.mkdirSync(target, { recursive: true })
  const copy = (from, to) => {
    const dest = path.join(target, to)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(from, dest, { recursive: true })
  }
  for (const source of sources) copy(path.join(ROOT, source), source)
  for (const file of ['tsconfig.json', 'postcss.config.mjs', 'package-lock.json', 'scripts/clean-next-artifacts.mjs']) {
    copy(path.join(ROOT, file), file)
  }
  copy(path.join(ROOT, 'src/app/globals.css'), 'src/app/globals.css')
  copy(path.join(ROOT, 'src/app/favicon.ico'), 'src/app/favicon.ico')
  for (const file of ['page.tsx', 'layout.tsx']) {
    copy(path.join(TEMPLATE, file + '.template'), 'src/app/' + file)
  }
  for (const file of ['next.config.mjs', 'firebase.json']) copy(path.join(TEMPLATE, file), file)
  for (const file of PUBLIC_ASSETS) copy(path.join(ROOT, 'public', file), 'public/' + file)
  // Curated source, not a possibly stale generated public/ copy.
  copy(path.join(ROOT, 'data/curriculum-content-systems'), 'public/curriculum-content-systems')

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  pkg.scripts = { dev: 'next dev', build: 'next build', start: 'next start' }
  pkg.engines = { node: '24' }
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  fs.writeFileSync(path.join(target, '.firebaserc'), JSON.stringify({ projects: { default: 'togethertr' } }, null, 2) + '\n')
  fs.writeFileSync(path.join(target, '.gitignore'), 'node_modules/\n.next/\n.firebase/\n.env*\nfirebase-debug.log\n')
  fs.writeFileSync(path.join(target, 'public-map-source.json'), JSON.stringify({ sources }, null, 2) + '\n')
  return { target, sources }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-public-curriculum-map.mjs /absolute/empty/directory')
  const { target, sources } = preparePublicCurriculumMap(process.argv[2])
  console.log(`Prepared public map (${sources.length} shared source files): ${target}`)
  console.log('Install dependencies and provide server-only AI environment variables before deploying.')
}
