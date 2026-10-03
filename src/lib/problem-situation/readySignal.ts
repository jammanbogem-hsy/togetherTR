const READY_KEYS = ['제목', '행1', '행2', '행3', '핵심질문', '탐구1', '탐구2', '탐구3'] as const
type ReadyKey = typeof READY_KEYS[number]

// 저장 키로 시작하는 표시만 읽고, 값 안의 성취기준 대괄호는 그대로 보존한다.
function readyMarks(text: string) {
  const keys = READY_KEYS.join('|')
  const starts = new RegExp(`\\[(?:PS_READY:\\s*|(?:${keys})\\s*=)`, 'g')
  const marks: Array<{ start: number; end: number; fields: Partial<Record<ReadyKey, string>> }> = []
  for (let match; (match = starts.exec(text));) {
    let depth = 1
    let end = match.index + 1
    for (; end < text.length && depth > 0; end++) {
      if (text[end] === '[') depth++
      else if (text[end] === ']') depth--
    }
    const fields: Partial<Record<ReadyKey, string>> = {}
    if (depth === 0) {
      const raw = text.slice(match.index + 1, end - 1).replace(/^PS_READY:\s*/, '')
      const fieldsStart = [...raw.matchAll(new RegExp(`(?:^|\\|)\\s*(${keys})\\s*=`, 'g'))]
      for (let i = 0; i < fieldsStart.length; i++) {
        const field = fieldsStart[i]
        fields[field[1] as ReadyKey] = raw.slice(field.index! + field[0].length, fieldsStart[i + 1]?.index ?? raw.length).trim()
      }
    }
    marks.push({ start: match.index, end, fields })
    starts.lastIndex = end
  }
  return marks
}

export function parsePsReady(text: string) {
  const fields = Object.assign({}, ...readyMarks(text).map(mark => mark.fields)) as Partial<Record<ReadyKey, string>>
  if (Object.keys(fields).length === 0) return null
  const get = (key: ReadyKey) => fields[key] ?? ''
  return {
    scenario: { title: get('제목'), row1: get('행1'), row2: get('행2'), row3: get('행3') },
    drivingQuestion: get('핵심질문'),
    essentialQuestions: [get('탐구1'), get('탐구2'), get('탐구3')].filter(Boolean),
  }
}

export function cleanPsReady(text: string): string {
  let clean = text
  // 스트리밍 중 아직 닫히지 않은 저장 표시도 사용자 본문에서는 숨긴다.
  for (const mark of readyMarks(text).reverse()) {
    clean = clean.slice(0, mark.start) + clean.slice(mark.end)
  }
  return clean.trim()
}
