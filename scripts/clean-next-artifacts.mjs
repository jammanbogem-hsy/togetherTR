// Firebase Hosting predeploy 훅: 함수 번들에 딸려 올라가는 불필요한 .next 산출물을 지운다.
//
// firebase-tools(프레임워크 통합)는 .next 전체를 함수 디렉터리로 복사한다
// (cache/webpack/*-development, cache/eslint 만 제외). 그래서 아래 두 가지가
// 그대로 압축·업로드돼 배포가 수 분씩 느려졌다(2026-09-20 실측: 1.7 GB).
//   .next/dev            — `next dev` 산출물. 런타임에 쓰이지 않는다.
//   .next/cache/webpack  — 예전 webpack 빌드 캐시. 지금 빌드는 Turbopack 이라 다시 생기지도 않는다.
// 둘 다 지워도 `next build` 결과(server/static/build)에는 영향이 없다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['.next/dev', '.next/cache/webpack']

function sizeOf(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) { try { total += fs.statSync(full).size } catch { /* ignore */ } }
    }
  }
  return total
}

let freed = 0
for (const relative of TARGETS) {
  const target = path.join(ROOT, relative)
  if (!fs.existsSync(target)) continue
  const bytes = sizeOf(target)
  fs.rmSync(target, { recursive: true, force: true })
  freed += bytes
  console.log(`[clean-next-artifacts] removed ${relative} (${(bytes / 1024 / 1024).toFixed(0)} MB)`)
}
console.log(`[clean-next-artifacts] freed ${(freed / 1024 / 1024).toFixed(0)} MB before deploy`)
