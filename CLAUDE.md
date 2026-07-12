# T-CID Agent — Claude Code 가이드

## 프로젝트 개요
협력적 수업설계 AI 에이전트 시스템. 초등 교사팀이 T-CID 모형(T→A→Ds→DI→E) 5단계를 협업하여 수업을 설계하도록 AI가 퍼실리테이션.

**스택**: Next.js 15 App Router · TypeScript · Firebase Firestore (실시간 동기화) · Zustand · Tailwind CSS · Claude API (SSE 스트리밍)

---

## 핵심 아키텍처

### 메시지 흐름
```
User Input → ChatPanel → /api/chat (Claude SSE) → onDone callback
  → parseActivityAdvance / parseActivityReturn / parseArtifactUpdates
  → Firestore 업데이트 → onSnapshot → Zustand store → UI 반영
```

### 활동별 채팅 저장 경로
- **신규 경로**: `projects/{id}/conversations/{activityCode}/messages`
- **레거시 경로**: `projects/{id}/conversations/{stageCode}/messages` (구버전 복구용)
- `watchMessages`는 두 경로를 모두 구독 후 클라이언트에서 병합 (Firebase 복합 인덱스 불필요)

### 활동 진행 신호 (AI → 파싱 → Firestore)
- `[ACTIVITY_ADVANCE: T-1-2]` → `advanceActivity()` → 현재 `completed`, 건너뛴 `warning`
- `[ACTIVITY_RETURN: T-1-1]` → `returnToActivity()` → 대상 `active_return`
- `[ARTIFACT_UPDATE: 섹션=내용]` → ArtifactPanel 실시간 반영
- `[TEAM_DISCUSSION_READY: 주제]` → TeamDiscussionBanner 표시

### 호스트 전용 권한
- 환영 메시지 Firestore 저장 (`amHost` 체크)
- 팀 자유 토론 종료 버튼
- 산출물 확정 버튼

---

## 주요 파일

| 파일 | 역할 |
|------|------|
| `src/lib/prompts/system.ts` | BASE_SYSTEM_PROMPT + 활동별 절차(ACTIVITY_PROCEDURE) + 환영 메시지(ACTIVITY_WELCOME) |
| `src/components/chat/ChatPanel.tsx` | 채팅 UI, SSE 스트리밍, 신호 파싱, 메시지 저장 |
| `src/lib/firebase/projects.ts` | Firestore CRUD, watchMessages (레거시 병합), advanceActivity, returnToActivity |
| `src/store/project.ts` | Zustand 전역 상태 (currentActivity, activityStatus, messages, currentArtifact 등) |
| `src/components/activity/ActivitySidebar.tsx` | 활동 진행 상황 사이드바 (completed/warning/active_return 상태 표시) |
| `src/app/(app)/projects/[id]/page.tsx` | 프로젝트 메인 페이지, Firestore onSnapshot, 상태 동기화 |

---

## 알려진 패턴 및 주의사항

### introSentRef — HMR 안전 구조
```typescript
// Set은 HMR 직렬화에서 prototype 소실 → plain object 사용
const introSentRef = useRef<Partial<Record<ActivityCode, true>>>({})
if (introSentRef.current[currentActivity]) return
introSentRef.current[currentActivity] = true
```

### Firestore undefined 필드 제거 (필수)
```typescript
const clean = Object.fromEntries(
  Object.entries(data).filter(([, v]) => v !== undefined)
)
await updateDoc(doc(db, 'projects', projectId), { [`artifacts.${activityCode}`]: clean })
```

### Firebase 쿼리 — 복합 인덱스 회피
```typescript
// ❌ where + orderBy 조합 → 복합 인덱스 필요
// ✅ orderBy만 사용 후 클라이언트 filter
const legacyQ = query(collection(...), orderBy('createdAt', 'asc'))
// 이후 .filter(m => m.activityCode === activityCode)
```

### currentArtifact 초기화
```typescript
// setCurrentActivity 호출 시 currentArtifact도 null로 초기화 (잘못된 산출물 표시 방지)
setCurrentActivity: (code) => set({ currentActivity: code, currentArtifact: null })
```

---

## 활동 체계 (260619 3장 피드백판 기준)

가이드 문서 원문: `docs/feedback-260619-extract.txt` · 갱신 명세: `docs/update-spec-260619.md`

### 내부 코드 ↔ 가이드 문서 번호 매핑
내부 활동 코드는 Firestore 데이터 호환을 위해 유지하되, **화면·대화 표시는 문서 번호를 사용** — `types/index.ts`의 `ACTIVITY_DISPLAY_CODE`/`displayActivityCode()`가 담당하고, 신호(`[ACTIVITY_ADVANCE: ...]`)는 내부 코드 전용(파서가 표시 번호도 방어적으로 정규화: `DISPLAY_TO_ACTIVITY_CODE`). AI 대화의 표시 변환은 BASE_SYSTEM_PROMPT "활동 번호 표기 규칙"이 강제:

| 내부 코드 | 문서 | 내부 코드 | 문서 | 내부 코드 | 문서 |
|---|---|---|---|---|---|
| T-1-1 | T-1 | A-1-1 | A-1 | Ds-1-1 | Ds-1 |
| T-1-2 | T-2 | A-1-2 | A-2 | Ds-1-2 | Ds-2 |
| T-2-1 | T-3 | A-2-1 | A-3 | Ds-1-3 | Ds-3 |
| T-2-2 | T-4 | A-2-2 | A-4 | Ds-2-1 | Ds-4 |
| T-2-3 | T-5 | A-2-3 | (앱 고유) | Ds-2-2 | Ds-5 |

DI-1-1↔DI-1, DI-2-1↔DI-2, E-1-1↔E-1, E-2-1↔E-2. **A-2-3(학습자·맥락 분석)은 문서에 없는 앱 고유 활동** — Ds 단계 가드레일(학습자 프로필) 소스로 유지.

### 협력 UP 5원리 (프롬프트 전반의 운영 기준)
`#활성화`(생각 먼저 꺼내기) · `#외현화`(눈에 보이게) · `#조정`(기준으로 묶기) · `#상호의존`(쏠림 방지) · `#인지분산`(기록을 기준으로)

### T단계 활동 절차 (system.ts 기준)

모든 T단계 절차는 `ACTIVITY_PROCEDURE['T-X-X']` 에 Step-based로 정의되어 있음.

| 활동 | 핵심 | 다음 활동 |
|------|------|----------|
| T-1-1 | 개인 키워드 3~5개 → 묶기 → AI 비전 후보 3안(키워드 반영 근거) → 명문화 | T-1-2 |
| T-1-2 | "~하려면 ~해야 한다" 형식 원칙 3~5개 + 번호 부여 + 멈춤 신호(거부권) | T-2-1 |
| T-2-1 | 과업 목록화 → 강점·희망 → 균형 배분, "누가·무엇을·언제까지" 표 | T-2-2 |
| T-2-2 | 규칙 5개 내외 + 갈등 상황 규칙 1개 필수, 실천 가능성 조율 ('위반 시 조치' 프레임 폐기) | T-2-3 |
| T-2-3 | 수업 실행일 역산 + 예비일 1~2일 + 정기 회의 고정 → A단계로 이동 | A-1-1 |

### A-1-1 건너뛰기 규칙
A-1-1(주제 선정 기준)은 재활성화됨. 학교 차원에서 주제가 이미 정해졌거나 범위가 좁혀진 팀은 건너뛸 수 있음 → A-1-1 진행 중 건너뛰기 선택 시 `[ACTIVITY_ADVANCE: A-1-2]` 방출 (advanceActivity가 현재 활동 A-1-1을 completed 처리).

---

## 개발 명령어
```bash
npm run dev     # 개발 서버 (localhost:3000)
npm run build   # 프로덕션 빌드
npm run lint    # ESLint
```
