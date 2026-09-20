# LLM 모델 설정 (2026-09-20 하이브리드)

모든 OpenAI 호출은 `src/lib/llm/openai.ts` 를 거친다. 모델은 `.env.local` 로 정한다(배포 시 함수 번들에 복사됨).

| env | 역할 | 기본값(미설정) | 현재 값 |
|---|---|---|---|
| `OPENAI_CHAT_MODEL` | 퍼실리테이션 대화 `/api/chat/stream` | gpt-4o | gpt-5-mini → (2단계 게이트 통과 후) gpt-5.6-luna |
| `OPENAI_CHAT_EFFORT` | 대화 reasoning 강제 (미설정: gpt-5-mini=minimal, gpt-5.6=low) | — | — |
| `OPENAI_UTILITY_MODEL` | 분석·종합·설명·융합·문제상황 대화 (예전 gpt-4o 라우트) | gpt-4o | gpt-5.6-luna (1단계) |
| `OPENAI_DEMO_MODEL` | 데모 엔진 | chat 과 동일 | — |
| `JEV_JUDGE` | `off` 면 모든 Jev 판정 비활성(폴백 경로) | — | — |
| `CURRICULUM_JUDGE` | `embedding` 이면 자동 채우기만 임베딩 경로 | — | — |

주의: gpt-5.6 계열은 `reasoning_effort: 'minimal'` 을 400 으로 거부한다(none/low/medium/high/xhigh/max). 헬퍼가 계열별로 매핑하므로 라우트에서 직접 값을 쓰지 말 것.

사용량은 서버 로그 `[llm-usage]` 한 줄 JSON(in/cached/out/reasoning/ms)으로 남는다 — Cloud Logging 에서 필터해 캐시 적중률을 본다.
