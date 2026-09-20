# Jev 이전 상태로 되돌리기 (no-jev)

`no-jev` 브랜치 = 2026-09-19 작업 종료 시점 코드(Jev 코드 없음) + 앱 동작과 무관한 배포 가속·검증 스크립트 수정만 포함.
2026-09-20 별도 폴더에서 `npm ci` → `npm run build` 통과 확인.

## 절차
1. `git switch no-jev` (또는 `git checkout no-jev`)
2. `.env.local` 확인 — `OPENAI_CHAT_MODEL=gpt-5-mini` 로 되돌리기
   (no-jev 코드는 `reasoning_effort: 'minimal'` 하드코딩이라 Luna(`gpt-5.6-luna`)와 조합하면 400 오류)
   `TYPESAFE_API_KEY` 는 남아 있어도 무방 (no-jev 코드는 읽지 않음)
3. `firebase deploy --only hosting` (약 4분)

## 되돌아가지 않는 것
- Firestore 에 저장된 분석 시트 행·산출물(데이터). 해당 프로젝트에서 "AI 자동 채우기"를 다시 돌리면 이전 방식 결과로 덮어써짐.

## 다시 Jev 상태로
`git switch main` (= `jev` 브랜치) → `.env.local` 의 모델 설정 복원 → 배포.

## 태그
- `pre-jev-integration` 비교 페이지만 있고 앱 흐름 미변경
- `jev-integration-pre-deploy` / `jev-integration-deployed` 자동 채우기 Jev 전환 전/후(라이브 배포 시점)
- `jev-graph-dedupe` 그래프 중복 문장 정리 · `jev-lesson-examples` 수업 예시 전환
