// 배포 버전 감지 — 한 번의 next build 에서 next.config 가 정한 빌드 도장(NEXT_PUBLIC_BUILD_STAMP)이
// 클라이언트 번들과 서버(/api/version)에 같은 값으로 박힌다. 열려 있던 탭의 번들 도장이 서버 도장과 다르면
// 새 버전이 배포된 것 — 탭이 옛 코드로 남아 일반 환영 등을 만드는 문제(2026-10-04 T4c)를 막는다.

export const CLIENT_BUILD_STAMP = process.env.NEXT_PUBLIC_BUILD_STAMP ?? ''

/** 확인 주기(ms) — 5분. 창에 다시 포커스가 오거나 화면이 보일 때도 확인한다. */
export const BUILD_CHECK_INTERVAL_MS = 5 * 60 * 1000

export function isNewBuildAvailable(clientStamp: string, serverStamp: unknown): boolean {
  return typeof serverStamp === 'string' && !!serverStamp && !!clientStamp && serverStamp !== clientStamp
}
