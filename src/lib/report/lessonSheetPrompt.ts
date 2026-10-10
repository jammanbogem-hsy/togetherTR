/**
 * 단계별 '테스트 보고서' — 연수 '수업 실행 나눔 기록지'의 구성 원리를 분석해 다섯 단계에 적용한 시험판.
 *
 * 기록지에서 가져온 원리
 *  1. 한 장 기록지: 서술형 분석 대신 '항목 | 내용' 표로 칸을 채운다.
 *  2. 칸마다 '무엇을 쓰나'가 정해져 있다 → 핵심 칸은 '항목 | 무엇을 쓰나 | 작성' 3열 표.
 *  3. 구조화된 내용은 열이 정해진 표로(루브릭·활동 계획·역할·일정 등).
 *  4. 끝은 KPT(유지·막힘·바꿀 것)와 한 줄 정리 — 원인은 사람이 아니라 운영 방식에서 찾는다.
 *  5. '~함/~한다' 기록 문체, 평가·점수 없음, 없는 내용은 비워 둔다.
 * 기본 단계 보고서와 나란히 두고 선생님들의 선호(reportFormatVotes)로 하나를 채택한다.
 */
import { ACTIVITY_META, STAGES, displayActivityCode, type ActivityCode, type StageCode } from '@/types'

export type LessonSheetArtifacts = Partial<Record<ActivityCode, { title: string; content: Record<string, unknown> }>>

export interface TestReportInput {
  stage: StageCode
  project: { title: string; targetGradeGroup?: string; targetSubjects?: string[]; schoolLevel?: string }
  members: Array<{ name: string; role?: string }>
  artifacts: LessonSheetArtifacts
}

const ARTIFACT_CHAR_LIMIT = 5000
export const TEST_REPORT_EMPTY = '(기록 없음)'
export const STAGE_NAMES: Record<StageCode, string> = { T: '팀준비', A: '분석', Ds: '설계', DI: '개발·실행', E: '평가' }

/** 이 단계 기록지를 쓸 때 함께 참고하는 앞 단계 산출물(맥락용). */
const CONTEXT_ACTIVITIES: Record<StageCode, ActivityCode[]> = {
  T: [],
  A: ['T-1-1'],
  Ds: ['T-1-1', 'A-1-2', 'A-2-2', 'A-2-3'],
  DI: ['Ds-1-1', 'Ds-1-3', 'Ds-2-2'],
  E: ['T-1-1', 'T-1-2', 'T-2-1', 'T-2-2', 'Ds-1-1', 'DI-2-1'],
}

function artifactText(content: Record<string, unknown>): string {
  const text = Object.entries(content)
    .filter(([key, value]) => !key.startsWith('_') && key !== 'manualWorkspace' && value !== null && value !== undefined && String(value).trim())
    .map(([key, value]) => `### ${key}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}`)
    .join('\n\n')
  return text.length > ARTIFACT_CHAR_LIMIT ? `${text.slice(0, ARTIFACT_CHAR_LIMIT)}\n…(이하 생략)` : text
}

function sourcesOf(codes: readonly ActivityCode[], artifacts: LessonSheetArtifacts): string {
  return codes.flatMap(code => {
    const artifact = artifacts[code]
    const body = artifact ? artifactText(artifact.content ?? {}) : ''
    return body ? [`## [${displayActivityCode(code)}] ${ACTIVITY_META[code].label}\n${body}`] : []
  }).join('\n\n')
}

export function stageActivities(stage: StageCode): ActivityCode[] {
  return STAGES.find(item => item.code === stage)?.activities ?? []
}

export function hasStageTestSources(stage: StageCode, artifacts: LessonSheetArtifacts | null | undefined): boolean {
  return !!artifacts && sourcesOf(stageActivities(stage), artifacts).length > 0
}

const KPT = (title: string, what: { k: string; p: string }) => `### ${title}

| 구분 | 무엇을 쓰나 | 작성 |
|---|---|---|
| K 유지할 것 | ${what.k} | |
| P 막힌 것 | ${what.p} | |
| T 바꿀 것 | P에 대한 답으로, 실행할 수 있는 행동 한 가지 | |
| 한 줄 정리 | 이 단계를 마치며 새롭게 알게 된 것 | |`

const TEMPLATES: Record<StageCode, string> = {
  T: `## 0. 팀 정보

| 항목 | 내용 |
|---|---|
| 팀명 | |
| 팀원·역할 | (이름: 역할 …) |
| 학년·교과 | |

## 1. 공동 비전과 수업설계 원칙

| 항목 | 무엇을 쓰나 | 작성 |
|---|---|---|
| 팀 공동 비전 | 팀이 함께 지향하는 수업을 한 문장으로 | |
| 핵심 키워드 | 비전을 이루는 낱말 3~5개 | |

| 번호 | 수업설계 원칙 (~하려면 ~해야 한다) |
|---|---|

## 2. 역할 배분

| 이름 | 역할 | 맡은 일 | 언제까지 |
|---|---|---|---|

## 3. 팀 규칙과 일정

| 번호 | 팀 규칙 |
|---|---|

| 날짜·시점 | 할 일 | 담당 |
|---|---|---|

${KPT('4. 팀준비 협력 KPT', { k: '잘 작동한 합의 방식(예: 각자 먼저 적고 말하기)', p: '합의가 막힌 장면과 운영상의 원인' })}`,

  A: `## 0. 분석 개요

| 항목 | 내용 |
|---|---|
| 프로젝트 | |
| 학년·교과 | |
| 팀 비전과의 연결 | |

## 1. 주제 선정

| 항목 | 무엇을 쓰나 | 작성 |
|---|---|---|
| 주제 선정 기준 | 팀이 주제를 고를 때 쓴 기준 | |
| 선정 주제 | 최종 고른 주제 | |
| 선정 이유 | 기준에 비추어 고른 까닭 | |

## 2. 교육과정 분석

| 교과 | 성취기준(코드) | 핵심 아이디어·내용 요소 |
|---|---|---|

## 3. 통합 학습 목표와 학습자

| 항목 | 무엇을 쓰나 | 작성 |
|---|---|---|
| 통합 학습 목표 | 성취기준과 연결한 목표 한 문장 | |
| 교과별 목표 | 교과마다 학생이 할 수 있게 될 것 | |
| 학습자·맥락 | 학생 특성, 어려움이 예상되는 지점 | |

${KPT('4. 분석 협력 KPT', { k: '잘 작동한 분석·조율 방식', p: '교과를 묶거나 목표를 정할 때 막힌 점과 원인' })}`,

  Ds: `## 0. 설계 개요

| 항목 | 무엇을 쓰나 | 작성 |
|---|---|---|
| 설계 의도 | 왜 이렇게 설계했는지(비전·주제·학습자에서 출발) | |
| 학습 목표 | 성취기준과 연결한 목표 한 문장 | |
| 탐구 질문 | 학생이 탐구할 핵심 질문 | |

## 1. 평가 루브릭

| 평가 요소(근거 성취기준·방법) | 잘함 | 보통 | 노력 필요 |
|---|---|---|---|

## 2. 문제 상황

| 항목 | 내용 |
|---|---|
| 상황 제목 | |
| 학생에게 제시할 상황 | |

## 3. 학습활동 계획

| 단계 | 교수·학습 활동 | 스캐폴딩 | 자료·AI·디지털 도구 | 시간 |
|---|---|---|---|---|
| 도입 | | | | |
| 전개 | | | | |
| 정리 | | | | |

${KPT('4. 설계 협력 KPT', { k: '잘 작동한 설계 협의 방식', p: '활동·평가를 맞출 때 막힌 점과 원인' })}`,

  DI: `## 0. 개발·실행 개요

| 항목 | 내용 |
|---|---|
| 실행 차시·일시 | |
| 실행 교사·학급 | |

## 1. 개발 자료

| 자료 | 탐색/개발 | 담당 | 일정 |
|---|---|---|---|

## 2. 수업 실행 기록

| 시점 | 상황 | 학생 반응 | 증거 |
|---|---|---|---|

## 3. 평가 단계로 넘길 질문

| 번호 | 확인할 질문 |
|---|---|

${KPT('4. 실행 KPT', { k: '의도대로 작동한 설계 요소와 그 근거 장면', p: '기대와 달랐던 장면과 원인(발문·안내·도구·시간 중)' })}`,

  E: `## 0. 성찰 개요

| 항목 | 내용 |
|---|---|
| 성찰 대상 차시 | |
| 근거 자료 | (학생 결과물·관찰 기록 등) |

## 1. 루브릭 도달 확인

| 교사·교과 | 샘플 유형 | 학생 결과물 근거 | 도달 정도 | 설계 의도와의 차이 |
|---|---|---|---|---|

${KPT('2. 우리 팀의 수업 성찰 KPT', { k: '의도대로 작동한 설계 요소와 그 근거 장면', p: '기대와 달랐던 장면과 원인(발문·안내·도구·시간 중)' })}

${KPT('3. 우리 팀의 협력 성찰 KPT', { k: '처음 정한 비전·역할·규칙 중 잘 작동한 협력 방식', p: '협력에서 어려웠던 점, 원인은 사람이 아니라 운영 방식에서' })}

## 4. 다음 주기

| 항목 | 작성 |
|---|---|
| 다음 주기 선택 | |
| 다음 협력 운영 원칙 | |`,
}

export function buildStageTestReportPrompt(input: TestReportInput): string {
  const { stage, project, members, artifacts } = input
  const memberLine = members.length ? members.map(member => member.role ? `${member.name}(${member.role})` : member.name).join(', ') : TEST_REPORT_EMPTY
  const context = sourcesOf(CONTEXT_ACTIVITIES[stage], artifacts)
  return `당신은 초등 교사팀의 협력적 수업설계 기록을 정리하는 조력자입니다.
'${STAGE_NAMES[stage]}(${stage}) 단계 기록지'를 아래 양식에 맞춰 채웁니다. 평가하거나 점수를 매기지 않고, 팀이 만든 내용을 한 장 기록지로 옮깁니다.

## 프로젝트 정보
- 프로젝트명: ${project.title}
- 학교급·학년군: ${[project.schoolLevel, project.targetGradeGroup].filter(Boolean).join(' · ') || TEST_REPORT_EMPTY}
- 교과: ${project.targetSubjects?.join(', ') || TEST_REPORT_EMPTY}
- 앱 참여자: ${memberLine}

## 작성 규칙
1. 첫 줄은 "# ${STAGE_NAMES[stage]}(${stage}) 단계 기록지"로 쓰고, 이어서 아래 양식의 제목·표 머리글·순서를 그대로 지킵니다. 양식 밖의 머리말·맺음말·인사말을 쓰지 않습니다.
2. '무엇을 쓰나' 열은 양식 그대로 두고, '작성'·'내용' 칸만 채웁니다.
3. 근거는 '이 단계 산출물'이 우선이고, '앞 단계 참고'는 설계 의도·연결 칸처럼 맥락이 필요한 칸에만 씁니다.
4. 산출물에 없는 내용은 지어내지 말고 "${TEST_REPORT_EMPTY}"이라고 씁니다. 숫자·시간·이름·성취기준 코드는 산출물에 있는 그대로 씁니다.
5. 행 수가 정해지지 않은 표(원칙·역할·성취기준·자료·실행 기록 등)는 산출물에 있는 만큼 행을 만듭니다. 하나도 없으면 첫 칸에 "${TEST_REPORT_EMPTY}"인 행 하나만 둡니다.
6. 팀원·역할은 산출물에 적힌 이름과 역할을 그대로 옮깁니다. 앱 참여자 명단에 없다는 이유로 빼지 않습니다.
7. 표 칸 안에서 줄을 바꿀 때는 <br>을 씁니다. 칸 안에 '|' 문자를 쓰지 않습니다.
8. KPT의 P는 원인을 사람이 아니라 발문·안내·도구·시간·운영 방식에서 찾습니다. 산출물에 근거가 없으면 "${TEST_REPORT_EMPTY}"으로 둡니다.
9. 문장은 짧고 구체적으로, '~함/~한다' 같은 기록지 문체로 씁니다.

## 출력 양식
${TEMPLATES[stage]}

## 이 단계 산출물
${sourcesOf(stageActivities(stage), artifacts) || TEST_REPORT_EMPTY}

## 앞 단계 참고
${context || TEST_REPORT_EMPTY}`
}
