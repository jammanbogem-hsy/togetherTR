# 실시간 공동 편집 변경 및 검증 (2026-10-05)

## 운영 반영 완료

- 운영 코드: `dfc8a4c8` (`feat/realtime-coedit-2026-10-05`), https://togethertr.web.app 에 Hosting/기존 SSR 함수 배포 완료. Firestore 규칙과 개인정보 기능은 배포하지 않았다.
- 최종 회귀 검사 260/260, TypeScript 오류 0, ESLint 오류 0·기존 경고 28. 배포 과정의 production build 성공.
- 최초 연결에서는 캐시·미확정 쓰기를 제외하고 metadata-only 확정 응답을 받는다. 초기 저장보다 오래된 서버 알림도 올 수 있어, 불일치는 최신 서버 transaction으로 재확인한다. 같은 시점의 확인은 합치며 실제 권한·주기·손상·용량 오류와 미전송 입력은 보존한다.
- 배포 후 기존 로그인된 Chrome의 연수 시험 프로젝트에서 공동 편집 이름표의 선명도와 기존 표 로딩을 확인했다. 최종 수정본을 새로고침하고 아직 열지 않았던 T-1 공동 편집 창을 열어 최초 연결부터 `공동 편집 저장됨` 표시를 확인했다. 운영 콘텐츠 입력·산출물 전송·로그인 대행은 하지 않았다.
- 원본 `feat/privacy-consent`에도 동일 보완 `79f1836d`를 반영하고 push했다. 개인정보 동의·탈퇴 기능은 계속 운영 반영 보류다.
- 동시 입력·한글 조합·오프라인 복구·본문 커서는 아래 로컬 브라우저 검증 범위다. 실제 두 계정의 운영 동시 입력은 별도 확인이 필요하다.

## 공동 편집 전용 릴리스

이 릴리스는 운영 기준 4cc39fa6에서 원본 999b6c03 및 최종 보완 2a9770db의 공동 편집 변경만 선택 반영한 배포 준비본이다. 작업 경로는 /tmp/tcid-realtime-release, 브랜치는 feat/realtime-coedit-2026-10-05이다.

개인정보 동의 게이트·회원 탈퇴 화면/API와 관련 코드는 제외했다. src/app 전체, src/components/privacy, src/lib/auth.ts, src/lib/firebase/admin.ts, src/lib/privacy, src/lib/account는 기준 커밋과 동일하다. P1/P2 테스트와 전용 import·fixture만 제외하고 C1/C2·연수용 모드·공동 편집 회귀 테스트를 유지했다. 개인정보 동의 화면과 규칙은 이 릴리스의 배포 대상이 아니다.

표와 T-2 본문 모두 250ms throttle을 사용하므로 연속 입력 중에도 저장을 예약한다. 본문 보완 파일과 테스트는 2a9770db와 일치한다. production build는 원본 node_modules를 macOS clone copy로 복사한 실제 디렉터리와 릴리스 worktree의 독립 .next에서 수행한다. 원본 의존성은 수정하지 않는다. 환경 파일 내용은 출력하거나 커밋하지 않는다.

릴리스 최종 코드 검사: teamTestFixes·workspaceCrdt·documentPresence·presenceDisplay 합계 254/254 통과, tsc 오류 0, eslint src 오류 0·경고 28, git diff --check 통과. git diff --name-only와 미추적 파일 목록으로 개인정보 경로가 포함되지 않음을 확인했다. 이 문서의 릴리스 준비는 커밋·push·운영 배포를 의미하지 않는다.

교육과정 검증은 18 PASS / 3 WARN / 0 FAIL이다. 최초 기본 빌드는 Turbopack이 외부 node_modules 심볼릭 링크를 거부했고, 임시 webpack 빌드는 Google Fonts 네트워크 접근이 차단돼 실패했다. 최종 빌드는 실제 node_modules 디렉터리로 기본 `next build`를 실행하고 `verify:runtime-assets`로 자산 포함 여부를 확인한다. 교육과정 검증은 이미 통과하여 중복 실행하지 않는다. 설정 파일은 변경하지 않았다.

## 범위

- 표의 Yjs 동기화는 `trainingMode.enabled === true`인 프로젝트에 적용한다. 핵심 활동도 포함하며 12개 전용 창 + DI/E 공통 창(4활동)을 연결한다.
- 표/행은 Y.Array/Y.Map, 칸은 Y.Text. 입력 중 250ms throttle로 전송하며 로컬 입력을 먼저 반영한다. 초안 저장과 산출물 전송은 대기 변경을 flush하고 최신 JSON을 읽는다. 기존 replace-all 저장을 실시간 경로에서 실행하지 않는다.
- 사용자 이름은 기존 프로필 색의 색조를 유지한 진한 글자색/배경/테두리로 표시한다. 앱 파스텔 12색의 대비 4.5:1 이상을 검사했다.
- 표 칸과 T-2 본문에 다른 편집자의 이름·커서·편집 위치를 표시한다. 본문 커서/선택 영역은 y-tiptap의 상대 위치 처리와 Decoration을 사용한다.
- 한글 조합 중 표의 view Y.Doc에는 원격 update를 잠시 보관하고 조합 완료 후 적용한다. 로컬 글자 변경은 계속 저장한다. 본문 커서 갱신도 조합이 끝날 때까지 보류한다.

## 저장·복구

- 프로젝트 문서의 `coeditWorkspaceCrdt[workspaceField]`에 주기별 CRDT를 저장하고 기존 workspace JSON을 호환용 projection으로 함께 저장한다.
- seed와 상태 병합은 Firestore transaction으로 수행한다. 기존 CRDT가 있으면 산출물/legacy JSON보다 우선한다. 손상된 state를 빈 문서로 초기화하지 않는다.
- 각 탭·사용자·주기별 localStorage에 미전송 입력을 보관한다. 재연결 시 재전송하고, 저장 실패를 성공으로 표시하지 않는다.
- T-2 본문은 기존 document provider가 소유하므로 표의 CRDT에서 blocks를 제외한다. 본문 flush 후 표 flush/getWorkspace가 최신 blocks를 포함한다.
- 기존 Presence 규칙 경로를 사용한다. 규칙 파일 수정·규칙 배포 없음. 새 본문 presence는 `lessonDesignDirectionDocumentPresence/{uid}`이다.
- 개별 state는 240,000 bytes, 프로젝트 전체는 보수적 UTF-8 추정 900,000 bytes 이내에서 저장한다. 초과 시 입력을 보관하고 오류를 표시한다.

## 비용과 한계

Yjs는 오픈소스이며 별도 공동편집 SaaS 계약은 없다. Firestore 쓰기·리스너 읽기·전송량은 사용량만큼 증가한다. 표 전송은 최대 250ms 간격, 본문 커서 200ms 간격, 커서는 heartbeat와 만료 처리로 제한한다. 정확한 금액은 동시 인원·편집 시간·프로젝트 문서 크기에 달려 있다.

현재 저장 위치는 프로젝트 문서이므로 큰 프로젝트/상시 대규모 사용은 문서별 하위 컬렉션 분리가 후속 과제다. 이 경우 보안 규칙 변경·배포 승인이 필요하다. 오래된 앱의 LWW 쓰기와 새 CRDT를 혼용하지 않도록 배포 후 편집 창을 새로 열어야 한다.

가격 근거: https://firebase.google.com/docs/firestore/pricing
Yjs: https://github.com/yjs/yjs

## 검증

`teamTestFixes`, `workspaceCrdt`, `presenceDisplay`, `documentPresence` 테스트를 함께 실행한다. 모델 검증은 같은 칸/다른 칸 동시 입력, 행·블록 재정렬, 동시 삽입과 삭제, 동일 상태 no-op, 한글·emoji, 동시 seed, 오프라인 복구, 저장 중 추가 입력, 주기·권한·용량 오류, 별도 본문 보존을 포함한다.

브라우저 검증은 `node scripts/verify-realtime-browser.cjs`로 임시 디렉터리에 만들고 로컬 HTTP 서버로 연다. 실제 React 훅·Yjs provider·모달·Tiptap을 사용하며 저장 transport만 메모리로 바꾼다. 운영 계정 로그인이나 Firebase 운영 데이터 조작은 없다.

2026-10-05 Chrome 확인:

- 독립 편집기 두 개에서 같은 칸 동시 입력 양쪽 보존.
- 한글 조합 중 원격 입력 화면 적용 보류, 조합 완료 후 양쪽 문자열 수렴.
- 연결 끊김 중 입력 유지, 재접속 후 양쪽 수렴.
- 실제 역할 배분 모달의 입력과 초안 저장 성공. 레거시 저장 함수는 호출 시 오류가 나도록 설정하여 CRDT 저장 경로 사용을 확인.
- 실제 Tiptap 본문 두 개에서 입력 내용 동기화와 상대 화면의 사용자 이름·커서 표시 확인.

검증 한계: 운영 Firestore 지연·권한·네트워크 비용 및 실제 두 계정의 운영 통합 시험은 별도다. 실제 OS 한글 입력기 모든 조합 패턴을 보장하는 시험은 아니다.

## 배포 구분

기존 P1/P2/C1/C2 통합 커밋은 baae996b이다. 개인정보 동의 화면 운영 배포, 규칙 배포, 실제 회원 탈퇴 시험, 로그인 대행은 사용자 승인 전 실행하지 않는다.

P1 운영 전 보완: 단독 프로젝트 삭제 중 새 멤버 가입 경쟁을 막는 원자적 확인·삭제 기록, Storage 삭제 실패를 partial-failure로 처리하고 계정 삭제를 중단하는 절차가 필요하다. 이번 공동 편집 변경과 구분한다.
