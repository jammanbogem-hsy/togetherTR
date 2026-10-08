export interface ExtractedReplyChoices {
  question: string
  options: string[]
}

export const REPLY_CHOICES_RULES = `짧은 선택 답변이 필요하면 실제 논의 중인 대안 2~4개만 각각 **굵게** 표시하고, 대안을 쉼표·와/과·또는/혹은으로 연결한 한 문장 질문을 답변 말미에 쓴다. 질문에는 "중 어느/어떤 것을 고를까요?"처럼 선택을 분명하게 나타낸다.
같은 질문 문장에서는 대안 이외의 단어를 굵게 강조하지 않는다(집중박스의 "지금 할 일" 표시는 허용). 선택 질문 뒤에 추가 질문을 붙이지 않고 답변을 기다린다. 없는 대안이나 예시용 대안을 추가하지 않는다.
선택은 질문에 대한 답변일 뿐 저장·확정·이동 동의가 아니다. 저장/확정/이동 요청은 기존 확인 절차를 따른다. ACTION_CARD·HELP_CARD 또는 A안/B안 선택지가 이미 있으면 일반 선택 질문을 중복해서 만들지 않는다. 별도 신호를 출력하지 않는다.`

const FOCUS_LABEL = /^(?:\*\*지금\s*할\s*일[:：]?\*\*|__지금\s*할\s*일[:：]?__|지금\s*할\s*일[:：]?)(?:\s*[:：])?(?:\s+|$)/
const CONFLICT = /\b(?:ACTION_CARD|HELP_CARD|ARTIFACT_UPDATE|ARTIFACT_CONFIRM|ACTIVITY_ADVANCE|ACTIVITY_RETURN|TEAM_DISCUSSION_READY)\b|\b[A-D]\s*안/i
const EXAMPLE = /(?:^|\s)예\s*[:：]|예\s*(?:를\s*들|시)|가령|샘플|example|e\.g\./i
const UNSAFE_ACTION = /저장|확정|승인|동의|반영|전송|확인(?:했|완료)|다음\s*(?:단계|활동|스텝|으로)|넘어(?:가|갈)|이동(?:하|해|할|하기)|(?:이대로|그대로)\s*진행/
const BETWEEN_OPTIONS = /^(?:\s*(?:,|，|、|\/|와|과|또는|혹은|아니면|및|그리고)\s*)+$/
const CHOICE_INTENT = /^\s*(?:중(?:에서|에)?\s*)?(?:어느|어떤|고를|고르|선택)/
const CHOICE_CONNECTOR = /또는|혹은|(?:^|\s)중(?:에서|에)?(?:\s|어느|어떤|고를|고르|선택|$)/
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim()

/** 제약된 문장 형식만 읽는다. 애매하면 선택 버튼을 만들지 않고 원래 대화를 유지한다. */
export function extractReplyChoices(text: string): ExtractedReplyChoices | null {
  if (typeof text !== 'string' || !text.trim() || text.length > 20000 || CONFLICT.test(text)) return null
  if (/(?:^|\n)\s*(?:`{3}|~{3})|<\/?(?:code|pre|blockquote)\b/i.test(text)) return null
  const lines = text.trim().split(/\r?\n/)
  const last = lines[lines.length - 1]
  if (!last.trimEnd().endsWith('?')) return null
  let quoted = /^\s*>/.test(last)
  let start = lines.length - 1
  if (quoted) {
    while (start > 0 && /^\s*>/.test(lines[start - 1])) start--
  } else {
    while (start > 0 && lines[start - 1].trim() && !/^\s*(?:>|#{1,6}\s|[-+*]\s|\d+[.)]\s|\|)/.test(lines[start - 1])) start--
    // Markdown의 '>' 없는 이어지는 줄도 앞 인용문의 일부다(lazy continuation).
    if (start > 0 && /^\s*>/.test(lines[start - 1])) {
      quoted = true
      start--
      while (start > 0 && /^\s*>/.test(lines[start - 1])) start--
    }
  }
  let candidate = lines.slice(start).map(line => quoted ? line.replace(/^\s*>\s?/, '') : line).join('\n').trim()
  const focus = FOCUS_LABEL.exec(candidate)
  if (quoted && !focus) return null
  if (focus) candidate = candidate.slice(focus[0].length).trim()
  if (/^(?:>|#{1,6}\s|[-+*]\s|\d+[.)]\s|\|)|`|\\\*|\\_/.test(candidate) || candidate.includes('<') || candidate.includes('>')) return null
  if ((candidate.match(/\?/g) ?? []).length !== 1 || !candidate.endsWith('?')) return null
  const preceding = lines.slice(0, start).filter(line => line.trim()).at(-1) ?? ''
  if (/(?:예시|example|예를\s*들면)\s*[:：]?\s*$/i.test(preceding)) return null

  const bold = [...candidate.matchAll(/(\*\*|__)([^\r\n]+?)\1/g)]
  if (bold.length < 2 || bold.length > 4) return null
  const options = bold.map(match => oneLine(match[2]))
  if (options.some(option => !option || option.length > 160 || /[*_`\[\]<>?]/.test(option) || /^(?:대안|옵션|선택)\s*\d+$/.test(option))) return null
  if (new Set(options).size !== options.length) return null
  const prefix = candidate.slice(0, bold[0].index)
  if (EXAMPLE.test(prefix) || /^["'“‘]/.test(prefix.trim())) return null
  const gaps = bold.slice(0, -1).map((match, index) => candidate.slice(match.index! + match[0].length, bold[index + 1].index))
  if (gaps.some(gap => !BETWEEN_OPTIONS.test(gap))) return null
  const lastBold = bold[bold.length - 1]
  const tail = candidate.slice(lastBold.index! + lastBold[0].length)
  if (!CHOICE_INTENT.test(tail) || !CHOICE_CONNECTOR.test([...gaps, tail].join(' '))) return null
  if (/어떤\s*(?:뜻|의미|차이(?:점)?|공통점)(?:\s|[이가은는을를?])/.test(tail)) return null
  const plain = candidate.replace(/(\*\*|__)([^\r\n]+?)\1/g, '$2')
  if (/[*_`]/.test(plain) || UNSAFE_ACTION.test(plain) || plain.length > 900) return null
  return { question: oneLine(plain), options }
}
