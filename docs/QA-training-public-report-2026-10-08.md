# 연수 기록·공개 보고서 개선 검증 (2026-10-08)

## 변경

- 연수 기록은 글 입력만 제공한다. 기존 문자열·표·구조화 자료의 읽기 변환과 저장 형식은 유지한다.
- 저장된 연수 기록에는 `저장됨`을 표시하고 별도 확정/확정 취소 버튼을 제거한다. 연수용 다음 단계 동작은 추가 확정 쓰기와 정식 모드 필수 섹션 검사를 반복하지 않는다. 일반·핵심 정식 활동의 확정 경로는 유지한다.
- 빈 입력란에 임시 입력 후 모두 지운 경우도 미저장 수정으로 남아 AI 저장값 반영을 막던 현상을 실제 브라우저에서 재현했다. 서버 기준값과 실제 입력 차이로 수정 상태를 판단한다. 충돌하는 미저장 글은 유지하고 저장본 불러오기를 제공한다.
- 공개 링크의 별도 구형 Markdown 렌더러를 제거하고 내부 보고서의 `ReportMarkdown`과 인쇄 스타일을 재사용한다. 단계/최종 보고서와 기존 공개 스냅샷을 읽으며 비공개 프로젝트나 산출물 통계를 추가로 조회하지 않는다.
- 부록을 활동별 제목·하위 항목으로 구분하며 활동 아이콘과 명확한 표 선을 적용한다. 화면과 인쇄에서 같은 구성 요소를 사용한다.

## 브라우저 검증

실제 React 컴포넌트와 모의 저장·프로젝트 업데이트를 이용했다. Firebase, 로그인, 실제 공개/삭제 작업은 호출하지 않았다.

- Chromium 1400px/390px: 공개 단계·최종 탭, URL 해시, 공유 링크 복사, 인쇄 버튼, 본문·부록·아이콘, 화면 넘침 없음.
- 인쇄 매체: 모든 보고서와 구조 포함, 화면용 중복 본문 숨김, 표 스크롤 높이 해제, 넓은 표의 카드 출력.
- 연수 T-3/T-4: 저장 후 다음 활동, 별도 확정 없음, 글 입력만 노출, 저장 상태와 피드백.
- AI 저장 동기화: 입력 후 모두 지운 칸에 새 저장값 반영, 실제 미저장 글 유지, 저장본 불러오기, 동일 저장본 중복 쓰기 없음.

증거 경로:

- `/private/tmp/tcid-lead-browser/public-report-before.png`
- `/private/tmp/tcid-lead-browser/public-report-1400.png`
- `/private/tmp/tcid-lead-browser/public-report-390.png`
- `/private/tmp/tcid-lead-browser/public-report-print.pdf`
- `/private/tmp/tcid-lead-browser/training-text-only.png`
- `/private/tmp/tcid-lead-browser/training-ai-synced.png`
- `/tmp/astra-public-report-browser.txt`
- `/tmp/astra-training-ai-sync-before.txt` (수정 전 재현 실패)
- `/tmp/astra-training-ai-sync-after.txt` (수정 후 통과)

## 자동 검사

- 공용 렌더러 결과와 공개 보고서 HTML 동일 여부, 공개 스냅샷 불변성, 인쇄 전체 보고서 포함 검사.
- 연수 저장/일반 모드 확정 경로, 기존 문자열 보존, 임시 입력 되돌리기·동시 저장·미저장 글 충돌 및 선택적 불러오기 검사.
- 전체 테스트 1,019개: 1,017 통과, 환경 의존 2개 건너뜀, 실패 0 (`/tmp/astra-final-report-training-tests.txt`).
- 타입 검사 오류 0, ESLint 오류 0·기존 경고 28.
- 핵심아이디어 오른쪽 복사 버튼은 해당 문장만 한 줄로 복사한다. 성공 status/실패 alert, 채팅 삽입과 분리, 중복 클릭 보호 및 기존 검색/교과 필터를 확인했다.
- 최종 통합 테스트 1,023개: 1,021 통과, 환경 의존 2개 건너뜀, 실패 0 (`/tmp/astra-report-training-copy-tests.txt`).
- 핵심아이디어 복사 브라우저 390px/1400px: 단일 문장 복사, 성공/실패 안내, 독립 채팅 삽입, 44px 버튼, 중첩 버튼 없음. 로그 `/tmp/astra-coreidea-copy-browser.txt`, 화면 `/private/tmp/tcid-lead-browser/coreidea-copy-390.png`, `/private/tmp/tcid-lead-browser/coreidea-copy-1400.png`.
