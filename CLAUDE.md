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

## T단계 활동 절차 (system.ts 기준)

모든 T단계 절차는 `ACTIVITY_PROCEDURE['T-X-X']` 에 Step-based로 정의되어 있음.

| 활동 | 핵심 | 다음 활동 |
|------|------|----------|
| T-1-1 | 선생님 이름 명시 개인 비전 문장 → A/B/C안 | T-1-2 |
| T-1-2 | T-1-1 비전 리마인드 → 정합성 점검 필수 | T-2-1 |
| T-2-1 | 이름+발언인용 역할 매핑 테이블 + 누락 역할 경고 | T-2-2 |
| T-2-2 | 위반 시 조치 포함 규칙 + 누락 항목 경고 | T-2-3 |
| T-2-3 | 마일스톤 테이블 + 대체일 → A단계로 이동 | A-1-1 |

---

## 개발 명령어
```bash
npm run dev     # 개발 서버 (localhost:3000)
npm run build   # 프로덕션 빌드
npm run lint    # ESLint
```
