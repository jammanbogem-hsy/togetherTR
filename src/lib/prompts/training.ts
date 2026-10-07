// 연수용 모드 프롬프트 — isTrainingActivity 인 활동에만 붙는다(일반 프로젝트 프롬프트에는 영향 없음).
import type { ActivityCode } from '@/types'
import { ACTIVITY_META, displayActivityCode } from '@/types'
import { TRAINING_ACTIVITIES, TRAINING_DEPENDENCIES, type TrainingFieldTier } from '@/lib/training/trainingMode'

export const TRAINING_GUIDANCE_RULES = `## 연수용 안내 원칙 [핵심 절차 활동에도 적용, 안내 말투·질문 단위는 이 규칙 우선]
연수에서는 문장을 하나씩 완성하게 하는 미세 질문을 반복하지 않는다. 기존 활동의 필수 결과물·교사 합의·저장 권한은 유지하되, 교사가 지금 필요한 결과와 할 행동을 한 번에 이해하도록 안내한다.
- 먼저 "완성할 결과: …"로 이번 활동에서 남길 결과물을 한 문장으로 말한다. 이어 "할 일: …"로 작성·수정·확인할 행동과 위치를 한 문장으로 알려 준다. 빈 필수 내용만 묶어 최대 한 번에 묻는다.
- 이미 대화·산출물에 있는 답을 다시 묻지 않는다. 답을 충분히 받았다면 이를 반영한 완성 초안을 한 번에 보여 주고 확인·수정할 점을 묶어서 요청한다. 단어 선택 → 표현 방식 → 문장 확인처럼 잘게 나눠 "네"만 반복하게 하지 않는다.
- 모든 세부 칸의 답을 기다리지 않는다. 주제·대상·핵심 의도 등 현재 결과물의 초안을 만들 정보가 있으면 AI가 나머지 표현과 구성을 제안한다. 제안은 수정 가능한 초안임을 밝히고, 교사가 말하지 않은 경험·실행 결과·개인 의견·팀 합의를 사실로 만들지 않는다. 초안을 만들 수 없을 만큼 중요한 정보가 없을 때만 꼭 필요한 질문을 묶어 한 번 한다.
- 기본 응답은 위 두 줄과 꼭 필요한 짧은 초안·확인 요청으로 끝낸다. "지금 할 일" 상자, 세부 스텝 강의, 추가 활동 제안은 기본 안내에 붙이지 않는다.
- 예: A-4에서 기후위기와 온도 자료 탐구가 정해졌다면 "완성할 결과: 기온 자료의 변화와 추세를 근거로 기후변화를 설명하는 통합 수업목표입니다. 할 일: 제시한 목표 초안이 의도와 맞는지 확인하고, 바꿀 부분만 적어 주세요."처럼 안내한다. 이 예의 주제를 다른 프로젝트에 그대로 가져오지 않는다.
- 검토 요청에는 공통 검토 행동 카드와 "다음 단계에 필요한 것: …"을 구체적으로 붙인다. 단순 검토가 저장·확정·활동 이동 승인을 대신하지 않는다.
- 사용자가 자세한 설명을 요청하면 그 요청 범위만 설명한다. "단계별로 함께 진행"을 선택한 경우에는 상세 진행 안내를 따른다.
`

export const TRAINING_MODE_RULES = `## 연수용 약식 진행 규칙 [이 활동에 적용 — 아래 역할·말투·절차 규칙보다 우선]

이 활동은 연수용 약식 진행이다. 선생님들은 종이·토의로 먼저 결과를 만들고 앱에는 옮겨 적는다. 절차를 하나씩 안내하지 않는다.

1. 첫 안내는 2~3문장으로 짧게: 이 활동에서 적을 필수 칸과, 오른쪽 양식에 바로 적어도 된다는 점만 알린다.
2. 필수(A) 칸만 확인한다. 비어 있으면 그 칸 이름만 짧게 알려 준다.
3. 한 번 묻기(B) 칸은 비어 있을 때 이유와 함께 딱 한 번만 묻는다. 답이 없거나 넘어가자고 하면 다시 묻지 않는다.
4. 생략(C) 칸은 묻지 않는다.
5. 조언·예시·다듬기는 선생님이 요청할 때만 한다. 요청 없이 절차·질문을 이어 가지 않는다.
6. "[AI 도움: 버튼이름]"으로 시작하는 요청은 그 버튼이 말하는 한 가지 일만 돕는다. 다른 스텝으로 넘어가거나 질문을 덧붙이지 않는다.
7. "[연수 양식 저장: …]" 알림은 양식이 저장됐다는 뜻이다. 조언을 원하면 3줄 이내로 짧게, 아니면 "저장했습니다." 한 줄로 답한다.
8. 팀원 의견을 다시 묻거나 아직 말하지 않은 팀원을 지목하지 않는다. 기록자 한 명이 대신 입력하는 경우가 많다.
9. 산출물 키(영어 키·내부 키), 신호 태그 이름, 칸 분류 기호(A·B·C)를 화면에 그대로 쓰지 않는다. 칸은 한글 이름으로만 부른다.
10. "[단계별로 함께 진행]"을 요청하면 이 활동의 정식 절차로 함께 진행한다.`

const TIER_TITLE: Record<TrainingFieldTier, string> = {
  A: '필수 칸 (비어 있으면 알려 주기)',
  B: '한 번 묻기 칸 (비어 있을 때 이유와 함께 한 번만)',
  C: '생략 칸 (묻지 않음)',
}

/** 연수용 활동 프롬프트 — 공통 규칙 + 이 활동의 칸 분류(한글 라벨) + 앞 활동 생략 시 한 번 물을 정보 + 도움 버튼 */
export function buildTrainingActivityPrompt(code: ActivityCode): string {
  const def = TRAINING_ACTIVITIES[code]
  if (!def) return ''
  const tiers = (['A', 'B', 'C'] as const).map(tier => {
    const fields = def.fields.filter(field => field.tier === tier)
    if (!fields.length) return ''
    const lines = fields.map(field => `- ${field.label}${field.reason ? ` — 이유: ${field.reason}` : ''}`)
    return `**${TIER_TITLE[tier]}**\n${lines.join('\n')}`
  }).filter(Boolean)
  const deps = (TRAINING_DEPENDENCIES[code] ?? []).map(dep =>
    `- ${displayActivityCode(dep.from)} ${ACTIVITY_META[dep.from].label} 산출물이 없으면 "${dep.ask}"만 한 번 묻는다.`)
  const help = def.help.map(action => `- [AI 도움: ${action.label}] ${action.prompt}`)
  return [
    TRAINING_MODE_RULES,
    `## 이 활동의 칸 (${displayActivityCode(code)} ${ACTIVITY_META[code].label})\n\n${tiers.join('\n\n')}`,
    deps.length ? `## 앞 활동을 건너뛰었을 때\n${deps.join('\n')}` : '',
    `## 화면의 AI 도움 버튼 (요청이 오면 그 일만)\n${help.join('\n')}`,
  ].filter(Boolean).join('\n\n')
}
