# 아스트라 팀장 인수인계 (2026-10-07, 총괄 Claude → 아스트라 팀장 herdr w1:p6)

사용자 지시: 이번을 끝으로 총괄 Claude 와 우측 Claude(w1:p4)는 빠지고, 아스트라(w1:p6)가 팀장, 코덱스(w1:p3)가 팀원인 2인 체제로 진행한다.

## 현재 운영
- 운영 togethertr.web.app = 86cfc051 (브랜치 feat/realtime-coedit-2026-10-05, worktree ~/tcid-work/release)
- 배포는 커밋된 상태만 꺼낸 ~/tcid-work/deploy 에서(작업 중 파일이 빌드에 섞이지 않게): `git -C ~/tcid-work/deploy checkout --detach <커밋>` → `npm_config_cache=/tmp/tcid-npm-cache npm run sync:runtime-assets && npm run verify:curriculum && firebase deploy --only hosting --project togethertr --account jammanbogem@gmail.com --non-interactive` (샌드박스 밖)
- 배포 전 `git merge-base --is-ancestor <직전 운영 커밋> HEAD`
- 관문: teamTestFixes 등 전체 테스트(기존 실패 3개: collaborativeAutofillRoute·collaborativeGradePersistence·deployed bundle 은 변경 전에도 실패), tsc 0, eslint src 오류 0
- 되돌림 태그: pre-training-mode-2026-10-04
- 미배포 브랜치: feat/privacy-consent (~/tcid-work/fix-team-test) — 가입 동의·탈퇴·Storage 정리 큐. 운영 배포는 사용자 승인 필요.

## 사용자 승인이 필요한 것
- Firestore 규칙 배포 — 준비된 보강안: hostRequests 는 자기 uid 만, originalCreatedBy·hostTransfers 팀원 수정 금지(우측 Claude 가 firestore.rules 에 준비, 미배포)
- 가입 동의·탈퇴 운영 배포, 실제 탈퇴 시험, 관리자 claim 부여
- 로그인 대행 금지

## 다음 할 일(사용자 요청, 미착수)
1. 체크리스트 개인별 체크: 지금은 칸 하나를 팀이 공유해 B 가 누르면 A 의 체크가 꺼짐. messages/{id}.checklistState.{순번}.{uid} = {checked, at, name} 로 바꿔 '내 체크' 상자 + 팀원 체크 이니셜 배지 + 'n/전체' 표시. 옛 데이터(순번 단일 값)는 읽기 호환.
2. 새 내용은 처음부터 보이게: 보고서 생성 시 보고서 맨 위부터, 채팅 AI 응답은 응답 첫 줄부터 보여야 하는데 중간·끝으로 스크롤됨. 새 AI 메시지 시작 시 그 메시지 맨 위로 맞추고, 응답이 화면보다 길어지면 자동 따라가기 중지(사용자가 맨 아래에 있을 때만 따라가기), 보고서 생성·다시 생성 시 스크롤 맨 위.
3. '논의해 주세요/검토해 주세요' 행동 지시: AI 가 검토·논의를 요청할 때 무엇을 해야 할지 모름 → grill-me 처럼 [검토 완료] [추가 내용 입력] 버튼(기존 ACTION_CARD 재사용), '추가 내용 입력'을 누르면 입력창에 무엇을 적을지 안내 문구가 채워지고, AI 문장에는 '다음 단계에 필요한 것: …'을 구체적으로 적게 프롬프트 보강(일반·연수용 모두, 출력 형식 테스트로 고정).
4. 그 밖: 최고관리자·관찰자 모드(메모리 super-admin-observer-pending), 개인 설계 연수용의 팀 표현 정리, 기존 '방장 되기'(transferHost)는 규칙상 실패 가능 — 기록 권한 요청으로 대체 검토.

## 작업 원칙(사용자 선호)
- 사용자 보고는 한국어, 마크다운 기호 없이 구분선·아이콘
- 연수용이 아닌 동작은 바꾸지 않음, 실제 브라우저로 확인 후 완료
- 반드시 지킬 동작은 코드로 보장
