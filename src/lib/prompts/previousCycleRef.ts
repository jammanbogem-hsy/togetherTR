/**
 * Task #23 Phase 3: 이전 주기 참고 시스템 프롬프트 (previous-cycle-ref)
 *
 * ACTION_CARD primary "이전 주기 반영하기" 클릭 시 호출되는 엔드포인트의 프롬프트.
 * 사용 데이터: P1-I에서 `finalizeCycleTransition`이 저장한 `project.previousCycleImprovements`.
 *
 * 톤 원칙:
 *  - 중립적 제안 (강요 금지). 강제·당위 어휘("반드시"/"꼭"/"해야 합니다"/"무조건"/"~야 합니다"/"필수적으로"/"잊지 마세요"/"중요한 점은") 모두 금지.
 *  - 정확히 2~3문장. 길면 교사 피로.
 *  - 질문형 마감("~는 어떨까요" 등) 권장 — synthesize 카드 톤과 일관성 유지.
 *  - currentActivity에 따라 맥락 차별화 — 비전/목표/그 외.
 *
 * 교차 감수 (pedagogy-auditor, 2026-04-12) 반영 사항:
 *  1. 어미 톤 — 명령형 "검토해 보세요" 제거, 질문형 "~는 어떨까요" 채택.
 *  2. 강요어 리스트 4 → 8개 확장 (한자어·당위형 우회 선제 차단).
 *  3. T-1-1 힌트 — "비전 재정의" 함의 약화 + "비전 구체화·풍부화" 함의 강화 ("비전 문장에 녹여낸다").
 *  4. 권장 예시 2개로 확장 — 문예체 + 담백체. LLM formula 고착 방지.
 */

import { ACTIVITY_META, type ActivityCode } from '@/types'

export interface PreviousCycleRefInput {
  cycleNumber: number
  e11Improvement?: string       // E-1-1 '수정안' 원문
  e21Improvement?: string       // E-2-1 '팀 개선안' 원문
  nextCycleChoice?: 'A' | 'B'   // A=즉시 반영 / B=기록만
}

/**
 * currentActivity별 맥락 힌트. 활동 종류에 따라 "이번 비전에" / "이번 목표에" 같은 문장 연결어 달라짐.
 * 알려지지 않은 활동이면 generic "이번 활동에"로 폴백.
 */
function contextHint(currentActivity: ActivityCode): string {
  const label = ACTIVITY_META[currentActivity]?.label ?? '이번 활동'
  switch (currentActivity) {
    case 'T-1-1':
      return `이번 "팀 공통 비전 설정"에서 지난 주기의 경험을 비전 문장에 어떻게 녹여낼 수 있을지`
    case 'T-1-2':
      return `이번 "수업설계 방향 설정"에 어떻게 반영할 수 있을지`
    case 'T-2-1':
    case 'T-2-2':
    case 'T-2-3':
      return `이번 "${label}"에 어떻게 반영할 수 있을지`
    case 'A-1-2':
    case 'A-2-1':
    case 'A-2-2':
    case 'A-2-3':
      return `이번 주제·분석 단계("${label}")에서 어떻게 고려할 수 있을지`
    case 'Ds-1-1':
    case 'Ds-1-2':
    case 'Ds-1-3':
    case 'Ds-2-1':
    case 'Ds-2-2':
      return `이번 수업 설계 활동("${label}")에서 어떻게 고려할 수 있을지`
    default:
      return `이번 활동("${label}")에 어떻게 반영할 수 있을지`
  }
}

/**
 * 이전 주기 참고 시스템 프롬프트 빌더.
 * Caller는 반환된 문자열을 `messages`의 system 역할로 전달하고, user 메시지는 따로 구성해서 넣지 말 것 —
 * 이 프롬프트 하나로 응답을 만들도록 설계됨 (messages에는 최소한의 trigger 1개만 두면 됨).
 */
export function buildPreviousCycleRefPrompt(
  ref: PreviousCycleRefInput,
  currentActivity: ActivityCode
): string {
  const hint = contextHint(currentActivity)

  // 개선안 섹션: 있는 것만 노출
  const improvementLines: string[] = []
  if (ref.e11Improvement) {
    improvementLines.push(`- 지난 주기 수업 성찰 수정안: "${ref.e11Improvement}"`)
  }
  if (ref.e21Improvement) {
    improvementLines.push(`- 지난 주기 팀 활동 개선안: "${ref.e21Improvement}"`)
  }
  const improvementBlock = improvementLines.length > 0
    ? improvementLines.join('\n')
    : '(구체적 개선안 텍스트는 기록되지 않음)'

  // nextCycleChoice 컨텍스트: B였다면 "기록만 남기셨는데 이번엔 본격 반영" 톤 활용
  let choiceContext = ''
  if (ref.nextCycleChoice === 'B') {
    choiceContext = `\n추가 컨텍스트: 지난 주기 말 팀은 "개선사항만 기록하고 나중에 시작" (B안)을 선택했습니다. 이번 주기가 그 "나중"에 해당합니다 — 기록만 했던 개선안을 본격 반영할 수 있는 시점임을 자연스럽게 짚어줘도 좋습니다.`
  } else if (ref.nextCycleChoice === 'A') {
    choiceContext = `\n추가 컨텍스트: 지난 주기 말 팀은 "개선사항 자동 반영하며 즉시 다음 주기 시작" (A안)을 선택했습니다. 개선 의지가 높은 상태이므로 구체적 반영 방안을 제안해도 환영받습니다.`
  }

  return `당신은 T-CID 협력적 수업설계의 AI 코치입니다. 팀이 이전 주기(${ref.cycleNumber}주기)를 마치고 이번 주기로 넘어온 상황에서, 이전 주기 성찰 결과를 이번 활동에 연결해주는 "참고 제안" 역할을 맡고 있습니다.

## 이전 주기 성찰 데이터
${improvementBlock}
${choiceContext}

## 이번 활동
활동 코드: ${currentActivity}
활동명: ${ACTIVITY_META[currentActivity]?.label ?? '(알 수 없음)'}

## 응답 지침 (엄격 준수)
1. **정확히 2~3문장**으로 응답합니다. 한 문장도 더 쓰지 마세요. 교사가 빠르게 훑어야 하는 카드입니다.
2. 첫 문장: 지난 주기에서 도출된 개선안을 간결히 요약.
3. 두 번째/세 번째 문장: ${hint}에 대한 **구체적 제안 1가지**. 추상적 격려 ("잘 하고 계세요") 금지, 실행 가능한 제안만.
4. 강요어 **금지** (8개, 한자어·당위형 포함): "반드시", "꼭", "해야 합니다", "무조건", "~야 합니다", "필수적으로", "잊지 마세요", "중요한 점은" — 모두 사용 금지.
5. **질문형 마감 권장**: "~는 어떨까요", "~해 보시는 건 어떨까요", "~한 방향도 가능하지 않을까요" 같이 팀에 결정권을 돌려주는 어미. 명령형 "~세요"는 가급적 피하고 부득이한 경우에만 사용.
6. 이전 개선안 원문이 비어있으면 (위 데이터가 "기록되지 않음"이면): 그 사실을 솔직히 인정하며 "이전 주기 자료가 충분치 않지만, ${hint}에 대해 이렇게 시작해 보는 건 어떨까요" 식으로 일반적 제안 1개만 제시.
7. 신호([ACTION_CARD], [ARTIFACT_UPDATE] 등) 사용 **금지**. 순수 텍스트만.
8. 서두에 "네, 알겠습니다" / "참고 드리겠습니다" 같은 인사말 **금지** — 바로 본론부터.

## 금지 패턴 예시 (따라하지 말 것)
- ❌ "지난 주기의 개선안을 반드시 이번 비전에 반영해야 합니다." (강요어 + 명령형)
- ❌ "네, 이전 주기 참고 드릴게요. 지난 번에는 ... 그리고 ... (4문장 이상)" (인사말 + 분량 초과)
- ❌ "잘 하고 계세요. 팀이 성장하고 있네요." (추상적 격려만)
- ❌ "잊지 마세요, 학생 참여를 높이는 것이 중요한 점입니다." (강요·당위 어휘)

## 권장 패턴 예시 (문체 다양성 — 두 가지 모두 가능)
- ✅ (문예체) "지난 주기엔 '학생 참여가 낮았다'는 점이 수업 성찰 수정안으로 남았네요. 이번 비전 설정에서는 '학생의 목소리가 수업 흐름을 바꾸는 순간'을 한 문장으로 녹여내 보는 건 어떨까요? 팀의 교실 상황에 맞춰 자유롭게 다듬어 주시면 됩니다."
- ✅ (담백체) "지난 주기 팀 개선안에서 '협업 시간 부족'이 짚였습니다. 이번 활동에서는 핵심 토의 항목 1개당 시간 박스를 미리 정해두는 방식도 가능하지 않을까요? 팀 호흡에 맞게 조정 가능합니다."

이제 위 지침에 따라 응답하세요.`
}
