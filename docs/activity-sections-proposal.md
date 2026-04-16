# 17개 활동 권장 섹션 제안 (B안 — `recommendedSections` 필드, 가이드 전용)

- 작성: pedagogy-auditor (team `tcid-ui-redesign`, Task #8)
- 날짜: 2026-04-14 · v1.1 (data-architect 자동 승격 충돌 발견에 따른 필드 분리)
- 관련 파일: `src/types/index.ts` (ACTIVITY_META·RequiredSection), `src/lib/firebase/projects.ts:338~340` (auto-promotion 로직), `src/lib/prompts/system.ts` (ACTIVITY_PROCEDURE), `src/lib/activity/completion.ts:43` (grandfather), `src/components/chat/ChatPanel.tsx:611` (A-2-1 extract)

### v1.1 필드 분리 결정 (중요)
data-architect가 `projects.ts:338~340`에서 **자동 승격(auto-promotion) 충돌**을 발견:
```ts
const shouldAttachSchema =
  data._schemaVersion === undefined &&
  (ACTIVITY_META[activityCode]?.requiredSections?.length ?? 0) > 0
```
→ `requiredSections`에 섹션을 넣으면 **해당 활동의 모든 신규 저장 산출물이 `_schemaVersion: 'v2-sections'`로 자동 승격**되어 `completion.ts:43` grandfather 경로가 깨짐(기존 완료 산출물은 grandfather 통과하지만, **새로 저장되는 산출물은 강제 검증 대상**이 되어 B안 "강제 X" 원칙 위반).

**해결**: 필드 분리
- **E-1-1 / E-2-1**: 기존 `requiredSections` (강제 판정 + v2-sections 자동 승격, 그대로 유지)
- **17개 활동**: 신규 **`recommendedSections`** (타입 동일 `RequiredSection[]`, **auto-promotion 경로에서 완전 배제**)

### 본 제안서 섹션이 들어갈 필드
**모든 섹션 정의는 `recommendedSections`에 배치**. `requiredSections`에 추가 금지.

### 용도 한정
1. UI EmptyState 권장 섹션 chip (data-architect Task #9)
2. AI 프롬프트의 "권장 기록 섹션" 힌트 (flow-integrator Task #10)

### 전제
- **강제 판정 아님**: 완료 검증(`completion.ts::isEffectivelyDone` 등)에서 전혀 참조되지 않음. 따라서 `required` 값은 **타입 일관성용** — 실질 의미 없음.
- **grandfather 안전선 유지**: `recommendedSections`는 auto-promotion 조건과 무관하므로 기존·신규 산출물 모두 스키마 부착 없음 → 회귀 0.
- **E-1-1 / E-2-1 건드리지 않음**.
- **`required: 'any'` 통일**, **`minChars` 10~20**.

### 본 제안서 §2 코드 예시 표기 규칙
§2의 각 활동 코드 블록은 가독성을 위해 ts 배열 리터럴을 그대로 둔다. data-architect가 ACTIVITY_META에 반영할 때는 **변수명을 `recommendedSections`로** 두고 해당 배열을 값으로 사용한다.

예:
```ts
'T-1-1': {
  code: 'T-1-1', label: '팀 공통 비전 설정', stage: 'T',
  recommendedSections: [  // ← requiredSections 아님!
    { key: '개인 비전',    label: '개인 비전 키워드·정교화 문장', minChars: 20, required: 'any' },
    { key: '팀 공통 비전', label: '팀 공통 비전 문장',           minChars: 10, required: 'any' },
  ],
},
```

---

## 1. 설계 원칙

### 1-1. 섹션 key = ARTIFACT_UPDATE 키 일치 규칙 (필수)
`src/types/index.ts:48~49` 주석:
> "key는 실제 저장된 섹션명과 1:1 매칭됨 (한글 라벨 그대로 — AI의 `[ARTIFACT_UPDATE: <label>=<값>]` 신호가 그대로 키로 저장됨)."

AI가 실제로 방출하는 ARTIFACT_UPDATE 키와 섹션 key가 **문자 단위로 일치**해야 매칭이 된다. 본 제안서의 모든 key는 `ACTIVITY_PROCEDURE`의 실제 저장 신호에서 확인해 그대로 인용했다.

**표현·구현 차이 부연**: UI의 section chip 라벨은 교사에게 친화적 문구로 덮어쓸 여지가 있지만, **`key`는 반드시 ARTIFACT_UPDATE 키 원문 그대로** 둬야 한다. label은 UI 표시용 별칭이고, 매칭은 key로만 이뤄지기 때문이다. 본 제안은 key=label로 두되, 필요시 flow-integrator/data-architect가 label만 조정하는 것은 허용.

### 1-2. "AI 분석 / AI 점검" 섹션 제외 여부
대부분 활동의 마지막 UPDATE는 `AI 분석` 또는 `AI 점검`이다. 이는 **AI가 자동 생성하는 메타 산출물**이지 교사가 진술하는 섹션이 아니다. 따라서:

- **AI 자동 섹션은 권장 섹션에서 제외한다.** (완료 가이드는 교사 수행 항목을 추적해야 의미가 있음)
- 단, Ds-1-3의 "AI 점검"처럼 시스템 프롬프트가 같은 응답에 반드시 함께 방출하도록 강제된 경우, 섹션 존재 자체는 key 목록에 **optional-note** 수준으로 남길지 후속 검토 (본 제안서는 현재 제외).

### 1-3. minChars 가이드
B안은 "강제 X" 원칙이므로 **내용 있음을 구분할 수 있는 최소선**만 둔다.

- 단일 개념/문장 섹션(예: "팀 공통 비전", "최종 선정 주제"): `minChars: 10`
- 표/복합 구조 섹션(예: "역할 배분", "학습 활동"): `minChars: 20` (표의 헤더만으로는 통과 못 하게)
- 장문 성찰·근거 섹션(예: "선정 근거", "종합 시사점"): `minChars: 20`

### 1-4. A-2-1 특수 처리
A-2-1은 `ACTIVITY_PROCEDURE`에 `⚠️ [ARTIFACT_UPDATE] 신호는 A-2-1에서 절대 사용하지 않는다` 규칙. 실제 저장은 `src/components/chat/ChatPanel.tsx:611` `extractA21TableForSave` 함수가 마크다운 표를 추출해 단일 key `성취기준분석표`(띄어쓰기 없음)로 저장한다. 따라서 A-2-1의 key는 이 함수 출력과 일치시킨다.

---

## 2. 17개 활동 × 권장 섹션

### T-1-1 팀 공통 비전 설정
근거: `system.ts:928~931` Step 6 기록 신호 3개 중 교사 입력 기반 2개.

```ts
recommendedSections: [
  { key: '개인 비전',      label: '개인 비전 키워드·정교화 문장', minChars: 20, required: 'any' },
  { key: '팀 공통 비전',   label: '팀 공통 비전 문장',          minChars: 10, required: 'any' },
]
```

- 제외: `AI 분석` (AI 자동 생성 메타)
- 근거 step: Step 1(개인 키워드 수집) → Step 2(AI 정교화) → Step 5(팀 최종 확정) → Step 6 저장

### T-1-2 수업설계 방향 설정
근거: `system.ts:1020~1024` Step 8.

```ts
recommendedSections: [
  { key: '설계 방향', label: '설계 방향 (방향·근거 표)', minChars: 20, required: 'any' },
]
```

- 제외: `AI 분석`
- 근거 step: Step 5(범주화·타협안) → Step 7(저장 확인) → Step 8 저장

### T-2-1 역할 배분
근거: `system.ts:1082~1085` Step 5.

```ts
recommendedSections: [
  { key: '역할 배분', label: '역할 배분 (교사별 5열 표)', minChars: 20, required: 'any' },
]
```

- 단일 표 강제(`반드시 단일 표 하나로 저장`) → 섹션도 1개로 단순
- 근거 step: Step 3(5열 표 생성) → Step 4(저장 확인) → Step 5 저장

### T-2-2 팀 규칙 수립
근거: `system.ts:1123~1124` 5단계.

```ts
recommendedSections: [
  { key: '팀 규칙', label: '팀 규칙 (규칙명·설명·위반 시 조치)', minChars: 20, required: 'any' },
]
```

- 근거 step: 3단계(필수 규칙 3개 내외 + 위반 시 조치) → 4단계(저장 확인) → 5단계 저장

### T-2-3 팀 일정 협의
근거: `system.ts:1151~1154` 4단계.

```ts
recommendedSections: [
  { key: '팀 일정', label: '팀 일정 (기간·활동·마감·담당자)', minChars: 20, required: 'any' },
]
```

- 근거 step: 2단계(초안 표) → 3단계(저장 확인) → 4단계 저장

### A-1-2 주제 선정
근거: `system.ts:1218~1224` Step 6. ARTIFACT_UPDATE 5개 중 AI 분석 제외 4개.

```ts
recommendedSections: [
  { key: '주제 선정 기준',  label: '주제 선정 기준 (기준·설명·가중치)', minChars: 20, required: 'any' },
  { key: '주제 후보',       label: '주제 후보 (비교표)',              minChars: 20, required: 'any' },
  { key: '최종 선정 주제',  label: '최종 선정 주제',                  minChars: 10, required: 'any' },
  { key: '선정 근거',       label: '선정 근거 (비전·교과·학생 맥락)', minChars: 20, required: 'any' },
]
```

- 제외: `AI 분석`
- 근거 step: Step 1(기준 합의) → Step 3(비교표) → Step 5(최종 선택) → Step 6 저장

### A-2-1 핵심아이디어 및 성취기준 분석
근거: `src/components/chat/ChatPanel.tsx:660` `extractA21TableForSave`의 출력 key.

```ts
recommendedSections: [
  { key: '성취기준분석표', label: '핵심아이디어 + 성취기준 분석표 + 융합 분석', minChars: 20, required: 'any' },
]
```

- **⚠️ 주의**: key는 `성취기준분석표` (띄어쓰기 없음). UI 라벨만 "핵심아이디어 및 성취기준 분석"으로 읽히도록 label로 교정.
- `ARTIFACT_UPDATE` 신호를 쓰지 않으므로 AI 프롬프트 힌트 주입 경로가 다름 — Task #10에서 flow-integrator가 별도 처리해야 함 (표 생성 가이드에 "핵심아이디어 블록 + 7열 표 + 융합 분석 3요소" 각각이 필수임을 서술).

### A-2-2 통합 수업목표 진술
근거: `system.ts:1396~1403` Step 6. UPDATE 3개 중 AI 분석 제외 2개.

```ts
recommendedSections: [
  { key: '교과별 세부 목표', label: '교과별 세부 목표 (교과·학습목표)', minChars: 20, required: 'any' },
  { key: '통합 학습목표',    label: '통합 학습목표 (3~5개)',           minChars: 20, required: 'any' },
]
```

- 제외: `AI 분석`
- 근거 step: Step 2(교과별 목표 초안) → Step 4(통합 목표 생성) → Step 5(최종 확정) → Step 6 저장

### A-2-3 학습자·맥락 분석
근거: `system.ts:1348` Step 6. 단일 UPDATE (공통 프로필 + 교사별 포인트를 한 키에 묶음).

```ts
recommendedSections: [
  { key: '학습자 프로필', label: '학습자 프로필 (팀 공통 + 교사별 맞춤)', minChars: 20, required: 'any' },
]
```

- **교수학적 주의**: 실제 산출물은 "공통" + "개인별" 두 층위로 구성되나 AI가 한 신호에 묶어 저장한다. Task #9(data-architect)에서 Ds 가드레일 카드 연동 시 단일 key 사용 주의. Ds 단계 문구 "A-2-3 학습자 프로필을 참조한다"는 이 key 원문과 일치.
- 근거 step: Step 4(2층위 동시 제시) → Step 5(팀+AI 성찰) → Step 6 저장

### Ds-1-1 평가 계획 수립 (Backward Design 첫 활동)
근거: `system.ts:1485~1487` Step 6.

```ts
recommendedSections: [
  { key: '평가 계획', label: '평가 계획 (평가 항목·방법·시점·상중하 루브릭)', minChars: 20, required: 'any' },
]
```

- 근거 step: Step 3(AI 루브릭 초안) → Step 5(Alignment 점검) → Step 6 저장
- 교수학적 의의: Ds 단계 첫 활동이자 Backward Design 축. 단일 섹션이지만 표 내부가 풍부해야 하므로 `minChars: 20`.

### Ds-1-2 문제상황 개발
근거: `system.ts:1562~1568` 저장 신호.

```ts
recommendedSections: [
  { key: '문제상황',  label: '문제상황 시나리오 (제목·실제성·학습내용+산출물·청중+행위)', minChars: 20, required: 'any' },
  { key: '핵심 질문', label: '핵심 질문 (Driving Question)',                         minChars: 10, required: 'any' },
]
```

- 근거 step: 3행 구조 시나리오(행1/행2/행3) + 핵심 질문 Driving Question
- PBL 고전 구조에 맞춘 2개 섹션 분리 (system.ts가 이미 분리 저장하고 있음)

### Ds-1-3 학습활동 설계
근거: `system.ts:1641~1646` Step 5.

```ts
recommendedSections: [
  { key: '학습 활동', label: '학습 활동 (순서·활동명·설명·교과·누적 차시)', minChars: 20, required: 'any' },
]
```

- 제외: `AI 점검` (점검은 AI 자동)
- 근거 step: Step 2(표 구조화) → Step 4(Alignment 점검) → Step 5 저장

### Ds-2-1 지원 도구 설계
근거: `system.ts:1712~1718` Step 4.

```ts
recommendedSections: [
  { key: '경험한 도구 정리',  label: '경험한 도구 정리 (도구명·활용 경험)',      minChars: 20, required: 'any' },
  { key: '학습활동-도구 매칭', label: '학습활동-도구 매칭 (활동·도구·활용 방안·대안)', minChars: 20, required: 'any' },
]
```

- 제외: `AI 점검` (학습환경 적절성 검토는 AI 자동)
- 근거 step: Step 1(도구 경험 수집) → Step 2(활동별 매칭) → Step 4 저장

### Ds-2-2 스캐폴딩 설계
근거: `system.ts:1784~1790` Step 4.

```ts
recommendedSections: [
  { key: '지원 방안 정리', label: '지원 방안 정리 (지원 방안·대상 활동)',                  minChars: 20, required: 'any' },
  { key: '스캐폴딩 계획',  label: '스캐폴딩 계획 (활동·유형·내용·대상·점진적 제거)', minChars: 20, required: 'any' },
]
```

- 제외: `AI 점검`
- 근거 step: Step 2(활동별 스캐폴딩 논의) → Step 3(활동별 정리) → Step 4 저장

### DI-1-1 자료 탐색·개발
근거: `system.ts:1872~1875` Step 7.

```ts
recommendedSections: [
  { key: '개발 자료 목록', label: '개발 자료 목록 (자료 유형·자료명·교과·구분·담당자·우선순위·마감일)', minChars: 20, required: 'any' },
]
```

- 제외: `AI 점검` (누락 점검은 AI 자동)
- 근거 step: Step 2(초안 제안) → Step 5(누락 점검) → Step 7 저장

### DI-2-1 수업 기록
근거: `system.ts:1961~1968` Step 7.

```ts
recommendedSections: [
  { key: '주요 상황 기록', label: '주요 상황 기록 (시점·상황·학생 반응·시사점)', minChars: 20, required: 'any' },
  { key: '종합 시사점',    label: '종합 시사점 (성공·장애·예상외·포용)',          minChars: 20, required: 'any' },
]
```

- 근거 step: Step 4(에피소드 구조화) → Step 5(성찰) → Step 6(핵심 에피소드 채택) → Step 7 저장

---

## 3. 요약 매트릭스

| 활동 | 권장 섹션 수 | key 목록 |
|---|---|---|
| T-1-1 | 2 | 개인 비전 / 팀 공통 비전 |
| T-1-2 | 1 | 설계 방향 |
| T-2-1 | 1 | 역할 배분 |
| T-2-2 | 1 | 팀 규칙 |
| T-2-3 | 1 | 팀 일정 |
| A-1-2 | 4 | 주제 선정 기준 / 주제 후보 / 최종 선정 주제 / 선정 근거 |
| A-2-1 | 1 | 성취기준분석표 ⚠️ (띄어쓰기 없음) |
| A-2-2 | 2 | 교과별 세부 목표 / 통합 학습목표 |
| A-2-3 | 1 | 학습자 프로필 |
| Ds-1-1 | 1 | 평가 계획 |
| Ds-1-2 | 2 | 문제상황 / 핵심 질문 |
| Ds-1-3 | 1 | 학습 활동 |
| Ds-2-1 | 2 | 경험한 도구 정리 / 학습활동-도구 매칭 |
| Ds-2-2 | 2 | 지원 방안 정리 / 스캐폴딩 계획 |
| DI-1-1 | 1 | 개발 자료 목록 |
| DI-2-1 | 2 | 주요 상황 기록 / 종합 시사점 |
| **총** | **25** | — |

대부분 활동 섹션 수: 1~2개 (task 요구 3~5개보다 적음). 사유는 아래 4절 참조.

---

## 4. 설계 주석 — 섹션 수 결정

Task #8 지시는 "3~5개씩"이지만 실제 system.ts를 확인한 결과 **대부분 활동이 단일 최종 산출물 중심**으로 설계돼 있다. 섹션을 인위로 쪼개면 AI가 방출하지 않는 key가 checklist에 뜨게 되어 **교사가 "안 채워진 것처럼 오인"**한다.

### 4-1. 왜 1~2개로 축소했나
- ARTIFACT_UPDATE 신호와 일치해야 매칭이 됨(§1-1)
- AI 분석·AI 점검 섹션 제외(§1-2)로 자연히 감소
- 표 형식 산출물은 내부에 다량의 하위 필드를 담으므로 **표 자체가 1개 섹션**임이 맞음

### 4-2. 3~5개로 쪼갤 수 있는 대안 (확장 후보 — 본 라운드 채택 안 함)
아래는 "더 세밀한 체크리스트가 필요하다"는 피드백이 올 경우 **C안 계열 확장**으로 검토할 수 있는 후보. B안 스코프 밖이므로 본 제안 채택 범위에는 넣지 않음.

- **T-2-3 팀 일정**을 "T/A/Ds/DI/E 각 단계 마감" 5개 subkey로 확장 — 단 system.ts가 단일 `팀 일정` 키로 저장하므로 스키마 변경 필요
- **Ds-1-1 평가 계획**을 "평가 항목(인지)", "평가 항목(정의)", "상·중·하 루브릭", "과정 평가 방법", "결과 평가 방법"으로 분해 — 단 `평가 계획` 단일 표 저장 관행이 system.ts에 고정
- **Ds-1-3 학습 활동**을 "도입", "탐구", "적용", "발표", "성찰" 5단계 subkey로 분해 — 단 Ds-2-1·Ds-2-2의 차시 참조와 충돌

→ 모두 **스키마·AI 프롬프트 동시 변경 필요**. 데이터·에이전트 작업이 크므로 본 B안 범위 밖. team-lead가 스펙 결정하면 별도 라운드로 이관.

### 4-3. data-architect (Task #9) 주의사항
- **v1.1 필드 분리**: 17개 활동은 신규 `recommendedSections?: RequiredSection[]` 필드에만 추가. `requiredSections`에는 절대 넣지 말 것 (auto-promotion 충돌, 상단 §v1.1 참조).
- 타입 추가: `src/types/index.ts`의 `ActivityMeta`에 `recommendedSections?: RequiredSection[]` 옵셔널 필드 1개 신설.
- `projects.ts:338~340` auto-promotion 로직은 `requiredSections`만 참조하므로 **코드 변경 없이 안전**. 17개 활동은 `_schemaVersion` 부착 대상에서 자동 제외.
- grandfather: `completion.ts:43` 규칙 덕분에 기존 Firestore 산출물은 `_schemaVersion !== 'v2-sections'`이므로 자동 통과. **마이그레이션 0건**.
- A-2-1 key 입력 시 반드시 `성취기준분석표` (띄어쓰기 없음) 주의.

### 4-4. flow-integrator (Task #10) 주의사항
- 시스템 프롬프트 힌트 주입 지점: `src/lib/prompts/system.ts`의 ACTIVITY_PROCEDURE 앞쪽 공통 지침 또는 각 활동 procedure 안에 "권장 섹션: [key 나열]"을 자연스럽게 삽입.
- **A-2-1은 ARTIFACT_UPDATE를 쓰지 않으므로 힌트 문구 포맷이 달라야 함** — "채팅 표가 핵심아이디어 블록 + 7열 표 + 융합 분석 3요소를 모두 담도록 작성하라" 형태.
- 섹션 라벨 표현이 시스템 프롬프트에 노출될 때 사용자에게 이 용어가 그대로 보이지 않도록 주의(ARTIFACT_UPDATE 키는 교사에게 숨겨진 내부 구조).

---

## 5. 검증 체크리스트 (data-architect·flow-integrator PR 리뷰용)

- [ ] 17개 활동 섹션이 **`recommendedSections` 필드에만** 정의됨 (`requiredSections`에 추가되지 않음)
- [ ] `ActivityMeta`에 `recommendedSections?: RequiredSection[]` 옵셔널 필드가 신설됨
- [ ] `projects.ts:338~340` auto-promotion 로직이 여전히 `requiredSections`만 참조(코드 변경 없음)
- [ ] 모든 섹션의 `key`가 해당 활동 `ACTIVITY_PROCEDURE`의 실제 ARTIFACT_UPDATE 문자열과 일치(A-2-1은 `extractA21TableForSave` 출력과 일치)
- [ ] E-1-1, E-2-1의 기존 `requiredSections` 불변
- [ ] `AI 분석`·`AI 점검` 키가 섹션 목록에 **없음**
- [ ] 모든 섹션이 `required: 'any'`, `minChars` 10 또는 20
- [ ] grandfather 규칙(`completion.ts:43`) 코드 변경 없음 → 기존 산출물 `completed` 유지
- [ ] 섹션 라벨 표현(label)은 교사 친화 문구, key는 내부 신호명 그대로 — 두 값이 혼동되지 않게 별도 필드로 유지

---

## 6. 표현·구현 차이 부연

- "권장 섹션 3~5개"는 Task 지시문의 표현이었고, **실제 구현은 활동당 1~4개 (평균 1.5개)** 로 결정했다. 사유: ARTIFACT_UPDATE 키와의 1:1 매칭 제약(§1-1) + AI 자동 섹션 제외(§1-2).
- "강제 X / 가이드만"은 UI·프롬프트 단에서만 힌트를 주는 설계로, **판정 로직은 전혀 건드리지 않는다** (`completion.ts`·`effectiveStatus` 불변).
- A-2-1 섹션 `성취기준분석표`는 화면 chip에서는 "핵심아이디어 + 성취기준 분석표"로 보이도록 label을 쓰는 것이 교사 친화적 — 단 key 자체는 절대 변경 금지.
