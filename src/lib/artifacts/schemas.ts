// ─── 구조화된 산출물 스키마 ──────────────────────────────────────────────
// AI 자유 형식 마크다운 대신 **코드가 구조를 강제**하는 방식.
// AI가 뭘 빠뜨리든, 형식이 이상하든 스키마가 보장한다.

import type { TeamVisionWorkspace, IntegratedGoalWorkspace } from '@/types'

// ─── 비콘텐츠(대화·절차 맥락) 판별 ──────────────────────────────────────────
// 채팅에서 산출물을 추출할 때, AI의 A안/B안 확정 선택지·"저장/수정/진행하겠습니다"
// 같은 절차 문구가 산출물 콘텐츠로 새어드는 것을 차단한다.
// system.ts 규칙(A안/B안 = **볼드** 확정 선택지, 항상 단독 라인)과 짝을 이룬다.
// 질문 프롬프트는 라인 단위 strip에서는 제거하지 않고(예: Ds-1-2 탐구질문 추출 보존),
// 원칙·규칙처럼 "질문이 콘텐츠가 될 수 없는" 항목 판별(isNonContentLabel)에서만 배제한다.

/** A안/B안/C안 선택지 라벨로 시작하는 라인/항목 (볼드·불릿 유무 무관).
 *  ChatPanel의 parseOptions(선택지 카드 렌더러)보다 넓게 잡는다 —
 *  "카드로 렌더링되는 라인은 반드시 산출물에서 걸러진다"를 보장하기 위해
 *  A~Z안 · 1안/２안 · 가안~마안 · 옵션 A · 선택지 1, 그리고 `**A안**:`처럼
 *  닫는 볼드가 콜론 앞에 오는 변형과 대시(—) 구분자까지 커버한다. */
const CHOICE_LABEL_RE = /^\s*[-•*]?\s*\*{0,2}\s*(?:[A-ZＡ-Ｚ]\s*안|[0-9０-９]{1,2}\s*안|[가나다라마]\s*안|옵션\s*[A-Z0-9]{1,2}|선택지\s*[0-9]{1,2})\s*\*{0,2}\s*[:：\-–—]/
/** 라벨 단독 항목 ("A안", "1안" 등 — 표 셀·리스트 항목 판별용) */
const CHOICE_BARE_RE = /^(?:[A-ZＡ-Ｚ]|[0-9０-９]{1,2}|[가나다라마])\s*안$/
/** "…저장/수정/진행하겠습니다" 류로 끝나는 절차·확정 문구 */
const PROCESS_END_RE = /(?:저장|수정|보완|진행|확정|기록|반영|논의|넘어가|정리)(?:하겠습니다|하겠어요|할게요|할까요|합시다|하시죠|해\s*주세요)\s*["'」』”’]*[.。!?？]*\s*$/
/** "이제 저장…", "다음 단계로…", "더 논의…", "저장하겠…"로 시작하는 절차 안내 문구.
 *  ("저장된 데이터…"처럼 process 동사가 콘텐츠 어두로 쓰인 경우는 제외) */
const PROCESS_START_RE = /^["'「『“‘]?\s*(?:이제\s+(?:저장|수정|보완|확정|기록|반영|정리|진행)|(?:이대로|그대로)\s*(?:저장|수정|확정|진행)|[ABCDＡ-Ｄ]\s*안으로\s*(?:저장|진행|확정)|다음\s*단계|더\s*논의|(?:저장|수정|보완|확정|기록|반영|진행)(?:하겠|할까|합니다|하시|해\s*주))/
/** 저장·진행·동의 확인/유도 질문으로 끝나는 라인 (항목 판별용) */
const CONFIRM_QUESTION_RE = /(?:할까요|하실까요|하시겠어요|하시겠습니까|드릴까요|어떠세요|어떠신가요|어떨까요|괜찮(?:으세요|으신가요|을까요)|있으신가요|있나요|보실까요)\s*["'」』”’]*[?？]\s*$/
/** "✅ 저장됐습니다" 류 상태 안내 라인 */
const STATUS_LINE_RE = /^\s*[✅☑✔️✓]\s*.*(?:저장|확정|반영|기록|완료)(?:됐|되었|했|합니다|됩니다)/

/** 한 항목(원칙 제목·규칙명·표 셀 등)이 산출물 콘텐츠가 아니라 대화·절차 맥락인지 */
export function isNonContentLabel(s: string): boolean {
  const raw = s ?? ''
  const t = raw.replace(/\*\*/g, '').replace(/^["'「『“‘]+|["'」』”’]+$/g, '').trim()
  if (!t) return true
  if (CHOICE_LABEL_RE.test(raw)) return true
  if (CHOICE_BARE_RE.test(t)) return true
  if (PROCESS_END_RE.test(t)) return true
  if (PROCESS_START_RE.test(t)) return true
  if (CONFIRM_QUESTION_RE.test(t)) return true
  if (STATUS_LINE_RE.test(raw)) return true
  return false
}

/** assistant 메시지 본문에서 A안/B안 선택지 라인과 절차·확정 단독 문장을 제거한다.
 *  채팅→산출물 추출 ctx 정제용 — build*Structured 호출 전 한 번 적용하면
 *  모든 chat-fallback 추출기가 동시에 보호된다. 질문 라인은 보존한다. */
export function stripNonContentLines(text: string): string {
  if (!text) return text
  return text
    .split('\n')
    .filter(line => {
      const t = line.replace(/\*\*/g, '').trim()
      if (!t) return true // 빈 줄·구조는 보존
      if (CHOICE_LABEL_RE.test(line)) return false
      if (PROCESS_END_RE.test(t)) return false
      if (PROCESS_START_RE.test(t) && t.length <= 80) return false // 절차 안내 문장 (혼합 라인 과차단 방지 상한)
      if (STATUS_LINE_RE.test(line)) return false
      return true
    })
    .join('\n')
    .trim()
}

/** assistant 메시지 배열 정제 (user 메시지는 원문 유지) */
export function sanitizeChatForExtraction<T extends { role: string; content: string }>(
  messages: T[],
): T[] {
  return messages.map(m =>
    m.role === 'assistant' ? { ...m, content: stripNonContentLines(m.content) } : m,
  )
}

/** [ARTIFACT_UPDATE: 키=값] 의 **값** 자체를 정화한다 — 신호 값이 Firestore에
 *  verbatim으로 저장되는 활동(Ds/DI/E 등 builder 미보유)까지 보호하는 단일 관문.
 *  - 잔여 신호 태그([ACTION_CARD] 등) 제거
 *  - 선택지·절차·상태 라인 strip (stripNonContentLines)
 *  - 표 행: 앞쪽 셀이 선택지/절차 라벨이면 그 행 전체 제거 */
export function sanitizeArtifactValue(value: string): string {
  if (!value) return value
  const untagged = value
    .replace(/\[ACTION_CARD:[^\]]*\]/g, '')
    .replace(/\[TEAM_DISCUSSION_READY[^\]]*\]/g, '')
    .replace(/\[ACTIVITY_(?:ADVANCE|RETURN)[^\]]*\]/g, '')
  const lineFiltered = untagged
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (!t.startsWith('|')) return true
      if (/^\|[\s\-:|]+\|$/.test(t)) return true // 구분선 보존
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
      const firstFilled = cells.find(c => c.length > 0)
      return !firstFilled || !isNonContentLabel(firstFilled)
    })
    .join('\n')
  return stripNonContentLines(lineFiltered)
}

/** 값 자체가 A안/B안 선택 결과인 섹션 — 정화·플레이스홀더 보강 대상에서 제외.
 *  E-2-1 "다음 주기 선택"은 parseNextCycleChoice(completion.ts)가 A/B를 판독하는
 *  정당한 선택 값이므로 CHOICE_LABEL_RE로 지우면 E단계 완료가 불가능해지고,
 *  짧은 값("A안 — …")이라 enrich의 placeholder 치환에도 걸리면 안 된다. */
export const SANITIZE_EXEMPT_KEYS = ['다음 주기 선택']

/** 섹션 레코드의 string 값들을 일괄 정화. dropEmptied=true면 정화 후 빈 값이 된
 *  키를 제거한다 (병합 시 기존 콘텐츠를 빈 값으로 덮지 않도록). 구조화 산출물의
 *  배열·객체 필드와 _schema 키는 그대로 통과시킨다. */
export function sanitizeArtifactSections<T extends Record<string, unknown>>(
  sections: T,
  opts: { dropEmptied?: boolean } = {},
): T {
  const { dropEmptied = true } = opts
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(sections)) {
    if (typeof v === 'string' && k !== '_schema' && !SANITIZE_EXEMPT_KEYS.includes(k.trim())) {
      const cleaned = sanitizeArtifactValue(v)
      if (cleaned || !dropEmptied) out[k] = cleaned
    } else {
      out[k] = v
    }
  }
  return out as T
}

// ─── T-1-1 팀 공통 비전 설정 ─────────────────────────────────────────────

export interface T11PersonalVision {
  teacherName: string
  subject?: string       // 담당 교과
  keywords: string[]     // 교사가 말한 원래 키워드
  refinedVision: string  // AI 정교화 비전 문장
}

export interface T11Structured {
  _schema: 'T-1-1'
  personalVisions: T11PersonalVision[]
  teamVision: string       // 팀 공통 비전 문장
  coreKeywords: string[]   // 핵심 키워드 3~5개
  designPrinciples?: T12DesignPrinciple[] // solo 모드에서 T-1-2를 흡수한 설계 원칙
  manualWorkspace?: TeamVisionWorkspace
}

/**
 * AI의 ARTIFACT_UPDATE 섹션들 + 채팅 이력에서 T-1-1 구조화 산출물을 구축.
 * 빠진 필드는 채팅에서 자동 추출한다.
 */
export function buildT11Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string; displayName?: string }>,
  /**
   * 개인 설계(solo) 모드 전용 옵션. 협력(팀) 모드에서는 절대 전달하지 않는다 — 팀 파싱 동작 불변.
   * solo에서는 AI가 '개인 비전'을 표가 아닌 한 문장으로 보내므로 별도 수용 경로가 필요하다.
   */
  soloOpts?: { teacherName?: string },
): T11Structured {
  const result: T11Structured = {
    _schema: 'T-1-1',
    personalVisions: [],
    teamVision: '',
    coreKeywords: [],
    designPrinciples: [],
  }

  // 1. 팀 공통 비전 — 가장 간단
  result.teamVision = (sections['팀 공통 비전'] ?? '').trim()

  // 2. 핵심 키워드
  const kwRaw = (sections['핵심 키워드'] ?? '').trim()
  if (kwRaw) {
    result.coreKeywords = kwRaw.split(/[,，·]/).map(s => s.trim()).filter(Boolean)
  }

  // 3. 개인 설계 모드가 T-1-1에 함께 저장한 설계 원칙
  const principlesRaw = (sections['설계 원칙'] ?? '').trim()
  if (principlesRaw) {
    result.designPrinciples = parseDesignPrinciples(principlesRaw)
    if (result.designPrinciples.length === 0) {
      result.designPrinciples = principlesRaw
        .split(/\n|(?=\s*\d+[.)]\s*)/)
        .map(line => line.replace(/^\s*\d+[.)]\s*/, '').trim())
        .filter(Boolean)
        .map(principle => ({ principle, rationale: '' }))
    }
  }

  // 4. 개인 비전 — AI 출력에서 추출 시도
  const pvRaw = (sections['개인 비전'] ?? '').trim()
  if (pvRaw) {
    result.personalVisions = parsePersonalVisions(pvRaw)
    // solo: 표/화살표가 아닌 한 문장 형식을 1인 항목으로 수용 (팀 모드에서는 soloOpts 미전달이라 미실행)
    if (result.personalVisions.length === 0 && soloOpts) {
      const single = parseSoloPersonalVision(pvRaw, soloOpts.teacherName, result.coreKeywords)
      if (single) result.personalVisions = [single]
    }
  }

  // 5. 개인 비전이 비어있으면 채팅 이력에서 자동 추출
  if (result.personalVisions.length === 0) {
    result.personalVisions = extractPersonalVisionsFromChat(chatMessages)
  }

  // 5-b. solo 보정: 개인 설계에서는 '개인 비전'과 '팀 공통 비전'이 같은 문장이다
  // (SOLO_ACTIVITY_PROCEDURE T-1-1 명시). 팀 형식 추출이 모두 실패해도 비전 문장이 있으면
  // 개인 비전 칸이 비어 있는 채로 남지 않도록 미러링한다.
  if (soloOpts && result.personalVisions.length === 0 && result.teamVision && !isNonContentLabel(result.teamVision)) {
    result.personalVisions = [{
      teacherName: soloOpts.teacherName?.trim() || '나',
      keywords: result.coreKeywords,
      refinedVision: result.teamVision,
    }]
  }

  // 6. 핵심 키워드가 비어있으면 비전에서 자동 추출
  if (result.coreKeywords.length === 0 && result.teamVision) {
    const nouns = result.teamVision.match(/[가-힣]{2,}(?:력|성|학습|교육|해결|활동|분석|역량|시민|탐구|설계)/g)
    if (nouns && nouns.length >= 2) {
      result.coreKeywords = [...new Set(nouns)].slice(0, 5)
    }
  }

  // 7. 팀 비전이 비어있으면 채팅에서 마지막 합의 문장 추출
  if (!result.teamVision) {
    for (const msg of [...chatMessages].reverse()) {
      if (msg.role !== 'assistant') continue
      const m = msg.content.match(/['"「"](.*?문제.*?교육.*?)['"」"]/)
        || msg.content.match(/['"「"](.*?학생.*?교육.*?)['"」"]/)
        || msg.content.match(/['"「"](.*?성장.*?수업.*?)['"」"]/)
      // "…교육으로 저장하겠습니다" 같은 절차 인용은 비전이 아님
      if (m && !isNonContentLabel(m[1])) { result.teamVision = m[1].trim(); break }
    }
  }

  return result
}

/** AI가 출력한 개인 비전 텍스트(표 또는 화살표 형식)를 파싱 */
function parsePersonalVisions(raw: string): T11PersonalVision[] {
  const entries: T11PersonalVision[] = []

  // 마크다운 표 형식: | 교사명 | 키워드 | 비전 |
  const lines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length >= 3) {
    // 헤더 + 구분 + 데이터 행
    const dataLines = lines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1) // 헤더 제거
    for (const line of dataLines) {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
      if (cells.length >= 3 && cells[0]) {
        entries.push({
          teacherName: cells[0].replace(/\s*선생님$/, ''),
          keywords: cells[1].split(/[,，·]/).map(s => s.trim()).filter(Boolean),
          refinedVision: cells[2],
        })
      }
    }
    if (entries.length > 0) return entries
  }

  // 화살표 형식: → 홍성용 선생님: '비전 문장'
  const arrowPattern = /→\s*(.+?)\s*선생님\s*[:：]\s*['"「"']?(.+?)['"」"']?\s*$/gm
  let m
  while ((m = arrowPattern.exec(raw)) !== null) {
    entries.push({
      teacherName: m[1].trim(),
      keywords: [],
      refinedVision: m[2].trim(),
    })
  }

  // 인라인 파이프 (줄바꿈 없이 || 로 붙어있는 경우)
  if (entries.length === 0 && raw.includes('|') && !raw.includes('\n')) {
    const cells = raw.split('|').map(s => s.trim()).filter(Boolean)
    // 헤더(교사명, 키워드, 비전) 제거 후 3셀씩 묶기
    const headerIdx = cells.findIndex(c => /교사명|이름/.test(c))
    const data = headerIdx >= 0 ? cells.slice(headerIdx + 3) : cells
    // 구분자 행(---) 제거
    const cleaned = data.filter(c => !/^-{2,}$/.test(c))
    for (let i = 0; i + 2 < cleaned.length; i += 3) {
      if (cleaned[i] && cleaned[i + 2]) {
        entries.push({
          teacherName: cleaned[i].replace(/\s*선생님$/, ''),
          keywords: cleaned[i + 1].split(/[,，·]/).map(s => s.trim()).filter(Boolean),
          refinedVision: cleaned[i + 2],
        })
      }
    }
  }

  return entries
}

/**
 * 개인 설계(solo) 모드의 '개인 비전' 값 파싱.
 * solo 절차는 표가 아니라 한 문장(때로 "키워드: …" 줄 동반)을 보내므로
 * 팀용 parsePersonalVisions가 항상 빈 배열을 돌려주던 문제를 여기서 흡수한다.
 */
function parseSoloPersonalVision(
  raw: string,
  teacherName: string | undefined,
  fallbackKeywords: string[],
): T11PersonalVision | null {
  const keywords: string[] = []
  const visionLines: string[] = []

  for (const line of raw.split('\n')) {
    const t = line.replace(/^[-*•]\s*/, '').trim()
    if (!t) continue
    const kw = t.match(/^(?:\*\*)?(?:핵심\s*)?키워드(?:\*\*)?\s*[:：=]\s*(.+)$/)
    if (kw) {
      keywords.push(...kw[1].split(/[,，·/]/).map(s => s.trim()).filter(Boolean))
      continue
    }
    // "비전:" / "개인 비전:" 라벨은 제거하고 문장만 남긴다
    visionLines.push(t.replace(/^(?:\*\*)?(?:나의\s*|개인\s*)?비전(?:\s*문장)?(?:\*\*)?\s*[:：=]\s*/, ''))
  }

  const refinedVision = visionLines
    .join(' ')
    .replace(/^["'「『“‘]+|["'」』”’]+$/g, '')
    .trim()

  // 절차 문구·선택지 라벨이 값으로 새어 들어온 경우는 저장하지 않는다
  if (!refinedVision || isNonContentLabel(refinedVision)) return null

  return {
    teacherName: teacherName?.trim() || '나',
    keywords: keywords.length > 0 ? keywords : fallbackKeywords,
    refinedVision,
  }
}

/** 채팅 이력에서 개인 비전 정보를 추출 */
function extractPersonalVisionsFromChat(
  messages: Array<{ role: string; content: string; displayName?: string }>,
): T11PersonalVision[] {
  const entries: T11PersonalVision[] = []
  const assistantMsgs = messages.filter(m => m.role === 'assistant')

  for (const msg of assistantMsgs) {
    // "→ 홍성용 선생님: '비전 문장'" 패턴
    const patterns = [
      /→\s*(.+?)\s*선생님\s*[:：]\s*['"「"'](.+?)['"」"']/g,
      /\*\*(.+?)\s*선생님\*\*\s*[:：]\s*['"「"'](.+?)['"」"']/g,
    ]
    for (const pattern of patterns) {
      let m
      while ((m = pattern.exec(msg.content)) !== null) {
        const name = m[1].trim()
        if (!entries.some(e => e.teacherName === name)) {
          entries.push({
            teacherName: name,
            keywords: [],
            refinedVision: m[2].trim(),
          })
        }
      }
    }
  }

  // 키워드 채우기: user 메시지 중 짧은 것(키워드)을 교사별로 매칭
  const userMsgs = messages.filter(m => m.role === 'user')
  for (const entry of entries) {
    for (const um of userMsgs) {
      if (um.displayName && um.displayName.includes(entry.teacherName) && um.content.length <= 30) {
        entry.keywords = um.content.split(/[,，·\s]+/).filter(Boolean)
        break
      }
    }
    // displayName 없으면 assistant 응답에서 "[이름]께서 말씀하신 '[키워드]'" 추출
    if (entry.keywords.length === 0) {
      for (const am of assistantMsgs) {
        const kwMatch = am.content.match(new RegExp(`${entry.teacherName}.*?말씀하신\\s*['"「](.+?)['"」]`))
        if (kwMatch) {
          entry.keywords = kwMatch[1].split(/[,，·\s]+/).filter(Boolean)
          break
        }
      }
    }
  }

  return entries
}

// ─── T-1-2 수업설계 방향 설정 ─────────────────────────────────────────────

export interface T12DesignPrinciple {
  principle: string   // 설계 원칙 (조건과 실천 행동, 방법론 이름은 선택 사항)
  rationale: string   // 근거
}

export interface T12Structured {
  _schema: 'T-1-2'
  designPrinciples: T12DesignPrinciple[]
  /** 수동 공동 편집 워크스페이스 스냅샷 — T-1-2 모달에서 작성한 표·블록을 그대로 보존 */
  manualWorkspace?: import('@/types').LessonDesignDirectionWorkspace
}

export function buildT12Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T12Structured {
  const result: T12Structured = { _schema: 'T-1-2', designPrinciples: [] }

  const raw = (sections['설계 방향'] ?? '').trim()
  if (raw) {
    result.designPrinciples = parseDesignPrinciples(raw)
  }

  // 채팅 fallback: 설계 원칙이 비어있으면 AI 응답에서 **A안:**/불릿 패턴 추출
  if (result.designPrinciples.length === 0) {
    result.designPrinciples = extractDesignPrinciplesFromChat(chatMessages)
  }

  return result
}

function parseDesignPrinciples(raw: string): T12DesignPrinciple[] {
  const entries: T12DesignPrinciple[] = []

  // 이전 2열 표와 번호·멈춤 신호가 추가된 표 모두 헤더로 해석한다.
  // 저장 스키마는 유지하고 멈춤 신호는 근거 본문에 보존한다.
  const lines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length >= 3) {
    const parseCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s => s.trim())
    const headers = parseCells(lines[0]).map(cell => cell.replace(/\*\*/g, ''))
    const matchedPrincipleIndex = headers.findIndex(header => /원칙|방향/.test(header))
    const principleIndex = matchedPrincipleIndex >= 0 ? matchedPrincipleIndex : 0
    const matchedRationaleIndex = headers.findIndex(header => /근거|이유|배경/.test(header))
    const rationaleIndex = matchedRationaleIndex >= 0 ? matchedRationaleIndex : headers.length === 2 ? 1 : -1
    const stopIndex = headers.findIndex(header => /멈춤|중단|보류|거부/.test(header))
    const dataLines = lines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1)
    for (const line of dataLines) {
      const cells = parseCells(line)
      if (cells.length >= 2 && cells[principleIndex]) {
        const rationale = rationaleIndex !== principleIndex ? cells[rationaleIndex] || '' : ''
        const stopCondition = cells[stopIndex]
        entries.push({
          principle: cells[principleIndex],
          rationale: [rationale, stopCondition ? `멈춤 신호: ${stopCondition}` : ''].filter(Boolean).join('\n'),
        })
      }
    }
    if (entries.length > 0) return entries
  }

  // 불릿 리스트: - **원칙**: 설명
  const bulletPattern = /[-•]\s*\*?\*?(.+?)\*?\*?\s*[:：]\s*(.+)/g
  let m
  while ((m = bulletPattern.exec(raw)) !== null) {
    const principle = m[1].trim()
    if (!principle || isNonContentLabel(principle) || isNonContentLabel(m[2].trim())) continue
    entries.push({ principle, rationale: m[2].trim() })
  }

  // 인라인 파이프 (줄바꿈 없이)
  if (entries.length === 0 && raw.includes('|') && !raw.includes('\n')) {
    const cells = raw.split('|').map(s => s.trim()).filter(Boolean)
    const headerIdx = cells.findIndex(c => /원칙|방향/.test(c))
    const data = headerIdx >= 0 ? cells.slice(headerIdx + 2) : cells
    const cleaned = data.filter(c => !/^-{2,}$/.test(c))
    for (let i = 0; i + 1 < cleaned.length; i += 2) {
      if (cleaned[i]) entries.push({ principle: cleaned[i], rationale: cleaned[i + 1] || '' })
    }
  }

  return entries
}

function extractDesignPrinciplesFromChat(
  messages: Array<{ role: string; content: string }>,
): T12DesignPrinciple[] {
  const entries: T12DesignPrinciple[] = []
  const assistantMsgs = [...messages.filter(m => m.role === 'assistant')].reverse()

  for (const msg of assistantMsgs) {
    // 표 패턴
    const tableLines = msg.content.split('\n').filter(l => l.trim().startsWith('|'))
    if (tableLines.length >= 3) {
      const parsed = parseDesignPrinciples(tableLines.join('\n'))
      if (parsed.length > 0) return parsed
    }
    // **원칙 N:** / 불릿+볼드 패턴 (A안/B안 확정 선택지는 의도적으로 제외 — 콘텐츠 아님)
    const patterns = [
      /\*\*(?:원칙\s*\d+)\s*[:：]?\*\*\s*['"「"]?(.+?)['"」"]?\s*(?:\((.+?)\))?$/gm,
      /[-•]\s*\*\*(.+?)\*\*\s*[:：]\s*(.+)/gm,
    ]
    for (const p of patterns) {
      let m
      while ((m = p.exec(msg.content)) !== null) {
        const principle = m[1].trim()
        const rationale = (m[2] || '').trim()
        // 선택지 라벨·절차 문구가 불릿/볼드 형태로 섞여 들어오는 경우 차단
        if (!principle || isNonContentLabel(principle) || isNonContentLabel(rationale)) continue
        entries.push({ principle, rationale })
      }
    }
    if (entries.length >= 2) return entries
  }
  return entries
}

// ─── Ds-1-1 평가 계획 수립 ───────────────────────────────────────────────

export interface Ds11RubricRow {
  checkpoint: string // 확인 지점(최종 결과/활동 과정의 구체 장면)
  item: string       // 평가 요소
  method: string     // 평가 방법
  timing: string     // 평가 시점
  actor: string      // 평가 주체
  high?: string      // 선택형 상세 루브릭(레거시 호환)
  mid?: string
  low?: string
}

export interface Ds11Structured {
  _schema: 'Ds-1-1'
  rubric: Ds11RubricRow[]
  /** 수동 공동 편집 워크스페이스 스냅샷 */
  manualWorkspace?: import('@/types').EvaluationPlanWorkspace
}

export function buildDs11Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): Ds11Structured {
  const result: Ds11Structured = { _schema: 'Ds-1-1', rubric: [] }
  const raw = (sections['평가 계획'] ?? sections['평가계획'] ?? '').trim()
  if (raw) result.rubric = parseDs11Rubric(raw)
  if (result.rubric.length === 0) result.rubric = extractDs11RubricFromChat(chatMessages)
  return result
}

function parseDs11Rubric(raw: string): Ds11RubricRow[] {
  const rows: Ds11RubricRow[] = []
  const lines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length < 3) return rows
  const contentLines = lines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
  const headers = (contentLines[0] ?? '').replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
  const dataLines = contentLines.slice(1)
  const indexOfHeader = (...patterns: RegExp[]) => headers.findIndex(header => patterns.some(pattern => pattern.test(header)))
  const checkpointIndex = indexOfHeader(/확인\s*지점/, /평가\s*장면/)
  const itemIndex = indexOfHeader(/평가\s*(?:요소|항목)/)
  const methodIndex = indexOfHeader(/평가\s*방법/)
  const timingIndex = indexOfHeader(/평가\s*시점/, /^시점$/)
  const actorIndex = indexOfHeader(/평가\s*주체/, /^주체$/)
  const highIndex = indexOfHeader(/^상$/, /상\s*수준/)
  const midIndex = indexOfHeader(/^중$/, /중\s*수준/)
  const lowIndex = indexOfHeader(/^하$/, /하\s*수준/)
  const hasLatestBase = checkpointIndex >= 0 || actorIndex >= 0
  for (const line of dataLines) {
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
    // parseTableRows와 동일 가드 — 선택지·확정 안내 행은 루브릭 콘텐츠가 아님
    if (cells.length >= 1 && cells[0] && !isNonContentLabel(cells[0])) {
      rows.push({
        checkpoint: checkpointIndex >= 0 ? cells[checkpointIndex] ?? '' : cells[0] ?? '',
        item: itemIndex >= 0 ? cells[itemIndex] ?? '' : cells[0] ?? '',
        method: methodIndex >= 0 ? cells[methodIndex] ?? '' : cells[1] ?? '',
        timing: timingIndex >= 0 ? cells[timingIndex] ?? '' : cells[2] ?? '',
        actor: actorIndex >= 0 ? cells[actorIndex] ?? '' : '',
        high: highIndex >= 0 ? cells[highIndex] ?? '' : hasLatestBase ? '' : cells[3] ?? '',
        mid: midIndex >= 0 ? cells[midIndex] ?? '' : hasLatestBase ? '' : cells[4] ?? '',
        low: lowIndex >= 0 ? cells[lowIndex] ?? '' : hasLatestBase ? '' : cells[5] ?? '',
      })
    }
  }
  return rows
}

function extractDs11RubricFromChat(
  messages: Array<{ role: string; content: string }>,
): Ds11RubricRow[] {
  const assistantMsgs = [...messages.filter(m => m.role === 'assistant')].reverse()
  for (const msg of assistantMsgs) {
    const tableLines = msg.content.split('\n').filter(l => l.trim().startsWith('|'))
    if (tableLines.length >= 3) {
      const parsed = parseDs11Rubric(tableLines.join('\n'))
      if (parsed.length > 0) return parsed
    }
  }
  return []
}

// ─── Ds-1-2 문제상황 개발 ─────────────────────────────────────────────────

export interface Ds12Structured {
  _schema: 'Ds-1-2'
  scenario: {
    title: string          // 제목
    authenticity: string   // 행1 실제성
    contentProduct: string // 행2 학습 내용+산출물
    audienceAction: string // 행3 청중+행위
  }
  drivingQuestion: string  // 핵심 질문
  manualWorkspace?: import('@/types').ProblemSituationWorkspace
}

export function buildDs12Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): Ds12Structured {
  const result: Ds12Structured = {
    _schema: 'Ds-1-2',
    scenario: { title: '', authenticity: '', contentProduct: '', audienceAction: '' },
    drivingQuestion: '',
  }
  const raw = (sections['문제상황'] ?? '').trim()
  if (raw) {
    const titleM = raw.match(/\*\*제목\*\*\s*[:：]?\s*(.+?)(?:\n|$)/)
    const r1 = raw.match(/\*\*행1[^*]*\*\*\s*[:：]?\s*([\s\S]*?)(?=\*\*행2|\*\*행3|$)/)
    const r2 = raw.match(/\*\*행2[^*]*\*\*\s*[:：]?\s*([\s\S]*?)(?=\*\*행3|$)/)
    const r3 = raw.match(/\*\*행3[^*]*\*\*\s*[:：]?\s*([\s\S]*?)$/)
    result.scenario.title = (titleM?.[1] ?? '').trim()
    result.scenario.authenticity = (r1?.[1] ?? '').trim()
    result.scenario.contentProduct = (r2?.[1] ?? '').trim()
    result.scenario.audienceAction = (r3?.[1] ?? '').trim()
    // 마커가 없으면 raw 전체를 실제성에 보존 (정보 손실 방지)
    if (!result.scenario.title && !result.scenario.authenticity && !result.scenario.contentProduct && !result.scenario.audienceAction) {
      result.scenario.authenticity = raw
    }
  }
  result.drivingQuestion = (sections['핵심 질문'] ?? sections['핵심질문'] ?? '').trim()
  // 채팅 fallback — 핵심 질문이 비면 마지막 assistant 메시지의 물음표 문장 추출.
  // 단, 저장·진행 확인이나 성찰·선택 유도 프롬프트는 탐구질문이 아니므로 배제한다.
  if (!result.drivingQuestion) {
    const META_Q = /저장|진행|넘어가|다음\s*단계|다음\s*활동|수정하|논의|확정|동의하|골라|선택해|느낄까요|어떠(?:세요|신가요)|어떨까요|괜찮으/
    for (const msg of [...chatMessages].reverse()) {
      if (msg.role !== 'assistant') continue
      const re = /["「'']([^"「''\n]{6,}?\?)["」'']/g
      let qm: RegExpExecArray | null
      while ((qm = re.exec(msg.content)) !== null) {
        const cand = qm[1].trim()
        if (META_Q.test(cand)) continue
        result.drivingQuestion = cand
        break
      }
      if (result.drivingQuestion) break
    }
  }
  return result
}

// ─── T-2-1 역할 배분 ─────────────────────────────────────────────────────

export interface T21Role {
  teacherName: string
  subject: string
  strengths: string
  role: string
  responsibilities: string
  deadline?: string
}

export interface T21Structured {
  _schema: 'T-2-1'
  roles: T21Role[]
  /** 수동 공동 편집 워크스페이스 스냅샷 — T-2-1 모달에서 작성한 표·블록을 그대로 보존 */
  manualWorkspace?: import('@/types').RoleDistributionWorkspace
}

export function buildT21Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T21Structured {
  const result: T21Structured = { _schema: 'T-2-1', roles: [] }
  const raw = (sections['역할 배분'] ?? '').trim()
  if (raw) result.roles = parseTableRows(raw, 5).map(cells => ({
    teacherName: cells[0] || '', subject: cells[1] || '', strengths: cells[2] || '',
    role: cells[3] || '', responsibilities: cells[4] || '', deadline: cells[5] || '',
  }))
  if (result.roles.length === 0) {
    // 채팅 fallback: 최신 6열 표(레거시 5열도 허용) 추출
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, 5)
      if (rows.length > 0) {
        result.roles = rows.map(cells => ({
          teacherName: cells[0] || '', subject: cells[1] || '', strengths: cells[2] || '',
          role: cells[3] || '', responsibilities: cells[4] || '', deadline: cells[5] || '',
        }))
        break
      }
    }
  }
  return result
}

// ─── T-2-2 팀 규칙 수립 ──────────────────────────────────────────────────

export interface T22Rule {
  category: string    // [소통], [시간] 등
  name: string
  description: string
  feasibility: string // 가장 빠듯한 팀원도 지킬 수 있게 조정한 실천 방법
  violation?: string  // 레거시 산출물 읽기 전용
}

export interface T22Structured {
  _schema: 'T-2-2'
  rules: T22Rule[]
  /** 수동 공동 편집 워크스페이스 스냅샷 — T-2-2 모달에서 작성한 표·블록을 그대로 보존 */
  manualWorkspace?: import('@/types').TeamRulesWorkspace
}

export function buildT22Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T22Structured {
  const result: T22Structured = { _schema: 'T-2-2', rules: [] }
  const raw = (sections['팀 규칙'] ?? '').trim()
  if (raw) result.rules = parseRules(raw)
  if (result.rules.length === 0) {
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rules = parseRules(msg.content)
      if (rules.length >= 2) { result.rules = rules; break }
    }
  }
  return result
}

function parseRules(raw: string): T22Rule[] {
  const rules: T22Rule[] = []

  // Step 1: 규칙 항목 블록으로 분리 — 번호(1. 2.), 볼드(**), 불릿(-•) 기준
  const blocks: string[] = []
  // 번호/볼드/불릿으로 시작하는 줄에서 분리
  const lines = raw.split('\n')
  let current = ''
  for (const line of lines) {
    const trimmed = line.trim()
    // A안/B안 선택지·절차 확정 문구는 규칙이 아님 — 진행 중 블록을 마감하고 건너뜀
    if (isNonContentLabel(trimmed)) {
      if (current.trim()) { blocks.push(current.trim()); current = '' }
      continue
    }
    // 새 규칙 항목 시작 감지
    const isNewRule = /^\d+\.\s*/.test(trimmed) || /^\*\*\[/.test(trimmed) || /^\*\*[^*]/.test(trimmed) || /^[-•]\s*\[/.test(trimmed)
    // 실천 방법/레거시 위반 시 조치 하위 항목은 새 규칙이 아님
    const isViolation = /(?:실천\s*(?:방법|조건)|위반\s*시)/.test(trimmed)
    if (isNewRule && !isViolation && current.trim()) {
      blocks.push(current.trim())
      current = line
    } else if (isNewRule && !isViolation) {
      current = line
    } else {
      current += '\n' + line
    }
  }
  if (current.trim()) blocks.push(current.trim())

  // Step 2: 각 블록에서 범주, 이름, 설명, 위반 시 조치 추출
  for (const block of blocks) {
    // 실천 방법 추출. 레거시 "위반 시 조치"는 데이터 유실 없이 실천 방법으로 읽는다.
    let feasibility = ''
    let mainText = block
    // 별도 줄: • 위반 시 조치: ... 또는 • N회 이상 위반 시 조치: ...
    const violationLineMatch = mainText.match(/\n\s*[-•]\s*(?:(?:실천\s*(?:방법|조건))|(?:\d+회\s*이상\s*)?위반\s*시\s*(?:조치\s*)?)[:：]\s*([^\n]+)/)
    if (violationLineMatch) {
      feasibility = violationLineMatch[1].trim().split('\n')[0]
      mainText = mainText.slice(0, mainText.indexOf(violationLineMatch[0])).trim()
    }
    // 인라인: (위반 시: ...)
    if (!feasibility) {
      const inlineMatch = mainText.match(/\((?:(?:실천\s*(?:방법|조건))|(?:\d+회\s*이상\s*)?위반\s*시\s*(?:조치\s*)?)[:：]\s*(.+?)\)/)
      if (inlineMatch) {
        feasibility = inlineMatch[1].trim()
        mainText = mainText.replace(inlineMatch[0], '').trim()
      }
    }

    // 번호/볼드/불릿 제거
    mainText = mainText
      .replace(/^\d+\.\s*/, '')
      .replace(/^\*\*(.+?)\*\*/, '$1')
      .replace(/^[-•]\s*/, '')
      .trim()

    // 범주 [소통] 추출
    let category = ''
    const catMatch = mainText.match(/^\[([^\]]+)\]\s*/)
    if (catMatch) {
      category = catMatch[1].trim()
      mainText = mainText.slice(catMatch[0].length).trim()
    }

    // 이름 : 설명 분리 (첫 번째 : 기준)
    const colonIdx = mainText.search(/\s*[:：]\s/)
    if (colonIdx > 0 && colonIdx < 40) {
      const name = mainText.slice(0, colonIdx).replace(/\*\*/g, '').trim()
      const desc = mainText.slice(colonIdx).replace(/^[\s:：]+/, '').trim()
      if (name && desc && !isNonContentLabel(name) && !isNonContentLabel(desc)) {
        rules.push({ category, name, description: desc, feasibility })
      }
    } else if (mainText.length > 5 && !isNonContentLabel(mainText)) {
      // 콜론 없으면 전체를 이름+설명으로
      rules.push({ category, name: mainText.slice(0, 30).replace(/\*\*/g, ''), description: mainText, feasibility })
    }
  }

  return rules
}

// ─── T-2-3 팀 일정 협의 ──────────────────────────────────────────────────

export interface T23ScheduleItem {
  period: string
  activity: string
  /** 활동의 구체 내용 — 어떻게 진행하는지, 주의사항/제약(예: 특정 일자 대체) 포함 */
  content: string
  assignee: string
}

export interface T23Structured {
  _schema: 'T-2-3'
  schedule: T23ScheduleItem[]
  /** 수동 공동 편집 워크스페이스 스냅샷 — T-2-3 모달에서 작성한 표·블록을 그대로 보존 */
  manualWorkspace?: import('@/types').TeamScheduleWorkspace
}

export function buildT23Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T23Structured {
  const result: T23Structured = { _schema: 'T-2-3', schedule: [] }
  const raw = (sections['팀 일정'] ?? '').trim()
  // [2026-09-20] 담당자가 정해지지 않은 초기 일정은 모델이 3열(기간|활동|마감) 표로 보내기도 한다
  // (라이브에서 팀 일정이 빈 채로 저장된 원인). 3열도 받아 담당자를 빈 값으로 둔다.
  if (raw) result.schedule = parseTableRows(raw, 3).map(cells => ({
    period: cells[0] || '', activity: cells[1] || '', content: cells[2] || '', assignee: cells[3] || '',
  }))
  if (result.schedule.length === 0) {
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, 3)
      if (rows.length > 0) {
        result.schedule = rows.map(cells => ({
          period: cells[0] || '', activity: cells[1] || '', content: cells[2] || '', assignee: cells[3] || '',
        }))
        break
      }
    }
  }
  return result
}

// ─── Ds-1-3 학습활동 설계 ────────────────────────────────────────────────
// 이미지 4단계 흐름 반영:
//  ① (개인+AI) 학습활동 아이디어 시각화 — 동사 중심 활동 나열 (외현화)
//  ② (교사팀) 논리적 흐름 재조정 — 문제이해→정보탐색→분석→의사결정→산출물제작→공유및수정 (조정)
//  ③ (개인교사) 목표 적합성 검토 — 핵심 활동 / 부가 활동 구분, 불필요 삭제 (판단)
//  ④ (교사팀+AI) 차시 운영안 정리 — 차시·예상시간·교사지원·필요자료·평가시점 (조정)

export interface Ds13Activity {
  order: string         // 순서 ("1", "2" …)
  phase: string         // 흐름 단계 (문제 이해 / 정보 탐색 / 분석 / 의사결정 / 산출물 제작 / 공유 및 수정)
  name: string          // 활동명 — 동사 중심 ("~하기")
  description: string   // 활동 설명 — 학생 수행 관점 2~3문장
  coreType: string      // "핵심" / "부가"
  subject: string       // 담당 교과 (주/보)
  session: string       // 누적 차시 (예: "1차시", "3~4차시")
  operation: string     // 차시 운영 메모 — 예상 시간·교사 지원·필요 자료·평가 시점
}

export interface Ds13Structured {
  _schema: 'Ds-1-3'
  activities: Ds13Activity[]
  /** AI 점검 — 목표·평가 정합성, 흐름·실행 적절성 단락 서술 */
  review: string
  /** 수동 공동 편집 워크스페이스 스냅샷 */
  manualWorkspace?: import('@/types').LearningActivityWorkspace
}

const DS13_COLS = 8

function rowsToDs13Activities(rows: string[][]): Ds13Activity[] {
  return rows.map(cells => ({
    order: cells[0] || '',
    phase: cells[1] || '',
    name: cells[2] || '',
    description: cells[3] || '',
    coreType: cells[4] || '',
    subject: cells[5] || '',
    session: cells[6] || '',
    operation: cells[7] || '',
  }))
}

export function buildDs13Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): Ds13Structured {
  const result: Ds13Structured = { _schema: 'Ds-1-3', activities: [], review: '' }
  result.review = (sections['AI 점검'] ?? '').trim()

  const raw = (sections['학습 활동'] ?? '').trim()
  if (raw) result.activities = rowsToDs13Activities(parseTableRows(raw, DS13_COLS))

  // 레거시(5열: 순서·활동명·설명·교과·차시) 산출물 호환 — 8열 매칭 실패 시 5열 시도
  if (result.activities.length === 0 && raw) {
    const legacy = parseTableRows(raw, 5)
    if (legacy.length > 0) {
      result.activities = legacy.map(cells => ({
        order: cells[0] || '',
        phase: '',
        name: cells[1] || '',
        description: cells[2] || '',
        coreType: '',
        subject: cells[3] || '',
        session: cells[4] || '',
        operation: '',
      }))
    }
  }

  if (result.activities.length === 0) {
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, DS13_COLS)
      if (rows.length > 0) { result.activities = rowsToDs13Activities(rows); break }
      const legacy = parseTableRows(msg.content, 5)
      if (legacy.length > 0) {
        result.activities = legacy.map(cells => ({
          order: cells[0] || '', phase: '', name: cells[1] || '', description: cells[2] || '',
          coreType: '', subject: cells[3] || '', session: cells[4] || '', operation: '',
        }))
        break
      }
    }
  }
  return result
}

// ─── Ds-2-1 지원 도구(자료) 설계 ────────────────────────────────────────
// 레퍼런스 4단계 흐름:
//  ❶ (개인교사+AI) 활동별 필요 자료 나열 — 기능 중심(조정의 원리)
//  ❷ (개인교사) 탐색 자료 / 개발 자료 구분 (인지 분산·조정)
//  ❸ (교사팀) 공동 개발 / 개별 개발 구분 (상호 의존)
//  ❹ (교사팀+AI) 자료 개발 일정·역할 분담 결정 → 활동-자료-운영 연결 구조

export interface Ds21Material {
  activity: string     // 대상 학습활동 (Ds-1-3 활동명 + 누적 차시)
  name: string         // 자료/도구명 + 핵심 기능
  purpose: string      // 활용 이유 — 학생의 어떤 수행을 지원하는지
  sourceType: string   // "탐색" | "개발"
  devScope: string     // (개발 자료) "공동" | "개별"
  owner: string        // 담당 교사
  schedule: string     // 일정 — 마감 / 중간 공유 / 최종 검토
}

export interface Ds21Structured {
  _schema: 'Ds-2-1'
  materials: Ds21Material[]
  /** AI 점검 — 학생 수준·출처·저작권·개인정보·접근성·기술 안정성 */
  envCheck: string
  /** Human-AI Agency — 학생·AI·교사의 역할, 판단 권한, 검증 책임 */
  humanAIAgency?: string
  /** 수동 공동 편집 워크스페이스 스냅샷 */
  manualWorkspace?: import('@/types').SupportToolWorkspace
}

const DS21_COLS = 7

function rowsToDs21Materials(rows: string[][]): Ds21Material[] {
  return rows.map(cells => ({
    activity: cells[0] || '',
    name: cells[1] || '',
    purpose: cells[2] || '',
    sourceType: cells[3] || '',
    devScope: cells[4] || '',
    owner: cells[5] || '',
    schedule: cells[6] || '',
  }))
}

export function buildDs21Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): Ds21Structured {
  const result: Ds21Structured = { _schema: 'Ds-2-1', materials: [], envCheck: '' }
  result.envCheck = (sections['AI 점검'] ?? '').trim()
  result.humanAIAgency = (sections['Human-AI Agency'] ?? sections['Human-AI 에이전시'] ?? sections['사람-AI 역할 조정'] ?? '').trim() || undefined

  const raw = (sections['활동별 자료 설계'] ?? sections['자료 설계'] ?? '').trim()
  if (raw) result.materials = rowsToDs21Materials(parseTableRows(raw, DS21_COLS))

  if (result.materials.length === 0) {
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, DS21_COLS)
      if (rows.length > 0) { result.materials = rowsToDs21Materials(rows); break }
    }
  }
  return result
}

// ─── Ds-2-2 스캐폴딩 설계 ────────────────────────────────────────────────
// 이미지 4단계 흐름 반영:
//  ① (교사팀) 활동별 예상 어려움·지원 아이디어 공유 (인지 분산·외현화)
//  ② (교사팀) 학습목표 근거 적절성 토론 — 발판 제공 우선 (조정·상호 의존)
//  ③ (교사팀+AI) 탐색·개발 자료 보완 — 학생 수행 장면 상상 (조정)
//  ④ (개인교사) 수정 자료 공유·재보완 — 반복 검토 (상호 의존·조정)

export interface Ds22SupportPlan {
  support: string         // 지원 방안 (자료명 + 간략 설명)
  targetActivity: string  // 대상 활동 (Ds-1-3 활동명 + 누적 차시)
}
export interface Ds22Scaffold {
  targetActivity: string  // 대상 활동 (Ds-1-3 활동명 + 누적 차시)
  type: string            // 스캐폴딩 유형 (개념 안내형/예시 제시형/절차 안내형/언어 프레임/구조화 틀 등)
  content: string         // 구체적 내용 — 제공 자료·진행 방식 2~3문장
  level: string           // 대상 수준 (전체 / 학습 지원 / 다문화 등)
  fadeOut: string         // 점진적 제거 계획 (GRR, Ds-1-3 누적 차시 기준)
}
export interface Ds22Structured {
  _schema: 'Ds-2-2'
  supportPlans: Ds22SupportPlan[]
  scaffolds: Ds22Scaffold[]
  /** AI 점검 — 적절성 검토 단락 (GRR 부합·개별화 충분성·제거 시점 명확성) */
  review: string
  /** 수동 공동 편집 워크스페이스 스냅샷 */
  manualWorkspace?: import('@/types').ScaffoldingWorkspace
}

function rowsToDs22Scaffolds(rows: string[][]): Ds22Scaffold[] {
  return rows.map(cells => ({
    targetActivity: cells[0] || '',
    type: cells[1] || '',
    content: cells[2] || '',
    level: cells[3] || '',
    fadeOut: cells[4] || '',
  }))
}

export function buildDs22Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): Ds22Structured {
  const result: Ds22Structured = { _schema: 'Ds-2-2', supportPlans: [], scaffolds: [], review: '' }
  result.review = (sections['AI 점검'] ?? '').trim()

  const supRaw = (sections['지원 방안 정리'] ?? '').trim()
  if (supRaw) {
    result.supportPlans = parseTableRows(supRaw, 2).map(cells => ({
      support: cells[0] || '',
      targetActivity: cells[1] || '',
    }))
  }

  const scRaw = (sections['스캐폴딩 계획'] ?? '').trim()
  if (scRaw) result.scaffolds = rowsToDs22Scaffolds(parseTableRows(scRaw, 5))

  if (result.scaffolds.length === 0) {
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, 5)
      if (rows.length > 0) { result.scaffolds = rowsToDs22Scaffolds(rows); break }
    }
  }
  return result
}

// ─── A-1-2 주제 선정 ─────────────────────────────────────────────────────

export interface A12Criterion { criterion: string; description: string; priority: string }
export interface A12LinkedSubject { subject: string; focus: string }

export interface A12Structured {
  _schema: 'A-1-2'
  criteria: A12Criterion[]
  linkedSubjects: A12LinkedSubject[]
  selectedTopic: string
  topicType: string        // 내용요소형 / 기능요소형 / 혼합형
  rationale: string
  /** 수동 공동 편집 워크스페이스 스냅샷 — A-1-2 모달에서 작성한 표·메타·블록을 그대로 보존 */
  manualWorkspace?: import('@/types').TopicSelectionWorkspace
}

export function buildA12Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A12Structured {
  const r: A12Structured = { _schema: 'A-1-2', criteria: [], linkedSubjects: [], selectedTopic: '', topicType: '', rationale: '' }
  // 기준
  const critRaw = (sections['주제 선정 기준'] ?? '').trim()
  if (critRaw) r.criteria = parseTableRows(critRaw, 2).map(c => ({ criterion: c[0], description: c[1] || '', priority: c[2] || '' }))
  const linkedRaw = (sections['연계 교과'] ?? sections['교과 연계'] ?? '').trim()
  if (linkedRaw) r.linkedSubjects = parseLinkedSubjects(linkedRaw)
  // 최종 주제 — 80자 이하만 유효 (긴 텍스트는 AI가 전체 응답을 넣은 것)
  const rawTopic = (sections['최종 선정 주제'] ?? sections['선정 주제'] ?? '').trim()
  r.selectedTopic = rawTopic.length <= 80 ? rawTopic.replace(/\*\*/g, '').replace(/^#+\s*/, '') : ''
  // 주제 유형
  const rawType = (sections['주제 유형'] ?? '').trim()
  r.topicType = rawType.length <= 40 ? rawType.replace(/\*\*/g, '') : ''
  // 선정 근거
  const rawRationale = (sections['선정 근거'] ?? '').trim()
  r.rationale = rawRationale.length <= 300 ? rawRationale.replace(/\*\*/g, '').replace(/^#+\s*/, '') : ''
  // fallback — 채팅에서 추출 (마크다운 strip 후 정밀 패턴)
  if (r.criteria.length === 0 || !r.selectedTopic) {
    const stripMd = (s: string) => s.replace(/\*\*/g, '').replace(/__/g, '').replace(/[*_~`]/g, '').trim()
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const rawLines = msg.content.split('\n')
      const lines = rawLines.map(stripMd)
      if (r.criteria.length === 0) { const rows = parseTableRows(msg.content, 2); if (rows.length >= 2) r.criteria = rows.map(c => ({ criterion: stripMd(c[0]), description: stripMd(c[1] || ''), priority: stripMd(c[2] || '') })) }
      if (r.linkedSubjects.length === 0) r.linkedSubjects = parseLinkedSubjects(msg.content)
      if (!r.selectedTopic) {
        for (const line of lines) {
          const m = line.match(/(?:[-•]\s*)?(?:최종\s*선정\s*주제|선정\s*주제)\s*[:：]\s*(.+)$/)
          if (m && m[1].length < 80 && m[1].length > 2) { r.selectedTopic = m[1].trim(); break }
        }
      }
      if (!r.topicType) {
        for (const line of lines) {
          const m = line.match(/(?:[-•]\s*)?주제\s*유형\s*[:：]\s*(.+?)(?:\s*[-–]|$)/)
          if (m && m[1].length < 40) { r.topicType = m[1].trim(); break }
        }
      }
      if (!r.rationale) {
        for (let li = 0; li < lines.length; li++) {
          const m = lines[li].match(/(?:[-•]\s*)?선정\s*근거\s*[:：]\s*(.*)/)
          if (m) {
            if (m[1].trim().length > 10) {
              r.rationale = m[1].trim()
            } else {
              const parts: string[] = []
              for (let j = li + 1; j < lines.length && j < li + 8; j++) {
                const bl = lines[j].match(/^\s*[-•]\s*(.+)/)
                if (bl) parts.push(bl[1].trim())
                else if (lines[j].trim() && !lines[j].match(/^\s*[-•]/)) break
              }
              if (parts.length > 0) r.rationale = parts.join('. ')
            }
            break
          }
        }
      }
      if (r.selectedTopic) break
    }
  }
  // 주제 유형 자동 추론
  if (!r.topicType && r.selectedTopic) {
    const t = r.selectedTopic + ' ' + r.rationale
    if (/해결|제작|표현|탐구|설계/.test(t) && /환경|사회|역사|과학|문화/.test(t)) r.topicType = '혼합형(내용 + 기능)'
    else if (/해결|제작|표현|탐구|설계/.test(t)) r.topicType = '기능요소형'
    else r.topicType = '내용요소형'
  }
  return r
}

function parseLinkedSubjects(raw: string): A12LinkedSubject[] {
  const subjectNames = ['국어', '사회', '수학', '과학', '도덕', '실과', '체육', '음악', '미술', '영어']
  const rows = parseTableRows(raw, 2)
    .map(c => ({ subject: stripArtifactMd(c[0] ?? ''), focus: stripArtifactMd(c[1] ?? '') }))
    .filter(item => subjectNames.includes(item.subject) && item.focus)
  if (rows.length > 0) return uniqueLinkedSubjects(rows)

  const parsed: A12LinkedSubject[] = []
  for (const line of raw.split('\n')) {
    const clean = stripArtifactMd(line).replace(/^[-•*\d.\s]+/, '').trim()
    const match = clean.match(/^([가-힣]+)\s*[:：]\s*(.+)$/)
    if (!match) continue
    const subject = match[1].replace(/과$/, '')
    if (!subjectNames.includes(subject)) continue
    parsed.push({ subject, focus: match[2].trim() })
  }
  return uniqueLinkedSubjects(parsed)
}

function uniqueLinkedSubjects(items: A12LinkedSubject[]): A12LinkedSubject[] {
  const seen = new Set<string>()
  const out: A12LinkedSubject[] = []
  for (const item of items) {
    if (seen.has(item.subject)) continue
    seen.add(item.subject)
    out.push(item)
  }
  return out
}

function stripArtifactMd(value: string): string {
  return value.replace(/\*\*/g, '').replace(/__/g, '').replace(/[*_~`]/g, '').trim()
}

function cleanA21Cell(value: string): string {
  return stripArtifactMd(value)
    .replace(/&(?:#124|124);/g, ' / ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

// ─── A-2-1 성취기준 분석 (기존 extractA21TableForSave 유지, 구조화는 단순 래핑) ──

export interface A21Row {
  subject: string           // 교과명
  coreIdea: string          // 핵심 아이디어
  standard?: string         // 성취기준
  knowledgeUnderstanding: string  // 지식·이해
  processFunction: string   // 과정·기능
  valueAttitude?: string    // 가치·태도
  contribution?: string     // 공통 요소 또는 교과의 고유 기여
  agentLessonExample?: string      // Agent 추천 수업아이디어
  description?: string             // 교사 수업내용 설명
  isCommon?: boolean        // 공통(팀 조정) 행 여부
}

export interface A21Structured {
  _schema: 'A-2-1'
  rows: A21Row[]
  commonElements?: string
  reconstructedStandard?: string
  agentLessonIdeas?: string
}

export function buildA21Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A21Structured {
  const r: A21Structured = { _schema: 'A-2-1', rows: [] }

  // 기존 "성취기준분석표" 키에서 4열 표 파싱 시도
  const raw = (sections['성취기준분석표'] ?? sections['핵심아이디어분석'] ?? '').trim()
  if (raw) r.rows = parseA21Table(raw)
  r.commonElements = (sections['공통 요소'] ?? sections['교과 간 공통 요소'] ?? '').trim() || undefined
  r.reconstructedStandard = (sections['재구조화 성취기준'] ?? sections['재구성 성취기준'] ?? '').trim() || undefined
  const agentLessonIdeas = (
    sections['Agent 추천 수업아이디어']
    ?? sections['Agent 추천 수업 예시']
    ?? sections['Agent 추천 수업예시']
    ?? ''
  ).trim()
  if (agentLessonIdeas) r.agentLessonIdeas = agentLessonIdeas

  // fallback: 채팅에서 4열 또는 7열 표 추출
  if (r.rows.length === 0) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseA21Table(msg.content)
      if (rows.length >= 2) { r.rows = rows; break }
    }
  }

  return r
}

function parseA21Table(raw: string): A21Row[] {
  const rows: A21Row[] = []
  const tableLines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (tableLines.length < 3) return rows

  // 헤더에서 열 인덱스 파악
  const headerCells = tableLines[0].replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanA21Cell)
  const findCol = (keywords: string[]) => headerCells.findIndex(h => keywords.some(k => h.includes(k)))

  const subjectIdx = findCol(['교과'])
  const coreIdeaIdx = findCol(['핵심아이디어', '핵심 아이디어'])
  const standardIdx = findCol(['성취기준'])
  const knowledgeIdx = findCol(['지식', '이해'])
  const functionIdx = findCol(['과정', '기능'])
  const attitudeIdx = findCol(['가치', '태도'])
  const contributionIdx = findCol(['공통 요소', '고유 기여', '교과 기여', '기여'])
  const agentLessonIdx = findCol(['Agent', '추천 수업', '수업아이디어', '수업 아이디어', '수업 예시'])
  const descriptionIdx = findCol(['수업내용', '수업 내용', '설명'])

  // 데이터 행 (헤더 + 구분자 제외)
  const dataLines = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1)
  for (const line of dataLines) {
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanA21Cell)
    const subject = cells[subjectIdx >= 0 ? subjectIdx : 0] || ''
    const coreIdea = cells[coreIdeaIdx >= 0 ? coreIdeaIdx : 1] || ''
    const standard = standardIdx >= 0 ? (cells[standardIdx] || '') : ''
    const knowledge = cells[knowledgeIdx >= 0 ? knowledgeIdx : 2] || ''
    const fn = cells[functionIdx >= 0 ? functionIdx : 3] || ''
    const attitude = attitudeIdx >= 0 ? (cells[attitudeIdx] || '') : ''
    const contribution = contributionIdx >= 0 ? (cells[contributionIdx] || '') : ''
    const agentLessonExample = agentLessonIdx >= 0 ? (cells[agentLessonIdx] || '') : ''
    const description = descriptionIdx >= 0 ? (cells[descriptionIdx] || '') : ''

    if (subject || coreIdea) {
      rows.push({
        subject,
        coreIdea,
        standard,
        knowledgeUnderstanding: knowledge,
        processFunction: fn,
        valueAttitude: attitude,
        contribution,
        agentLessonExample,
        description,
        isCommon: /공통|팀\s*조정|통합/.test(subject),
      })
    }
  }

  // 불릿 리스트 형식 fallback: "1. 과학\n• 핵심아이디어: ...\n• 지식·이해: ..."
  if (rows.length === 0) {
    const blocks = raw.split(/(?=\d+\.\s*[가-힣])/).filter(b => b.trim())
    for (const block of blocks) {
      const lines = block.split('\n').map(cleanA21Cell)
      const subjectMatch = lines[0]?.match(/^\d+\.\s*(.+?)(?:\s*$|\s*[:：])/)
      if (!subjectMatch) continue
      const subject = subjectMatch[1].trim()
      let coreIdea = '', knowledge = '', fn = '', attitude = '', contribution = ''
      for (const line of lines) {
        const ci = line.match(/핵심\s*아이디어\s*[:：]\s*(.+)/)
        if (ci) coreIdea = ci[1].trim()
        const kn = line.match(/지식[·⋅\s]*이해\s*[:：]\s*(.+)/)
        if (kn) knowledge = kn[1].trim()
        const pf = line.match(/과정[·⋅\s]*기능\s*[:：]\s*(.+)/)
        if (pf) fn = pf[1].trim()
        const va = line.match(/가치[·⋅\s]*태도\s*[:：]\s*(.+)/)
        if (va) attitude = va[1].trim()
        const co = line.match(/(?:고유\s*기여|교과\s*기여|공통\s*요소)\s*[:：]\s*(.+)/)
        if (co) contribution = co[1].trim()
      }
      if (subject && (coreIdea || knowledge)) {
        rows.push({ subject, coreIdea, knowledgeUnderstanding: knowledge, processFunction: fn, valueAttitude: attitude, contribution, isCommon: /공통|팀/.test(subject) })
      }
    }
  }

  return rows
}

// ─── A-2-2 통합 수업목표 진술 ────────────────────────────────────────────

/**
 * 교과별 수업목표 한 행.
 *  - goal: 본문 그대로 (지식·이해/과정·기능/가치·태도 태그 마커를 인라인으로 포함 가능)
 *  - knowledge/process/attitude: 가능하면 태그 부분만 분리 추출 (없으면 빈 문자열)
 */
export interface A22SubjectGoal {
  subject: string
  goal: string
  knowledge?: string
  process?: string
  attitude?: string
}

/**
 * 진술 방식
 *  - inductive: 귀납적 (개별 교과 목표 → 통합 목표)
 *  - deductive: 연역적 (통합 목표 → 개별 교과 목표)
 */
export type A22Method = 'inductive' | 'deductive'

export interface A22Structured {
  _schema: 'A-2-2'
  /** 공통 핵심 아이디어 (A-2-1에서 합의된 단일 문장. 산출물 상단에 노출) */
  commonCoreIdea: string
  /** 공통 핵심 아이디어를 학생의 언어로 바꾼 개방형 질문 */
  inquiryQuestion: string
  /** 통합 수업목표: 1개의 상위 문장. (레퍼런스 예: "학생은 ~ 할 수 있다") */
  integratedGoal: string
  /** 교과별 수업목표 표 */
  subjectGoals: A22SubjectGoal[]
  /** 공통 핵심 아이디어로 수렴되는 핵심 키워드 (협의 단계 추출 결과) */
  convergentKeywords: string[]
  /** 진술 방식 (선택) */
  method?: A22Method
  /** 수동 공동 편집 워크스페이스 (자유 형식 보존용 — 산출물로 보낼 때 원형 유지) */
  manualWorkspace?: IntegratedGoalWorkspace
}

const A22_TAG_KNOWLEDGE = /\(\s*지식[·⋅]\s*이해(?:\s*[:：]\s*([^)]*))?\)/
const A22_TAG_PROCESS = /\(\s*과정[·⋅]\s*기능(?:\s*[:：]\s*([^)]*))?\)/
const A22_TAG_ATTITUDE = /\(\s*가치[·⋅]\s*태도(?:\s*[:：]\s*([^)]*))?\)/

function extractA22Tag(goal: string, re: RegExp): string {
  const m = goal.match(re)
  if (!m) return ''
  return (m[1] ?? '').trim()
}

export function buildA22Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A22Structured {
  const r: A22Structured = {
    _schema: 'A-2-2',
    commonCoreIdea: '',
    inquiryQuestion: '',
    integratedGoal: '',
    subjectGoals: [],
    convergentKeywords: [],
  }

  // 1. 공통 핵심 아이디어 — A-2-2 산출물 본문 또는 A-2-1 산출물에서 가져옴
  r.commonCoreIdea = (sections['공통 핵심 아이디어'] ?? sections['핵심 아이디어'] ?? '').trim()
  r.inquiryQuestion = (sections['탐구 질문'] ?? sections['핵심 질문'] ?? sections['탐구질문'] ?? '').trim()

  // 2. 통합 수업목표 (단일 문장)
  const integratedRaw = (sections['통합 수업목표'] ?? sections['통합 학습목표'] ?? '').trim()
  if (integratedRaw) {
    // 다중 라인이면 첫 의미 있는 라인을 단일 문장으로 채택
    const firstLine = integratedRaw
      .split('\n')
      .map(l => l.replace(/^[-•\d.]\s*/, '').trim())
      .find(l => l.length > 0 && !isNonContentLabel(l))
    // 모든 라인이 절차/선택지면 비워두고 아래 fallback(최근 메시지)에 위임
    r.integratedGoal = firstLine ?? ''
  }

  // 3. 교과별 수업목표 표 (교과 | 목표)
  const sgRaw = (sections['교과별 수업목표'] ?? sections['교과별 세부 목표'] ?? '').trim()
  if (sgRaw) {
    r.subjectGoals = parseTableRows(sgRaw, 2).map(c => {
      const goal = (c[1] || '').trim()
      return {
        subject: (c[0] || '').trim(),
        goal,
        knowledge: extractA22Tag(goal, A22_TAG_KNOWLEDGE),
        process: extractA22Tag(goal, A22_TAG_PROCESS),
        attitude: extractA22Tag(goal, A22_TAG_ATTITUDE),
      }
    })
  }

  // 4. 핵심 키워드 (협의 단계 추출 결과)
  const kwRaw = (sections['핵심 키워드'] ?? sections['수렴 키워드'] ?? '').trim()
  if (kwRaw) {
    r.convergentKeywords = kwRaw
      .split(/[,\n·•]/)
      .map(s => s.replace(/^[-\d.]\s*/, '').trim())
      .filter(Boolean)
  }

  // 5. 진술 방식
  const methodRaw = (sections['진술 방식'] ?? '').trim()
  if (/연역/.test(methodRaw)) r.method = 'deductive'
  else if (/귀납/.test(methodRaw)) r.method = 'inductive'

  // 6. Fallback: 최근 AI 메시지에서 표/단일 통합 목표를 추출
  if (r.subjectGoals.length === 0 || !r.integratedGoal) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      if (r.subjectGoals.length === 0) {
        const rows = parseTableRows(msg.content, 2)
        if (rows.length >= 2) {
          r.subjectGoals = rows.map(c => {
            const goal = (c[1] || '').trim()
            return {
              subject: (c[0] || '').trim(),
              goal,
              knowledge: extractA22Tag(goal, A22_TAG_KNOWLEDGE),
              process: extractA22Tag(goal, A22_TAG_PROCESS),
              attitude: extractA22Tag(goal, A22_TAG_ATTITUDE),
            }
          })
        }
      }
      if (!r.integratedGoal) {
        const sentence = msg.content
          .split('\n')
          .map(l => l.replace(/^[-•\d.]\s*/, '').trim())
          .find(l => /^학생은?\s.{10,}.*(?:할 수 있다|있다)\.?$/.test(l))
        if (sentence) r.integratedGoal = sentence
      }
      if (r.subjectGoals.length > 0 && r.integratedGoal) break
    }
  }

  return r
}

/**
 * 통합 수업목표 워크스페이스(수동 공동 편집)를 A-2-2 구조화 산출물로 변환.
 * 자유 형식이라도 가능한 필드를 best-effort로 추출하고, 워크스페이스 원본은 manualWorkspace로 보존한다.
 * 컬럼 id가 디폴트(subject/goal/knowledge/process/attitude)와 다르면 라벨 매칭으로 fallback.
 */
export function workspaceToA22Structured(workspace: IntegratedGoalWorkspace): A22Structured {
  // 디폴트 컬럼 id 우선, 없으면 라벨로 fallback (자유 형식 호환)
  const findColumnId = (idCandidates: string[], labelCandidates: string[]): string | null => {
    for (const id of idCandidates) {
      if (workspace.columns.some(c => c.id === id)) return id
    }
    for (const label of labelCandidates) {
      const match = workspace.columns.find(c => c.label.replace(/\s/g, '').includes(label.replace(/\s/g, '')))
      if (match) return match.id
    }
    return null
  }
  const subjectCol = findColumnId(['subject'], ['교과', '과목'])
  const goalCol = findColumnId(['goal'], ['수업목표', '목표'])
  const knowledgeCol = findColumnId(['knowledge'], ['지식·이해', '지식', '이해'])
  const processCol = findColumnId(['process'], ['과정·기능', '과정', '기능'])
  const attitudeCol = findColumnId(['attitude'], ['가치·태도', '가치', '태도'])

  const subjectGoals: A22SubjectGoal[] = workspace.rows
    .map(row => {
      const subject = subjectCol ? (row.cells[subjectCol] ?? '').trim() : ''
      const goal = goalCol ? (row.cells[goalCol] ?? '').trim() : ''
      const knowledge = knowledgeCol ? (row.cells[knowledgeCol] ?? '').trim() : ''
      const process = processCol ? (row.cells[processCol] ?? '').trim() : ''
      const attitude = attitudeCol ? (row.cells[attitudeCol] ?? '').trim() : ''
      // goal 본문에 인라인 태그가 있으면 추출도 시도
      const result: A22SubjectGoal = { subject, goal }
      result.knowledge = knowledge || extractA22Tag(goal, A22_TAG_KNOWLEDGE)
      result.process = process || extractA22Tag(goal, A22_TAG_PROCESS)
      result.attitude = attitude || extractA22Tag(goal, A22_TAG_ATTITUDE)
      return result
    })
    .filter(item => item.subject || item.goal)

  const structured: A22Structured = {
    _schema: 'A-2-2',
    commonCoreIdea: workspace.commonCoreIdea.trim(),
    inquiryQuestion: workspace.inquiryQuestion.trim(),
    integratedGoal: workspace.integratedGoal.trim(),
    subjectGoals,
    convergentKeywords: workspace.convergentKeywords.map(k => k.trim()).filter(Boolean).slice(0, 8),
    manualWorkspace: workspace,
  }
  if (workspace.method) structured.method = workspace.method
  return structured
}

// ─── A-2-3 학습자·맥락 분석 ──────────────────────────────────────────────

export interface A23ProfileItem { item: string; content: string }
export interface A23TeacherNote { teacherName: string; note: string }

export interface A23Structured {
  _schema: 'A-2-3'
  commonProfile: A23ProfileItem[]  // 선수지식, 오개념·혼동, 환경 제약, 예상 난관
  teacherNotes: A23TeacherNote[]   // 교사별 맞춤 고려 포인트
}

export function buildA23Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A23Structured {
  const r: A23Structured = { _schema: 'A-2-3', commonProfile: [], teacherNotes: [] }
  const raw = (sections['학습자 프로필'] ?? '').trim()
  if (raw) {
    // 표 형식: | 항목 | 내용 |
    const rows = parseTableRows(raw, 2)
    if (rows.length > 0) r.commonProfile = rows.map(c => ({ item: c[0], content: c[1] || '' }))
    // 교사별 맞춤 (불릿: • 교사명 : 내용)
    const teacherLines = raw.split('\n').filter(l => /[-•]\s*.+선생님\s*[:：]/.test(l))
    r.teacherNotes = teacherLines.map(l => {
      const m = l.match(/[-•]\s*(.+?선생님)\s*[:：]\s*(.+)/)
      return m ? { teacherName: m[1].trim(), note: m[2].trim() } : null
    }).filter((n): n is A23TeacherNote => n !== null)
  }
  // fallback
  if (r.commonProfile.length === 0) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, 2)
      if (rows.length >= 2 && /선수|오개념|환경|난관/.test(msg.content)) {
        r.commonProfile = rows.map(c => ({ item: c[0], content: c[1] || '' }))
        break
      }
    }
  }
  if (r.teacherNotes.length === 0) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const tLines = msg.content.split('\n').filter(l => /[-•]\s*.+선생님\s*[:：]/.test(l))
      if (tLines.length >= 1) {
        r.teacherNotes = tLines.map(l => { const m = l.match(/[-•]\s*(.+?선생님)\s*[:：]\s*(.+)/); return m ? { teacherName: m[1].trim(), note: m[2].trim() } : null }).filter((n): n is A23TeacherNote => n !== null)
        break
      }
    }
  }
  return r
}

// ─── 공통 유틸 ───────────────────────────────────────────────────────────

/** 마크다운 표에서 데이터 행을 추출 (헤더/구분자 제외) */
function parseTableRows(raw: string, minCols: number): string[][] {
  const lines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length < 3) return []
  const dataLines = lines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1) // 헤더 제거
  return dataLines
    .map(line => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim()))
    .filter(cells => cells.length >= minCols && cells.some(c => c.length > 0))
    // A안/B안·"저장할까요?" 같은 선택지·확정 안내 행은 산출물 콘텐츠가 아님
    .filter(cells => !isNonContentLabel(cells[0] ?? ''))
}

// ─── 스키마 감지 유틸 ─────────────────────────────────────────────────────

// ─── 빈 필드 감지 ────────────────────────────────────────────────────────
// 구조화 산출물에서 아직 채워지지 않은 항목을 검출 → 사용자에게 격려 피드백 제공

export interface MissingField {
  label: string        // 사용자에게 보여줄 필드명
  hint: string         // 입력 유도 안내 문구
}

export function detectMissingFields(data: Record<string, unknown>): MissingField[] {
  const missing: MissingField[] = []
  const schema = data._schema as string | undefined

  if (schema === 'T-1-1') {
    const d = data as unknown as T11Structured
    if (!d.personalVisions?.length) missing.push({ label: '개인 비전', hint: '각 선생님의 비전 키워드와 정교화 문장을 공유해주세요' })
    if (!d.teamVision) missing.push({ label: '팀 공통 비전', hint: '팀이 합의한 비전 문장을 확정해주세요' })
    if (!d.coreKeywords?.length) missing.push({ label: '핵심 키워드', hint: '비전의 핵심 단어 3~5개를 정해주세요' })
  } else if (schema === 'T-1-2') {
    const d = data as unknown as T12Structured
    if (!d.designPrinciples?.length) missing.push({ label: '설계 원칙', hint: '수업에서 지킬 설계 원칙 3~5가지를 정해주세요' })
  } else if (schema === 'T-2-1') {
    const d = data as unknown as T21Structured
    if (!d.roles?.length) missing.push({ label: '역할 배분', hint: '팀원별 역할과 담당 업무를 나눠주세요' })
  } else if (schema === 'T-2-2') {
    const d = data as unknown as T22Structured
    if (!d.rules?.length) missing.push({ label: '팀 규칙', hint: '팀에서 지킬 규칙 3~5가지를 정해주세요' })
  } else if (schema === 'T-2-3') {
    const d = data as unknown as T23Structured
    if (!d.schedule?.length) missing.push({ label: '팀 일정', hint: '단계별 일정과 마감을 정해주세요' })
  } else if (schema === 'Ds-1-3') {
    const d = data as unknown as Ds13Structured
    if (!d.activities?.length) missing.push({ label: '학습 활동', hint: '학생이 수행할 활동을 흐름 단계별로 나열해주세요' })
    if (!d.review) missing.push({ label: 'AI 점검', hint: '목표·평가 정합성과 실행 적절성을 점검해주세요' })
  } else if (schema === 'Ds-2-2') {
    const d = data as unknown as Ds22Structured
    if (!d.scaffolds?.length) missing.push({ label: '스캐폴딩 계획', hint: '활동별 스캐폴딩 유형·내용·점진적 제거 계획을 정해주세요' })
    if (!d.review) missing.push({ label: 'AI 점검', hint: '점진적 책임 이양·개별화 지원 적절성을 점검해주세요' })
  } else if (schema === 'A-1-2') {
    const d = data as unknown as A12Structured
    if (!d.criteria?.length) missing.push({ label: '주제 선정 기준', hint: '주제를 고르는 기준 3가지를 정해주세요' })
    if (!d.selectedTopic) missing.push({ label: '선정 주제', hint: '팀이 합의한 주제를 확정해주세요' })
    if (!d.topicType) missing.push({ label: '주제 유형', hint: '내용요소형/기능요소형/혼합형 중 선택해주세요' })
    if (!d.rationale) missing.push({ label: '선정 근거', hint: '왜 이 주제를 선택했는지 근거를 적어주세요' })
  } else if (schema === 'A-2-1') {
    const d = data as unknown as A21Structured
    if (!d.rows?.length) missing.push({ label: '주제 상세 분석표', hint: '교과별 지식·이해, 과정·기능, 가치·태도 분석표를 완성해주세요' })
    if (!d.reconstructedStandard) missing.push({ label: '재구조화 성취기준', hint: '공통 요소와 교과별 고유 기여를 반영한 성취기준을 확정해주세요' })
  } else if (schema === 'A-2-2') {
    const d = data as unknown as A22Structured
    if (!d.commonCoreIdea) missing.push({ label: '공통 핵심 아이디어', hint: 'A-2-1에서 합의된 공통 핵심 아이디어를 1문장으로 옮겨주세요' })
    if (!d.inquiryQuestion) missing.push({ label: '탐구 질문', hint: '핵심 아이디어를 학생의 언어로 된 개방형 질문으로 바꿔주세요' })
    if (!d.integratedGoal) missing.push({ label: '통합 수업목표', hint: '"학생은 ~ 할 수 있다" 형식의 단일 통합 목표 1문장을 작성해주세요' })
    if (!d.subjectGoals?.length) missing.push({ label: '교과별 수업목표', hint: '각 교과별 수업목표를 (지식·이해)·(과정·기능)·(가치·태도) 태그와 함께 작성해주세요' })
  } else if (schema === 'A-2-3') {
    const d = data as unknown as A23Structured
    if (!d.commonProfile?.length) missing.push({ label: '학습자 프로필', hint: '선수지식, 오개념, 환경 제약 등을 정리해주세요' })
  }

  return missing
}

export function isStructuredArtifact(content: Record<string, unknown>): boolean {
  return typeof content._schema === 'string'
}

export function getArtifactSchema(content: Record<string, unknown>): string | null {
  return typeof content._schema === 'string' ? content._schema : null
}
