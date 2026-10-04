# 브랜치·운영 인수인계 (2026-10-04, 다른 세션/cmux 용)

## 한 줄 요약
운영(togethertr.web.app)은 `fix/2026-10-03-team-test`(c6664e88)에서 배포됐다. 메인 작업 폴더의 `codex/2026-09-21-grade-bands` 에는 이 커밋들(43개+)이 없다. 메인 폴더 그대로 배포하면 아래 기능이 운영에서 사라진다.

## 브랜치
- `fix/2026-10-03-team-test` — 운영 기준. 3인 페르소나 테스트 결함 수정, 데모·워크숍 MD3(deploy/2026-10-03-md3-callout 병합 포함), 보고서 대시보드·PDF 다운로드, 저장 관문, 워크숍 맥락, 온톨로지 개편 등.
- `feat/training-mode` — 연수용 모드 개발(위 브랜치에서 분기). 명세: docs/training-mode-spec.md
- 태그 `pre-training-mode-2026-10-04` — 연수용 모드 작업 전 되돌림 지점.

## 작업 위치
- 이 세션(Claude 총괄)은 `~/tcid-work/fix-team-test` worktree 에서 작업한다(/tmp 는 재부팅 시 비워짐).
- 메인 폴더(`~/tcid-agent`)는 다른 세션 작업 중이라 건드리지 않는다.

## 배포 규칙
- 배포 전 `git merge-base --is-ancestor <운영 커밋> HEAD` 로 운영 최신이 포함됐는지 확인.
- `npm_config_cache=/tmp/tcid-npm-cache npm run sync:runtime-assets && npm run verify:curriculum && firebase deploy --only hosting --project togethertr --account jammanbogem@gmail.com` (샌드박스 밖, UUID 없는 경로).

## 합치기 계획
연수(10/9~10) 뒤, 메인 폴더 작업이 커밋되면 `fix/2026-10-03-team-test`(+ `feat/training-mode`)를 메인 브랜치에 병합. 충돌 예상 파일: src/components/chat/ChatPanel.tsx, src/lib/prompts/system.ts, src/app/api/chat/stream/route.ts. 연수용 모드가 바꾼 파일 목록은 docs/training-mode-spec.md 끝에 갱신한다.
