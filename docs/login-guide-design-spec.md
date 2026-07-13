# `/login` 안내형 로그인 페이지 — 디자인 명세서

> 코딩 에이전트는 이 문서만으로 구현 가능해야 함. 브리프(`docs/login-guide-brief.md`)의 **절대 제약**을 모두 전제로 한다.
> 핵심: 로그인 카드의 **로직·상태·필드·단계는 무변경**(시각 재배치만 허용), `globals.css`는 **append만**, `layout.tsx`·`auth.ts`·라우트 **무변경**.

---

## 0. 디자인 콘셉트 요약

| 항목 | 결정 |
|------|------|
| 톤 | 교사 대상 · 따뜻함 · 협력 · 차분한 신뢰. 화려한 SaaS가 아니라 "잘 만든 교사용 안내서" 느낌 |
| 메타포 | **농사·텃밭** — 밭을 일구고(T) → 씨앗을 고르고(A) → 텃밭을 그리고(Ds) → 꽃을 피우고(DI) → 열매를 거두는(E) 흐름. STAGES의 실제 description을 그대로 헤드라인/서브라인으로 사용 |
| 시각 언어 | Google Material 베이스(Noto Sans KR) + **명조 디스플레이 폰트(Gowun Batang)로 헤드라인만** 대비. 파스텔 단계색 5종, 부드러운 코너 그라데이션(project-card) 재사용 |
| UX 제1원칙 | "설명을 읽지 않고도 즉시 로그인" — 로그인 카드를 Hero 우측(데스크톱)·헤더 직하(모바일)에 항시 노출 |

---

## 1. 디스플레이 폰트 확정 — **Gowun Batang (고운바탕)**

### 결정
- **폰트**: `Gowun Batang` (Google Fonts, 윤디자인 계열 부드러운 명조)
- **적용 범위**: **헤드라인 전용** — Hero h1, 각 섹션 h2 제목, 단계 카드 메타포 문장, 최종 CTA 제목. **오버라인·본문·칩·버튼은 기존 Noto Sans KR 유지**(명조/고딕 대비로 위계 강조).
- **weight**: `400`, `700` (이 폰트가 제공하는 전 weight. 대형 헤드라인은 700, 메타포 문장은 400).

### 선정 근거
1. **한글 지원 확인됨** — Google Fonts `subset=korean`에서 400/700 정상 응답(검증 완료). 이 저장소가 이미 `next/font/google`로 Noto Sans KR을 `subsets: ["latin"]`으로 로드해 한글이 정상 렌더되므로, **동일 패턴을 그대로 재사용**하면 빌드 안전이 보장된다.
2. **톤 적합성** — "고운바탕"이라는 이름 그대로 부드러운 세리프. 고딕 기반 UI에 명조 헤드라인을 얹으면 *editorial·이야기가 있는* 질감이 생겨 **따뜻함 + 텃밭 스토리텔링**과 맞다. 아이보리한 세리프가 교사 대상 신뢰감을 준다.
3. **대비 효과** — 본문(Noto Sans)과 헤드라인(명조)의 서체 대비만으로 위계가 서므로, 무게(font-weight)를 과하게 쓰지 않아도 시각적 리듬이 생긴다(700로도 충분히 우아).

### 대안(불채택, 참고용)
- `Nanum Myeongjo` (400/700/800) — 800로 더 강한 헤드라인 가능하나 다소 딱딱함. Gowun Batang이 더 부드러움.
- `Gowun Dodum` (고딕, 400만) — 본문톤과 겹쳐 대비가 약함.

### 구현 스니펫 (LoginCard가 아닌 `page.tsx` 또는 전용 모듈 스코프 상수)
```ts
// src/app/(auth)/login/landing/fonts.ts (신규 파일)
import { Gowun_Batang } from 'next/font/google'

// 저장소의 Noto 패턴과 동일: subsets latin + weight 배열(가변폰트 아님 → weight 필수).
// 한글 글리프는 unicode-range로 자동 포함(Noto와 동일 방식, 빌드 검증됨).
export const gowunBatang = Gowun_Batang({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-gowun',
  display: 'swap',
})
```
- 적용: `page.tsx`의 최상위 래퍼 `<div className={gowunBatang.variable}>`에 부여 → CSS 변수가 자식 전체로 캐스케이드(`layout.tsx`/`html` 무수정).
- 사용: 아래 §4에서 정의하는 `.font-display` 유틸(globals.css append)로 `font-family: var(--font-gowun)` 적용.

---

## 2. 페이지 골격

### 섹션 순서 · 앵커 id
| # | 섹션 | id | 배경 | 좌우 배치 |
|---|------|----|------|-----------|
| 0 | 고정 상단 네비 | — (`<nav>`) | 투명→스크롤 시 흰색+그림자 | — |
| 1 | **Hero + 로그인 카드** | `#login` | 로그인 그라데이션 | 좌 카피 / 우 로그인 카드 |
| 2 | 4단계 시작 (START) | `#start` | 흰색 | 지그재그 2열 |
| 3 | 5과정 워크플로우 (WORKFLOW) | `#workflow` | 옅은 그라데이션(#FFF→#F8F9FA) | 5 단계 카드 그리드 + 하단 플로우 |
| 4 | AI 퍼실리테이터 (AI) | `#ai` | 흰색 | 좌 4역할 카드 / 우 채팅 목업 |
| 5 | 협력 UP 5원리 (PRINCIPLES) | `#principles` | 옅은 틴트(#F8F9FA) | 태그 5개 + 원리 패널 |
| 6 | 협업·산출물·보고서 (COLLABORATION) | `#collab` | 흰색 | 좌 체크리스트 / 우 목업 |
| 7 | FAQ | `#faq` | #F8F9FA | 아코디언(native `<details>`) |
| 8 | 최종 CTA | `#cta` | 강한 그라데이션(#E8F0FE→#F3E5F5) | 중앙 정렬 |
| 9 | 푸터 | — (`<footer>`) | #F1F3F4 | — |

- **FAQ 포함 결정**: 포함. 단, JS 상태 없이 **native `<details>/<summary>`** 로 구현(접근성·무의존·경량). 교사 대상 신뢰 형성(비용·초대·개인정보 질문)에 효과.

### 상단 고정 네비 구성
```
[좌] morph-shape 블롭 로고(소형, BookOpen 20px) + "T-CID 협력 수업설계"(15px, 700)
[우·데스크톱] 앵커 링크: 소개 · 5단계 · AI · 협력 원리     [primary 버튼] "바로 로그인"
[우·모바일] [primary 버튼] "바로 로그인" 만 노출 (앵커 링크 숨김)
```
- 고정: `sticky top-0 z-50`, 높이 `h-14`(56px), 좌우 패딩 `px-4 md:px-8`.
- **스크롤 상태**: 최상단에선 `bg-transparent`, Hero를 벗어나면 `bg-white/85 backdrop-blur-md` + `shadow-1`. → `LandingNav.tsx`(client)에서 1px sentinel + IntersectionObserver로 `scrolled` 토글.
- **"바로 로그인" 버튼**: `<a href="#login">` — native 앵커 이동. 스킵 동선 겸용(§8). primary 스타일(#1A73E8 배경, 흰 텍스트, `rounded-full px-4 py-2 text-[13px] font-bold`).
- 앵커 링크: `<a href="#workflow">` 등, `text-[13px] font-semibold text-[#5F6368] hover:text-[#1A73E8]`.

---

## 3. 섹션별 상세

> 공통 컨테이너: `max-w-[1120px] mx-auto px-5 md:px-8`. 섹션 상하 패딩 `py-16 md:py-24`.
> 공통 오버라인 패턴: `<p class="overline">WORKFLOW</p>` → 그 아래 `<h2 class="font-display …">한글 제목</h2>` → 서브카피 → 콘텐츠.

### 3-1. Hero + 로그인 카드 (`#login`)

**레이아웃**
- 데스크톱(≥1024): CSS Grid 2열 `grid-cols-[1fr_minmax(360px,420px)] gap-12 items-center`. 좌=카피, 우=로그인 카드.
- 태블릿(768–1023): 2열 유지하되 `gap-8`, 카드 `max-w-[380px]`.
- 모바일(<768): 1열. **순서: 헤드라인 → 로그인 카드 → 서브카피·신뢰 칩**(카드를 상단 근처에 노출, §7 참조).
- 배경: 로그인 그라데이션 `linear-gradient(135deg,#EAF2FF 0%,#F8F9FA 50%,#F3E5F5 100%)` + 기존 배경 장식 원 2개(현재 `page.tsx` 88~99행의 radial blob 그대로 이식, `fixed`→`absolute`로 섹션 내부 한정).
- 상하 패딩 `pt-24 pb-16 md:pt-28 md:pb-24` (고정 네비 높이 보정).

**한국어 카피 전문**
- 오버라인: `함께 만드는 수업 설계`
- h1 (font-display, 700): **함께 밭을 일구듯,\n동료와 짓는 수업 설계**
  (줄바꿈은 `<br class="hidden md:block"/>` — 모바일 자연 흐름)
- 서브카피(Noto, 16–17px): `T-CID 다섯 단계를 따라, 동료 교사들이 한 팀이 되어 한 학기 수업을 함께 설계합니다. AI 퍼실리테이터가 활동마다 절차를 안내하고, 초안을 제안하고, 정합성을 점검합니다.`
- 신뢰 칩 3개(카드 아래 또는 카피 아래, 가로 나열):
  `Google 계정으로 바로 시작` · `초대 코드로 팀 참여` · `실시간 공동 편집`
  (각 칩: lucide 아이콘 14px + 텍스트 12px. 아이콘: `LogIn` / `Users` / `RefreshCw`)
- 스크롤 큐(선택, 데스크톱만): 하단 중앙 `아래로 내려 살펴보기` + `ChevronDown`(기존 `chevron-flow` 키프레임 재사용 가능).

**로그인 카드 재사용 (핵심)**
- 현재 `page.tsx`의 `<div className="w-full max-w-sm relative">…</div>` 전체(로고 블롭 + 카드 + 하단 안내문)를 **`LoginCard.tsx`로 verbatim 이식**. 핸들러(`handleGoogleLogin`/`handleCompleteProfile`), 상태(`step`, `firebaseUser`, `isLoading`, `error`, 폼 4필드), Google SVG, 프로필 폼 **한 글자도 변경 금지**.
- Hero 배치용 prop 추가만 허용: `showBrand?: boolean`(기본 true).
  - `showBrand={false}` → 카드 위 대형 로고 블롭 + "T-CID 협력 수업설계" h1 블록(현재 102~115행)을 **렌더하지 않음**(Hero 좌측이 이미 h1을 담당 → 중복 h1 방지). 카드 본문("시작하기"/프로필 단계)은 그대로.
  - 이는 "시각 재배치"에 해당하며 로직 무변경 조건을 만족.
- Hero 우측에서 카드는 `md-shadow-3`로 살짝 떠 보이게, `project-card` 코너 변수는 현재 값 유지.

**사용 클래스/토큰**: 로그인 그라데이션, `project-card`, `morph-shape`+`stage-bounce`(로고), `morph-btn`(프로필 CTA), `md-shadow-3`, `.font-display`(h1), `.overline`(오버라인).

---

### 3-2. 4단계 시작 (`#start`)

**레이아웃**: 상단 오버라인+제목 중앙 정렬 → 아래 4단계를 **지그재그 2열**(데스크톱). 각 스텝 = 좌(번호 원형 뱃지 + 제목 + 설명) / 우(브라우저 목업), 홀짝 교차. 모바일 1열(목업은 텍스트 아래).

**카피 전문**
- 오버라인: `START`
- h2 (font-display): `네 걸음이면, 팀이 움직입니다`
- 서브카피: `로그인부터 첫 설계 활동까지, 준비는 간단합니다.`

| 단계 | 번호 뱃지 | 제목 | 설명(실제 기능 근거) | lucide 아이콘 | 목업 |
|------|-----------|------|----------------------|---------------|------|
| 1 | 01 | **로그인하고 프로필 만들기** | Google 계정으로 로그인한 뒤, 이름·학교급·학교명·담당 학년을 입력합니다. | `LogIn` | 로그인 카드 축소 목업(Google 버튼 1개) |
| 2 | 02 | **팀 만들고 동료 초대하기** | 방장이 팀을 만들면 **초대 코드**가 생깁니다. 동료는 코드로 참여하고, 방장이 진행을 제어합니다. | `Users` | 초대 코드 칩(예: `T-CID · 8자리`) + 팀원 아바타 3개 목업 |
| 3 | 03 | **프로젝트 시작하기** | 학교급·학년군·교과·학기를 정해 협력 프로젝트를 만듭니다. | `FolderPlus` | 프로젝트 카드(제목 + 교과 태그) 목업 |
| 4 | 04 | **AI와 함께 설계하기** | T→A→Ds→DI→E 흐름을 AI 퍼실리테이터와 단계별로 진행합니다. | `Sparkles` | 채팅 1왕복(사용자→AI) 미니 목업 |

- 번호 뱃지: 원형 `w-11 h-11 rounded-full`, 배경 `#E8F0FE`, 텍스트 `#1558D6` 700 15px.
- 스텝 간 연결선(데스크톱): 뱃지 사이 세로 점선 `border-l border-dashed #DADCE0`(선택).

**목업(브라우저 프레임) 규격** — 레퍼런스 신호등 헤더 차용:
```
카드: bg-white rounded-2xl border border-[#E8EAED] md-shadow-2 overflow-hidden
헤더: h-8 bg-[#F1F3F4] flex items-center gap-1.5 px-3
      · 신호등 3점: w-2.5 h-2.5 rounded-full  #EF9A9A / #FDE293 / #A8DAB5 (순서대로)
본문: p-4, 스텝별 내용(위 표)
```
- 목업은 전부 장식 → 컨테이너에 `aria-hidden="true"`.

**배경**: 흰색.

---

### 3-3. 5과정 워크플로우 (`#workflow`)

**레이아웃**
- 오버라인+제목 중앙 → **5개 단계 카드**. 데스크톱: `grid grid-cols-2 lg:grid-cols-3 gap-5`(카드 5개 → 3+2 배치, 마지막 카드 폭 자연 배치). 또는 상단 3 / 하단 2 명시 배치. 태블릿 2열, 모바일 1열.
- 카드 하단(전체 폭)에 **T→A→Ds→DI→E 원형 플로우 바** + **E→T "다음 주기" 곡선 화살표**.

**카피 전문**
- 오버라인: `WORKFLOW`
- h2 (font-display): `다섯 시간의 흐름, 열아홉 개의 활동`
  (⚠️ 실측 근거: STAGES 5개, 활동 합계 = T5 + A5 + Ds5 + DI2 + E2 = **19개**. 레퍼런스의 "18개"가 아닌 우리 서비스 실값 사용. A-5 학습자·맥락 분석은 앱 고유 활동.)
- 서브카피: `밭을 일구는 일부터 열매를 거두는 일까지. 각 단계 안에서 세부 활동을 하나씩 함께 완성합니다.`

**단계 카드 5종** — 헤드라인 메타포는 STAGES의 실제 description, 활동 칩은 `ACTIVITY_DISPLAY_CODE`(표시 번호) + `ACTIVITY_META.label`(라벨) 전량 사용. 색은 `stageColors.ts`(§5).

카드 공통 구조:
```
카드: rounded-2xl border p-5, 배경=단계 light, 보더=단계 border
헤더: 좌 단계 이니셜 뱃지(원형, 배경=단계 hex, 흰 텍스트, 700) + 단계 라벨(단계 doneText 색, 700 15px)
      우: 활동 개수 pill (예: "5개 활동", 단계 hex 텍스트 12px)
메타포: font-display 400, 14–15px, 단계 doneText 색  ← STAGES.description
칩 목록: flex flex-wrap gap-1.5, 각 칩 = [단계색 점 6px] + "표시번호 · 라벨"
```

**T · 팀준비** (색 T=파랑) — 메타포 `협력의 밭을 일구는 시간`
- `T-1 · 공동 비전 설정`
- `T-2 · 수업설계 방향 설정`
- `T-3 · 역할 배분`
- `T-4 · 팀 규칙 결정`
- `T-5 · 팀 일정 결정`

**A · 분석** (색 A=보라) — 메타포 `우리 땅을 살피고 씨앗을 고르는 시간`
- `A-1 · 주제 선정 기준 논의·조정`
- `A-2 · 비전 기반 주제 선정`
- `A-3 · 주제 상세 분석·성취기준 재구조화`
- `A-4 · 통합 수업목표 진술`
- `A-5 · 학습자·맥락 분석`

**Ds · 설계** (색 Ds=청록) — 메타포 `배움의 텃밭을 함께 그려가는 시간`
- `Ds-1 · 평가 설계`  *(백워드 디자인 — 평가 먼저)*
- `Ds-2 · 문제 상황 설정`
- `Ds-3 · 학습활동 설계`
- `Ds-4 · 자료와 도구 연결`
- `Ds-5 · 스캐폴딩 설계`

**DI · 개발·실행** (색 DI=주황) — 메타포 `우리의 협력이 꽃피우는 시간`
- `DI-1 · 자료 탐색·개발`
- `DI-2 · 수업 실행·기록`

**E · 평가** (색 E=빨강) — 메타포 `우리의 열매를 거두는 시간`
- `E-1 · 수업 성찰과 공동 개선`
- `E-2 · 협력 과정 성찰`

> Ds-1 옆 `평가 먼저` 미니 뱃지(Backward Design, `ACTIVITY_META['Ds-1-1'].isBackwardDesignFirst`)와 A-5 옆 `앱 고유`/`분석 기반` 톤은 선택. 과장 없이 사실만.

**하단 플로우 바**
```
[T]→[A]→[Ds]→[DI]→[E]  각 노드=단계 hex 원형 점(w-3 h-3) + 라벨(11px, 단계 doneText)
화살표=chevron(ChevronRight 14px, #9AA0A6)
E 오른쪽에서 T로 되돌아오는 곡선 화살표 + 라벨 "다음 주기" (E→T 순환, 실제 isECompleted 트리거 근거)
```
- 곡선 화살표는 인라인 SVG path(장식, `aria-hidden`). 색 `#9AA0A6`, "다음 주기" 라벨 11px `#5F6368`.

**모션**: 각 단계 카드 `Reveal` 스태거(80ms 간격). 플로우 점은 정적(과도한 모션 금지).

**배경**: `linear-gradient(180deg,#FFFFFF 0%,#F8F9FA 100%)`.

---

### 3-4. AI 퍼실리테이터 (`#ai`)

**레이아웃**: 데스크톱 2열 `lg:grid-cols-2 gap-10 items-center`. 좌=오버라인+제목+서브카피+4역할 카드(2×2), 우=채팅 목업. 모바일 1열(목업 아래).

**카피 전문**
- 오버라인: `AI FACILITATOR`
- h2 (font-display): `곁에서 함께 설계하는 AI 퍼실리테이터`
- 서브카피: `AI는 정답을 대신 정해주지 않습니다. 팀이 스스로 결정하도록 절차를 안내하고, 초안을 제안하고, 놓친 부분을 짚어줍니다.`

**AI가 하는 네 가지 일 (2×2 카드)** — 실제 기능(활동별 절차 안내 / 산출물 초안 A·B안 / 정합성 점검 / 대화·기록)에 근거. 레퍼런스의 "역할 선택 기능"은 우리 앱에 확인되지 않으므로 **역할 선택 UI가 아니라 'AI가 하는 일' 4종**으로 제시.

| 이모지 | 제목 | 설명 |
|--------|------|------|
| 📌 | **절차 안내** | 활동마다 무엇을 어떤 순서로 정하면 되는지 단계별로 안내합니다. |
| ✍️ | **초안 제안** | 비전·규칙·평가 등 산출물의 A안·B안 초안을 제안해 논의의 출발점을 만듭니다. |
| 🔍 | **정합성 점검** | 앞 단계에서 정한 비전·목표와 어긋나는 부분이나 빠진 항목을 짚어줍니다. |
| 📝 | **대화·기록** | 팀 토의를 제안하고, 이름을 부르며 개인별로 피드백해 논의를 기록으로 남깁니다. |

- 카드: `rounded-2xl border border-[#E8EAED] bg-white p-4 md-shadow-1`, 이모지 24px, 제목 14px 700, 설명 13px `#5F6368`.

**채팅 목업(우)** — 레퍼런스 방식 경량 CSS:
```
프레임: rounded-2xl border border-[#E8EAED] bg-[#F8F9FA] p-4 md-shadow-2 (aria-hidden)
① 사용자 말풍선(우측 정렬): bg-[#1A73E8] 흰 텍스트 rounded-2xl, 예: "저는 '스스로 질문하는 아이'가 우리 반 비전이에요."
② AI 응답(좌측 정렬): bg-white 보더 rounded-2xl, 예:
   "좋아요. 세 분의 키워드를 모으면 이런 팀 공통 비전 초안을 만들 수 있어요."
   + 초안 인용 블록(border-left #AECBFA) "함께 질문하고, 스스로 답을 찾아가는 교실"
③ 액션 버튼 3개(pill): [이 안으로]  [조금 수정]  [다른 안 보기]
   (실제 A안/B안·수정 흐름 은유. 색: primary / outline / ghost)
```
- 말풍선 등장에 `msg-slide-in` 키프레임 재사용 가능(Reveal 내부에서 1회).

**배경**: 흰색.

---

### 3-5. 협력 UP 5원리 (`#principles`)

**레이아웃**: 오버라인+제목 중앙 → **5개 태그(가로 wrap)** → 그 아래 원리 설명 패널(카드 그리드 또는 아코디언). 데스크톱: 태그 한 줄, 패널 `grid grid-cols-1 md:grid-cols-5 gap-3`(각 원리 미니 카드). 모바일 1~2열.

**카피 전문**
- 오버라인: `PRINCIPLES`
- h2 (font-display): `협력이 살아나는 다섯 가지 원리`
- 서브카피: `AI 퍼실리테이터는 이 다섯 원리를 기준으로 팀의 협력을 북돋웁니다.`

**5원리 태그 + 짧은 글로스** (해시태그는 실제 명칭, 글로스는 CSCL 통용 의미로 절제):

| 태그 | 한 줄 설명 |
|------|-----------|
| `#활성화` | 모두가 입을 열도록 참여를 이끌어냅니다. |
| `#외현화` | 머릿속 생각을 말과 글로 꺼내 눈에 보이게 합니다. |
| `#조정` | 서로 다른 의견을 맞추고 역할을 나눕니다. |
| `#상호의존` | 서로에게 기대는 구조로 함께 완성합니다. |
| `#인지분산` | 부담이 한 사람에게 쏠리지 않게 나눕니다. |

- 태그 pill: `rounded-full px-3.5 py-1.5 text-[13px] font-bold`, 배경 `#E8F0FE`, 텍스트 `#1558D6`. hover 시 배경 살짝 진하게.
- 원리 미니 카드: 번호(01~05) + 태그명 + 설명. 5색을 순서대로 은은히 매핑(태그별 좌측 보더를 T→A→Ds→DI→E 색으로) 하거나 통일 primary. **권장: 통일 primary 톤**(5원리는 단계색과 무관하므로 단계색 오남용 방지).

**배경**: `#F8F9FA`.

---

### 3-6. 협업·산출물·보고서 (`#collab`)

**레이아웃**: 데스크톱 2열 `lg:grid-cols-2 gap-10 items-center`. 좌=오버라인+제목+서브카피+체크리스트, 우=목업(3층 스택 또는 탭 느낌 카드). 모바일 1열.

**카피 전문**
- 오버라인: `COLLABORATION`
- h2 (font-display): `같은 화면에서, 함께 쌓는 산출물`
- 서브카피: `채팅·산출물·활동 상태가 실시간으로 동기화됩니다. 논의한 내용은 그대로 기록과 보고서로 남습니다.`

**체크리스트 (lucide `Check` 원형 뱃지 + 문구)** — 실제 기능 근거:
- `실시간 동기화` — 채팅·산출물·활동 상태를 팀원 모두가 같은 화면에서 봅니다.
- `12종 공동 편집 워크스페이스` — 비전·규칙·일정·평가·문제상황 등 산출물을 표와 블록으로 함께 편집합니다. *(types의 워크스페이스 12종 실측 근거)*
- `지식 그래프` — 성취기준을 탐색하고 중심 교과를 고정해 분석에 연결합니다. *(A-3 연동)*
- `단계·종합 보고서` — 단계별 분석 보고서와 누적 종합 보고서를 만들고, HWPX·PDF로 내보내거나 공개 링크로 공유합니다.

**목업(우)** — 3개 미니 카드 스택(장식, `aria-hidden`):
1. 산출물 패널 카드: "T-1 · 공동 비전 설정" 제목 + 확정 뱃지(`확정됨`, 초록 `#E6F4EA`/`#34A853`) + 섹션 2줄. (`artifact-section-flash` 톤 인용은 정적으로)
2. 지식 그래프 카드: 노드 3~4개를 잇는 인라인 SVG(중심 노드 강조) + "성취기준" 라벨.
3. 보고서 카드: 문서 라인 목업 + `HWPX` `PDF` `공유 링크` 3개 pill.

**배경**: 흰색.

---

### 3-7. FAQ (`#faq`)

**레이아웃**: 오버라인+제목 중앙 → `max-w-[720px] mx-auto` 세로 `<details>` 목록. 각 항목 `border-b border-[#E8EAED]`, `<summary>` 클릭 시 펼침.

**카피 전문**
- 오버라인: `FAQ`
- h2 (font-display): `자주 묻는 질문`

| 질문(summary) | 답변 |
|----------------|------|
| 혼자서도 쓸 수 있나요? | 팀 협력이 기본이지만, 혼자 설계하는 방식도 지원합니다. 팀을 만들면 초대 코드로 동료를 부를 수 있습니다. |
| 초등학교만 되나요? | 초·중·고 모두 지원합니다. 프로필과 프로젝트에서 학교급을 고를 수 있습니다. |
| 만든 수업설계는 어떻게 남나요? | 활동별 산출물이 실시간으로 저장되고, 단계·종합 보고서를 HWPX·PDF로 내보내거나 공개 링크로 공유할 수 있습니다. |
| AI가 수업을 대신 만들어 주나요? | 아니요. AI는 절차를 안내하고 초안을 제안할 뿐, 결정은 팀이 합니다. |

- `<summary>`: `text-[15px] font-bold text-[#202124] py-4 cursor-pointer flex justify-between items-center`, 우측 `ChevronDown`(열림 시 회전 — CSS `details[open] summary svg { transform: rotate(180deg) }`, globals append).
- 답변: `text-[14px] text-[#5F6368] leading-[1.7] pb-4`.

**배경**: `#F8F9FA`.

---

### 3-8. 최종 CTA (`#cta`)

**레이아웃**: 중앙 정렬, `max-w-[720px]`. 배경 강조 그라데이션 full-bleed.

**카피 전문**
- h2 (font-display, 700, 대형): `이제, 우리 팀의 밭을 일굴 차례입니다`
- 서브카피: `Google 계정만 있으면 바로 시작할 수 있습니다.`
- 버튼(primary, `morph-btn`): `바로 로그인하기` → `<a href="#login">` (맨 위 로그인 카드로 이동, `ArrowUp` 아이콘)

- 배경: `linear-gradient(135deg,#E8F0FE 0%,#F3E5F5 100%)`, 상하 `py-20 md:py-28`.

---

### 3-9. 푸터 (`<footer>`)

- 배경 `#F1F3F4`, 텍스트 `#5F6368` 12–13px, `py-10 text-center`.
- 내용: `T-CID 협력 수업설계` (로고 소형) · 한 줄 소개 `AI 퍼실리테이터와 함께하는 협력적 수업 설계` · 저작권 `© 2026 T-CID`.
- 과장·허위 링크 금지. 실제 존재하는 라우트 외 링크는 넣지 않음(외부 링크 없이 텍스트만 권장).

---

## 4. 타이포 스케일

> 기존 페이지의 **arbitrary px 표기 관습**(`text-[26px]`, `font-black` 등) 유지. 본문 base는 body 15px/weight500.

| 역할 | 폰트 | 크기 | 굵기 | 행간 | 자간 | Tailwind 예시 |
|------|------|------|------|------|------|----------------|
| Hero h1 | **Gowun Batang** | `clamp(30px,6vw,54px)` | 700 | 1.18 | -0.02em | `font-display text-[clamp(30px,6vw,54px)] font-bold leading-[1.18] tracking-[-0.02em]` |
| 섹션 h2 | **Gowun Batang** | `28px` / md `34px` | 700 | 1.25 | -0.01em | `font-display text-[28px] md:text-[34px] font-bold leading-[1.25] tracking-[-0.01em]` |
| 오버라인 | Noto Sans | `12px` | 700 | 1 | 0.18em | `overline`(§custom) uppercase |
| 서브카피(lead) | Noto Sans | `16px` / md `17px` | 500 | 1.75 | 0 | `text-[16px] md:text-[17px] leading-[1.75] text-[#5F6368]` |
| 본문 | Noto Sans | `14px` | 500 | 1.7 | 0 | `text-[14px] leading-[1.7] text-[#5F6368]` |
| 카드 제목 | Noto Sans | `15px` | 700 | 1.3 | 0 | `text-[15px] font-bold text-[#202124]` |
| 단계 메타포 문장 | **Gowun Batang** | `14–15px` | 400 | 1.5 | 0 | `font-display text-[15px]` (단계 doneText 색) |
| 칩 / pill | Noto Sans | `12–13px` | 600–700 | 1 | 0 | `text-[12px] font-semibold` |
| 번호 뱃지 | Noto Sans | `15px` | 700 | 1 | 0 | — |
| FAQ summary | Noto Sans | `15px` | 700 | 1.3 | 0 | — |

**globals.css append 유틸(신규 클래스만 추가, 기존 줄 무수정):**
```css
/* ── /login 안내형 랜딩 (append-only, 기존 규칙 불변) ─────── */
.font-display { font-family: var(--font-gowun), var(--font-noto), 'Nanum Myeongjo', serif; }

.overline {
  font-size: 12px; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase; color: #1558D6;   /* AA 대비 확보(§8) */
}
```

---

## 5. 색 · 배경 리듬

### 단계색 5종 — **`src/lib/ui/stageColors.ts` 실측값** (⚠️ 브리프 본문의 "T보라·A파랑"은 레퍼런스 기준. 우리 앱 실제 매핑은 아래이며, 태스크 지시대로 **사이드바 상수값을 사용**한다.)

| 단계 | 이름 | hex(진한) | light(배경) | border | doneText(텍스트) |
|------|------|-----------|-------------|--------|------------------|
| **T** 팀준비 | 파랑 | `#1A73E8` | `#E8F0FE` | `#AECBFA` | `#1558D6` |
| **A** 분석 | 보라 | `#7B1FA2` | `#F3E5F5` | `#CE93D8` | `#6A1B9A` |
| **Ds** 설계 | 청록 | `#00897B` | `#E0F2F1` | `#80CBC4` | `#00695C` |
| **DI** 개발·실행 | 주황 | `#E65100` | `#FBE9E7` | `#FFAB91` | `#BF360C` |
| **E** 평가 | 빨강 | `#C62828` | `#FFEBEE` | `#EF9A9A` | `#B71C1C` |

> 코딩 에이전트는 색 하드코딩 대신 `import { STAGE_COLOR } from '@/lib/ui/stageColors'`(읽기 전용)로 참조 권장 — `light`/`border`/`doneText`/`hex` 필드 사용. 단계 카드 데이터는 `STAGES`(라벨·description·activities) + `ACTIVITY_DISPLAY_CODE` + `ACTIVITY_META.label` 조합.

### 전역 토큰(globals.css)
- primary `#1A73E8` / primary-container `#E8F0FE` / surface `#FFF` / background `#F8F9FA`
- on-surface `#202124` / on-surface-variant `#5F6368` / outline `#DADCE0`
- shadow: `.md-shadow-1/2/3` (elevation)

### 섹션 배경 교차 리듬
```
Hero        로그인 그라데이션(EAF2FF→F8F9FA→F3E5F5)
START       #FFFFFF
WORKFLOW    linear-gradient(180deg,#FFF,#F8F9FA)
AI          #FFFFFF
PRINCIPLES  #F8F9FA
COLLAB      #FFFFFF
FAQ         #F8F9FA
CTA         linear-gradient(135deg,#E8F0FE,#F3E5F5)
FOOTER      #F1F3F4
```
→ 흰색과 옅은 틴트가 번갈아 나와 스크롤 리듬 형성. 단계색은 WORKFLOW 카드에서만 집중 사용(과용 금지).

---

## 6. 모션

### 6-1. 스크롤 리빌 (IntersectionObserver 1개)
- `Reveal.tsx`(client): `IntersectionObserver`(threshold 0.15, once) 로 뷰포트 진입 시 `.reveal-in` 부여.
- 스태거: 자식에 `style={{ '--reveal-delay': '${i*80}ms' }}`.
- CSS(append):
```css
.reveal { opacity: 0; transform: translateY(16px); }
.reveal-in {
  opacity: 1; transform: none;
  transition: opacity .6s cubic-bezier(.4,0,.2,1) var(--reveal-delay,0ms),
              transform .6s cubic-bezier(.4,0,.2,1) var(--reveal-delay,0ms);
}
```

### 6-2. 기존 애니메이션 재사용 지점
- **morph-shape + stage-bounce**: 네비 좌측 로고 블롭, Hero 로그인 카드 로고(현재 그대로).
- **morph-btn**: Hero 카드의 프로필 CTA(기존), 최종 CTA 버튼.
- **msg-slide-in**: AI 섹션 채팅 말풍선 등장(Reveal 내 1회).
- **chevron-flow**: Hero 스크롤 큐(선택).

### 6-3. 과도 모션 금지 · reduced-motion
- 패럴랙스·연속 루프 배너 금지. 리빌은 진입 시 1회.
- globals.css는 이미 `@media (prefers-reduced-motion: reduce)` 블록 존재(369행) → **수정 불가**. 대신 **새 `@media` 블록을 append**(중복 블록 유효):
```css
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; }
  .reveal-in { transition: none; }
  html { scroll-behavior: auto; }
}
```
- 부드러운 앵커 스크롤도 reduced-motion 존중:
```css
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
.landing-section { scroll-margin-top: 72px; }   /* 고정 네비가 제목을 가리지 않게 */
```

---

## 7. 반응형 브레이크포인트

| 구간 | Hero | START | WORKFLOW | AI / COLLAB | 공통 |
|------|------|-------|----------|-------------|------|
| **모바일 <768** | **1열, 순서 = 헤드라인 → 로그인 카드 → 서브카피·칩** | 1열(목업은 텍스트 아래) | 1열 카드 스택 | 1열(목업 아래) | 네비 앵커링크 숨김·"바로 로그인"만, 컨테이너 `px-5` |
| **태블릿 768–1023** | 2열 `gap-8`, 카드 `max-w-[380px]` | 지그재그 2열 | 2열 | 2열 `gap-8` | 네비 앵커 표시 시작 |
| **데스크톱 ≥1024** | 2열 `grid-cols-[1fr_minmax(360px,420px)]`, 카피 좌·카드 우 | 지그재그 2열(홀짝 교차) | `grid-cols-3`(3+2) | 2열 `gap-10` | 컨테이너 `max-w-[1120px] px-8` |

**모바일 Hero 순서 근거**: UX 제1원칙("설명 없이도 즉시 로그인"). 모바일에서 카드가 긴 마케팅 카피에 밀리지 않도록 **로그인 카드를 헤드라인 바로 아래**에 둔다. 구현: Hero를 `flex flex-col`로 두고 카드 블록에 `order-2 lg:order-none`, 서브카피/칩 블록에 `order-3`, 헤드라인 `order-1`. 데스크톱에선 grid로 좌우 재배치.

---

## 8. 접근성 체크리스트

- **헤딩 위계**: `h1`은 Hero **하나만**(서비스 가치 문장). 각 섹션 제목 `h2`, 카드/스텝 소제목 `h3`. 로그인 카드가 `showBrand={false}`로 자체 h1을 숨겨 **중복 h1 방지**.
- **랜드마크**: `<nav>`, `<main>`, 각 `<section aria-labelledby="…">`, `<footer>`. 목업 컨테이너 `aria-hidden="true"`, 장식 아이콘 `aria-hidden`.
- **스킵 동선**: 네비 "바로 로그인"(`href="#login"`)이 즉시 로그인 카드로 이동 → 스크린리더·키보드 사용자 스킵 링크 겸용. 필요 시 시각 숨김 스킵링크 `sr-only focus:not-sr-only` 추가 가능.
- **색 대비(WCAG AA)**:
  - 본문 `#5F6368` on 흰색 ≈ 5.9:1 ✅. 제목 `#202124` on 흰색 ✅.
  - **오버라인·소형 primary 텍스트는 `#1558D6` 사용**(#1A73E8는 흰 배경 대비 ≈3.99:1로 소형 텍스트 AA 미달 → 어두운 `#1558D6` ≈5.2:1로 상향). `.overline` 유틸에 반영됨.
  - 단계 `doneText` 색은 각 `light` 배경 위에서 AA 충족(진한 톤).
  - 그라데이션 배경 위 텍스트는 가장 옅은 지점 기준으로 대비 확인.
- **포커스**: 네비 링크·앵커 CTA·FAQ `<summary>`에 `:focus-visible` 링(2px `#1A73E8`, offset 2px). 로그인 카드 기존 인터랙션(입력 포커스 시 보더 primary)은 유지.
- **키보드**: 모든 상호작용 요소는 native `<a>`/`<button>`/`<summary>` → 기본 포커스·엔터 동작 보장. FAQ는 `<details>`로 키보드 토글 기본 지원.
- **모션 민감성**: §6-3 reduced-motion 블록으로 리빌·스무스 스크롤 비활성.
- **터치 타깃**: 네비 버튼·CTA·칩 최소 44×44 확보(pill은 `py-2` 이상).

---

## 9. 구현 파일 구성 제안

> **허용 범위**: `src/app/(auth)/login/` 내부 신규 파일 + `globals.css` **append만**. 그 외 파일 무수정.

```
src/app/(auth)/login/
├── page.tsx                     # (수정) 서버 컴포넌트 조립. 'export const dynamic = "force-dynamic"' 유지.
│                                #   래퍼 <div className={gowunBatang.variable}> + LandingNav + <main> 섹션들.
│                                #   'use client' 제거 가능(로직은 LoginCard로 이동). force-dynamic는 서버 컴포넌트에서도 유효.
├── LoginCard.tsx                # (신규, 'use client') 현재 page.tsx의 카드 전체 verbatim 이식:
│                                #   handleGoogleLogin/handleCompleteProfile, step·firebaseUser·isLoading·error·폼4필드,
│                                #   Google SVG, 프로필 폼 — 무변경. prop: showBrand?: boolean (기본 true).
│                                #   ⚠️ 검증 기준(브리프 §검증): 핸들러·상태·필드 diff 무변경.
└── landing/                     # (신규) 마케팅 프리젠테이션 컴포넌트 (대부분 서버 컴포넌트)
    ├── fonts.ts                 # Gowun_Batang next/font 상수 (§1)
    ├── content.ts               # 카피·워크플로우 데이터. STAGES/ACTIVITY_DISPLAY_CODE/ACTIVITY_META/STAGE_COLOR
    │                            #   (from '@/types', '@/lib/ui/stageColors') 를 읽어 파생 — 원본 무수정.
    ├── LandingNav.tsx           # 'use client' — sticky 네비 + 스크롤 그림자(IntersectionObserver) + 앵커
    ├── Reveal.tsx               # 'use client' — IntersectionObserver 스크롤 리빌 래퍼
    ├── HeroSection.tsx          # 좌 카피 + 우 <LoginCard showBrand={false}/>
    ├── StartSection.tsx
    ├── WorkflowSection.tsx      # STAGE_COLOR·활동 데이터로 5카드 + 플로우
    ├── AiFacilitatorSection.tsx
    ├── PrinciplesSection.tsx
    ├── CollaborationSection.tsx
    ├── FaqSection.tsx           # native <details>
    ├── FinalCtaSection.tsx
    ├── LandingFooter.tsx
    └── mockups.tsx              # BrowserFrame(신호등 헤더)·ChatMockup·ArtifactMockup 등 경량 CSS 목업 (aria-hidden)
```

**globals.css append 블록(파일 끝, 전체)** — 위 §4·§6 조각을 한 번에:
```css
/* ── /login 안내형 랜딩 (append-only) ───────────────────── */
.font-display { font-family: var(--font-gowun), var(--font-noto), 'Nanum Myeongjo', serif; }
.overline { font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #1558D6; }
.landing-section { scroll-margin-top: 72px; }
.reveal { opacity: 0; transform: translateY(16px); }
.reveal-in {
  opacity: 1; transform: none;
  transition: opacity .6s cubic-bezier(.4,0,.2,1) var(--reveal-delay,0ms),
              transform .6s cubic-bezier(.4,0,.2,1) var(--reveal-delay,0ms);
}
details.faq-item > summary { list-style: none; }
details.faq-item > summary::-webkit-details-marker { display: none; }
details.faq-item[open] > summary svg { transform: rotate(180deg); }
details.faq-item > summary svg { transition: transform .2s ease; }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; }
  .reveal-in { transition: none; }
  html { scroll-behavior: auto; }
}
```

**검증 게이트**(브리프 §산출물 재확인): `npx tsc --noEmit` + `npm run build` 통과 · 로그인 로직 diff 무변경 · `(auth)/login/` 외 파일 diff 없음(globals.css는 append만) · lucide 아이콘은 `lucide-react`에서 import(신규: `LogIn, Users, FolderPlus, Sparkles, RefreshCw, Check, ChevronRight, ChevronDown, ArrowUp` 등 — 모두 lucide-react 존재).

---

## 10. lucide 아이콘 매핑(요약)

| 위치 | 아이콘 |
|------|--------|
| 네비/카드 로고 | `BookOpen`(기존 유지) |
| Hero 신뢰 칩 | `LogIn` · `Users` · `RefreshCw` |
| START 4단계 | `LogIn` · `Users` · `FolderPlus` · `Sparkles` |
| WORKFLOW 플로우 화살표 | `ChevronRight` |
| AI 4역할 | 이모지(📌✍️🔍📝) 사용 — lucide 대체 시 `ClipboardList·PenLine·SearchCheck·NotebookPen` |
| COLLAB 체크리스트 | `Check` |
| FAQ | `ChevronDown` |
| 최종 CTA | `ArrowUp` |

---

**끝.** 이 문서 + 원본 `page.tsx`(로그인 카드 소스) + `stageColors.ts`/`types` 만으로 구현 가능하도록 구성함.
