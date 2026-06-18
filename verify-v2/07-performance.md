# 07. 성능 분석 (performance-analyst)

> 소유자: `performance-analyst` | 작성일: 2026-05-14 | 상태: 작업 전

## 검증 범위
- **번들 크기** — Next.js build 결과, code splitting, dynamic import 활용도
- **Firestore 쿼리** — N+1, 인덱스 누락, 불필요한 onSnapshot, 페이지네이션 부재
- **렌더 성능** — React 19 컴포넌트 중 useMemo/useCallback 누락, 불필요 리렌더, key 누락
- **SSE 처리** — 토큰 단위 setState 폭주, requestAnimationFrame 사용 여부
- **이미지** — next/image 사용률, public/ 자산 크기, 압축
- **데이터 로드** — `standards_all.json` 7MB 클라이언트 로드 여부
- **캐시 전략** — Firestore 오프라인 캐시, SWR/React Query 부재, fetch revalidate
- **Core Web Vitals** — LCP/INP/CLS 예상 영향 분석
- **메모리 누수** — onSnapshot unsubscribe 누락, AbortController 누락

## 기준(spec)
- Next.js 16 성능 가이드
- React 19 best practices
- Firestore pricing/performance docs

## 현재 구현 상태
_TBD by performance-analyst — 모든 주장은 file:line 인용_

## 정합성 판정
| 항목 | 판정 | 증거 | 비고 |
|---|---|---|---|
| _TBD_ | | | |

## 리스크 (P0/P1/P2)
_TBD_

## 권장 조치
_TBD_
