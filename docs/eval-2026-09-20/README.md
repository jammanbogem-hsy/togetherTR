# gpt-5-mini vs GPT-5.6 Luna 성능 비교 (2026-09-20)

실행: `node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs scripts/eval/luna-run.mjs <출력폴더>` → `scripts/eval/luna-judge.mjs <출력폴더>` (Fable 블라인드 심사) → `scripts/eval/luna-describe.mjs`.
실제 `buildSystemPrompt` 로 만든 채팅 프롬프트(입력 16~19k 토큰) 6개 시나리오 × 3구성.

## 채팅 퍼실리테이션 (Fable 블라인드 심사, 25점 만점 = 절차 준수·간결성·정확성·협력 촉진·신호 태그)
| 구성 | 평균 | 1위 | 절차 | 간결 | 정확 | 협력 | 신호 | 총 지연 | 출력 토큰 |
|---|---|---|---|---|---|---|---|---|---|
| gpt-5-mini (reasoning minimal, 현재) | 12.8 | 1/6 | 2.2 | 1.7 | 3.0 | 2.7 | 3.3 | 2.1~7.8 s | 148~963 |
| gpt-5.6-luna (none) | 20.7 | 2/6 | 4.2 | 4.0 | 4.3 | 3.8 | 4.3 | 1.6~3.2 s | 115~179 |
| gpt-5.6-luna (low) | **21.5** | 3/6 | 4.2 | 4.5 | 4.7 | 3.8 | 4.3 | 2.3~6.4 s | 148~579 (추론 54~130) |

객관 지표: gpt-5-mini 는 매 턴 활동 소개·표 반복(1,000~1,600자), 성취기준 코드 환각 1건([6사03-04]), 내부 활동 코드 노출 3건. Luna 는 환각 0, 내부 코드 노출 1건(low, Ds-1-1), `[TEAM_DISCUSSION_READY]`·`[HELP_CARD]` 신호를 상황에 맞게 사용.

## 수업내용 설명 작성 (gpt-4o 라우트 대체 검토, Jev Noul 범위 검증)
| 모델 | Jev 범위내 (실과/수학/도덕) | 지연 | 호출 비용 |
|---|---|---|---|
| gpt-4o (현재) | 0.87 / 0.88 / 0.84 | 2.0 s | $0.00346 |
| gpt-5-mini (minimal) | 0.89 / 0.90 / 0.86 | 2.4 s | $0.00058 |
| gpt-5.6-luna (low) | **0.92 / 0.91 / 0.90** | 2.7 s | $0.00046 |

## 부작용 (실측)
- Luna 는 `reasoning_effort: 'minimal'` 을 400 으로 거부 (지원값 none/low/medium/high/xhigh/max) — `/api/chat/stream` 은 'minimal' 하드코딩이라 env 만 바꾸면 채팅 전체 오류.
- 프롬프트 캐시는 모델별 — 전환 직후 캐시 적중 0 에서 다시 시작(비용 소폭 증가, 일시적).
- Luna(none) 은 매우 짧게 답해 안내가 빈약할 수 있음 → low 권장.
- 자료가 없으면 성취기준 추천을 거절함(정확성↑, 대신 교육과정 컨텍스트 주입/Jev 판정이 있어야 답을 냄).

## 채팅 회귀 20 시나리오 (실제 신호 파서로 검사, `scripts/eval/chat-regression.mjs`)
| 구성 | 통과 | 주요 실패 |
|---|---|---|
| gpt-5-mini (minimal) | 10/20 | 내부 활동 코드 노출 9건, A-1 건너뛰기 신호 누락, T→A 이동 시 체크리스트 생략, A안 저장 후 ARTIFACT_UPDATE 누락 1건(저장 실패) |
| gpt-5.6-luna (low) | 19/20 (남은 1건은 기대 정규식 문제로 실제 정상) | 체크리스트 표에 내부 코드 노출 1건 → 프롬프트 템플릿을 표시 번호(T-1~T-5)로 수정 |

산출물 신호 형식: 두 모델 모두 `[ARTIFACT_UPDATE: 섹션=값]` 다중 섹션(개인 비전 표·팀 공통 비전·핵심 키워드·AI 분석)을 파서가 정상 파싱. gpt-5-mini 는 대화에 없던 개인 키워드를 지어내 표에 넣었고, Luna 는 "이 대화에서 제시되지 않음"으로 남김.

## 종단 점검 (검증용 사이트, `scripts/eval/e2e-hybrid.mjs`, 2026-09-20)
| 점검 | 결과 | 소요 | 비고 |
|---|---|---|---|
| chat/stream 논의 턴 (Luna) | ✅ | 10.0s | 712자 · 내부코드 노출 0 |
| chat/stream 저장 턴 → ARTIFACT_UPDATE 파싱 | ✅ | 6.7s | 섹션 주제 선정 기준·최종 선정 주제·주제 유형·선정 근거(스키마 키와 일치) · ADVANCE 동시방출 없음 |
| autofill coreIdeas (Jev) | ✅ | 1.6s | 실과 제시 0.94 · 수학 확인 0.74 · 도덕 확인 0.77 |
| autofill rows (Jev) | ✅ | 1.5s | 행 3 · 누락 필드 0 · 코드 환각 0 |
| autofill describe (Luna → Jev 검증) | ✅ | 3.1s | 검증 0.93/0.92/0.91 |
| ontology/relate (Jev → haiku → Jev) | ✅ | 14.9s | 문제-해결 0.82(검증 0.77) · 개념-적용 0.85(0.82) |
| ontology/search (Jev 재순위) | ✅ | 1.6s | 중심 [6과16-01] (재순위 전 [6과14-04] 연소) |
| topic-selection/suggest (sonnet-5 + 검증) | ✅ | 16.6s | gradeFit 0.83 · goalFit 0.71 |
| analyze/stage (Luna SSE) | ✅ | 32.4s | 6,776자 — 60초 한도의 절반, 여유 감시 필요 |
| curriculum-sheet/fusion (Luna JSON) | ✅ | 13.5s | 아이디어 3 |
