# 탈퇴 후 업로드 자료 정리 (TASK-A1, 미배포)

운영 배포·Firestore 규칙 배포·실제 계정 탈퇴·실제 자료 삭제는 이 작업에서 수행하지 않았다.

## 탈퇴 경로

혼자 남은 프로젝트를 지우기 전에 `storageCleanupQueue/{sha256(projectId)}`에 정리 작업을 기록한다. 기록 실패 시 해당 프로젝트와 계정 삭제를 중단한다. 프로젝트 삭제 후 Storage prefix 삭제를 시도하고, 실패하거나 버킷을 얻지 못하면 목록을 보존한 채 계정 삭제를 완료할 수 있다. 이후 계정 삭제 재시도에서도 uid 해시로 남은 목록을 조회하므로 이미 삭제된 프로젝트가 조회되지 않아도 안내가 사라지지 않는다.

정리 문서는 `schemaVersion`, `projectId`, `uidHash`, `paths`(해당 프로젝트 prefix 하나), `bucketName`, `reason`, `createdAt`, `attempts`, `lastAttemptAt`을 보관한다. uid는 도메인 접두사를 포함한 SHA-256 해시이며 이메일·이름·원본 uid·SDK 오류 원문은 넣지 않는다. 자료 삭제 성공 후 정리 문서도 삭제한다. SDK가 중간 일부 파일만 지운 뒤 실패해도 prefix 전체를 재시도하므로 남은 파일을 다시 정리한다.

API 결과의 `storageCleanupPending`이 true이면 로그아웃 후 “탈퇴가 완료되었습니다. 일부 업로드 자료는 정리 중입니다”를 표시한다. 전부 정리된 경우 기존 완료 문구를 유지한다. 동의서 본문·상세 보유 기간·탈퇴 전 안내에 “탈퇴 후 남은 업로드 자료는 순차 삭제됩니다”를 추가했고 동의 버전은 `2026-10-06`이다.

## 관리자 재시도 API

`POST /api/admin/storage-cleanup`, 헤더 `Authorization: Bearer <관리자 Firebase ID 토큰>`, JSON 본문 `{"queueId":"<정리 목록 문서 ID>"}`.

관리자는 Firebase Console의 `storageCleanupQueue`에서 처리할 문서 ID를 확인한다. 이 API는 한 요청당 한 건만 처리한다. 앱 프로젝트 방장이나 클라이언트 프로필의 role로는 실행할 수 없다. 서버에서 ID 토큰의 유효성·폐기 여부와 `admin === true`를 확인하고, Auth의 현재 사용자 customClaims도 다시 읽어 관리자 권한 회수·사용 중지를 확인한다. 권한 부여나 토큰 발급 자동화는 추가하지 않았다. 근거: [Firebase 관리자 custom claims](https://firebase.google.com/docs/auth/admin/custom-claims), [세션 폐기 확인](https://firebase.google.com/docs/auth/admin/manage-sessions).

관리자 권한은 Firebase Auth에 신뢰할 수 있는 운영자가 설정한 custom claim `admin: true`가 있어야 한다. 기존 관리 계정에도 해당 claim이 없다면 403을 반환한다. 권한 설정은 별도 운영 승인 범위다.

응답은 `deleted`/`missing`이면 200(완료·이미 완료), `pending`이면 503(자료 삭제 실패·버킷 미설정·버킷 불일치), `project-exists`이면 409(프로젝트 삭제가 끝나지 않아 자료 삭제 차단), `invalid-record`이면 422(정리 기록이 예상 형식/경로가 아님)다. 큐 접근 실패 등은 503 `cleanup-retry-failed`이고 기록이 유지된다. 토큰 없음·만료·폐기는 401, 일반 회원이나 회수된 관리자 권한은 403이다.

요청에서 Storage 경로·버킷을 직접 받지 않는다. 문서에 저장된 prefix가 `projects/{projectId}/`와 정확히 같아야 하며, 현재 버킷 이름도 기록과 같아야 한다. 해당 프로젝트가 아직 존재하면 삭제하지 않는다. 파일 삭제 후 큐 문서 삭제만 실패한 경우에도 같은 ID로 멱등 재시도한다.

자동 스케줄러는 포함하지 않았다. 운영 승인 후 담당 관리자가 목록을 확인하고 재시도해야 한다. 실패 목록에 TTL을 설정하면 정리 대상 자체가 유실되므로 성공 전에 문서를 지우지 않는다. 프로젝트 삭제 자체가 중단되어 409가 나면 먼저 탈퇴/프로젝트 삭제의 미완료 상태를 처리한다.

## 접근과 검증

큐는 Admin SDK만 접근한다. 기존 Firestore 마지막 catch-all이 클라이언트 읽기·쓰기를 모두 차단하므로 규칙 수정이나 배포는 필요 없다. 관리자 API도 이번에는 미배포 상태다.

`scripts/storageCleanup.test.mjs`는 실제 탈퇴 라우트·관리자 라우트·정리 함수를 실행하고 Firebase/Auth/Storage만 메모리 대역으로 바꾼다. 기록 실패 시 삭제 중단, Storage 실패/버킷 없음 후 탈퇴 안내, 프로젝트 미삭제 차단, Auth 실패 후 재호출, 큐 삭제 실패 후 재시도, 권한·경로·버킷 제한, 문구를 검사한다. 기존 P2 화면 테스트도 결과 전달과 완료 화면 분기를 검사한다. 실제 계정·운영 자료는 조작하지 않는다.

최종 검사: 신규 10/10, 전체 876개 중 874 통과·0 실패·2 환경 선택 검사 제외(Firestore emulator, 외부 Google Fonts 응답). TypeScript 오류 0, `eslint src` 오류 0·기존 경고 28, diff check 통과. 전체 명령은 Node 24의 `--experimental-strip-types --experimental-test-module-mocks --import ./scripts/lib/register-ts-hooks.mjs --test scripts/*.test.mjs`다.

최초 전체 검사에서 기존 생성 자료 `data/core-idea-area-mapping.json` 누락과 `demo-observer.test.mjs`의 공용 remarkPlugins 의존성 누락이 발견됐다. 생성 자료는 메인 작업 폴더의 기존 파일로 로컬 복원했으며 gitignore 대상이라 커밋하지 않는다. 데모 테스트는 실제 공용 플러그인을 주입하도록 2줄만 수정했다. 앱의 데모 동작은 수정하지 않았다.
