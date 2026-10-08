# 선택 답변·응답 중복·산출물 진입 검증 (2026-10-08)

## 변경

- 마지막 AI 응답의 명확한 2~4개 대안을 동등한 답변 버튼으로 표시한다. 선택은 해당 문구를 일반 사용자 메시지로 보내며, 직접 입력은 작성 중인 글을 유지하고 입력창으로 초점을 옮긴다. 저장·확정·이동 요청, 예시, 코드, 기존 행동 카드는 일반 선택 버튼에서 제외한다.
- 다른 팀원의 AI 응답이 진행 중이면 새 질문은 기존 대기열에서 기다린다. 재시도는 원래 메시지를 보존한 채 대기 안내로 막는다. 앞선 답이 도착한 뒤 새 대화 맥락으로 보낸다.
- 일반 전송·직접 전송·팀 토의 분석의 AI 답 저장과 요청자 스트리밍 상태 삭제를 한 Firestore batch로 처리한다. 응답 메시지 ID로 최종 답이 이미 도착했는지 판단해 늦게 남는 임시 말풍선을 숨긴다. 실패는 안내하고 스트리밍 상태를 정리한다.
- 일반 모드의 빈 산출물에서 공동 편집으로 진입하며, 활동이 다르거나 연수용이면 열지 않는다. 기존 직접 입력 경로를 유지한다.
- 보고서의 넓은 표도 카드로 변환하지 않고 화면·인쇄 모두 일반 표로 표시한다. 넓은 인쇄 표는 더 작은 글자와 여백을 사용한다.

## 검증 결과

전체 테스트 1,052개 중 1,050개 통과, 환경 조건 skip 2개, 실패 0개. TypeScript 오류 0개, ESLint src 오류 0개·기존 경고 28개. git diff --check 통과.

## 검증 범위

실제 ChatPanel 전송 함수와 대기열 effect를 추출한 두 클라이언트 테스트, 실제 Firestore 쓰기 함수의 mock batch 검사, 실제 React 컴포넌트/렌더 조건을 사용하는 독립 브라우저 fixture를 사용했다. 로그인 및 운영 Firestore 쓰기는 하지 않았다.

브라우저 390px·1400px: 선택 버튼 44px 이상, 중복 클릭 1회 전송, 직접 입력 초점·작성 글 유지, 실패 안내와 재시도, 저장 답 수신 직후 임시 응답 제거, 뒤따르는 새 응답 표시·오류 정리를 확인했다. 빈 산출물은 390px·1200px에서 해당 활동 공동 편집 요청을 확인하고, 연수용에는 진입 버튼이 없음을 확인했다.

공개 보고서는 390px·1400px에서 공용 보고서 스타일·부록·공유/인쇄 버튼을 확인했다. 인쇄에서 7열 표의 머리글과 행이 표 형태를 유지하고 전체 탭과 내용이 포함됨을 확인했다.

## 증거

- `/tmp/astra-reply-duplicate-tests-final.txt`
- `/tmp/astra-reply-duplicate-tsc-final.txt`
- `/tmp/astra-reply-duplicate-eslint-final.json`
- `/tmp/astra-reply-choices-browser-final.txt`
- `/tmp/astra-public-report-browser-final.txt`
- `/private/tmp/tcid-lead-browser/reply-choices-390.png`
- `/private/tmp/tcid-lead-browser/reply-choices-1400.png`
- `/private/tmp/tcid-lead-browser/remote-response-saved-390.png`
- `/private/tmp/tcid-lead-browser/artifact-empty-coedit-390.png`
- `/private/tmp/tcid-lead-browser/public-report-print.pdf`

## 한계

응답 대기는 클라이언트가 수신한 공유 스트리밍 상태를 기준으로 한다. 두 사용자가 공유 상태를 받기 전 같은 순간에 전송하는 경합까지 직렬화하는 서버 잠금은 이번 범위에 포함하지 않았다. 테스트는 실시간 전송 계층을 mock으로 대체했다.
