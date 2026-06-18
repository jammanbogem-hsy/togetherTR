# 08. 코드 품질 검토 (code-quality-reviewer)

> 소유자: `code-quality-reviewer` | 작성일: 2026-05-14 | 상태: 작업 전

## 검증 범위
- **타입 안전성** — `any`/`as unknown as`/`@ts-ignore`/`@ts-expect-error` 분포, 비-strict 영역
- **죽은 코드** — 호출처 0인 함수·컴포넌트·exports
- **중복 코드** — 동일 로직 재구현 (특히 chat, stage, modal 영역)
- **복잡도** — 함수당 lines/cyclomatic, 200줄+ 컴포넌트
- **명명 일관성** — 한국어/영어 혼용, 약어, 단수/복수
- **에러 처리** — try/catch 누락, swallowed errors, Firestore undefined 패턴
- **테스트** — 테스트 파일 존재 여부, 커버리지, e2e
- **lint/format** — eslint.config.mjs 규칙 적정성, 위반 개수
- **CLAUDE.md / docs/** — 문서 vs 실제 코드 정합성
- **dev-only 코드** — `src/components/dev/` 프로덕션 누출
- **`logStageTransition` 등 정의됐으나 호출 없는 핵심 함수** 식별

## 기준(spec)
- TypeScript strict mode 모범
- ESLint 권장 규칙
- React/Next.js 패턴 가이드

## 현재 구현 상태
_TBD by code-quality-reviewer — 모든 주장은 file:line 인용_

## 정합성 판정
| 항목 | 판정 | 증거 | 비고 |
|---|---|---|---|
| _TBD_ | | | |

## 리스크 (P0/P1/P2)
_TBD_

## 권장 조치
_TBD_
