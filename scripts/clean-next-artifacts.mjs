// Firebase Hosting predeploy 훅: 함수 번들에 딸려 올라가는 불필요한 .next 산출물을 지운다.
//
// firebase-tools(프레임워크 통합)는 .next 전체를 함수 디렉터리로 복사한다
// (cache/webpack/*-development, cache/eslint 만 제외). 그래서 아래 두 가지가
// 그대로 압축·업로드돼 배포가 수 분씩 느려졌다(2026-09-20 실측: 1.7 GB).
//   .next/dev            — `next dev` 산출물. 런타임에 쓰이지 않는다.
//   .next/cache/webpack  — 예전 webpack 빌드 캐시. 지금 빌드는 Turbopack 이라 다시 생기지도 않는다.
// 둘 다 지워도 `next build` 결과(server/static/build)에는 영향이 없다.
//
// 또한 firebase-tools 는 .firebase/<site>/functions/.next 에 덮어쓰기만 하고 비우지 않아
// 예전 배포에서 복사된 dev/·cache/ 가 그대로 남아 다시 업로드된다(2026-09-20 재확인).
//
// 실행 순서 주의: hosting.predeploy 훅은 프레임워크 빌드·복사가 끝난 뒤, 업로드 직전에 돈다.
// 그래서 스테이징 .next 를 통째로 지우면 방금 만든 server/ 까지 사라져 함수가 500 을 낸다
// (2026-09-20 검증 사이트에서 실제 발생). 스테이징에서도 dev/·cache/webpack 만 지운다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['.next/dev', '.next/cache/webpack']
const STAGING_ROOT = path.join(ROOT, '.firebase')

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
function remove(target, label) {
  if (!fs.existsSync(target)) return
  const bytes = sizeOf(target)
  fs.rmSync(target, { recursive: true, force: true })
  freed += bytes
  console.log(`[clean-next-artifacts] removed ${label} (${(bytes / 1024 / 1024).toFixed(0)} MB)`)
}
for (const relative of TARGETS) remove(path.join(ROOT, relative), relative)
if (fs.existsSync(STAGING_ROOT)) {
  for (const site of fs.readdirSync(STAGING_ROOT, { withFileTypes: true })) {
    if (!site.isDirectory()) continue
    for (const relative of TARGETS) {
      remove(path.join(STAGING_ROOT, site.name, 'functions', relative), `.firebase/${site.name}/functions/${relative}`)
    }
  }
}
console.log(`[clean-next-artifacts] freed ${(freed / 1024 / 1024).toFixed(0)} MB before deploy`)
