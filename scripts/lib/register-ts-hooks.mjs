// Resolve hooks so raw Node (with --experimental-strip-types) can load this
// repo's TS modules: extensionless relative imports (./graphReader) and the
// Next.js "@/..." alias (tsconfig paths → src/). Used by verification scripts.
// Usage: node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs <script>
import { registerHooks } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC_DIR = path.join(REPO_ROOT, 'src')
const EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs']

function tryFile(base) {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const ext of EXTS) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTS) {
    const idx = path.join(base, 'index' + ext)
    if (fs.existsSync(idx)) return idx
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const hit = tryFile(path.join(SRC_DIR, specifier.slice(2)))
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL))
      const hit = tryFile(path.resolve(parentDir, specifier))
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
