import { ACTIVITY_META, type ActivityCode } from '@/types'

export interface DemoActivityContract {
  steps: Array<{ id: string; title: string; instruction: string }>
  artifactGuidance: string
  completionCriteria: string[]
}

type ContractDefinition = Omit<DemoActivityContract, 'artifactGuidance'> & { format: string }
const step = (id: string, title: string, instruction: string) => ({ id, title, instruction })

// Shared pedagogical intent, not a scripted conversation. Each step is separately
// facilitated and teachers contribute before the next step receives their work.
const CONTRACTS: Record<ActivityCode, ContractDefinition> = {
  'T-1-1': {
    steps: [
      step('personal-vision', '참여 목적과 개인 비전', '총괄 AI는 참여 배경과 학생에게 바라는 경험을 묻는다. 각 교사는 자기 페르소나의 관점으로 키워드 3~5개와 개인 비전 한 문장을 직접 제안한다. 아직 팀 비전을 대신 결정하지 않는다.'),
      step('cluster-candidates', '키워드 묶기와 후보 조정', '총괄 AI는 직전 개인 비전의 원문과 교사 이름을 연결하여 키워드를 묶고, 통합 비전 후보 3개를 A/B/C안으로 제시한다. 각 후보에 어떤 교사의 어떤 키워드가 반영되었는지 근거를 붙인다. 각 교사는 후보를 비교·선택하거나 구체적인 문장 수정을 제안한다.'),
      step('joint-vision', '공동 비전 명문화', '총괄 AI는 교사들의 후보 선택과 수정 요청을 반영한 단일 비전 초안을 보여준다. 각 교사는 자신의 핵심 가치가 반영되었는지 확인하고 빠진 관점을 보완한다. 교과별 문장들을 나열하지 말고 하나의 학생 경험으로 연결한다.'),
    ],
    format: '개인 비전: 모든 교사가 각각 한 행인 마크다운 표(교사명 | 개인 키워드 3~5개 | 정교화 비전). 팀 공통 비전: 선택·수정된 단일 문장과 선택 근거. 핵심 키워드: 쉼표로 구분한 3~5개. 개인 키워드를 임의로 바꾸거나 교사를 누락하지 않는다.',
    completionCriteria: ['모든 교사의 개인 비전과 키워드가 보존됨', '3개 후보를 실제 비교한 뒤 교사 선택·수정을 반영함', '최종 비전을 교사별로 검토함'],
  },
  'T-1-2': {
    steps: [
      step('principles', '공동 비전을 설계 원칙으로', '총괄 AI가 확정 비전을 다시 보여준다. 각 교사는 “~한 수업이 되려면 ~해야 한다” 형식의 원칙과 비전상의 근거를 제안한다. 지금은 교육과정 코드·차시 활동·도구를 확정하는 단계가 아니다.'),
      step('priorities-veto', '원칙 조정과 멈춤 조건', '총괄 AI는 중복 원칙을 묶은 3~5개 초안을 번호로 제시한다. 각 교사는 충돌하는 원칙의 우선 판단 기준과 이대로 진행하면 안 되는 멈춤 신호(거부권)를 협의한다. 특정 교사의 기술적 관심이 공동 비전을 대체하지 않게 한다.'),
    ],
    format: '설계 방향: 마크다운 표(번호 | 설계 원칙 | 비전 연결 근거 | 멈춤 신호). 데이터 행 3~5개. 각 원칙은 “~하려면 ~해야 한다” 또는 “~한 수업이 되려면 ~해야 한다” 형식이며 하나 이상의 명시적인 멈춤·보류 조건이 필요하다.',
    completionCriteria: ['조건-행동 관계의 원칙 3~5개와 번호가 있음', '공동 비전 근거와 교사의 멈춤 조건이 있음'],
  },
  'T-2-1': {
    steps: [
      step('tasks-strengths', '과업과 교사의 희망·조건', '총괄 AI는 앞으로 필요한 설계·자료·검토 과업을 제시한다. 각 교사는 강점, 맡고 싶은 과업, 시간·부담의 제약을 밝힌다. 교과별 수업을 따로 만들도록 분리하지 않는다.'),
      step('balance-review', '균형 배분과 상호의존', '총괄 AI는 누가 무엇을 언제까지 수행할지 공동 작업안을 제시한다. 각 교사는 부담과 누락을 조정하고, 자기 작업을 검토할 다른 교사 및 다른 작업과 연결되는 지점을 정한다. 총괄 AI는 일을 배정했다고 합의로 간주하지 않는다.'),
    ],
    format: '역할 배분: 모든 교사가 한 행 이상인 마크다운 표(담당자 | 과업 | 기한 | 공동 검토자·연결 과업). 사용자에게 없는 실제 날짜는 만들지 말고 “수업 3일 전” 같은 상대 기한으로 기록한다.',
    completionCriteria: ['모든 교사의 과업·기한이 구체적임', '과업 간 연결과 다른 교사의 교차 검토가 있음'],
  },
  'T-2-2': {
    steps: [
      step('team-rules', '협력 조건과 규칙 제안', '총괄 AI는 교사팀의 발언·기록·검토·응답 방식에서 필요한 약속을 묻는다. 교사는 자기 협력 스타일과 제약에서 규칙과 필요 배경을 제안한다. 학생 생활 규칙이나 위반 처벌을 만들지 않는다.'),
      step('conflict-practice', '갈등 장면에서 실천 가능성 점검', '총괄 AI는 교사 의견이 충돌하는 구체적인 예시 상황을 제시한다. 각 교사는 규칙을 적용해 조정하고 실천 가능한 약 5개 규칙으로 다듬는다. 갈등 때 판단 근거로 돌아오는 규칙을 반드시 포함한다.'),
    ],
    format: '팀 규칙: 마크다운 표(규칙명 | 필요 배경 | 실천 방법), 4~6개 규칙. 대상은 교사팀이며 “갈등·이견·불일치” 상황을 다루는 규칙을 최소 1개 포함한다.',
    completionCriteria: ['교사팀 협력 규칙과 실천 방법이 있음', '갈등 상황 규칙을 적용·검토함'],
  },
  'T-2-3': {
    steps: [
      step('reverse-plan', '수업 실행일 기준 역산', '총괄 AI는 수업 실행일과 가용 시간을 확인한다. 각 교사는 자신의 과업 소요 기간과 검토 시간을 제안한다. 실제 날짜가 없으면 가정임을 명시한 D-day 상대 일정으로만 설계한다.'),
      step('buffer-meetings', '예비일과 정기 회의 합의', '총괄 AI는 과업 선후관계와 병목을 보여준다. 각 교사는 1~2일 예비일, 정기 회의 시점·목적·준비물과 자신의 기한을 조정한다. 자료 개발 뒤에 교차 검토 시간이 남는지 확인한다.'),
    ],
    format: '팀 일정: 마크다운 표(기간 | 활동 | 내용 | 담당자), 최소 3개 일정. 예비일 1~2일, 정기 회의 시점과 목적·준비물을 포함한다. 실제 실행일 미입력 시 상대 일정이라는 가정을 명시한다.',
    completionCriteria: ['실행일 기준 과업 선후관계와 담당이 있음', '예비일과 정기 회의가 명시됨'],
  },
  'A-1-1': {
    steps: [
      step('selection-criteria', '비전 기반 선정 기준', '총괄 AI는 T의 비전과 원칙을 제시한다. 각 교사는 주제를 판단할 핵심 기준과 참고 기준을 제안한다. 이미 주제가 정해졌으면 새 주제를 억지로 만들지 말고 그 주제의 범위·적합성을 판단할 기준을 논의한다.'),
      step('criteria-agreement', '기준 조정·적용 가능성', '총괄 AI는 핵심 기준 3~5개와 참고 기준을 구분한다. 각 교사는 실제 학생·학교 맥락에 적용해 모호한 기준을 수정하고 필요한 경우 주제가 고정되어 있음을 합의 기록한다.'),
    ],
    format: '주제 선정 기준: 핵심 기준 3~5개와 참고 기준을 구분한 목록 또는 표. 각 기준의 의미와 비전·학생 맥락의 연결 근거를 함께 기록한다.',
    completionCriteria: ['핵심 기준과 참고 기준이 구분됨', '팀 비전·학생 맥락으로 기준을 조정함'],
  },
  'A-1-2': {
    steps: [
      step('topic-comparison', '주제 또는 주제 범위 비교', '총괄 AI는 이전 선정 기준을 재사용한다. 교사들은 자기 교과·학생 관점으로 후보를 비교한다. 이미 고정된 주제라면 범위나 접근 방식을 비교하며 사용자 주제를 임의로 바꾸지 않는다.'),
      step('topic-choice', '선정 이유와 기여 연결', '총괄 AI는 기준별 비교를 보여준다. 교사들은 내용·기능·혼합형 중 성격을 판단하고 최종 주제에 각 교사의 기여가 연결되는지 검토한다. 채택하지 않은 제안도 이유를 남긴다.'),
    ],
    format: '주제 선정 기준: 기존 기준과 우선 판단 기준. 최종 선정 주제: 확정 주제·범위. 주제 유형: 내용 중심/기능 중심/혼합 중 해당 유형. 선정 근거: 비전·교과·학생 맥락의 비교 근거와 미채택 제안의 이유.',
    completionCriteria: ['기존 기준으로 주제·범위를 비교함', '단순 교과 병렬이 아닌 공동 주제와 선정 이유가 있음'],
  },
  'A-2-1': {
    steps: [
      step('subject-analysis', '교과별 내용과 근거 분석', '총괄 AI는 선택 주제와 사용 가능한 교육과정 자료를 확인한다. 교사는 자기 교과의 지식·이해, 과정·기능, 가치·태도를 제안한다. 자료가 제공되지 않은 성취기준의 공식 코드·원문·출처를 만들어내지 말고 확인 필요라고 표시한다.'),
      step('restructure', '공통 내용 재구조화', '총괄 AI는 교과별 공통점·차이를 드러낸다. 교사들은 공동 탐구에 필요한 내용을 연결하고 중복·과도한 수준을 조정한다. 공통 개념, 수행 기능, 루브릭 연계와 교과 고유 기여를 함께 남긴다.'),
    ],
    format: '성취기준분석표: 마크다운 표(교과 | 핵심아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 근거·확인 상태). 교과별 행과 공통(팀 조정) 행을 포함한다. 제공된 교육과정이 없으면 공식 코드 생성 금지, “교육과정 원문 확인 필요”를 표기한다.',
    completionCriteria: ['교과별 내용과 팀 조정 행이 있음', '공식 성취기준의 확인 여부가 명확함'],
  },
  'A-2-2': {
    steps: [
      step('core-inquiry', '공통 아이디어와 학생의 질문', '총괄 AI는 내용 분석에서 도출된 연결을 제시한다. 각 교사는 공통 핵심 아이디어 한 문장과 학생이 탐구할 수 있는 질문을 제안한다. 학년 수준을 벗어난 통계·전문 용어를 목표로 강요하지 않는다.'),
      step('integrated-goals', '통합 목표와 교과별 기여', '총괄 AI는 하나의 통합 목표 초안을 제시한다. 각 교사는 자기 교과가 공동 목표에 어떻게 기여하는지와 관찰 가능한 학생 수행을 검토한다. 교과별 목표를 단순 이어 붙인 문장을 수정한다.'),
    ],
    format: '공통 핵심 아이디어: 하나의 핵심 문장. 탐구 질문: 학생 언어의 열린 질문. 통합 수업목표: 연결된 학생 수행을 나타내는 단일 문장. 교과별 수업목표: 마크다운 표(교과 | 목표 | 통합 목표 기여).',
    completionCriteria: ['아이디어·질문·통합 목표가 서로 연결됨', '교과별 기여가 관찰 가능한 수행으로 표현됨'],
  },
  'A-2-3': {
    steps: [
      step('learner-context', '학습자와 실행 맥락', '총괄 AI는 입력된 학생·학교 맥락을 재확인한다. 교사는 선행 경험, 읽기·수리·표현의 접근성, 기기·시간·자료 제약을 제안한다. 실제 학생 검사 결과나 개인 정보를 가정해 생성하지 않는다.'),
      step('learner-guardrails', '공통·개별 설계 조건', '총괄 AI는 공통 조건과 교사별 관찰 관점을 묶는다. 교사들은 설계에서 지켜야 할 접근성 조건과 확인할 가정을 구분한다. 이후 Ds의 평가·활동·지원 설계에 이 조건을 어떻게 반영할지 합의한다.'),
    ],
    format: '학습자 프로필: 팀 공통 조건과 모든 교사의 맞춤 관점을 구분한 표 또는 소제목. 이미 확인된 맥락/가정/추가 확인 필요를 구별하고 설계 대응을 기록한다.',
    completionCriteria: ['공통 조건과 교사별 관점이 보존됨', '확인된 정보와 가정을 구분한 설계 가드레일이 있음'],
  },
  'Ds-1-1': {
    steps: [
      step('learning-evidence', '목표 달성 증거부터 설계', '총괄 AI는 통합 목표·교과 목표·학습자 조건을 보여주고 어떤 학생 수행을 보면 도달을 알 수 있는지 묻는다. 교사는 결과와 과정 증거를 먼저 제안한다. 활동이나 도구 선택부터 시작하지 않는다.'),
      step('assessment-alignment', '공동 평가 정합성 검토', '총괄 AI는 확인 지점·요소·방법·시점·주체를 정리한다. 교사들은 같은 학생 산출물을 각 교과 관점에서 함께 볼 수 있는지와 표현 방식에 따른 불이익을 검토하고 평가 기준을 수정한다.'),
    ],
    format: '평가 계획: 마크다운 표(확인 지점·목표 | 평가 요소 | 평가 방법·증거 | 시점 | 주체). 최소 2개 확인 지점에 과정·결과 증거와 관찰 가능한 기준을 포함한다.',
    completionCriteria: ['목표와 관찰 가능한 증거가 연결됨', '방법·시점·주체와 접근성을 공동 검토함'],
  },
  'Ds-1-2': {
    steps: [
      step('authentic-situation', '실제성 있는 공동 문제', '총괄 AI는 탐구 질문과 평가 증거를 제시한다. 각 교사는 학생이 맡을 역할, 해결할 문제와 실제 맥락을 제안한다. 단순히 측우기 만들기와 그래프 그리기를 나열하지 않는다.'),
      step('audience-action', '청중·행위·제약 연결', '총괄 AI는 하나의 문제 상황 초안을 보여준다. 교사들은 학생의 선택권, 활용할 자료와 제약, 만들어 전달할 결과물, 이를 읽을 청중과 실제 행위를 구체화한다.'),
    ],
    format: '문제상황: 제목과 시나리오에 학생 역할, 문제, 조건·제약, 산출물, 청중과 행위를 명시한다. 핵심 질문: A의 탐구 질문과 연결되는 질문. 확인되지 않은 지역 사건은 실제 사실처럼 쓰지 않는다.',
    completionCriteria: ['학생 역할·문제·산출물·청중·행위가 연결됨', '탐구 질문과 평가에 정합적임'],
  },
  'Ds-1-3': {
    steps: [
      step('learning-sequence', '학생 사고 흐름 설계', '총괄 AI는 문제 상황과 평가 계획을 제시한다. 교사들은 문제 이해→탐색→분석→판단→생산→공유·수정의 여섯 사고 흐름을 공동으로 설계한다. 각자 교과 시간표를 별도로 만들지 않는다.'),
      step('time-alignment', '시간·목표·평가 연결 점검', '총괄 AI는 누적 차시·시간을 정리한다. 각 교사는 전체 흐름에서 자기 교과 기여와 다른 교과 기여가 만나는 지점을 점검하고, 제한 차시 안에서 핵심/부가 활동을 조정한다.'),
    ],
    format: '학습 활동: 6개 흐름 행의 마크다운 표(흐름 단계 | 동사형 활동명 | 학생 수행·교과 연결 | 핵심/부가 | 차시·시간 | 평가 연결). AI 점검: 총 시간, 목표·평가 정합성, 접근성 및 수정 결과를 구체적으로 기록한다.',
    completionCriteria: ['여섯 사고 흐름과 시간 배분이 있음', '목표·평가·교과 기여가 하나의 학생 활동에 연결됨'],
  },
  'Ds-2-1': {
    steps: [
      step('resource-functions', '활동에서 필요한 자료 기능', '총괄 AI는 학습 활동별 부족한 자료 기능을 묻는다. 교사들은 특정 도구 이름부터 고르지 않고 탐색·표현·검증·공유에 필요한 기능과 출처, 탐색/개발 여부를 제안한다.'),
      step('agency-safety', '역할 경계와 자료 책임', '총괄 AI는 자료 담당·검토자·기한을 연결한다. 각 교사는 학생이 판단할 일, AI가 도울 일, 교사가 책임질 일을 구분하고 출처·저작권·개인정보·접근성을 점검한다.'),
    ],
    format: '활동별 자료 설계: 마크다운 표(활동 | 자료·기능 | 탐색/개발·출처 | 담당 | 기한 | 검토자). Human-AI Agency: 학생·AI·교사의 역할과 금지 경계. AI 점검: 출처·저작권·개인정보·접근성의 확인 여부와 대안.',
    completionCriteria: ['자료의 기능·담당·기한·검토자가 있음', '학생 판단을 대체하지 않는 AI 역할 경계가 있음'],
  },
  'Ds-2-2': {
    steps: [
      step('barriers-support', '학습 장벽과 최소 지원', '총괄 AI는 학습자 프로필을 근거로 학생이 막힐 장면을 제시한다. 교사는 대상 활동과 학생에게 필요한 질문·표현 틀·도움을 제안한다. 지원이 정답 제공이나 모든 학생에게 같은 도움을 주는 방식이 되지 않게 한다.'),
      step('walkthrough-fading', '학생 관점 실행과 지원 제거', '총괄 AI는 각 지원을 학생 관점에서 따라가도록 요청한다. 교사들은 지원의 시점·대상·점진적 제거 기준과 독립 수행 기회를 조정한다.'),
    ],
    format: '지원 방안 정리: 예상 장벽과 대상 활동. 스캐폴딩 계획: 마크다운 표(활동 | 지원 유형·내용 | 대상 | 제공 시점 | 점진적 제거 기준). AI 점검: 학습자 프로필 연결, 정답 대체 여부, 독립 수행 기회와 수정 결과.',
    completionCriteria: ['학습자 장벽과 맞춤 지원이 연결됨', '제공·제거 시점과 독립 수행 기회가 있음'],
  },
  'DI-1-1': {
    steps: [
      step('material-production', '실제로 사용할 자료 제작', '총괄 AI는 Ds의 확정 활동·평가·지원 계획을 보여준다. 각 교사는 담당 자료의 실제 본문을 작성한다. 최소 학생용 활동지(안내와 문항 2개 이상), 바로 읽을 수 있는 예시 CSV 데이터, 관찰 가능한 수준별 평가 기준을 공동 자료로 만든다. “추후 개발” 목록만 제출하지 않는다. 예시 데이터는 합성임을 명시한다.'),
      step('material-peer-review', '학생 관점 교차 검토·수정', '총괄 AI는 앞서 작성한 자료 본문을 연결해 보여준다. 각 교사는 다른 교사가 만든 문항·데이터·평가 기준을 학생처럼 수행하며 모호함·접근성·불일치를 지적하고 수정 본문을 제안한다. 최종 자료에 버전과 무엇을 왜 바꿨는지 남긴다.'),
    ],
    format: '개발 자료 목록: 담당·버전·학생 관점 검토 결과의 목록에 이어 “학생용 활동지” 소제목 아래 학생 안내와 실제 문항 2개 이상, “합성 예시 데이터” 아래 csv 코드 블록(열 이름과 3행 이상의 데이터), “평가 기준” 아래 요소와 수준별 관찰 기준의 마크다운 표를 모두 포함한다. 외부 파일이 없어도 이 본문 자체를 내려받아 사용할 수 있어야 한다. 목록·링크·제작 약속만으로 완료하지 않는다.',
    completionCriteria: ['활동지 본문·예시 CSV·평가 기준이 실제 생성됨', '다른 교사의 학생 관점 검토를 반영한 버전이 있음'],
  },
  'DI-2-1': {
    steps: [
      step('evidence-scenes', '자료 기반 실행 장면 기록', '총괄 AI는 실제 제작된 DI 자료를 제시하고 관찰 기록 방식을 안내한다. 데모에서는 실제 수업을 한 것처럼 말하지 않고 명시적으로 시뮬레이션한다. 각 교사는 자료의 특정 문항·행·기준을 사용한 예시 반응을 하나 이상 작성한다. 목표 도달·오개념·창의적 반응이 구별되게 구성하되 모두 가상임을 밝힌다.'),
      step('evidence-cross-check', '관찰과 해석 분리', '총괄 AI는 장면 기록을 모은다. 교사는 동료 기록이 실제 생성 자료의 어느 위치와 연결되는지 교차 확인하고 장면 ID·시점·기록자·관찰 가능한 반응·증거 위치를 보완한다. 수업 효과나 원인을 단정하지 말고 해석은 E단계 질문으로 남긴다.'),
    ],
    format: '주요 상황 기록: 데모에서는 첫 줄에 “시뮬레이션 — 실제 수업 자료가 아님”을 명시하고 최소 3개 장면을 표로 기록(장면 ID | 시점·차시 | 기록자 | 관찰·학생 반응 | 증거 위치). SIM-1 등의 ID를 사용하며 증거 위치는 DI-1에서 생성한 자료명·문항·행을 구체적으로 가리킨다. E단계 확인 질문: 장면 ID별 해석 유보 질문.',
    completionCriteria: ['시뮬레이션 여부와 장면별 증거 위치가 명시됨', '최소 3개 장면의 사실과 추후 해석 질문이 분리됨'],
  },
  'E-1-1': {
    steps: [
      step('evidence-reflection', '증거 기반 수업 성찰', '총괄 AI는 DI의 장면 ID와 목표·평가 기준을 함께 제시한다. 교사는 목표 도달·오개념·창의적 예시 반응을 비교하여 관찰 사실과 원인 가설을 구분한다. 데모의 합성 증거로 실제 학습 효과가 입증되었다고 말하지 않는다.'),
      step('joint-revision', '공동 자료 수정', '총괄 AI는 근거가 있는 수정 후보를 모은다. 각 교사는 어떤 활동·자료의 어느 부분을 수정할지와 수정 본문을 제안하고 동료의 변경이 다른 교과 목표를 해치지 않는지 검토한다. 단순 “개선하겠다” 대신 변경 전→후, 이유, 재확인 방법을 기록한다.'),
    ],
    format: '사실: DI 장면 ID(SIM-1 등)와 관찰 증거를 연결하고 데모라면 합성·시뮬레이션임을 명시한다. 해석: 증거에 근거한 원인 가설과 대안 해석·한계. 수정안: 대상 활동·자료·문항, 변경 전과 변경 후의 실제 수정 문구, 이유, 재확인 방법. 증거 없이 실제 학습 효과를 주장하지 않는다.',
    completionCriteria: ['사실·해석·수정이 같은 장면 증거로 연결됨', '실제 수정 문구와 확인 방법이 있음'],
  },
  'E-2-1': {
    steps: [
      step('collaboration-evidence', '협력 과정과 원칙 재확인', '총괄 AI는 처음의 비전·설계 원칙·역할·규칙과 실제 대화 기록에서 관찰된 의사결정 장면을 제시한다. 각 교사는 자신의 관점이 다른 교사의 제안으로 어떻게 바뀌었는지와 쏠림·누락·상호의존을 발언 근거로 성찰한다. 없는 발언·갈등을 만들지 않는다.'),
      step('operating-improvements', '협력 구조 개선', '총괄 AI는 개인 비난이 아닌 운영 구조의 개선안을 정리한다. 교사는 다음 설계에서 바꿀 발언·기록·교차 검토·합의 원칙과 담당·시점을 정한다. 교사팀의 합의 범위와 미해결 쟁점을 남기며 다음 주기는 사용자 결정 전 자동 시작하지 않는다.'),
    ],
    format: '협력 과정 성찰: T의 합의와 실제 대화의 교사명·활동·발언 또는 결정을 연결한 근거, 잘된 점과 한계. 팀 개선안: 마크다운 표(운영 원칙 | 변경 내용 | 근거 | 담당·시점). 다음 주기 선택: 데모 종료·다음 주기는 사용자 선택 대기라고 기록하며 자동 선택하지 않는다.',
    completionCriteria: ['T의 약속과 실제 대화에 근거해 성찰함', '개인 비난 대신 구체적인 운영 원칙을 개선함'],
  },
}

export function getDemoActivityContract(code: ActivityCode): DemoActivityContract {
  const definition = CONTRACTS[code]
  const sections = ACTIVITY_META[code].requiredSections ?? ACTIVITY_META[code].recommendedSections ?? []
  return {
    steps: definition.steps,
    artifactGuidance: `저장할 섹션 키는 정확히 다음과 같다: ${sections.map(section => section.key).join(', ')}. 임의로 키를 바꾸거나 추가하지 않는다. 각 섹션 값은 완성된 마크다운 본문이다.\n${definition.format}`,
    completionCriteria: definition.completionCriteria,
  }
}

interface MarkdownTable { headers: string[]; rows: string[][] }
function markdownTables(text: string): MarkdownTable[] {
  const lines = text.split('\n')
  const result: MarkdownTable[] = []
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim())
  for (let index = 1; index < lines.length; index += 1) {
    // GFM allows one or more delimiter hyphens (not just `---`). A bare
    // leading `- ` is a list marker, however, and does not start a table row.
    if (!lines[index].includes('|') || /^ {0,3}-\s/.test(lines[index]) || !cells(lines[index]).every(cell => /^:?-+:?$/.test(cell))) continue
    const headers = cells(lines[index - 1]).map(header => header.replace(/[*_`]/g, ''))
    if (headers.length !== cells(lines[index]).length || headers.some(header => !header)) continue
    const rows: string[][] = []
    let cursor = index + 1
    while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
      const row = cells(lines[cursor])
      if (row.length === headers.length && row.every(Boolean)) rows.push(row)
      cursor += 1
    }
    result.push({ headers, rows })
  }
  return result
}

// Deterministic format checks are a floor, never evidence of pedagogical quality.
// Teacher review separately checks attribution, truthfulness and lesson coherence.
export function validateDemoArtifactContent(code: ActivityCode, content: Record<string, string>, teacherNames: string[]): string[] {
  const errors: string[] = []
  const sections = ACTIVITY_META[code].requiredSections ?? ACTIVITY_META[code].recommendedSections ?? []
  for (const section of sections) {
    const value = content[section.key]
    if (section.required === 'optional' && !value) continue
    if (typeof value !== 'string' || value.trim().length < section.minChars) errors.push(`${section.key}: 완성된 본문이 필요합니다.`)
    else if (/^(추후\s*작성|작성\s*예정|미정|없음|tbd|n\/a)[.!\s]*$/i.test(value.trim())) errors.push(`${section.key}: 자리표시자는 산출물이 아닙니다.`)
  }
  for (const key of Object.keys(content)) if (!sections.some(section => section.key === key)) errors.push(`정의되지 않은 산출물 섹션: ${key}`)
  const field = (key: string) => typeof content[key] === 'string' ? content[key] : ''
  const requirePattern = (key: string, pattern: RegExp, message: string) => { if (!pattern.test(field(key))) errors.push(`${key}: ${message}`) }
  const requireTeachers = (key: string) => {
    for (const name of teacherNames) if (!field(key).includes(name)) errors.push(`${key}: ${name} 교사의 기여가 누락되었습니다.`)
  }
  const requireTable = (key: string, minRows: number, columns: RegExp[] = []) => {
    const tables = markdownTables(field(key))
    const missingColumns = (table: MarkdownTable) => columns.filter(pattern => !table.headers.some(header => pattern.test(header)))
    const match = tables.find(table => table.rows.length >= minRows && missingColumns(table).length === 0)
    if (!match) {
      const closest = [...tables].sort((left, right) => missingColumns(left).length - missingColumns(right).length || right.rows.length - left.rows.length)[0]
      const missing = closest ? missingColumns(closest) : columns
      const details = missing.length ? ` 필수 열 누락: ${missing.map(pattern => pattern.source.replace(/\|/g, '/')).join(', ')}.` : ''
      errors.push(`${key}: 내용이 채워진 마크다운 표 ${minRows}행 이상이 필요합니다(현재 ${closest?.rows.length ?? 0}행).${details}`)
    }
    return match
  }

  switch (code) {
    case 'T-1-1': {
      requireTeachers('개인 비전')
      requireTable('개인 비전', teacherNames.length, [/교사|이름|성명/, /키워드/, /비전/])
      const keywords = field('핵심 키워드').split(/[,，、\n]/).map(value => value.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean)
      if (keywords.length < 3 || keywords.length > 5) errors.push('핵심 키워드: 쉼표 또는 줄바꿈으로 구분한 3~5개가 필요합니다.')
      break
    }
    case 'T-1-2': {
      const table = requireTable('설계 방향', 3, [/번호|순서|순번/, /원칙|방향/, /근거|이유|비전/, /멈춤|중단|보류|거부/])
      if (table) {
        if (table.rows.length > 5) errors.push(`설계 방향: 원칙은 3~5개여야 합니다. 현재 ${table.rows.length}행입니다.`)
        table.rows.forEach((row, index) => {
          if (!/(?:려면|위해서는).{1,200}해야/.test(row.join(' '))) {
            errors.push(`설계 방향 ${index + 1}행: “${row.join(' | ').slice(0,240)}”의 원칙 문장을 “~한 수업이 되려면 ~해야 한다”로 고치세요. '~할 때'나 단순 행동 나열만으로는 조건-행동 원칙 형식을 충족하지 않습니다. 다른 행과 비전 근거·멈춤 조건은 보존하세요.`)
          }
        })
      }
      break
    }
    case 'T-2-1':
      requireTeachers('역할 배분')
      requireTable('역할 배분', teacherNames.length, [/담당|누가|교사/, /과업|무엇|업무|역할/, /기한|언제|일정|마감/])
      break
    case 'T-2-2':
      requireTable('팀 규칙', 4, [/규칙/, /배경|이유|근거/, /방법|실천|행동/])
      requirePattern('팀 규칙', /갈등|이견|불일치|의견.{0,8}(충돌|다를|다른)/, '교사 간 갈등 상황의 조정 규칙이 필요합니다.')
      break
    case 'T-2-3':
      requireTable('팀 일정', 3, [/기간|일정|시점|날짜/, /활동|과업/, /담당/])
      requirePattern('팀 일정', /예비|완충|버퍼/, '예비일을 포함해야 합니다.')
      requirePattern('팀 일정', /정기.{0,8}회의|회의.{0,8}정기/, '정기 회의 시점과 목적을 포함해야 합니다.')
      break
    case 'A-1-1':
      requirePattern('주제 선정 기준', /핵심/, '핵심 기준을 구분해야 합니다.')
      requirePattern('주제 선정 기준', /참고/, '참고 기준을 구분해야 합니다.')
      break
    case 'A-2-1':
      requireTable('성취기준분석표', 2, [/교과/, /지식|이해/, /과정|기능/, /가치|태도/])
      requirePattern('성취기준분석표', /공통|팀 조정/, '교과 간 공통 내용을 재구조화한 행이 필요합니다.')
      requirePattern('성취기준분석표', /출처|근거|확인|제공/, '교육과정 근거 또는 확인 필요 상태를 명시해야 합니다.')
      break
    case 'A-2-2':
      requireTable('교과별 수업목표', 2, [/교과/, /목표/])
      break
    case 'A-2-3':
      requireTeachers('학습자 프로필')
      requirePattern('학습자 프로필', /공통/, '팀 공통 조건과 교사별 관점을 구분해야 합니다.')
      break
    case 'Ds-1-1':
      requireTable('평가 계획', 2, [/확인|목표/, /요소|기준/, /방법|증거/, /시점|시기|차시/, /주체|담당/])
      break
    case 'Ds-1-2':
      requirePattern('문제상황', /역할|학생.{0,20}(되어|맡|으로서)/, '학생이 맡는 역할을 명시해야 합니다.')
      requirePattern('문제상황', /청중|독자|대상|전달|발표|공유/, '결과물을 전달할 청중과 행위가 필요합니다.')
      break
    case 'Ds-1-3':
      requireTable('학습 활동', 6, [/단계|흐름/, /활동|수행/, /시간|차시/, /평가/])
      break
    case 'Ds-2-1':
      requireTable('활동별 자료 설계', 2, [/활동/, /자료|기능/, /담당/, /기한|일정/, /검토/])
      for (const role of ['학생', 'AI', '교사']) requirePattern('Human-AI Agency', new RegExp(role, 'i'), `${role}의 역할 경계를 명시해야 합니다.`)
      break
    case 'Ds-2-2':
      requireTable('스캐폴딩 계획', 2, [/활동/, /지원|유형|내용/, /대상/, /제거|축소|독립/])
      break
    case 'DI-1-1': {
      requirePattern('개발 자료 목록', /학생용 활동지|학생 활동지|학습 활동지/, '학생용 활동지 본문이 필요합니다.')
      const questions = field('개발 자료 목록').match(/(?:^|\n)\s*(?:#{1,6}\s+)?\*{0,2}(?:\d+[.)]|문항\s*\d+|질문\s*\d+|Q\s*\d+)/g) ?? []
      if (questions.length < 2) errors.push('개발 자료 목록: 학생에게 제시할 실제 문항을 번호로 2개 이상 작성해야 합니다.')
      const csv = field('개발 자료 목록').match(/```csv\s*\n([\s\S]*?)```/i)?.[1]?.trim().split('\n') ?? []
      if (csv.length < 4 || csv.some(line => !line.includes(','))) errors.push('개발 자료 목록: 열 이름과 데이터 3행 이상의 csv 코드 블록이 필요합니다.')
      requirePattern('개발 자료 목록', /합성|가상|예시 데이터/, '생성 데이터가 합성임을 명시해야 합니다.')
      requirePattern('개발 자료 목록', /평가 기준|루브릭/, '수준별 평가 기준을 포함해야 합니다.')
      requireTable('개발 자료 목록', 2, [/요소|기준|평가/, /도달|수준|충족|우수|^상$|^중$|^하$/])
      break
    }
    case 'DI-2-1':
      requirePattern('주요 상황 기록', /시뮬레이션|모의 실행|합성.*증거/, '실제 수업 자료와 구분되는 시뮬레이션 표시가 필요합니다.')
      requireTable('주요 상황 기록', 3, [/장면|ID/i, /시점|차시|시간/, /기록자|교사|담당/, /관찰|반응|상황/, /증거|자료 위치/])
      break
    case 'E-1-1':
      requirePattern('사실', /SIM[-‐–]?\d|장면\s*\d|증거\s*\d/i, 'DI의 구체적인 장면 ID를 참조해야 합니다.')
      requirePattern('사실', /시뮬레이션|합성|가상|모의/, '성찰 증거가 시뮬레이션임을 명시해야 합니다.')
      requirePattern('수정안', /변경 전|수정 전|기존/, '변경 전 대상 문구를 포함해야 합니다.')
      requirePattern('수정안', /변경 후|수정 후|개정|수정 문구/, '실제로 사용할 수정 문구를 포함해야 합니다.')
      break
    case 'E-2-1':
      requireTable('팀 개선안', 2, [/원칙|규칙|운영/, /변경|개선|내용/, /근거|이유/, /담당|시점|기한/])
      break
  }
  return errors
}
