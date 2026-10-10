/**
 * 시험판 보고서 — '수업 실행 나눔 기록지' 형식 (2026 협력적 수업설계 실천교사 연수 기록지).
 * 단계 보고서와 나란히 제공하고, 선생님들의 선호(reportFormatVotes)를 보고 하나를 채택한다.
 * 모든 단계의 저장 산출물을 한 장의 기록지로 옮겨 적는다. 없는 내용은 지어내지 않는다.
 */
import { ACTIVITY_META, STAGES, displayActivityCode, type ActivityCode } from '@/types'

export type LessonSheetArtifacts = Partial<Record<ActivityCode, { title: string; content: Record<string, unknown> }>>

export interface LessonSheetInput {
  project: { title: string; targetGradeGroup?: string; targetSubjects?: string[]; schoolLevel?: string }
  members: Array<{ name: string; role?: string }>
  artifacts: LessonSheetArtifacts
}

/** 산출물 하나의 원문 길이 상한 — 긴 표가 요청을 막지 않게 한다. */
const ARTIFACT_CHAR_LIMIT = 5000
export const LESSON_SHEET_EMPTY = '(기록 없음)'

function artifactText(content: Record<string, unknown>): string {
  const text = Object.entries(content)
    .filter(([key, value]) => !key.startsWith('_') && key !== 'manualWorkspace' && value !== null && value !== undefined && String(value).trim())
    .map(([key, value]) => `### ${key}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`)
    .join('\n\n')
  return text.length > ARTIFACT_CHAR_LIMIT ? `${text.slice(0, ARTIFACT_CHAR_LIMIT)}\n…(이하 생략)` : text
}

export function lessonSheetSources(artifacts: LessonSheetArtifacts): string {
  return STAGES.flatMap(stage => stage.activities.flatMap(code => {
    const artifact = artifacts[code]
    if (!artifact) return []
    const body = artifactText(artifact.content ?? {})
    return body ? [`## [${displayActivityCode(code)}] ${ACTIVITY_META[code].label}\n${body}`] : []
  })).join('\n\n')
}

export function hasLessonSheetSources(artifacts: LessonSheetArtifacts | null | undefined): boolean {
  return !!artifacts && Object.values(artifacts).some(artifact => artifact && artifactText(artifact.content ?? {}).length > 0)
}

export function buildLessonSheetPrompt(input: LessonSheetInput): string {
  const { project, members, artifacts } = input
  const memberLine = members.length ? members.map(member => member.role ? `${member.name}(${member.role})` : member.name).join(', ') : LESSON_SHEET_EMPTY
  return `당신은 초등 교사팀의 협력적 수업설계 기록을 정리하는 조력자입니다.
아래 '팀 산출물'만 근거로 '수업 실행 나눔 기록지'를 채웁니다. 평가하거나 점수를 매기지 않고, 팀이 만든 내용을 읽기 쉽게 옮깁니다.

## 프로젝트 정보
- 프로젝트명: ${project.title}
- 학교급·학년군: ${[project.schoolLevel, project.targetGradeGroup].filter(Boolean).join(' · ') || LESSON_SHEET_EMPTY}
- 교과: ${project.targetSubjects?.join(', ') || LESSON_SHEET_EMPTY}
- 앱 참여자: ${memberLine}

## 작성 규칙
1. 아래 '출력 양식'의 제목·표 머리글·순서를 그대로 지킵니다. 양식 밖의 머리말·맺음말·인사말을 쓰지 않습니다.
2. 산출물에 없는 내용은 지어내지 말고 "${LESSON_SHEET_EMPTY}"이라고 씁니다. 숫자·시간·이름·성취기준 코드는 산출물에 있는 그대로 씁니다.
3. 팀원 칸은 산출물(역할 배분 등)에 적힌 이름과 역할을 그대로 옮깁니다. 앱 참여자 명단에 없다는 이유로 빼지 않습니다.
4. 표 칸 안에서 줄을 바꿀 때는 <br>을 씁니다. 칸 안에 '|' 문자를 쓰지 않습니다.
5. 학습활동 계획은 학습활동 설계(Ds 단계)의 흐름을 도입·전개·정리로 묶고, 스캐폴딩은 스캐폴딩 설계, 도구는 도구 연결 산출물에서 가져옵니다. 한 차시를 고를 수 있으면 핵심 차시 하나를 고르고 단원명·차시에 그 차시를 적습니다.
6. 평가 루브릭은 평가 설계 산출물의 평가 요소와 수준(잘함·보통·노력 필요 또는 상·중·하)을 옮기고, 근거 성취기준 코드와 평가 방법이 있으면 평가 요소 칸에 함께 적습니다.
7. KPT는 평가 단계(E) 산출물의 성찰을 근거로 씁니다. K(유지할 것)·P(막힌 것, 원인은 사람이 아니라 발문·안내·도구·시간·운영 방식에서)·T(P에 대한 한 가지 행동)로 나눕니다. E 단계 기록이 없으면 "${LESSON_SHEET_EMPTY}"으로 둡니다.
8. '1-1. 다른 팀 피드백'은 앱에 없는 내용이므로 표 칸을 "(연수 현장에서 작성)"으로 둡니다.
9. 문장은 짧고 구체적으로, '~함/~한다' 같은 기록지 문체로 씁니다.

## 출력 양식
# 수업 실행 나눔 기록지

## 0. 팀 정보

| 항목 | 내용 |
|---|---|
| 팀명 | (프로젝트명 또는 산출물의 팀 이름) |
| 팀원 | (이름: 역할 …) |
| 발표 분담 | (산출물에 있으면 · 없으면 ${LESSON_SHEET_EMPTY}) |
| 학년·교과 | |
| 단원명·차시 | |

## 1. 수업 설계

| 항목 | 내용 |
|---|---|
| 설계 의도 | (팀 비전·주제 선정 이유·문제 상황에서 이 차시를 이렇게 설계한 까닭) |
| 학습 목표 | (성취기준과 연결한 목표 한 문장) |
| 차시 탐구 질문 | |

### 평가 루브릭

| 평가 요소 | 잘함 | 보통 | 노력 필요 |
|---|---|---|---|

### 학습활동 계획

| 단계 | 교수·학습 활동 | 스캐폴딩 | 자료·AI·디지털 도구 | 시간 |
|---|---|---|---|---|
| 도입 | | | | |
| 전개 | | | | |
| 정리 | | | | |

## 1-1. 다른 팀 피드백

| 팀 | 피드백 |
|---|---|
| (연수 현장에서 작성) | (연수 현장에서 작성) |

## 2. KPT 성찰 프레임

### 2-1. 우리 팀의 수업 성찰 KPT

| 구분 | 작성 |
|---|---|
| K 유지할 것 | |
| P 막힌 것 | |
| T 바꿀 것 | |
| 한 줄 정리 | (이번 수업으로 학생의 배움에 관해 새롭게 알게 된 것) |

### 2-2. 우리 팀의 협력 성찰 KPT

| 구분 | 작성 |
|---|---|
| K 유지할 것 | |
| P 막힌 것 | |
| T 바꿀 것 | |

## 팀 산출물
${lessonSheetSources(artifacts) || LESSON_SHEET_EMPTY}`
}
