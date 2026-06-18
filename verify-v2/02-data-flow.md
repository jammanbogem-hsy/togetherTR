# 02. 데이터 흐름 검증 (flow-integrator)

> 소유자: `flow-integrator` | 작성일: 2026-05-14 | 상태: 작업 전

## 검증 범위
- Zustand store ↔ Firestore 동기화 경로
- SSE 스트리밍 (OpenAI / Anthropic) 파서·에러·중단·재시도
- AI 신호 체계 (STAGE_MOVE, STANDARD_SEARCH, TEAM_DISCUSSION_READY, HELP_CARD 등)
- 활동 상태 머신 (E→T 순환 포함)
- 메시지 저장 흐름 (Firestore undefined, 권한 등)

## 기준(spec)
- `06.절차 프롬프트(md).md`, `07.절차프롬프트_v2(초등팀기반).md`
- 직전 검증 `verify/02-data-flow.md` P0 2건

## 현재 구현 상태
_TBD by flow-integrator — 모든 주장은 file:line 인용_

## 정합성 판정
| 항목 | 판정 | 증거 | 비고 |
|---|---|---|---|
| _TBD_ | | | |

## 리스크 (P0/P1/P2)
_TBD_

## 권장 조치
_TBD_
