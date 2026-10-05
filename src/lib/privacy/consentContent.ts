// 개인정보 동의 문구·표 — 화면(동의 창·자세히 보기·탈퇴 안내)이 모두 여기서 읽는다(명세 docs/privacy-consent-spec.md).
// 문구를 바꾸면 PRIVACY_CONSENT_VERSION 을 올려 모든 회원에게 다시 동의를 받는다.
// 순수 데이터·함수만 둔다(테스트·서버에서 Firebase 없이 불러올 수 있게). 저장은 consent.ts.

export const PRIVACY_CONSENT_VERSION = '2026-10-05'

export type ConsentItemId = 'collect' | 'overseas'

export const REQUIRED_CONSENT_ITEMS: readonly ConsentItemId[] = ['collect', 'overseas']

export interface PrivacyConsentRecord {
  version: string
  /** Firestore serverTimestamp(저장 시) / Timestamp(읽을 때) */
  agreedAt: unknown
  items: ConsentItemId[]
}

export interface ConsentItemCopy {
  id: ConsentItemId
  required: true
  title: string
  body: string
}

export const CONSENT_COPY = {
  title: '개인정보 동의',
  intro: '서비스 이용을 위해 개인정보 수집·이용과 국외 이전 동의가 필요합니다. 처음 로그인하신 분과 기존 회원 모두 한 번 동의해 주셔야 서비스를 이용할 수 있습니다.',
  items: [
    {
      id: 'collect',
      required: true,
      title: '개인정보 수집·이용 동의',
      body: '서비스 제공을 위해 이름, 이메일, 프로필 사진 주소(Google 로그인), 서비스 이용 중 작성한 채팅·산출물·업로드 자료를 수집합니다.',
    },
    {
      id: 'overseas',
      required: true,
      title: '개인정보 국외 이전 동의',
      body: 'AI 응답 생성과 자료 분석을 위해 채팅·산출물·업로드 자료 내용이 미국 OpenAI와 미국 Anthropic으로, 성취기준 판정 문장이 TypeSafe(Jev) 판정 서비스로 전송됩니다. 계정 정보와 설계 데이터는 대한민국(서울) Google Firebase에 저장되며, 전송은 암호화된 연결로 이루어집니다.',
    },
  ] as const satisfies readonly ConsentItemCopy[],
  refusal: '동의를 거부할 수 있으나, 거부하면 AI 공동 설계가 중심 기능인 이 서비스를 이용할 수 없습니다.',
  retention: "회원 탈퇴 시까지. 탈퇴는 설정의 '회원 탈퇴'에서 직접 할 수 있습니다. 팀 프로젝트에 남긴 대화와 산출물은 팀의 공동 기록으로 남습니다.",
  agreeButton: '동의하고 계속하기',
  declineButton: '동의하지 않고 나가기',
  detailsLink: '자세한 내용 보기',
} as const

/** 자세히 보기 — 수집 항목·이용 목적·보유 기간 표 */
export const CONSENT_COLLECTION_TABLE = {
  columns: ['수집 항목', '이용 목적', '보유 기간'] as const,
  rows: [
    ['이름, 이메일, 프로필 사진 주소(Google 로그인)', '회원 식별, 팀 구성원 표시', '회원 탈퇴 시까지'],
    ['서비스 이용 중 작성한 채팅·산출물·업로드 자료', 'AI 공동 수업설계, 산출물·보고서 작성', '회원 탈퇴 시까지(팀 프로젝트에 남긴 대화와 산출물은 팀의 공동 기록으로 남음)'],
  ] as const,
}

/** 자세히 보기 — 국외 이전 표(받는 곳·나라·항목·목적·방법·보유 기간) */
export const CONSENT_OVERSEAS_TABLE = {
  columns: ['받는 곳', '나라', '이전 항목', '목적', '방법', '보유 기간'] as const,
  rows: [
    ['OpenAI', '미국', '채팅·산출물·업로드 자료 내용', 'AI 응답 생성, 자료 분석', '서비스 이용 시 암호화된 연결(HTTPS)로 전송', '각 사업자의 API 데이터 정책에 따름'],
    ['Anthropic', '미국', '채팅·산출물·업로드 자료 내용', 'AI 응답 생성, 자료 분석', '서비스 이용 시 암호화된 연결(HTTPS)로 전송', '각 사업자의 API 데이터 정책에 따름'],
    // TypeSafe 개인정보처리방침(typesafe.ai/privacy, 2026-10-05 확인): "The Services are hosted in the United States", 법인 TypeSafe AI, Inc.
    ['TypeSafe AI, Inc.(Jev 판정 서비스)', '미국', '성취기준 판정 문장', '성취기준 연결 판정', '서비스 이용 시 암호화된 연결(HTTPS)로 전송', '서비스 제공에 필요한 기간(사업자 개인정보처리방침에 따름)'],
  ] as const,
}

/** 동의가 필요한지 — 기록이 없거나, 버전이 다르거나, 필수 항목이 빠졌으면 true. */
export function needsConsent(profile: { privacyConsent?: Partial<PrivacyConsentRecord> | null } | null | undefined): boolean {
  const consent = profile?.privacyConsent
  if (!consent || consent.version !== PRIVACY_CONSENT_VERSION) return true
  const items = Array.isArray(consent.items) ? consent.items : []
  return !REQUIRED_CONSENT_ITEMS.every(item => items.includes(item))
}

/** 동의 창 동작 문구 */
export const CONSENT_UI_COPY = {
  detailsTitle: '자세한 내용',
  collectionTableTitle: '수집 항목·이용 목적·보유 기간',
  overseasTableTitle: '개인정보 국외 이전',
  requiredLabel: '[필수]',
  saving: '동의 내용을 저장하는 중…',
  saveError: '동의 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  declineError: '로그아웃하지 못했습니다. 잠시 후 다시 시도하거나 브라우저를 닫아 주세요.',
  retry: '다시 시도',
} as const

/** 회원 탈퇴 문구 — 확인 창은 confirmWord 를 그대로 입력해야 버튼이 켜진다. */
export const ACCOUNT_DELETION_COPY = {
  menuLabel: '회원 탈퇴',
  dialogTitle: '회원 탈퇴',
  steps: [
    '나만 참여한 프로젝트(개인 설계 포함)는 대화·산출물·자료와 함께 삭제됩니다.',
    '내가 방장인 팀 프로젝트는 남은 팀원 중 가장 먼저 참여한 분에게 방장이 넘어갑니다.',
    '팀 프로젝트에 남긴 대화와 산출물은 팀의 공동 기록으로 남습니다.',
    '계정 정보와 로그인 계정이 삭제되며, 되돌릴 수 없습니다.',
  ] as const,
  confirmWord: '탈퇴',
  confirmPrompt: "계속하려면 아래 칸에 '탈퇴'를 입력해 주세요.",
  confirmPlaceholder: '탈퇴',
  submitButton: '탈퇴하기',
  cancelButton: '취소',
  inProgress: '탈퇴를 처리하는 중입니다…',
  done: '회원 탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.',
  failed: '탈퇴를 끝내지 못했습니다. 처리된 부분은 그대로 두었으니 잠시 후 다시 시도해 주세요.',
  reauthRequired: '보안을 위해 다시 로그인한 뒤 탈퇴해 주세요.',
} as const

/** 탈퇴 API 계약 — POST, 헤더 Authorization: Bearer <Firebase ID 토큰>, 본문 { confirm: '탈퇴' } */
export const ACCOUNT_DELETE_ENDPOINT = '/api/account/delete'

export interface AccountDeletionResult {
  ok: boolean
  /** 실패 코드: 'unauthenticated' | 'confirm-required' | 'admin-unavailable' | 'partial-failure' | 'requires-recent-login' */
  error?: string
  /** 처리된 내용(실패해도 어디까지 됐는지) */
  deletedProjects: string[]
  transferredProjects: Array<{ projectId: string; newHostUid: string }>
  leftProjects: string[]
  userDocDeleted: boolean
  authDeleted: boolean
}

/** 탈퇴 실패 코드 → 화면 안내 문구 */
export const ACCOUNT_DELETION_ERROR_COPY = {
  unauthenticated: '로그인 정보를 확인하지 못했습니다. 다시 로그인한 뒤 탈퇴해 주세요.',
  'confirm-required': "확인 칸에 '탈퇴'를 정확히 입력해 주세요.",
  'admin-unavailable': '지금은 탈퇴를 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  'partial-failure': '탈퇴를 끝내지 못했습니다. 처리된 부분은 그대로 두었으니 잠시 후 다시 시도해 주세요.',
  'requires-recent-login': '보안을 위해 다시 로그인한 뒤 탈퇴해 주세요.',
} as const satisfies Record<string, string>

export type AccountDeletionErrorCode = keyof typeof ACCOUNT_DELETION_ERROR_COPY
