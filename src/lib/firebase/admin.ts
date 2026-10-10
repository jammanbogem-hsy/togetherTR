// 서버 전용 Firestore (firebase-admin) — 보안 규칙을 우회하는 관리자 권한 접근.
// API 라우트(자료 RAG 검색·PDF 청크 적재·이전 주기 참조)처럼 사용자 인증
// 컨텍스트가 없는 서버 코드는 클라이언트 SDK로는 isMember 규칙에 걸려
// permission-denied가 나므로 반드시 이 모듈을 사용한다.
//
// ⚠️ createRequire 런타임 로드 (정적 import 금지):
//   Turbopack은 firebase-admin을 해시 별칭(firebase-admin-<hash>)으로 외부화하는데,
//   Firebase Hosting 함수 번들에는 그 별칭 패키지가 없어 ERR_MODULE_NOT_FOUND가 난다.
//   정적 import면 이 실패가 "모듈 로드 시점"에 터져, admin을 import하는 채팅 스트림
//   라우트까지 전부 500이 된다(2026-07-05 프로덕션 장애). createRequire로 런타임에
//   실제 패키지명을 resolve하면 번들러가 손대지 않고, 실패해도 아래 try/catch에
//   흡수되어 RAG만 비활성화될 뿐 채팅은 정상 동작한다.
//
// 자격증명 우선순위:
//  1. FIREBASE_SERVICE_ACCOUNT — 서비스 계정 JSON 전체를 담은 env (로컬 개발용)
//  2. Application Default Credentials — Firebase App Hosting/Cloud Run/Functions
//     배포 환경에서 자동 주입 (별도 설정 불필요)

import { createRequire } from 'node:module'
import type { App } from 'firebase-admin/app'
import type { Auth } from 'firebase-admin/auth'
import type { Firestore, FieldValue as FieldValueNS } from 'firebase-admin/firestore'

// Keep a genuine Node require: direct createRequire calls are analyzed by Turbopack,
// which otherwise replaces the variable package path with a MODULE_NOT_FOUND stub.
const nodeRequire = Reflect.apply(createRequire, undefined, [import.meta.url]) as NodeRequire

// Native Node resolution uses the installed package name, never a bundler hash alias.
const ADMIN = ['firebase', 'admin'].join('-')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadAdmin(sub: string): any {
  return nodeRequire(`${ADMIN}/${sub}`)
}

let cached: Firestore | null | undefined
let cachedApp: App | undefined
let warned = false

export function getAdminDb(): Firestore | null {
  if (cached !== undefined) return cached
  try {
    const { getApps, initializeApp, applicationDefault, cert } = loadAdmin('app')
    const { getFirestore } = loadAdmin('firestore')
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    const app = getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        })
    cached = (getFirestore(app) as Firestore) ?? null
    if (cached) cachedApp = app
  } catch (e) {
    warnOnce(e)
    cached = null
  }
  return cached ?? null
}

/** FieldValue(serverTimestamp/delete) — admin SDK가 로드된 경우에만 사용 가능.
 *  getAdminDb()가 null이 아닐 때만 호출할 것. */
export function getFieldValue(): typeof FieldValueNS {
  return loadAdmin('firestore').FieldValue
}

/** FieldPath — for selecting nested fields whose keys contain '-' (activity codes). */
export function getFieldPath(): typeof import('firebase-admin/firestore').FieldPath {
  return loadAdmin('firestore').FieldPath
}

/** Default Storage bucket via the admin SDK (bypasses storage.rules — callers must check access). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAdminBucket(): any | null {
  if (!getAdminDb()) return null
  try {
    const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    return loadAdmin('storage').getStorage(cachedApp).bucket(name || undefined)
  } catch (e) {
    warnOnce(e)
    return null
  }
}

/** 첫 호출에서 자격증명 부재가 확인되면 이후 요청의 반복 시도·로그를 막는다. */
export function disableAdminDb(reason: unknown): void {
  warnOnce(reason)
  cached = null
}

/** 자격증명 계열 오류인지 판별 — 일시적 네트워크 오류로 기능 전체를 끄지 않기 위함 */
export function isCredentialError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /PERMISSION_DENIED|UNAUTHENTICATED|default credentials|Could not load|invalid_grant|metadata|ERR_MODULE_NOT_FOUND|Cannot find (module|package)/i.test(msg)
}

function warnOnce(e: unknown): void {
  if (warned) return
  warned = true
  const msg = e instanceof Error ? e.message : String(e)
  console.warn(
    `[firebase-admin] 서버 Firestore 비활성화 — 자료 RAG 검색·PDF 처리가 동작하지 않습니다. ` +
    `로컬 개발: FIREBASE_SERVICE_ACCOUNT env(서비스 계정 JSON) 또는 gcloud ADC 설정 필요. 원인: ${msg}`
  )
}

/** 서버 전용 Auth(ID 토큰 검증) — getAdminDb 가 앱을 초기화한 뒤에만 쓸 수 있다. 없으면 null. */
export function getAdminAuth(): Auth | null {
  if (!getAdminDb()) return null
  try {
    // Hosting may initialize a named app only; Auth must use the same app as Firestore.
    return loadAdmin('auth').getAuth(cachedApp)
  } catch (e) {
    warnOnce(e)
    return null
  }
}
