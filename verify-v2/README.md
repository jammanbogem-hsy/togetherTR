# togethertr 전방위 풀스캔 v2 (togethertr-fullscan-v2 팀)

- 대상 구현체: `/Users/hongseong-yong/tcid-agent` (Next.js 16, React 19, Firestore, OpenAI SSE + Anthropic SDK)
- 기준 문서 루트: `/Users/hongseong-yong/협력적수업설계`
- 배포 확인: https://togethertr.web.app/
- 시작: 2026-05-14
- 직전 검증: `verify/` (2026-04-12, 5축) — 본 v2는 그 결과를 *참고용 베이스라인*으로 활용하되 모든 결과는 현재 코드 재검증 후 산출

## 파일 소유권 (절대 남의 파일 편집 금지)

| Teammate | 소유 파일 | 검증 축 | 신규/계승 |
|---|---|---|---|
| Lead | `00-summary.md` + `99-roadmap.md` | 교차 이슈 종합·우선순위·리팩토링 로드맵 | 계승 |
| `data-architect` | `01-data-structure.md` | Firestore 스키마·타입·보안규칙·인덱스 | 계승 |
| `flow-integrator` | `02-data-flow.md` | Zustand ↔ Firestore ↔ SSE ↔ UI, AI 신호 파이프라인 | 계승 |
| `ux-frontend-reviewer` | `03-frontend.md` | 컴포넌트·UX·3패널·E→T 순환·반응형·접근성 | 계승 |
| `pedagogy-auditor` | `04-pedagogy.md` | T-CID 모형·5원리·활동유형·행위주체 정합성 | 계승 |
| `knowledge-graph-analyst` | `05-knowledge-graph.md` | 성취기준 하이브리드·융합 그래프·지식 누적 | 계승 |
| `security-auditor` | `06-security.md` | Auth·Firestore Rules·시크릿·OWASP·API 키 노출·XSS·SSRF | **신규** |
| `performance-analyst` | `07-performance.md` | 번들·Firestore 쿼리·렌더·SSE·이미지·캐시·CWV | **신규** |
| `code-quality-reviewer` | `08-code-quality.md` | 패턴·중복·죽은 코드·타입 안전성·테스트·복잡도 | **신규** |

## 보고서 필수 항목

각 teammate는 자신의 md 파일에 다음을 채움:

1. **기준(spec)** — 어떤 문서/요구사항·표준을 기준으로 삼았나
2. **현재 구현 상태** — 증거는 반드시 `file:line` 형식
3. **정합성 판정** — 항목별 ✅ 충족 / ⚠️ 부분 / ❌ 누락 / 🚨 즉시 위험
4. **리스크** — 현장 적용 시 영향도 (P0/P1/P2)
5. **권장 조치** — 구체적 변경안 (가능하면 patch 수준)

모든 주장은 `파일:줄번호` 인용을 요구. 인용 없는 주장은 Lead가 반려.

## 판정 통일 규약

| 마커 | 의미 |
|---|---|
| ✅ | 설계대로 충족 |
| ⚠️ | 부분 충족 (일부 누락 또는 결함) |
| ❌ | 미구현 또는 명백한 결함 |
| 🚨 | **즉시 위험** (보안·데이터 손실·서비스 장애) — P0 자동 승격 |

**2축 이상에서 수렴한 이슈는 P0로 자동 승격** (단일 anchoring 편향 배제).

## 베이스라인 — 이전 검증(2026-04-12) 미해결 P0 후보

본 v2 팀은 아래 항목들이 현재(2026-05-14)에도 유효한지 **반드시 재검증**해야 함:

- **A. 단계 전환 기록 계층 붕괴** — `logStageTransition` 호출처, `StageMoveModal.handleConfirm`, `CycleArrow`, E→T 자동 트리거
- **B. firestore.rules `allow read, write: if true`** 한 줄 잔존 여부
- **C. 성취기준 시스템 설계-구현 괴리** — `/api/standards/search` 라우트, TF-IDF, FUSION_PATTERNS, standards_index 컬렉션
- **D. SSE error 분기 부재 / Abort 부재 / 오프라인 배너 부재**
- **E. 행위주체 5분류 LLM 미도달**

해결되었다면 ✅ + 커밋/파일:줄 증거로 명시. 미해결이면 P0 우선순위 유지.

## Lead 종합 산출물

- `00-summary.md` — 교차 이슈 종합, 2축+ 수렴 이슈, P0/P1/P2 분류
- `99-roadmap.md` — 단기(2주) / 중기(1~2개월) / 장기(분기) 리팩토링 로드맵, 의존성 그래프
