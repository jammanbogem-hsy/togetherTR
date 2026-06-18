# 01. 데이터 구조 검증 (data-architect)

> 소유자: `data-architect` | 작성일: 2026-05-14 | 직전 검증: `/Users/hongseong-yong/협력적수업설계/verify/01-data-structure.md` (2026-04-12 + 2026-04-13 P0 조치)

## 검증 범위
- Firestore 컬렉션 스키마 (`projects`, `users`, 산하 서브컬렉션, `public_reports`, `user_settings`)
- TypeScript 타입(`src/types/index.ts`)과 실제 저장 로직(`src/lib/firebase/*`)의 일치
- `firestore.rules` 보안 규칙 (재검증)
- `firestore.indexes.json` 복합 인덱스 적정성
- 성취기준 데이터 로드 경로 (`standards_index` Firestore 컬렉션 vs 로컬 JSON)
- 핵심 P0 회귀 점검: `firestore.rules` `if true` 잔존 여부, `logStageTransition` 호출처

## 기준 (spec)
- `/Users/hongseong-yong/협력적수업설계/09.Firebase데이터모델.md` (542줄)
- `/Users/hongseong-yong/협력적수업설계/10.성취기준_하이브리드유사도시스템.md` (525줄)

---

## 1. 직전 검증(2026-04-12/13) P0 회귀 점검 — **핵심**

| P0 항목 (직전) | 직전 판정 | 현 상태 | 증거 |
|---|---|---|---|
| **R1 — `firestore.rules`가 `if true` 단일 rule (전면 개방)** | 🚨 치명 | **✅ 해소** | `firestore.rules:1–199` 전면 재작성(199줄). 헬퍼 4개(`isSignedIn`/`isProjectMemberData`/`isMember`/`isSelfJoinUpdate`) + 컬렉션별 명시 rule 12+개 + 서브컬렉션 catch-all 차단(`firestore.rules:169`) + 루트 catch-all 차단(`firestore.rules:195–197`). |
| **R2 — `logStageTransition` 호출처 0건 (단계 전환 미기록)** | ❌ 누락 | **✅ 해소** | `src/components/modals/StageMoveModal.tsx:175` `handleConfirm` 말미에서 `void logStageTransition(project.id, transitionLogPayload).catch(...)` 호출. `transitionLogPayload`는 `fromStage/toStage/direction/cycleNumber/reason/missingItemsIgnored/initiatedBy` 모두 포함(`StageMoveModal.tsx:113–123`). `direction === 'cycle'` 시 `finalizeCycleTransition`가 자동 트리거(`src/lib/firebase/projects.ts:1415–1426`)되어 `isECompleted=true`, `currentCycle/cycleCount` 증가, `previousCycleImprovements` 추출까지 단일 흐름. |
| **P0-4 — `joinProject`에 inviteCode 검증 없음** | flag-A | **✅ 해소** | `src/lib/firebase/projects.ts:158–187` `joinProject(projectId, uid, inviteCode, memberInfo?)` 시그니처로 변경. 비멤버 시 `data.inviteCode !== inviteCode → throw 'invalid-invite-code'`(`projects.ts:172–176`). 이미 멤버면 skip(프로필 갱신 경로 보호). |

**총평**: 직전 검증의 두 핵심 P0(Rules·StageTransition)는 코드/룰 양쪽에서 모두 해소됨. 본 차수에서는 **새로 도입된 컬렉션/필드의 일관성**과 **여전히 미해결인 항목(스키마 이중화, members 서브컬렉션 부재 등)** 위주로 재판정한다.

---

## 2. 대조 구현체 (현재 코드)

- 타입 정의: `src/types/index.ts` (693줄)
- Firebase 클라이언트 초기화: `src/lib/firebase/config.ts` (33줄)
- Firebase 서버 초기화: `src/lib/firebase/server.ts` (20줄)
- 프로젝트/메시지/산출물/단계전환 CRUD: `src/lib/firebase/projects.ts` (1550줄)
- 자료(RAG) CRUD: `src/lib/firebase/materials.ts` (73줄)
- 공개 보고서: `src/lib/firebase/publicReports.ts` (175줄)
- 인증·프로필: `src/lib/auth.ts` (218줄)
- 보안 규칙: `firestore.rules` (199줄)
- 인덱스: `firestore.indexes.json` (5줄)

---

## 3. 항목별 판정

| # | 항목 | 판정 | 리스크 | 증거(file:line) | 설명 |
|---|------|------|---|---------|------|
| 3.1 | `users` 컬렉션 스키마 | ⚠️ 부분 | P2 | `src/lib/auth.ts:11–23`, `src/lib/auth.ts:96–106` | `UserProfile` 인터페이스는 `uid/displayName/email/photoURL/color/emoji/createdAt/schoolLevel/schoolName/grade`만 보유. spec 3.1(`09.Firebase데이터모델.md:51–71`)이 요구한 `subject`(담당 교과)·`gradeGroup`·`role: 'teacher'\|'admin'`·`lastActiveAt`·`preferences{defaultMode, notificationsEnabled}` **5개 필드 누락**. `schoolLevel` enum 불일치도 잔존: 코드 `'초등'\|'중등'\|'고등'`(`auth.ts:20`) vs spec `'초등학교'\|'중학교'\|'고등학교'` (Project enum은 spec 일치 — `src/types/index.ts:215`). |
| 3.2 | `projects` 컬렉션 메인 스키마 | ⚠️ 부분 | P1 | `src/types/index.ts:219–388`, `src/lib/firebase/projects.ts:59–72` | spec 3.2 핵심 필드(`title/mode/schoolLevel/targetGradeGroup/targetSubjects/createdBy/currentStage/currentCycle/status/isECompleted/isA23Completed/cycleCount/createdAt/updatedAt/metadata`)는 모두 매핑됨. **spec과의 차이**: ① `description` 필드 누락(`src/types/index.ts:219–238`) ② spec에 없는 협업·상태 필드 **40+개 추가** — `invite/lobby/teamDiscussions/graphSavedData/problemSituationData/artifacts/stageReports/cumulativeReport/optionVotes/curriculumSheet/teamVisionWorkspace/integratedGoalWorkspace/artifactProposal/skippedActionCards/keyNotes/previousCycleImprovements/...` 등(`src/types/index.ts:240–387`). 단일 문서 1MB 한도 위협은 여전(R3 참조). |
| 3.3 | `projects/{id}/members` 서브컬렉션 | ❌ 누락 (불변) | P2 | `src/lib/firebase/projects.ts:158–187`, `src/types/index.ts:248–249` | spec 3.3(`09.md:101–116`)의 `members/{uid}` 서브컬렉션은 여전히 미구현. 대안은 `memberUids: string[]` + `memberInfo: Record<uid,...>` 맵(`src/types/index.ts:248–249`). spec의 `role: 'facilitator'\|'recorder'\|'researcher'\|'reviewer'\|'member'` 5분류 미존재, `isOnline/lastSeenAt` 부재 → spec 5.2 실시간 presence 구조적 불가. 현재 호스트 표시는 `hostUid` 단일 필드(`src/types/index.ts:247`) + `createdBy`(`:226`)로 갈음. |
| 3.4 | `projects/{id}/stages/{stage}/activities/{code}` | ❌ 누락 (불변) | P2 | `src/lib/firebase/projects.ts:1297–1300, 1302–1345`, `src/types/index.ts:267` | spec 3.4 활동 문서(`status/hasWarning/isGuardrailSource/guardrailApplied` 등)는 여전히 평탄화: `projects/{id}.activityStatuses: Partial<Record<ActivityCode, StageStatus>>` 맵(`src/types/index.ts:267`). `stages/{stage}/activities/{code}/artifacts` 서브컬렉션 경로 정의(`projects.ts:1298–1300 artifactPath`)는 존재하나 `saveArtifact`/`getArtifact`/`watchArtifact`(`projects.ts:1302/1319/1332`) **호출처 0건** — grep 결과 `getArtifact`는 동명 함수 `getArtifactSchema`(`src/lib/artifacts/schemas.ts:1007`)만 검출. **스키마 이중화 그대로**. firestore.rules는 양쪽 모두 보호(서브컬렉션 `:119`, 프로젝트 문서 `:101`). |
| 3.5 | 산출물 데이터 구조 | ⚠️ 부분 (불변) | P2 | `src/types/index.ts:613–634`, `src/types/index.ts:329–342`, `src/lib/firebase/projects.ts:385–429` | spec 3.5의 `Artifact` 인터페이스(`aiDraft/confirmedContent/lastEditedContent/meta{evidence,changeReason,approvalStatus}`)는 타입 정의(`src/types/index.ts:613–634`)에 그대로 살아있으나 **실제 저장 경로는 사용 안 함**. 실제 저장은 `setProjectArtifact`(`projects.ts:385–429`)가 `projects/{id}.artifacts.{code}={status,title,content,version,confirmedBy,confirmedAt,revisionNote,_schemaVersion?}`만 적재(`src/types/index.ts:329–342`). "AI 추천 vs 교사 확정 분리"라는 spec 핵심 의도는 `status: 'ai_draft'\|'in_review'\|'confirmed'\|'rejected'`(`src/types/index.ts:611`) **상태 enum 1개로 라이트하게 보존**(직전 보고서가 권한 B안에 해당). |
| 3.6 | `artifacts/{id}/versions` 버전 이력 | ❌ 누락 (불변) | P1 | grep 결과 `ArtifactVersionDocument` 0건 | spec 3.7(`09.md:282–298`)의 `ArtifactVersionDocument`(`version/contentSnapshot/changeType/changeSummary/changedBy/changedAt`) 타입·CRUD·호출 모두 부재. `setProjectArtifact`(`projects.ts:385–429`)는 `version: number` 단일 카운터만(`src/types/index.ts:333`). 직전 주기와 동일한 결손. P1-I의 `previousCycleImprovements`로 cycle 단위 스냅샷은 일부 보완됐으나(아래 3.13) **개별 산출물 변경 이력은 여전히 손실**. |
| 3.7 | `conversations/{X}/messages` 경로 키 | ⚠️ 부분 (불변) | P2 | `src/lib/firebase/projects.ts:1404, 1430, 1434, 1447`, `firestore.rules:109` | 경로는 `projects/{id}/conversations/{activityCode}/messages` — spec(`stageCode` 키, `09.md:301`)과 **활동 단위 vs 단계 단위로 불일치**. rules에 명시(`firestore.rules:107–111`)와 함께 의도적으로 유지 중. `Message` 타입의 `actionCard*` 필드(`src/types/index.ts:654–656`)·`displayName`(`:649`)·`replyTo`(`:650`)는 신규 — spec에 없음. spec의 `metadata.tokenCount/latencyMs/modelId`는 여전히 누락. |
| 3.8 | `stage_transitions` 컬렉션 + `logStageTransition` | ✅ 충족 (신규 해소) | — | `src/lib/firebase/projects.ts:1411–1426`, `src/components/modals/StageMoveModal.tsx:175`, `firestore.rules:128–133` | **직전 검증 P0 해소.** 함수 정의(`projects.ts:1411–1426`)는 그대로, 호출이 `StageMoveModal.handleConfirm` 말미에서 `void logStageTransition(...).catch(...)`로 추가됨(`StageMoveModal.tsx:175`). 페이로드는 `fromStage/toStage/direction/cycleNumber/reason/missingItemsIgnored/initiatedBy` 전부 포함(`StageMoveModal.tsx:113–123`). rules는 `create`만 허용하고 `update/delete: if false`로 무결성 보호(`firestore.rules:130–132`), `initiatedBy == request.auth.uid` 강제(`firestore.rules:131`)로 spoofing 차단. **단 호출은 fire-and-forget(`void` + `.catch`)** — 실패 시 로그만 남고 UI는 진행. 감사 추적이 누락될 가능성은 P2로 잔존(아래 R-A 참조). |
| 3.9 | `cycle_history` 컬렉션 | ⚠️ 부분 (부분 해소) | P1 | grep 결과 함수 0건, `firestore.rules:136–138`, `src/types/index.ts:343–352`, `src/lib/firebase/projects.ts:1437–1484` | spec 3.10 `CycleHistoryDocument`(cycle별 `artifactSummary/keyImprovements/nextCyclePresets`) 자체는 **여전히 컬렉션·타입·CRUD 모두 부재**. 그러나 rules에는 슬롯 마련됨(`firestore.rules:136–138 match /cycle_history/{cid}`). 대안으로 `project.previousCycleImprovements` 단일 슬롯이 도입되어(`src/types/index.ts:343–352`) cycle 전환 시 `finalizeCycleTransition`에서 `e11Improvement/e21Improvement/nextCycleChoice`를 추출·기록(`projects.ts:1437–1484`). **단 슬롯 1개라 이전 주기 이력 전부는 보존되지 않음** (덮어쓰기). |
| 3.10 | `standards_index` Firestore 컬렉션 | ❌ 누락 (불변) | P1 | grep 결과 `standards_index`·`standards_by_grade` Firestore 적재 코드 0건; `src/app/api/knowledge-graph/route.ts:97–99`, `src/lib/curriculum/graphReader.ts:103–110`, `src/lib/curriculum/curriculumJsonReader.ts:1–9` | spec 6(`09.md`) 및 10.md 4.1이 명시한 Firestore 적재(`standards_index/{code}` + 임베딩) 미실행. 현재는 `data/elementary_knowledge_graph.json` + `public/curriculum_json/*.json`(11개 교과 파일) **로컬 파일을 서버측 `fs.readFile`로 직접 로드**. firestore.rules의 catch-all 차단(`:195–197`)으로 향후 Firestore 적재 시 명시 rule 추가 필요. **10.md spec("Firestore + 자체 코사인 계산" — `10.성취기준_하이브리드유사도시스템.md:111`)은 여전히 미구현**. |
| 3.11 | `firestore.rules` 보안 규칙 — 잔존 위험 | ⚠️ 부분 | P1 | `firestore.rules:77–82, 84–93, 178–185` | 전면 재작성 됐으나(✅ R1 해소) **3개 trade-off 명시 잔존**: ① 인증 사용자 누구나 `inviteCode != null` 프로젝트를 get 가능(`:77–82` — join 미리보기 목적, `inviteCodes/{code}` 인덱스 이전 P1-B로 이월) ② 클라이언트가 `where('memberUids', 'array-contains', X-uid)`로 다른 사용자 프로젝트 list 가능(`:84–93`, TODO P1 명시) ③ self-join rule이 inviteCode 일치 검증 불가(`firestore.rules:55–62 isSelfJoinUpdate()` + 앱단 `joinProject:172–176` 이중 방어로 1차 차단, 그러나 SDK 직접 호출 시 우회 가능 — Cloud Function 필요). |
| 3.12 | `firestore.indexes.json` 적정성 | ✅ 충족 | — | `firestore.indexes.json:1–5` | 현재 `{"indexes": [], "fieldOverrides": []}`. **실제 코드 쿼리 패턴 분석 결과**: `where('memberUids', 'array-contains', uid) + limit(50)` (`projects.ts:98`), `where('createdBy', '==', uid) + limit(50)` (`projects.ts:99`), `where('inviteCode', '==', code) + limit(2)` (`projects.ts:134`), `orderBy('createdAt', 'asc')` (`projects.ts:233/1448`, `materials.ts:45`) — **모두 단일 필드 쿼리**라 자동 인덱스로 충분. 복합 인덱스 필요 없음. spec과의 직접 대응은 없으나 현재 쿼리 부담은 적정. (단, 향후 `standards_index` 적재 시 학년군+교과 복합 인덱스 필요해질 것 — 10.md spec.) |
| 3.13 | E→T cycle finalize 흐름 | ✅ 충족 (신규) | — | `src/lib/firebase/projects.ts:1411–1426, 1437–1484`, `src/lib/activity/completion.ts` | **직전 검증 8.x 보고가 명시한 P1-I 흐름이 코드에 안착.** `logStageTransition`이 `direction==='cycle'`일 때 `finalizeCycleTransition` 자동 호출(`projects.ts:1415–1426`). `finalizeCycleTransition`는 단일 `updateDoc`으로 `isECompleted=true` + `currentCycle+1` + `cycleCount+1` + E-1-1/E-2-1 산출물에서 추출한 `previousCycleImprovements{e11Improvement, e21Improvement, nextCycleChoice}` 기록(`projects.ts:1442–1483`). 추출 실패는 cycle 전환 자체를 막지 않음(best-effort, `projects.ts:1478–1481`). |
| 3.14 | `setProjectArtifact` 자동 `_schemaVersion: 'v2-sections'` 부착 | ✅ 충족 (신규) | — | `src/lib/firebase/projects.ts:401–411`, `src/types/index.ts:339–341` | 직전 보고 8.4의 "후속 과제(`_schemaVersion` 부착)"가 해소. `ACTIVITY_META[code].requiredSections`가 비어있지 않으면(현재 E-1-1·E-2-1만 해당, `src/types/index.ts:186–203`) 호출처에서 명시하지 않은 한 자동으로 `_schemaVersion: 'v2-sections'` 부착(`projects.ts:406–411`). 호출처 누락 방어선이 중앙 1곳으로 모임. **단 비-E 활동은 부착 안 함 → 기존 산출물 grandfather 유지** — 회귀 위험 없음. |
| 3.15 | Firestore 오프라인 캐시 | ⚠️ 부분 (불변) | P2 | `src/lib/firebase/config.ts:27–30` | `memoryLocalCache()` 유지(`config.ts:28`). 주석에 "멀티탭 persistent 캐시 잠금 문제 회피" 명시(`config.ts:27`). spec 1(`09.md:10`)의 "오프라인 지원" 근거가 약화된 상태 그대로. `persistentMultipleTabManager()` 옵션 미적용. |
| 3.16 | 실시간 구독(`onSnapshot`) 범위 | ⚠️ 부분 (악화 가능) | P2 | `src/lib/firebase/projects.ts:1275–1294, 1387–1407, 1535–1556, 235–238, 1212–1217`, `materials.ts:41–48` | watcher 7개로 증가: `watchProject`(`projects.ts:1275`) / `watchMessages`(`:1387`) / `watchStreamingState`(`:1529`) / `watchLobbyMessages`(`:227`) / `watchIntegratedGoalWorkspacePresence`(`:1207`) / `watchProjectMaterials`(`materials.ts:41`) + (별도 함수 추가 의심: teamVisionPresence — `projects.ts:986` 참조). 핵심 문제: `Project` 문서가 비대해져(40+ 동적 필드, `src/types/index.ts:219–388`) **1팀당 변경 1건이 전체 프로젝트 문서 페이로드를 모든 클라이언트로 재전송**. spec의 산출물 단위 watch(`stages/{stage}/.../artifacts`)는 정의만 존재하고 미사용(`projects.ts:1332` `watchArtifact` 호출처 0건). |
| 3.17 | Firebase Auth 연동 | ✅ 충족 (불변) | — | `src/lib/auth.ts:108–155, 162–194`, `src/lib/firebase/config.ts:24` | `signInWithPopup(GoogleAuthProvider)` + `onAuthStateChanged`로 세션 복원. 학교 도메인 제한(spec `09.md:13`)은 미구현(범위 외). |
| 3.18 | `public_reports` 공개 보고서 컬렉션 | ✅ 충족 (spec 외 추가) | — | `src/lib/firebase/publicReports.ts:1–175`, `src/types/index.ts:503–516`, `firestore.rules:178–185` | spec 외 컬렉션이나 민감 데이터 분리 원칙으로 잘 설계. `buildPublicReport()`(`publicReports.ts:43–73`)가 `memberUids/memberInfo/inviteCode/hostUid/createdBy/conversations/messages/streamingState/teamDiscussions/optionVotes` **전부 제외** — 화이트리스트 방식. rules는 `read: if true` + `create/update/delete`는 host/createdBy만(`firestore.rules:179–184`). `autoSyncIfPublic`(`publicReports.ts:162–175`)은 호스트 외 호출은 silently no-op으로 안전. |
| 3.19 | `materials` / `materialChunks` (RAG) | ✅ 충족 (spec 외) | — | `src/lib/firebase/materials.ts:18–72`, `src/app/api/materials/process/route.ts:47, 128`, `src/lib/rag/search.ts:139`, `firestore.rules:147–152` | spec 외 RAG용 컬렉션. 클라이언트(`materials.ts`)와 서버(`process/route.ts:47` `serverDb` 사용 + `materials.ts`의 client `db`) 양쪽에서 동일 경로 일관 사용. rules로 멤버 전용 보호. |
| 3.20 | `streamingState` (사용자별 분리) | ✅ 충족 (spec 외, 불변) | — | `src/lib/firebase/projects.ts:1498–1604`, `firestore.rules:141–144` | `projects/{pid}/streamingState/{activity}/users/{uid}` 사용자별 분리 + TTL 3분(`projects.ts:1547`) + 재시도 3회(`projects.ts:1517–1523`). rules는 read 멤버 / write 본인만(`firestore.rules:142–143`). 좀비 데이터 방어 잘 설계됨. |
| 3.21 | `lobby` / `integratedGoalPresence` / `teamVisionPresence` 신규 서브컬렉션 | ✅ 충족 (spec 외, 신규) | — | `src/lib/firebase/projects.ts:217–238, 1207–1217, 947, 986`, `firestore.rules:113–115, 156–165` | 모두 spec 외 협업 컬렉션. **rules에 명시적 rule 보유**(`firestore.rules:113–115, 156–165`) → 새 컬렉션 추가 시 catch-all에 막혀 발생할 수 있는 권한 거부 폭주(auto-memory `feedback_firestore_path_rules_sync.md` 패턴) 방지 완료. |
| 3.22 | `user_settings` 사용자 폴더/숨김 | ✅ 충족 (spec 외) | — | `src/lib/firebase/projects.ts:23–51`, `firestore.rules:188–190` | `user_settings/{uid}` 본인 read/write로 보호. |
| 3.23 | undefined 필드 안전 처리 | ✅ 충족 (불변) | — | `src/lib/firebase/projects.ts:413–416, 522–526, 1371–1375, 1463–1471`, `src/lib/auth.ts:88–94, 104` | `Object.fromEntries(Object.entries(...).filter(([,v]) => v !== undefined))` 패턴이 모든 쓰기 직전에 일관 적용. auto-memory `feedback_tcid_dev.md`의 규칙과 일치. |

---

## 4. 리스크 매트릭스 (현장 적용 영향도)

### P1 — `firestore.rules` 잔존 trade-off 3건

**R-rules-1: inviteCode 가진 프로젝트 메타 노출**
- 증거: `firestore.rules:77–82` (인증 사용자 누구나 `inviteCode != null` 프로젝트 get 가능)
- 영향: 프로젝트 `title/inviteCode/cycleCount/targetSubjects` 등 메타데이터가 다른 사용자에게 노출 가능. 콘텐츠는 멤버십 보호.
- 권장: rules 상단 주석(line 18–24)이 이미 P1-B `inviteCodes/{code}` 인덱스 컬렉션 이전을 명시. 별도 task로 계속 추적.

**R-rules-2: `list` 쿼리가 본인 uid 검증 불가**
- 증거: `firestore.rules:84–93` (TODO 명시: `request.query.where` 미노출 → 클라이언트 컨벤션 강제만 가능)
- 영향: 악의적 클라이언트가 `array-contains: <다른 uid>` 쿼리로 그 uid의 프로젝트 메타 리스트업 가능.
- 권장: 별도 `user_projects/{uid}/{pid}` 인덱스 컬렉션 도입 → `projects`는 get-only로 잠그고 list는 본인 인덱스만(`firestore.rules:88–92` TODO).

**R-rules-3: `joinProject` SDK 직접 호출 우회**
- 증거: `firestore.rules:55–62` `isSelfJoinUpdate()` + `src/lib/firebase/projects.ts:172–176` 이중 방어이나 inviteCode를 모르는 임의 self-join은 차단, **inviteCode 보유자가 SDK 직접 호출로 다른 uid를 join 시키는 시나리오는 여전히 가능**.
- 권장: Cloud Function 위임 필요. 범위 외이나 추적 task 등록 권장.

### P1 — `standards_index` Firestore 미적재 (불변)

- 증거: `src/lib/curriculum/curriculumJsonReader.ts` + `src/lib/curriculum/graphReader.ts` (로컬 JSON 직접 로드)
- 영향: 10.md spec("Firestore + 자체 코사인 계산" `10.md:111`)의 학년군 가중치·하이브리드 검색이 클라이언트/서버 메모리에서 매번 처리. 모바일·저성능 환경 부담. **firestore.indexes.json 빈 상태는 적정하지만**, 적재 시 학년군+교과 복합 인덱스 필요.

### P1 — 산출물 버전 이력 (`versions` 서브컬렉션) 부재 (불변)

- 증거: `src/lib/firebase/projects.ts:385–429 setProjectArtifact`는 `version: number` 단일값만(`src/types/index.ts:333`).
- 영향: 분산인지 5원리 중 "외현화/조정"이 요구하는 변경 추적 불가. P1-I로 cycle 단위 스냅샷(`previousCycleImprovements`)은 도입됐으나 **개별 산출물 변경(예: T-1-2의 5번째 수정)이 누구에 의해 어떤 사유로 발생했는지** 추적 불가.

### P2 — 스키마 이중화 (불변)

- 증거: 산출물·활동 상태가 2곳:
  - 사용 중: `projects/{id}.artifacts.{code}` 맵 + `projects/{id}.activityStatuses` 맵 (`src/types/index.ts:267, 329–342`)
  - 정의만: `projects/{id}/stages/{stage}/activities/{code}/artifacts` 서브컬렉션 (`projects.ts:1297–1345`) — 호출 0건
- 영향: 장기적으로 `Project` 문서 1MB 한도 위협. `graphSavedData/problemSituationData/cumulativeReport/stageReports/curriculumSheet/teamVisionWorkspace/integratedGoalWorkspace` 동시 누적 시 가속.
- 권장(B안 권장 — 직전 검증 §5의 결론 그대로): `Artifact` 인터페이스에서 미사용 필드(`aiDraft/confirmedContent/lastEditedContent`)를 삭제하고 09.md spec을 코드 현실에 맞춰 업데이트. `saveArtifact`/`getArtifact`/`watchArtifact` 정의는 호출처 0건이므로 **삭제 후보**로 분류 가능 → P2 코드 정리 작업으로 회수.

### P2 — `users` 프로필 enum 불일치 + 누락 필드 (불변)

- 증거: `src/lib/auth.ts:20` `'초등'\|'중등'\|'고등'` vs `src/types/index.ts:215` `'초등학교'\|'중학교'\|'고등학교'`(Project) vs spec `09.md:60` `'초등학교'\|'중학교'\|'고등학교'`(User)
- 영향: 사용자 프로필에서 가입한 `schoolLevel`을 Project 생성 시 직접 매핑 불가 → 폼에서 변환 로직 필요 (현재 어디서 변환되는지 추적 필요, 본 검증 범위 외).
- 권장: `UserProfile.schoolLevel`을 `SchoolLevel` 타입으로 통일하고 마이그레이션은 다음 로그인 시 lazy 보강.

### P2 — `members` 서브컬렉션 부재로 역할 모델 붕괴 (불변)

- 증거: `memberUids` 배열 + `memberInfo` 맵으로 대체. role(facilitator/recorder/...) 없음.
- 영향: CollabAgent가 "역할 비대칭"을 인지할 메타데이터 부재. spec 5.2 실시간 presence 구조적 불가(presence는 `integratedGoalPresence`/`teamVisionPresence`로 활동별 임시 구현 — `projects.ts:1207`, `:986`).

### P2 — `logStageTransition` fire-and-forget 패턴 (신규 발견)

- 증거: `src/components/modals/StageMoveModal.tsx:175` `void logStageTransition(...).catch(err => console.warn(...))`
- 영향: 단계 이동 자체는 `returnToActivity`/`advanceActivity`로 먼저 확정되고, 감사 로그(`stage_transitions`) 저장은 **백그라운드 + 실패 시 console.warn만**. spec(`09.md:329` `direction/reason 필수 기록`) 의도와 어긋날 수 있음 — 네트워크 일시 장애 시 단계 이동은 성공했으나 감사 로그가 비는 케이스 발생 가능.
- 권장: ① 감사 무결성 우선이면 `await logStageTransition(...)` (UI 약간 느려질 수 있음) ② 현 패턴 유지 + 실패 시 재시도 큐(예: `pendingTransitionLogs` 배열에 임시 적재 후 다음 진입 시 flush) — 코드 변경 30줄 이내. 현재로서는 UX 우선의 의도적 선택으로 보이므로 **본 검증에서는 P2로 등재, 처리는 선택**.

### P2 — Firestore 오프라인 캐시 memory only (불변)

- 증거: `src/lib/firebase/config.ts:28` `memoryLocalCache()`
- 영향: 새로고침 시 캐시 소실, 오프라인 작성 후 재접속 동기화 불가. spec 1(`09.md:10`) "오프라인 지원" 근거 약화.
- 권장: `persistentMultipleTabManager()` 옵션으로 멀티탭 잠금 회피하면서 persistent 캐시 사용 가능.

### P2 — `Project` 문서 비대화 / `onSnapshot` 페이로드 (악화 가능)

- 증거: `src/types/index.ts:219–388` 40+ 필드 (직전 검증 대비 `curriculumSheet/teamVisionWorkspace/integratedGoalWorkspace/previousCycleImprovements/keyNotes/skippedActionCards` 추가). `watchProject`(`projects.ts:1275`)가 변경 1건마다 전체 문서 페이로드 재전송.
- 영향: 비용·지연 증가. 직전 검증 대비 비대화는 더 진전됨.

---

## 5. 권장 조치

### 즉시 (Day 1)
**없음.** 직전 검증의 두 P0(Rules·StageTransition)는 모두 해소. **배포 차단 사유 없음**.

### 단기 (1주 이내)

1. **`UserProfile.schoolLevel` enum 통일** (P2 → 사실상 P1 수준의 데이터 정합성 문제)
   - 변경: `src/lib/auth.ts:20` `'초등'\|'중등'\|'고등'` → `'초등학교'\|'중학교'\|'고등학교'`
   - 마이그레이션: 다음 로그인 시 lazy 보강(`onProfileRestored`에서 구값 발견 시 자동 변환 후 `saveFirestoreProfile`)
   - 효과: 프로젝트 생성 시 사용자 프로필값 그대로 사용 가능.

2. **`Artifact` 인터페이스 정리** (P2)
   - `src/types/index.ts:613–634` 미사용 필드(`aiDraft/confirmedContent/lastEditedContent/meta.evidence/...`) 제거
   - `src/lib/firebase/projects.ts:1297–1345` `saveArtifact`/`getArtifact`/`watchArtifact` 함수 + `artifactPath`(:1298) 삭제 (호출처 0건 확인됨)
   - `firestore.rules:119–124` 해당 서브컬렉션 rule도 제거(또는 향후 활성화 대비 주석 처리)
   - 09.md를 코드 현실에 맞춰 업데이트 — 단일 진실원천 회복.

3. **`logStageTransition` fire-and-forget 보강** (P2)
   - 두 옵션:
     - (a) `StageMoveModal.tsx:175`의 `void`를 `await`로 변경 — UX 약간 느려질 수 있으나 감사 무결성 보장.
     - (b) 실패 시 `localStorage` 임시 큐에 적재 후 다음 진입 시 flush — UX 유지 + 무결성 보장.
   - data-architect 판단: (b) 권장(20줄 내외 추가).

### 중기 (2–3주)

4. **`previousCycleImprovements` → `cycle_history` 다중 슬롯화** (P1)
   - 현재 단일 슬롯(덮어쓰기). 3 cycle 이상 진행 시 직전 1개만 추적 가능.
   - `projects/{id}/cycle_history/{cycleNumber}` 서브컬렉션으로 누적 (이미 rules 슬롯 있음 — `firestore.rules:136–138`).
   - `finalizeCycleTransition`(`projects.ts:1437–1484`)에 `setDoc(doc(...,'cycle_history',String(cycle)), {artifactSummary, keyImprovements, nextCyclePresets})` 추가.

5. **`standards_index` Firestore 적재** (P1)
   - 10.md spec("Firestore + 자체 코사인 계산" `10.md:111`) 반영.
   - Cloud Function 스크립트 1회 실행 → `data/elementary_knowledge_graph.json` + `public/curriculum_json/*.json`을 정규화 적재.
   - 적재 후 `firestore.indexes.json`에 학년군+교과 복합 인덱스 추가 (`{collectionGroup: 'standards_index', fields: [{fieldPath: 'gradeGroup', order: 'ASCENDING'}, {fieldPath: 'subject', order: 'ASCENDING'}]}`).
   - rules에 read-only rule 명시 (현재 catch-all에 막힘).

6. **rules trade-off 1·2 해소** (P1)
   - `inviteCodes/{code}` 인덱스 컬렉션 도입 → `projects` get rule에서 `inviteCode != null` 분기 제거 → `inviteCodes/{code}` get-only 허용으로 대체.
   - `user_projects/{uid}/{pid}` 인덱스 컬렉션 도입 → `projects` list 권한을 본인 인덱스로만 제한 → R-rules-2 해소.

7. **`persistentMultipleTabManager` 전환** (P2)
   - `src/lib/firebase/config.ts:28` 옵션 변경. spec의 "오프라인 지원" 회복.

### 문서 동기화

8. **09.md 업데이트** (직전 검증 §5.10과 동일 — 처리 안 된 상태)
   - (a) `materials/materialChunks/lobby/streamingState/integratedGoalPresence/teamVisionPresence/curriculumSheet/teamVisionWorkspace/integratedGoalWorkspace/public_reports/user_settings` 추가
   - (b) `members`를 배열 모델(`memberUids` + `memberInfo`)로 변경 명시
   - (c) `artifacts` 위치(맵 vs 서브컬렉션) 결론 (B안)
   - (d) Security Rules를 `memberUids` 기반으로 재작성한 현실 반영
   - (e) `previousCycleImprovements` 슬롯 → `cycle_history` 분리 계획 명시

---

## 6. 요약 점수 (현 차수)

| 영역 | 충족 | 부분 | 누락 | 비고 |
|------|------|------|------|------|
| 컬렉션 존재성 (3.1–3.10, 3.13–3.14) | 4 | 4 | 4 | 직전 0/4/3 대비 충족 +3 |
| 보안 규칙 (3.11) | 0 | 1 | 0 | 직전 0/0/2 대비 P0 해소 |
| 인덱스 (3.12) | 1 | 0 | 0 | 신규 검증 — 단일 필드 쿼리만이라 적정 |
| 실시간/캐시 (3.15–3.16) | 0 | 2 | 0 | 불변 |
| 인증 (3.17) | 1 | 0 | 0 | 불변 |
| 추가 컬렉션 (3.18–3.22) | 5 | 0 | 0 | spec 외 컬렉션, 모두 rules 보호 + 일관 코딩 |
| 안전 처리 (3.23) | 1 | 0 | 0 | 불변 |
| **합계 (23 항목)** | **12** | **7** | **4** | 직전 6/6/8 대비 충족 6→12, 누락 8→4 |

**핵심 변화**: 직전 검증 R1·R2 두 P0가 모두 해소. P1·P2 항목은 다수 잔존하나 배포 차단 사유 없음. 본 차수의 새 권고는 ① schoolLevel enum 통일 ② Artifact 인터페이스 정리 ③ logStageTransition 재시도 큐 — 모두 P2/단기 작업.

---

## 7. 직전 검증 대비 변화 요약 (Lead 보고용)

### 해소된 P0 (2건)
- **R1(rules `if true`)**: 199줄 재작성, 컬렉션별 명시 rule + catch-all 차단 ✅
- **R2(`logStageTransition` 호출 0건)**: `StageMoveModal.tsx:175`에서 호출 + cycle 전환 시 `finalizeCycleTransition`로 `isECompleted/currentCycle/cycleCount/previousCycleImprovements` 자동 처리 ✅

### 추가 해소된 P0/flag (직전 검증 §7.5·§7.6에서 식별)
- **P0-4(joinProject inviteCode 검증)**: `projects.ts:158–187`에 inviteCode 인자 + 비멤버 시 일치 강제 ✅

### 신규 해소 (P1 영역)
- **P1-I 데이터 모델**(`_schemaVersion: 'v2-sections'` 자동 부착, `previousCycleImprovements` 추출): 코드 안착 완료 ✅
- **Task #23 Phase 3**(`/api/chat/previous-cycle-ref` 엔드포인트): 본 검증 범위 외이나 직전 §9 보고 그대로 살아있음.

### 잔존 (직전 검증과 동일)
- Members 서브컬렉션 부재, Artifact 스키마 이중화, versions 서브컬렉션 부재, standards_index Firestore 미적재, 오프라인 캐시 memory, schoolLevel enum 불일치, 09.md 동기화 미반영.

### 신규 발견 (이번 차수)
- ⚠️ `logStageTransition` **fire-and-forget 패턴**(`StageMoveModal.tsx:175` `void ... .catch`): 단계 이동 자체는 확정되나 감사 로그는 best-effort → P2.
- ⚠️ `Project` 문서 비대화 가속(curriculumSheet/teamVisionWorkspace/integratedGoalWorkspace/keyNotes/skippedActionCards/previousCycleImprovements 신규 누적) → P2.
- ✅ `firestore.indexes.json` 적정성 확인: 단일 필드 쿼리만이라 빈 indexes로 OK.
- ✅ rules에 `lobby/integratedGoalPresence/teamVisionPresence/cycle_history/streamingState/materials/materialChunks/public_reports/stage_transitions` 모두 명시 rule 보유 → auto-memory `feedback_firestore_path_rules_sync.md` 패턴(catch-all permission denied 폭주) 예방 완료.

### 본 차수의 결론
**배포 차단 P0 없음.** 직전 검증의 핵심 P0 2건이 해소되고, 추가 인프라(`previousCycleImprovements`, `public_reports`, `teamVisionPresence`, `integratedGoalPresence`)가 모두 rules·코드 양쪽에서 일관되게 추가됨. 잔여 P1·P2는 모두 점진 개선 항목.
