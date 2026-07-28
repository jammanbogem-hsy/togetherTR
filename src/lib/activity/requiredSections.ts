export interface RequiredSectionRule {
  key: string
  minChars: number
  required: 'all' | 'any' | 'optional'
}

function sectionSatisfies(
  content: Record<string, unknown>,
  section: RequiredSectionRule,
): boolean {
  const raw = content[section.key]
  if (typeof raw !== 'string') return false
  return raw.replace(/\s/g, '').length >= section.minChars
}

export function validateRequiredSections(
  content: Record<string, unknown> | undefined | null,
  sections: RequiredSectionRule[] | undefined,
): boolean {
  if (!content || !sections) return false

  const allRequired = sections.filter(section => section.required === 'all')
  if (allRequired.some(section => !sectionSatisfies(content, section))) return false

  const anyRequired = sections.filter(section => section.required === 'any')
  if (anyRequired.length > 0 && !anyRequired.some(section => sectionSatisfies(content, section))) {
    return false
  }

  return true
}
