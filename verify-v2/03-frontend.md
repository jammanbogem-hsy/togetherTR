# 03. 프론트엔드 검증 (ux-frontend-reviewer)

> 소유자: `ux-frontend-reviewer` | 작성일: 2026-05-14 | 상태: 완료
> 검증 대상: `/Users/hongseong-yong/tcid-agent` (Next.js 16, App Router, React 19)
> 검증 방식: 코드 기반 정적 분석 (dev 서버 미기동)
> 기준: `/Users/hongseong-yong/협력적수업설계/08.UI_StageFlow컴포넌트설계.md`,
>       베이스라인 `/Users/hongseong-yong/협력적수업설계/verify/03-frontend.md` Critical 4건 재판정

---

## 0. 베이스라인 Critical 4건 재판정 요약

| # | 항목 | 베이스라인(2026-04-12) | 현재(2026-05-14) | 증거 |
|---|---|---|---|---|
| C1 | E→T 순환 화살표 시각화 | ❌ → 7-2절 P0 해결 | ✅ | `StageBar.tsx:57-180` `CycleArrow` + `StageBar.tsx:390-397` 조건부 렌더 |
| C2 | Ds 노드 가드레일 뱃지 | ❌ → 7-2절 P0 해결 | ✅ | `StageBar.tsx:23-55` `GuardrailBadge` + `StageBar.tsx:382` `showGuardrail` |
| C3 | 단계 이동 모달 "사유 입력 필수" | ❌ (라벨 "선택", 검증 없음) | ✅ | `StageMoveModal.tsx:253` 라벨 `(필수)`, `StageMoveModal.tsx:74-78` `trim` 빈값 차단, `StageMoveModal.tsx:367` 버튼 disabled |
| C4 | E→T 순환 모달 자동 트리거 | ❌ → 7-2절 P0 해결 | ✅ | `page.tsx:480-499` useEffect로 E단계 전 활동 완료 시 자동 `setPendingStageMove('T')` + sessionStorage dismiss |

베이스라인의 P0 4건은 모두 해소되었다. 다만 베이스라인이 P1로 미뤘던 항목(SSE 사용자 중단, 네트워크 끊김, 접근성, 반응형) 중 **SSE 사용자 중단·네트워크 끊김·반응형은 여전히 미구현**이고, 접근성은 ActionCard/FontScale/ActivitySidebar 부분에선 보강되었으나 ChatPanel·StageMoveModal에선 여전히 부족하다. 또한 베이스라인 P0 해결 이후 추가된 레이아웃 토글 기능(`useLayoutToggle`, `PanelToggle`)에서 신규 접근성·시맨틱 이슈가 발견되었다.

---

## 1. Critical 4건 재판정 — 세부 증거

### C1 — E→T 순환 화살표 시각화 ✅

- `StageBar.tsx:57-180` `CycleArrow` 컴포넌트:
  - `useLayoutEffect`로 E·T 노드의 `getBoundingClientRect()`로 좌표 측정(`StageBar.tsx:77-117`)
  - SVG quadratic Bezier (`M from Q cp, to`) — `archHeight=38`로 노드 위 호선(`StageBar.tsx:96-100`)
  - 색상 `#34A853` (초록), `strokeWidth 2.5`, `strokeDasharray "8 6"`, `cycle-dash-flow 1.6s linear infinite` 애니메이션(`StageBar.tsx:151-160`)
  - T측 단방향 화살촉 `<marker id="cycle-arrowhead">`(`StageBar.tsx:129-141`)
  - 가독성 보강용 배경 그림자 path `rgba(52,168,83,0.15)` strokeWidth 6 (`StageBar.tsx:142-149`)
  - 곡선 정점에 클릭 가능 라벨 `↻ 새로운 주기 시작` (`StageBar.tsx:163-172`) — 클릭 시 `setPendingStageMove('T')` (호스트만)
- 표시 조건(`StageBar.tsx:355-356`): `canOpenCycleMove = currentStage !== 'T'` AND (`eAllDone || project.isECompleted === true`)
- `window.resize` 리스너 + 50ms timeout 재측정으로 폰트/이미지 로드 후 위치 보정(`StageBar.tsx:111-115`)

판정 근거: spec 8장 2.4의 "곡선 화살표 + 초록 굵기 + '새로운 주기' 라벨 + 점선 흐름" 4요소 모두 충족.

### C2 — Ds 노드 가드레일 뱃지 ✅

- `StageBar.tsx:23-55` `GuardrailBadge` 컴포넌트:
  - 위치 `absolute -top-1.5 -right-1.5`(`StageBar.tsx:26`)
  - 보라색 `#7B1FA2` 원형 칩 + 흰 ring + `Shield size={11} weight="fill"`(`StageBar.tsx:28-32`)
  - `guardrail-pulse 2.4s` ripple shadow 애니메이션(`StageBar.tsx:48-51`)
  - hover 시 폭 64에 `bg-[#202124]` 다크 툴팁 — A-2-3 학습자 프로필 요약 `line-clamp-6`(`StageBar.tsx:34-46`)
- 표시 조건(`StageBar.tsx:347-350`, `382`): `a23Artifact && summarizeA23(content) !== null` AND `stage.code === 'Ds'`
- `summarizeA23`(`StageBar.tsx:286-306`)이 비어있지 않은 필드만 골라 `· key: value` 4줄로 요약(빈 산출물·null·빈 배열은 자동 제외)

판정 근거: spec 4.1·5의 "Ds 노드 가드레일 뱃지 + 학습자 프로필 요약 툴팁"이 모두 충족.

### C3 — 단계 이동 모달 사유 필수화 ✅

- `StageMoveModal.tsx:253` 라벨: `이동 이유 <span className="text-[#D93025] font-semibold">(필수)</span>` — 빨강 강조로 베이스라인 ❌(선택)에서 변경됨.
- `StageMoveModal.tsx:73-78` `handleConfirm` 첫 분기에서 `reason.trim()` 빈값 시 `reasonError` 세팅 후 early return.
- `StageMoveModal.tsx:269-280` inline 에러 표시 (`aria-invalid={!!reasonError}` 포함, 빨강 ring).
- `StageMoveModal.tsx:367` submit 버튼 `disabled={submitting || reason.trim() === ''}` — UI 차원에서도 이중 차단.
- spec 3.1 "사유 입력 필수" 충족. 이동 방향(전진/회귀/순환) 모두에서 동일 강제 — `StageMoveModal.tsx:73-78` 분기 무관 일괄 검증.

### C4 — E→T 순환 모달 자동 트리거 ✅

- `page.tsx:480-499` useEffect:
  - 의존성: `project?.currentStage`, `project?.activityStatuses`, `project?.artifacts`, `projectId`
  - 가드: `project.currentStage === 'E'` AND `!pendingStageMove`(중복 방지) AND `!sessionStorage[dismissKey]`
  - 트리거 조건(`page.tsx:488-493`): E 단계 모든 활동 status가 `completed`/`warning` AND artifact 존재
  - 동작: `sessionStorage.setItem(dismissKey, '1')` 후 `setPendingStageMove('T')` — 한 세션 내 1회만
  - 모달은 기존 `StageMoveModal`(cycle 분기, `StageMoveModal.tsx:68`)을 재사용
- spec 3.3 "E-2-1 완료 후 자동 '새 주기 시작' CTA" 충족.
- 한계: dismissal 키가 `projectId` 단위라 활동 1개만 추가로 완료해도 재발동되지 않음 — 의도된 per-user-per-session 정책(베이스라인 7-2 C4 결정 근거 그대로).

---

## 2. 신규 정합성 판정 (베이스라인 이후 추가 영역)

### 2-1 레이아웃 토글 시스템 (`useLayoutToggle`, `PanelToggle`)

| 항목 | 판정 | 증거 |
|---|---|---|
| 토글 상태 영속화 | ✅ | `useLayoutToggle.ts` projectId별 `layoutPanels:{projectId}` localStorage. SSR hydration mismatch 대비 useEffect 후 동기화 |
| 접힌 상태 정체성 힌트 | ✅ | sidebar 접힘 strip(`page.tsx:719-792`) 단계 dot + currentActivity 코드/라벨 세로쓰기 + 미니 진행률 + `role="progressbar" aria-valuenow/min/max/label`. stage 접힘 strip(`page.tsx:848-953`) 5단계 chip 브레드크럼 + 현재 단계 라벨 + 활동코드 + 팀원 아바타. artifact 접힘은 `CollapsedArtifactStrip` 컴포넌트 위임 |
| 토글 버튼 클릭 영역 중복 | ✅ | `Task #38` (베이스라인 14절)에서 중첩 `<button>` 버그 수정 완료 — 현재 접힘 strip은 외부 `<button>` 1개 + 내부 `<span aria-hidden>` 캐럿 구조 (`page.tsx:740, 949`) |
| 펼쳐진 상태 토글 버튼 | ✅ | `PanelToggle.tsx:35` `aria-label` 필수 prop. `direction` 4종(left/right/up/down) 지원 |
| 키보드 단축키 | ❌ | 의도적 미구현(브라우저/OS 충돌 회피, 베이스라인 12-4 결정). 모달이나 일반 텍스트 입력 중에는 토글 불가. screen reader 사용자에겐 진입 비용 큼 |
| 3패널 모두 접힘 시 | ⚠️ | 채팅 거의 풀스크린 가능, 각 strip은 32-40px(`page.tsx:657, 800, 976`). 다만 접힌 strip 폭이 균일하지 않음 — sidebar `w-10`, artifact `w-10`, stage `h-10`. 너비 일관성은 OK. ChatPanel 입력창의 좌우 패딩과 충돌하는지 dev 서버에서 확인 필요 |

### 2-2 ChatPanel 핵심 UX

| 항목 | 판정 | 증거 |
|---|---|---|
| SSE 토큰 스트리밍 | ✅ | `StreamingBubble`(`ChatPanel.tsx:3980`), `streamFromAPI`(`ChatPanel.tsx:1636-1729`) |
| SSE 60초 무응답 자동 abort | ✅ | `ChatPanel.tsx:1641-1648` `INACTIVITY_MS=60_000`, 청크마다 `armTimer` 리셋 |
| SSE 시작 안 됨 안내 | ✅ | `ChatPanel.tsx:1718-1724` "AI 응답이 시작되지 않아 연결을 종료했습니다. 재시도 버튼을 눌러주세요." |
| **SSE 사용자 중단(Abort) 버튼** | ❌ | 베이스라인과 동일. `StopCircle` import는 `ChatPanel.tsx:34`에 있으나 본문 미사용(**dead import**). 전송 버튼(`ChatPanel.tsx:4231-4254`)은 isLoading 시 spinner만 표시하고 `disabled` 처리 — abort 토글 부재 |
| 끊긴 응답 재시도 버튼 | ✅ | `ChatPanel.tsx:2908-2922` 마지막이 user 메시지 + `!isLoading`일 때만 노출 |
| 에러 배너 | ✅ | `ChatPanel.tsx:4091-4099` `chatError` 배너 |
| 메시지 저장 실패 안내 | ✅ | `ChatPanel.tsx:2716` "메시지 저장에 실패했습니다. 내용은 화면에 표시되지만…" |
| **메시지 컨테이너 `aria-live`** | ❌ | `ChatPanel.tsx:3166` `<div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative">`에 `role="log"`·`aria-live="polite"` 없음 → 스크린리더가 새 메시지·스트리밍 토큰 인지 못함 |
| **`navigator.onLine` / offline 이벤트** | ❌ | 전 코드베이스 검색 0 결과. 오프라인 시 메시지 전송 시도하면 fetch 실패 → 일반 에러 배너로만 안내 |
| 슬래시 커맨드 키보드 지원 | ✅ | `ChatPanel.tsx:2820-2837` ArrowUp/Down + Enter + Escape 처리 |
| 빈 상태 (활동 첫 진입) | ✅ | `ChatPanel.tsx:3167-3171` messages 비어있고 not loaded면 spinner. `isIdle` 시 가이드 UI(`ChatPanel.tsx:3957`) |

### 2-3 StageBar (베이스라인 #11 이후 수직 정렬·반응형 작업 검증)

| 항목 | 판정 | 증거 |
|---|---|---|
| 모든 노드 수평선 정렬 (NODE_SLOT) | ✅ | `StageBar.tsx:203` `NODE_SLOT='h-14 flex items-center justify-center'` 전 단계 노드 통일. 활성 단계 sub-label "0/5"가 추가돼도 노드 y좌표 불변 |
| `items-start` 부모 정렬 | ✅ | `StageBar.tsx:362, 373` |
| Connector chevron 시각 | ✅ | `StageBar.tsx:272-282` `text-[20px] font-black`, 3개 `›` 시퀀스 + chevron-flow 애니메이션 |
| 노드 클릭 → `setPendingStageMove` | ✅ | `StageBar.tsx:381` `if (isHost && stage.code !== currentStage)` 가드 — 호스트만, 현재 단계 클릭은 무시 |
| StageBar `<nav>` 시맨틱 | ❌ | spec 5장 `<nav className="stage-bar">` 명시. 현재는 `<div ref={containerRef} className="relative flex …">`(`StageBar.tsx:362`) — 시맨틱 부재. `aria-label` 없음 |

### 2-4 StageMoveModal (C3 외 추가 검증)

| 항목 | 판정 | 증거 |
|---|---|---|
| 미완료 활동 경고 리스트 | ✅ | `StageMoveModal.tsx:225-238` `getIncompleteActivities()` 결과 ul 렌더 |
| 사이클 안내 카피 | ✅ | `StageMoveModal.tsx:241-248` "주기 N+1를 시작합니다" |
| 단계 분석 모달 진입 | ✅ | `StageMoveModal.tsx:292-352` 다음 단계 이동 시만 표시되는 "분석 보기" CTA. `setAnalysisOpen` Firestore 동기화로 팀원 모달도 동시 노출(`page.tsx:1124-1129`) |
| 제출 실패 인라인 에러 | ✅ | `StageMoveModal.tsx:284-289` `submitError` 표시 + 모달 닫히지 않음 |
| 30초 timeout 안내 | ✅ | `StageMoveModal.tsx:156-158` HMR 재컴파일 가이드 포함 |
| **ESC 키 닫기** | ❌ | `StageMoveModal.tsx` 어디에도 `keydown` 리스너 없음. X 버튼만 존재 |
| **`role="dialog"` / `aria-modal`** | ❌ | `StageMoveModal.tsx:194` 외부 `<div className="fixed inset-0 z-40 …">` — 시맨틱 마킹 부재. 스크린리더가 모달 진입을 인지 못함 |
| **focus trap** | ❌ | 모달 열림 시 첫 포커스 이동 없음. Tab으로 모달 밖 ChatPanel·StageBar로 빠져나갈 수 있음 |

### 2-5 ArtifactPanel · 기타 컴포넌트 (요약 검토)

| 항목 | 판정 | 증거 |
|---|---|---|
| RequiredSectionsChecklist (E 활동) | ✅ | 베이스라인 8-2절에서 도입. `ACTIVITY_META.requiredSections` 단일 출처 |
| PrevCycleImprovementsCard (T-1-1) | ✅ | `page.tsx:957-962` cycle별 dismiss 키 |
| FontScaleControl 접근성 | ✅ | `FontScaleControl.tsx:54-86` `role="group"` + 3 버튼 모두 `aria-label`. 잘 만들어진 컴포넌트 |
| ActivitySidebar 접근성 | ✅ | `ActivitySidebar.tsx:247, 264, 294-300, 314, 481` 각 활동 행 `aria-label` 동적 생성, 장식 아이콘 `aria-hidden`, 상태 아이콘 `aria-label` |
| ActionCard 접근성 | ✅ | `ActionCard.tsx:84, 109` `role="group"`, primary/secondary/skip 각 버튼 `aria-disabled`+`aria-label`. 베이스라인 9-5 설계 그대로 구현 |
| **artifact/chat 모달 ESC** | ❌ | `CurriculumSheetModal`, `KeyNotesModal`, `StandardsFinderModal`, `IntegratedGoalWorkspaceModal`, `TeamVisionWorkspaceModal` 모두 `keydown` 검색 0건 |

### 2-6 반응형

| 항목 | 판정 | 증거 |
|---|---|---|
| 메인 3패널 sm/md/lg 분기 | ❌ | `page.tsx` 메인 라우트에 `sm:`·`md:`·`lg:` 검색 0건(검색은 ActionCard 등 일부 컴포넌트에 5건만 잡힘 — 메인 레이아웃은 0건) |
| 대기실 반응형 | ✅ | `page.tsx:111` `grid-cols-1 lg:grid-cols-2` |
| 좌측 사이드바 폭 | ⚠️ | 펼침 시 사실상 고정 폭(`ActivitySidebar.tsx` 내부 `w-80` 등). 토글로 `w-10`까지 줄일 수만 있음 |
| 우측 산출물 폭 | ⚠️ | `page.tsx:976` `layout.artifact ? 'w-80' : 'w-10'` — 토글 두 상태만. 중간 폭(예: 360px)으로 드래그 리사이즈 미지원 |
| 모바일(<768px) | ❌ | 사이드바 펼침(`w-80`) + 산출물 펼침(`w-80`) = 640px 이미 잠식. 380px iPhone에선 모두 접어도 충분치 않을 수 있으나, 접힘 strip이 32-40px라 채팅 영역 자체는 확보 가능 — 다만 ChatPanel 내부 입력창·메시지 폰트가 모바일 미최적화. 슬래시 커맨드 팝업·StageMoveModal `max-w-md`는 모바일 호환 |

### 2-7 키보드·시맨틱·접근성 (집계)

| 영역 | 판정 | 증거 |
|---|---|---|
| 시맨틱 태그(`<main>`/`<aside>`/`<nav>`) | ❌ | 메인 3패널·StageBar·ActivitySidebar 모두 `<div>`. `<header>` 1건만 WaitingRoom(`page.tsx:101`) |
| `aria-*` 사용 빈도 | ⚠️ | page.tsx 15회, ActivitySidebar 8회, ArtifactPanel 8회, ChatPanel 2회, StageBar 0회, StageMoveModal 0회. 분포 매우 편차 큼 |
| 키보드만으로 단계 이동 가능 | ⚠️ | 노드 클릭은 `<button>`이라 Tab+Enter 가능. 하지만 StageMoveModal에 focus trap 없음 — 모달 열림 시 첫 포커스 자동 이동도 없음 |
| 색상 대비 (`text-[#9AA0A6]` 등 회색) | ⚠️ | StageBar 미진행 노드 `opacity-60` + 회색 텍스트, FontScaleControl 회색 등 — WCAG AA(4.5:1) 자동 검증 미수행. dev 서버 + Lighthouse 권장 |

---

## 3. 리스크 (P0/P1/P2)

### P0 — 즉시 조치 (현장 적용 직접 영향)

| # | 리스크 | 위치 | 근거·결과 |
|---|---|---|---|
| **P0-1** | **StageMoveModal ESC 키·focus trap·`role="dialog"` 전무** | `StageMoveModal.tsx:188-385` | 모달 열린 후 ESC로 닫기 불가, Tab 키가 모달 밖 ChatPanel로 빠짐. 스크린리더 사용자는 모달 진입조차 인지 못함. 베이스라인 M3에서 지적된 항목이 미해결로 잔류 |
| **P0-2** | **ChatPanel 사용자 중단(Abort) 버튼 부재** | `ChatPanel.tsx:1644, 4231-4254` | `AbortController`는 60초 inactivity용으로만 쓰임, 외부 노출 없음. 사용자가 잘못된 응답이 진행 중일 때 강제 정지 불가 — 토큰·시간 낭비. 베이스라인 H3 미해결. `StopCircle` import는 dead import 상태 |

### P1 — 사용성·접근성 보완

| # | 리스크 | 위치 | 권장 조치 |
|---|---|---|---|
| **P1-1** | ChatPanel 메시지 스트림 `aria-live` 없음 | `ChatPanel.tsx:3166` | `role="log" aria-live="polite" aria-atomic="false"` 부착. 스트리밍 토큰은 너무 빈번하므로 `StreamingBubble` 컨테이너에는 `aria-busy` 토글 |
| **P1-2** | `navigator.onLine` / online/offline 이벤트 미사용 | 전역 | `page.tsx` 또는 `layout.tsx`에 전역 hook 도입, 오프라인 시 상단 sticky 배너. SSE 안정화 약점 ③ 대응 |
| **P1-3** | 메인 레이아웃 시맨틱 태그 부재 | `page.tsx:652-1131` | `<div className="flex h-screen">` → `<main>` 도입, 좌·우 컬럼 `<aside aria-label="…">`. StageBar는 `<nav aria-label="설계 단계">` 권장 |
| **P1-4** | 모바일(<768px) 메인 화면 미대응 | `page.tsx` 메인 분기 | 토글로 일부 완화됐으나 ChatPanel 내부 메시지 폰트·입력창 패딩이 모바일 가독성 미보장. `sm:` breakpoint 추가 또는 모바일 전용 stack 레이아웃 |
| **P1-5** | 모달군 ESC·`role="dialog"` 일괄 누락 | `KeyNotesModal`, `StandardsFinderModal`, `CurriculumSheetModal`, `IntegratedGoalWorkspaceModal`, `TeamVisionWorkspaceModal`, `StageReportsModal`, `PublishModal` | 공통 `useEscapeKey(onClose)` + `useFocusTrap(ref)` 훅 1개로 일괄 적용. P0-1과 함께 정리 권장 |
| **P1-6** | StageBar `<nav>` 미사용 + `aria-current` 없음 | `StageBar.tsx:308-400` | 부모를 `<nav aria-label="설계 단계">`로, 현재 단계 버튼에 `aria-current="step"` 부착. 호스트가 아닌 팀원의 클릭 무시 시 `disabled` + `aria-disabled` 안내 |
| **P1-7** | StageMoveModal "이동 사유 (필수)" — 빈값 외 추가 검증 없음 | `StageMoveModal.tsx:73-78` | 베이스라인 권장 "5자 이상" 미적용. 사용자가 ` ` 한 글자만 입력해도 진행됨. spec(`07.절차프롬프트_v2`) 의도가 "의미 있는 사유 기록"이라면 최소 길이 추가 검토 |
| **P1-8** | StageBar `<style jsx>` 중첩 keyframes 격리 | `StageBar.tsx:47-52, 173-178` | `cycle-dash-flow`/`guardrail-pulse` keyframes가 컴포넌트 내부 `<style jsx>`에 정의 — `globals.css`에 통합하면 컴포넌트당 키프레임 중복 정의 회피 가능(현 구조에서도 동작은 함, 코드 품질 영역) |

### P2 — Nice-to-have

| # | 리스크 | 위치 | 권장 조치 |
|---|---|---|---|
| P2-1 | `StopCircle` dead import | `ChatPanel.tsx:34` | P0-2 함께 abort 버튼 도입 시 활용 또는 import 제거 |
| P2-2 | 키보드 단축키로 패널 토글 불가 | `useLayoutToggle.ts` | `Alt+1/2/3` 등 명시 토글 단축키, 단 textarea 포커스 중에는 비활성 |
| P2-3 | 패널 폭 드래그 리사이즈 미지원 | `page.tsx:655, 974` | VSCode 식 split bar — `react-resizable-panels` 등 도입. 토글 두 상태(펼침/접힘)로는 사용자 화면비 다양성 한계 |
| P2-4 | 색상 대비 WCAG AA 자동 검증 부재 | StageBar 미진행 노드, FontScaleControl 회색 라벨 | Lighthouse / axe-core CI 도입 |

---

## 4. 권장 조치 (요약 액션)

### 4-1 P0 즉시 (이번 스프린트)

1. **공통 모달 훅 도입** (`/Users/hongseong-yong/tcid-agent/src/lib/hooks/useEscapeKey.ts`, `useFocusTrap.ts`):
   - `useEscapeKey(onClose)`: `useEffect`로 `document.addEventListener('keydown', e => e.key==='Escape' && onClose())` 추가/제거
   - `useFocusTrap(modalRef)`: 모달 열림 시 첫 focusable 요소로 자동 포커스 + Tab/Shift+Tab 트랩
   - 적용 첫 대상: `StageMoveModal.tsx`(라벨 변경 없이 훅 호출 + 외부 div에 `role="dialog" aria-modal="true" aria-labelledby={titleId}`)
2. **ChatPanel 사용자 Abort**:
   - `streamFromAPI`의 `controller`를 `useRef<AbortController>`로 외부 노출 → `streamAbortRef.current = controller`
   - 전송 버튼(`ChatPanel.tsx:4231`)을 `isLoading` 분기 시 클릭 가능한 "중단" 토글로 변경: `<StopCircle size={20} weight="fill" />` 사용, `onClick={() => streamAbortRef.current?.abort()}`
   - catch 블록에서 `signal.aborted` 분기에 사용자 abort 메시지 분리 (`'사용자가 중단했습니다.'`)

### 4-2 P1 (다음 스프린트)

- 메시지 스트림 `role="log" aria-live="polite"` 추가 + 시맨틱 태그(`<main>`/`<aside>`/`<nav>`) 도입
- `useOnlineStatus` 훅 + 상단 sticky offline 배너
- StageBar `<nav>` + `aria-current="step"` + 호스트 가드 `aria-disabled`
- 모달 일괄 ESC/`role="dialog"` 적용 (`StageReportsModal`, `KeyNotesModal` 등 7건)
- 모바일 breakpoint — 최소 `sm:` 이상에서 `<768px`일 때 자동으로 사이드바·산출물 strip 강제(`layout.toggle('sidebar'=false)`) 또는 bottom-sheet 전환

### 4-3 P2 (백로그)

- 패널 드래그 리사이즈 (`react-resizable-panels`)
- 키보드 단축키(`Alt+1/2/3`)
- Lighthouse/axe-core CI 통합

---

## 5. 종합 판정

| 영역 | 충족 | 부분 | 누락 |
|---|---|---|---|
| 베이스라인 Critical 4 (C1-C4) | 4 | 0 | 0 |
| ChatPanel SSE UX | 5 | 0 | 2 (사용자 Abort, offline 이벤트) |
| 레이아웃 토글 (신규) | 4 | 1 | 1 (키보드 단축키) |
| StageBar 정렬·반응형 | 4 | 0 | 1 (`<nav>` 시맨틱) |
| StageMoveModal | 5 | 0 | 3 (ESC, role=dialog, focus trap) |
| 모달군 (artifact/chat) | 1 | 0 | 7 (ESC/role 일괄 미적용) |
| 컴포넌트별 접근성 (ActionCard/FontScale/ActivitySidebar) | 3 | 0 | 0 |
| 시맨틱 태그 / `aria-live` | 0 | 1 | 2 |
| 모바일 반응형 | 1 | 2 | 1 (메인 화면) |
| **합계** | **27** | **4** | **17** |

**핵심 결론**

- 베이스라인 P0(C1-C4)는 모두 해결되어 "T-CID 시그니처가 UI에서 사라진다" 위험은 제거됨.
- 그러나 베이스라인이 P1로 분류했던 항목 중 **모달 ESC·focus trap**과 **사용자 Abort**는 여전히 미해결로 잔류 — 둘 다 WCAG 2.1 AA의 키보드 접근성 최저 요건이거나, 사용자가 자기 행동을 통제할 수 있어야 한다는 기본 UX 원칙에 직결되므로 **본 검증에서는 P0로 재분류**.
- 베이스라인 이후 추가된 레이아웃 토글 시스템은 **잘 만들어진 추가 가치**(접힘 strip 정체성 힌트, projectId별 영속화, 중첩 button 버그 수정 등)지만, 시맨틱 태그·키보드 단축키는 후속 작업.
- ActionCard·FontScaleControl·ActivitySidebar는 베이스라인 이후 접근성 보강이 확실히 이루어졌음(`aria-disabled`, `aria-label` 동적 생성, `role="group"`/`role="progressbar"` 등).
- 가장 큰 시스템적 부채: **시맨틱 HTML과 모달 키보드 접근성 일관성**. `useEscapeKey`/`useFocusTrap` 공통 훅 1쌍 만들면 모달 7-8개를 한꺼번에 끌어올릴 수 있다.
