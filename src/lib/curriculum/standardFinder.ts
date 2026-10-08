export function standardClipboardLine(code: string, text: string): string {
  const normalizedCode = code.trim().replace(/^\[|\]$/g, '')
  return `[${normalizedCode}] ${text.replace(/\s+/g, ' ').trim()}`
}

/** Subject is part of the key: equally named areas in different subjects stay separate. */
export function groupStandardsByArea<T extends { subject: string; area: string }>(standards: readonly T[]): { key: string; subject: string; area: string; standards: T[] }[] {
  const groups = new Map<string, { key: string; subject: string; area: string; standards: T[] }>()
  for (const standard of standards) {
    const area = standard.area.trim() || '영역 미분류'
    const key = JSON.stringify([standard.subject, area])
    if (!groups.has(key)) groups.set(key, { key, subject: standard.subject, area, standards: [] })
    groups.get(key)!.standards.push(standard)
  }
  return [...groups.values()]
}
