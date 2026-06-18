# 06. 보안 감사 (security-auditor)

> 소유자: `security-auditor` | 작성일: 2026-05-14 | 상태: 작업 전

## 검증 범위
- **Firebase Auth** 도입 상태, `demo-user` 임시 인증의 위험도
- **`firestore.rules`** — `allow read, write: if true` 잔존 여부 + 컬렉션별 명시 규칙 + auth.uid 기반 권한
- **`storage.rules`** — 업로드 권한·MIME 검증·크기 제한
- **시크릿 관리** — `.env` 노출, 클라이언트 번들 안의 API 키 (OPENAI/ANTHROPIC), Firebase 설정 노출 적정성
- **OWASP Top 10** — XSS (react-markdown 처리), SSRF (서버 fetch), Open Redirect, Insecure Deserialization
- **CSRF** — API Route 보호
- **PII** — 학생 데이터·교사 이메일 저장 적정성, 로깅 누출
- **CORS/CSP** — Next.js 설정
- **종속성 취약점** — `package-lock.json` 알려진 CVE
- **클라이언트 입력 검증** — Zod 등 스키마 검증 부재 영역

## 기준(spec)
- OWASP Top 10 2021
- Firebase Security Rules best practices
- Next.js 16 보안 가이드
- 09.Firebase데이터모델.md Security Rules 섹션

## 현재 구현 상태
_TBD by security-auditor — 모든 주장은 file:line 인용_

## 정합성 판정
| 항목 | 판정 | 증거 | 비고 |
|---|---|---|---|
| _TBD_ | | | |

## 리스크 (P0/P1/P2)
🚨 마커는 즉시 위험 → P0 자동 승격
_TBD_

## 권장 조치
_TBD_
