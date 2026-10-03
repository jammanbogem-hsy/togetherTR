// 성취기준 바로 뒤의 성취수준만 표시에서 제거한다. 저장된 원문은 바꾸지 않는다.
const STANDARD_LEVEL = /(\[?\d[가-힣]+\d{2}-\d{2}\]?(?:\*{1,2}|_{1,2}|`)?)[ \t]+(?:\*\*[ABC]\*\*|__[ABC]__|\*[ABC]\*|_[ABC]_|[ABC](?=(?:\*{1,2}|_{1,2}|`)?(?:$|[\s|,.;:!?()·/])))/gm

export function cleanReportMarkdown(content: string): string {
  return content.replace(STANDARD_LEVEL, '$1')
}
