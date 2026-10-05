# 아스트라 차장 인수인계 (2026-10-05, 총괄 Claude → 코덱스 '아스트라 차장')

사용자 지시로 총괄 크레딧이 줄어 코덱스를 '아스트라 차장'으로 임명, 업무 총괄을 잠시 위임한다. 팀원: 우측 Claude(herdr w1:p4). 총괄(w1:p2)은 대기, 필요 시 복귀.

## 작업 위치·브랜치
- 작업 폴더: ~/tcid-work/fix-team-test (메인 폴더 ~/tcid-agent 는 다른 세션 작업 중 — 건드리지 않음)
- 브랜치 흐름: fix/2026-10-03-team-test → feat/training-mode(운영 4cc39fa6 까지 배포) → feat/privacy-consent(현재, 미배포 변경 있음)
- 되돌림 태그: pre-training-mode-2026-10-04 (c6664e88)
- 명세: docs/training-mode-spec.md, docs/privacy-consent-spec.md, docs/HANDOFF-branches-2026-10-04.md

## 배포 절차 (운영 togethertr.web.app)
1. tsc 0, eslint src 오류 0, `node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test scripts/teamTestFixes.test.mjs` 전부 통과
2. 커밋 메시지 끝 '🗿 MoAI <email@mo.ai.kr>', push
3. `git merge-base --is-ancestor c6664e88 HEAD` 로 운영 최신 포함 확인
4. `npm_config_cache=/tmp/tcid-npm-cache npm run sync:runtime-assets && npm run verify:curriculum && firebase deploy --only hosting --project togethertr --account jammanbogem@gmail.com --non-interactive` (샌드박스 밖, 실패 시 3회 재시도)
5. 배포 후 실제 브라우저로 확인(API 시뮬레이션만으로 완료 판정 금지)

## 사용자 승인이 필요한 것 (차장이 결정하지 말고 사용자에게 물을 것)
- Firestore 보안 규칙 배포
- 가입 동의 화면 운영 배포(배포 즉시 모든 회원이 동의 화면을 봄 — 문구 확인 먼저)
- 실제 회원 탈퇴 시험(되돌릴 수 없음 — 시험 계정 지정 받기)
- 로그인·자격 증명 입력(자동화 도구가 대신하지 않음)

## 미배포(커밋 전) 변경 — 검토 후 커밋
- P1(우측 Claude): 동의 문구 데이터·동의 기록·탈퇴 API(/api/account/delete)
- P2(코덱스): 동의 게이트·탈퇴 화면
- C1(우측 Claude): 채팅 표 짧은 열 줄바꿈 방지, 체크한 사람 이니셜 배지
- C2(코덱스): 공동 편집 — 팀원도 초안 저장, 팀원은 '방장에게 반영 요청'

## 최우선 과제: 공동 편집 실시간화(구글 문서처럼)
- 현상: 표 공동 편집이 칸 patch + Firestore 덮어쓰기(LWW)라 실시간 느낌이 없고 동시 입력 시 글이 사라짐.
- 방향: 이미 T-1-2 본문이 쓰는 Tiptap+Yjs+Firestore(메모리 coedit-editor-decision) 방식을 표에도 — 워크스페이스마다 Y.Doc, 표=Y.Array<Y.Map>, 칸=Y.Text, 다른 사람 커서/편집 중 칸 표시. 기존 저장 형식과 양방향 변환(산출물 보내기·보고서는 기존 형식 유지), 12개 공동 편집 창 공통화.
- 연수(10/9~10) 전에는 최소한 '입력이 사라지지 않음'과 '다른 사람 입력이 바로 보임'을 보장.

## 그 밖의 대기 과제
- 최고관리자(jammanbogem)·관찰자 모드(메모리 super-admin-observer-pending) — 연수용 안정화 뒤
- 개인 설계 연수용에서 '팀 일정' 등 팀 표현을 개인용으로
- 팀원 화면 시험(캔바1 크롬 연결 필요)

## 작업 원칙(사용자 선호)
- 사용자 보고는 한국어, 마크다운 기호(**, `) 없이 구분선·아이콘으로
- 연수용이 아닌 프로젝트 동작은 바꾸지 않음, 바꾸면 되돌림 지점 남기기
- 반드시 지킬 동작은 프롬프트가 아니라 코드로
