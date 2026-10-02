# 2026년 9월 21일 — 여러 학년군 협력적 수업설계 수정

대화에서 여러 학년군을 인식했지만 분석시트에는 대표 학년군만 적용되던 문제를 수정한 기록입니다.

수업내용 설명 자동 입력과 내부 용어 표시를 보완한 후속 수정·백업·배포 기록은 [추가수정-수업내용설명](./추가수정-수업내용설명/README.md)에 있습니다.

## 이전 버전과 수정본

| 구분 | 내용 |
| --- | --- |
| [이전버전.zip](./이전버전.zip) | 이번 변경 대상 파일의 수정 전 원본. 새로 추가한 파일은 들어 있지 않습니다. |
| [수정본.zip](./수정본.zip) | 이번에 수정·추가한 소스와 회귀 테스트 원본. 저장소 루트 기준 경로로 압축했습니다. |
| [변경파일.json](./변경파일.json) | 파일별 추가/수정 여부, 수정 전·후 SHA-256 해시, 백업 커밋 |
| [수정 전 전체 작업본](https://github.com/jammanbogem-hsy/togetherTR/tree/codex/2026-09-21-before-grade-fix) | 작업 시작 시점의 소스 전체. 당시 미커밋 교육과정 맵 변경도 보존했습니다. |
| [9/21 수정 브랜치](https://github.com/jammanbogem-hsy/togetherTR/tree/codex/2026-09-21-grade-bands) | 원격 main 기준 코드에 이번 학년군 수정만 추가한 버전 |

최종 코드 커밋: [`75173b16`](https://github.com/jammanbogem-hsy/togetherTR/commit/75173b16dc48cfcc6cae4e942d8ab0a7a2a72eba)
기능 수정 커밋: [`32806c9d`](https://github.com/jammanbogem-hsy/togetherTR/commit/32806c9d116215c3ec161f2385bf5c690cbaba7e)

수정 전 원격 기준 커밋: `3bd4e2e7e70509b7b9fe7c08340dc402fd5197a0`
수정 전 전체 작업본 백업 커밋: `0c5884511b2d00014f1c0cbfb9ccdbf732c20cf7`

압축 파일은 **이번 변경 파일 묶음**입니다. 실행 가능한 전체 소스는 위 Git 브랜치로 보관합니다. 백업에는 운영 Firestore 데이터나 환경변수·인증정보가 포함되지 않습니다.

## 바뀐 동작

1. 프로젝트에 저장된 팀 학년군을 시트와 자동 채우기 API에 전달합니다. 빈 시트에서도 팀 학년군 전체를 조회합니다. 행 하나의 명시적 학년 선택은 그대로 존중합니다.
2. 1–2학년군에 사회·과학 등이 없으면 통합교과의 실제 교육과정 자료를 함께 조회합니다. 확인창에서 일부 학년군 선택이 잘못 비활성화되던 연결도 수정했습니다.
3. 팀원의 학년군 발언은 프로젝트에 제안으로 보존하고 방장이 반영·거절합니다. 승인 시 기존 팀 학년군에 추가하고, 제안 ID를 확인해 오래된 승인이 새 제안을 삭제하지 않게 합니다.
4. 방장이 여러 학년군을 확정하면 시트 모드도 같은 트랜잭션에서 `multi`로 저장합니다. 기존 여러 학년군 프로젝트의 `single` 설정은 방장 접속 시 보정합니다. 기존 행에는 원래 학년군을 붙여 내용이 다른 학년으로 바뀌지 않게 합니다.
5. 학년군마다 중심 교과를 각각 지정할 수 있습니다. 예를 들어 1–2학년군은 통합교과, 5–6학년군은 사회를 중심으로 설계할 수 있고, 산출물에도 학년군별 중심 표시를 유지합니다.
6. 저장된 그래프의 성취기준을 해당 학년군으로 필터링합니다. `[6국01-01]`이 1–2학년군 근거에 들어가던 재현 사례를 차단했습니다. 대화는 시트에서 고른 학년군별 성취기준과 중심 교과를 참조합니다.
7. 자동 채우기는 최신 서버 행과 병합하며 교사가 작성한 내용과 연결 줄을 보존합니다. 늦게 도착한 설명은 이미 편집된 셀이나 성취기준이 바뀐 행을 덮어쓰지 않습니다.

## 안전하게 이전 버전 확인하기

현재 작업을 지우거나 덮어쓰지 않고 별도 폴더에 백업을 열 수 있습니다.

```bash
git fetch origin
git worktree add --detach ../tcid-backup-0921 origin/codex/2026-09-21-before-grade-fix
```

이번 학년군 수정만 되돌리는 경우 수정 브랜치의 기능 수정 커밋을 `git revert 75173b16dc48cfcc6cae4e942d8ab0a7a2a72eba 32806c9d116215c3ec161f2385bf5c690cbaba7e`로 취소합니다. 운영에 적용한 뒤 되돌릴 때는 앱 소스와 `firestore.rules`를 함께 해당 버전으로 배포해야 합니다. Git 복원은 이미 저장된 Firestore 데이터를 되돌리지 않습니다.

## 검증

- 단위·회귀·실제 교육과정 API·트랜잭션 어댑터·산출물 렌더링 테스트: 123개 통과.
- 실제 Firestore Emulator 권한 테스트: 1개 통과. 팀원 직접 확정 차단, 제안 저장, 방장 확정, self-join 우회 차단과 정상 가입을 확인했습니다.
- 이번 변경만 적용한 별도 작업본의 TypeScript 검사 통과.
- Next.js 프로덕션 빌드(webpack), runtime-assets 검사 통과. 격리 작업본에서는 Node 24 경로를 지정하고 기존 로컬 교육과정 매핑 자료를 복사해 검증했습니다.
- 교육과정 연결 검사: 16 PASS / 3 WARN / 0 FAIL. 1,134개 대화 컨텍스트의 학년군 범위를 점검했습니다. 경고는 창체 관계·원문 매칭·레거시 학년군 복구 항목입니다.
- 변경 파일 ESLint: 오류 0개. 기존 경고 12개.
- 단위·회귀 테스트에서는 외부 모델 호출을 대체했습니다. 아래 운영 API 검증은 실제 배포 서버를 호출했습니다. 실제 교사 계정의 다중 브라우저 실시간 공동 편집은 별도로 확인해야 합니다.

## 운영 배포 — 2026-09-21 23:39 KST

사용자 요청에 따라 [운영 앱](https://togethertr.web.app)에 앱과 Firestore 권한 규칙을 함께 배포했습니다.

- 배포 소스: `9dc63f47a57fb6f356f923469c4461db916dffb9` (위 최종 코드와 백업 문서 포함). 별도 작업 폴더에서 이 커밋만 배포했습니다.
- Firebase 프로젝트: `togethertr`, 서버: `ssrtogethertr`, 리전: `asia-northeast3`, 런타임: Node.js 24.
- Hosting 버전: `5f7368b0aa46b6cb`, 직전 운영 버전: `506cfec718660914`.
- 운영 페이지와 로그인 페이지 HTTP 200, 새 클라이언트 파일의 SHA-256 일치 확인.
- 실제 자동 채우기 API: 세 학년군의 분석 행 6개 생성. 1–2학년군 통합교과, 3–4학년군 국어, 5–6학년군 사회 중심 설정 유지.
- 실제 대화 API: 세 학년군별 답변과 중심 표시 유지, 다른 학년군 성취기준 혼입 0건.
- 이 점검은 테스트 입력으로 API 응답을 확인했으며, 운영 교사 프로젝트 데이터를 작성하거나 수정하지 않았습니다.
- 상세 기록: [배포기록.json](./배포기록.json), [운영검증.json](./운영검증.json).

배포 도구는 Firebase CLI `15.30.2`를 사용했습니다. 기본 설치된 구버전 CLI와 로컬 npm 캐시 권한 문제를 피하기 위해 Node.js 24 및 별도 npm 캐시를 지정했습니다. 앱·권한 규칙을 되돌릴 때는 위 복원 절차에 따라 두 항목을 함께 배포하세요.

주요 테스트 실행:

```bash
node --experimental-strip-types --experimental-test-module-mocks \
  --import ./scripts/lib/register-ts-hooks.mjs --test \
  scripts/teamGradeBands.test.mjs scripts/sheetGradeBands.test.mjs \
  scripts/autofillGradeBands.test.mjs scripts/bridgeStandards.test.mjs \
  scripts/a21GroupRows.test.mjs scripts/collaborativeGradeBands.test.mjs \
  scripts/collaborativeAutofillRoute.test.mjs scripts/collaborativeGradePersistence.test.mjs \
  scripts/collaborativeGradeArtifact.test.mjs
```

권한 테스트는 Firestore Emulator 실행 환경에서 `TCID_RULES_TESTING_ROOT`를 임시 설치한 `@firebase/rules-unit-testing`의 루트 폴더로 지정한 후 `node --test scripts/collaborativeGradeRules.test.mjs`로 실행합니다.

## 지식 그래프 후속 수정 (9/22)

과목 아이콘·연결선 수정 전후 파일과 복원 방법은 [추가수정-지식그래프](./추가수정-지식그래프/README.md)에 보관합니다.

## 저학년 교과 연결 후속 수정 (9/22)

미술 등 미개설 교과에서 통합교과 성취기준을 연결하는 수정 전후 파일과 복원 방법은 [추가수정-저학년교과연결](./추가수정-저학년교과연결/README.md)에 보관합니다.
