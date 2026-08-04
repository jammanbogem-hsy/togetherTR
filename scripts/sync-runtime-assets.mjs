// Deterministic prebuild sync: copy the fs-read curriculum data that the SSR
// routes need into public/, which Firebase/Next reliably ships in the function
// bundle. (Next 16 + Firebase frameworks silently drop `outputFileTracingIncludes`
// globs, so `data/**` never reaches the deployed function — verified: the built
// .firebase/*/functions bundle contained only public/*. coreIdeas survived only
// because the graph already lives in public/.)
//
// Sources (single source of truth stays under data/, committed):
//   data/curriculum-content-systems/*.json  → public/curriculum-content-systems/
//     (read by /api/core-ideas via contentSystemReader; provides area +
//      지식⋅이해 / 과정⋅기능 원문)
//   data/core-idea-area-mapping.json         → public/core-idea-area-mapping.json
//     (read by /api/curriculum-sheet/autofill)
//
// Excludes *.bak and non-JSON. Destinations are gitignored generated artifacts
// (see .gitignore) so there is no committed duplicate to go stale.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

const CONTENT_SYSTEMS_SUBDIR = 'curriculum-content-systems'
const MAPPING_FILENAME = 'core-idea-area-mapping.json'

function isSyncableJson(name) {
  return name.endsWith('.json') && !name.endsWith('.bak')
}

/**
 * Copy runtime curriculum assets from data/ into publicDir. Deterministic:
 * the content-systems destination is wiped and rebuilt so a renamed/removed
 * source file cannot leave a stale copy behind.
 *
 * @param {{ repoRoot?: string, publicDir?: string }} [opts]
 * @returns {{ contentSystems: string[], mappingCopied: boolean, publicDir: string }}
 */
export function syncRuntimeAssets(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT
  const publicDir = opts.publicDir ?? path.join(repoRoot, 'public')

  const srcCsDir = path.join(repoRoot, 'data', CONTENT_SYSTEMS_SUBDIR)
  const dstCsDir = path.join(publicDir, CONTENT_SYSTEMS_SUBDIR)

  if (!fs.existsSync(srcCsDir)) {
    throw new Error(`[sync-runtime-assets] source missing: ${srcCsDir}`)
  }

  // Deterministic rebuild of the content-systems destination.
  fs.rmSync(dstCsDir, { recursive: true, force: true })
  fs.mkdirSync(dstCsDir, { recursive: true })

  const contentSystems = fs
    .readdirSync(srcCsDir)
    .filter(isSyncableJson)
    .sort()
  for (const name of contentSystems) {
    fs.copyFileSync(path.join(srcCsDir, name), path.join(dstCsDir, name))
  }

  // core-idea-area-mapping.json is generated (gitignored). Copy when present.
  const srcMapping = path.join(repoRoot, 'data', MAPPING_FILENAME)
  let mappingCopied = false
  if (fs.existsSync(srcMapping)) {
    fs.copyFileSync(srcMapping, path.join(publicDir, MAPPING_FILENAME))
    mappingCopied = true
  }

  return { contentSystems, mappingCopied, publicDir }
}

// Run when invoked directly (npm build step), not when imported by the test.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = syncRuntimeAssets()
  const mappingNote = result.mappingCopied
    ? MAPPING_FILENAME
    : `${MAPPING_FILENAME} (absent — run npm run build:core-idea-mapping)`
  console.log(
    `[sync-runtime-assets] ${result.contentSystems.length} content-system files + ${mappingNote} → ${path.relative(REPO_ROOT, result.publicDir)}/`,
  )
}
