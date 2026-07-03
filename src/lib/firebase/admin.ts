// 서버 전용 Firestore (firebase-admin) — 보안 규칙을 우회하는 관리자 권한 접근.
// API 라우트(자료 RAG 검색·PDF 청크 적재·이전 주기 참조)처럼 사용자 인증
// 컨텍스트가 없는 서버 코드는 클라이언트 SDK로는 isMember 규칙에 걸려
// permission-denied가 나므로 반드시 이 모듈을 사용한다.
//
// 자격증명 우선순위:
//  1. FIREBASE_SERVICE_ACCOUNT — 서비스 계정 JSON 전체를 담은 env (로컬 개발용)
//  2. Application Default Credentials — Firebase App Hosting/Cloud Run/Functions
//     배포 환경에서 자동 주입 (별도 설정 불필요)
// 둘 다 없으면 null을 반환하고 호출부는 해당 기능을 조용히 비활성화한다.

import { getApps, initializeApp, applicationDefault, cert, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

let cached: Firestore | null | undefined
let warned = false

export function getAdminDb(): Firestore | null {
  if (cached !== undefined) return cached
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    const app: App = getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        })
    cached = getFirestore(app)
  } catch (e) {
    warnOnce(e)
    cached = null
  }
  return cached
}

/** 첫 호출에서 자격증명 부재가 확인되면 이후 요청의 반복 시도·로그를 막는다.
 *  (applicationDefault()는 init 시점이 아니라 첫 Firestore 호출에서 실패할 수 있음) */
export function disableAdminDb(reason: unknown): void {
  warnOnce(reason)
  cached = null
}

/** 자격증명 계열 오류인지 판별 — 일시적 네트워크 오류로 기능 전체를 끄지 않기 위함 */
export function isCredentialError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /PERMISSION_DENIED|UNAUTHENTICATED|default credentials|Could not load|invalid_grant|metadata/i.test(msg)
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
