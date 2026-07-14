// 랜딩 콘텐츠 데이터 — 원본(@/types, @/lib/ui/stageColors)에서 파생만 하고 원본은 무수정.
import { STAGES, ACTIVITY_META, ACTIVITY_DISPLAY_CODE } from '@/types'
import type { StageCode } from '@/types'
import { STAGE_COLOR } from '@/lib/ui/stageColors'
import type { StageColor } from '@/lib/ui/stageColors'

export interface WorkflowStage {
  code: StageCode
  label: string
  metaphor: string
  color: StageColor
  activities: { display: string; label: string }[]
}

// 5과정 카드 데이터 — STAGES 실측(라벨·농사 메타포 description·활동 목록) + 표시 번호 + 활동 라벨
export const WORKFLOW_STAGES: WorkflowStage[] = STAGES.map(stage => ({
  code: stage.code,
  label: stage.label,
  metaphor: stage.description,
  color: STAGE_COLOR[stage.code],
  activities: stage.activities.map(code => ({
    display: ACTIVITY_DISPLAY_CODE[code],
    label: ACTIVITY_META[code].label,
  })),
}))

// 전체 활동 수 (실값 — 현재 19)
export const TOTAL_ACTIVITIES = STAGES.reduce((n, s) => n + s.activities.length, 0)

// 4단계 시작 스텝
export const START_STEPS = [
  {
    no: '01',
    title: '로그인하고 프로필 만들기',
    desc: 'Google 계정으로 로그인한 뒤, 이름·학교급·학교명·담당 학년을 입력합니다.',
  },
  {
    no: '02',
    title: '팀 만들고 동료 초대하기',
    desc: '방장이 팀을 만들면 초대 코드가 생깁니다. 동료는 코드로 참여하고, 방장이 진행을 제어합니다.',
  },
  {
    no: '03',
    title: '프로젝트 시작하기',
    desc: '학교급·학년군·교과·학기를 정해 협력 프로젝트를 만듭니다.',
  },
  {
    no: '04',
    title: 'AI와 함께 설계하기',
    desc: 'T→A→Ds→DI→E 흐름을 AI 퍼실리테이터와 단계별로 진행합니다.',
  },
] as const

// AI가 하는 네 가지 일 (symbol: Material Symbols Rounded 리거처, emoji: 하위호환 유지)
export const AI_ROLES = [
  { emoji: '📌', symbol: 'checklist', title: '절차 안내', desc: '활동마다 무엇을 어떤 순서로 정하면 되는지 단계별로 안내합니다.' },
  { emoji: '✍️', symbol: 'edit_document', title: '초안 제안', desc: '비전·규칙·평가 등 산출물의 A안·B안 초안을 제안해 논의의 출발점을 만듭니다.' },
  { emoji: '🔍', symbol: 'task_alt', title: '정합성 점검', desc: '앞 단계에서 정한 비전·목표와 어긋나는 부분이나 빠진 항목을 짚어줍니다.' },
  { emoji: '📝', symbol: 'forum', title: '대화·기록', desc: '팀 토의를 제안하고, 이름을 부르며 개인별로 피드백해 논의를 기록으로 남깁니다.' },
] as const

// 협력 UP 5원리
export const PRINCIPLES = [
  { tag: '#활성화', desc: '모두가 입을 열도록 참여를 이끌어냅니다.' },
  { tag: '#외현화', desc: '머릿속 생각을 말과 글로 꺼내 눈에 보이게 합니다.' },
  { tag: '#조정', desc: '서로 다른 의견을 맞추고 역할을 나눕니다.' },
  { tag: '#상호의존', desc: '서로에게 기대는 구조로 함께 완성합니다.' },
  { tag: '#인지분산', desc: '부담이 한 사람에게 쏠리지 않게 나눕니다.' },
] as const

// 협업·산출물·보고서 체크리스트
export const COLLAB_FEATURES = [
  { title: '실시간 동기화', desc: '채팅·산출물·활동 상태를 팀원 모두가 같은 화면에서 봅니다.' },
  { title: '12종 공동 편집 워크스페이스', desc: '비전·규칙·일정·평가·문제상황 등 산출물을 표와 블록으로 함께 편집합니다.' },
  { title: '지식 그래프', desc: '성취기준을 탐색하고 중심 교과를 고정해 분석에 연결합니다.' },
  { title: '단계·종합 보고서', desc: '단계별 분석 보고서와 누적 종합 보고서를 만들고, HWPX·PDF로 내보내거나 공개 링크로 공유합니다.' },
] as const

// FAQ
export const FAQ_ITEMS = [
  {
    q: '혼자서도 쓸 수 있나요?',
    a: '팀 협력이 기본이지만, 혼자 설계하는 방식도 지원합니다. 팀을 만들면 초대 코드로 동료를 부를 수 있습니다.',
  },
  {
    q: '만든 수업설계는 어떻게 남나요?',
    a: '활동별 산출물이 실시간으로 저장되고, 단계·종합 보고서를 HWPX·PDF로 내보내거나 공개 링크로 공유할 수 있습니다.',
  },
  {
    q: 'AI가 수업을 대신 만들어 주나요?',
    a: '아니요. AI는 절차를 안내하고 초안을 제안할 뿐, 결정은 팀이 합니다.',
  },
] as const
