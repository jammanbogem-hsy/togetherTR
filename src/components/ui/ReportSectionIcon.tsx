'use client'

import type { CSSProperties, ReactNode } from 'react'

// ─── 보고서 섹션 아이콘 (Material Design 3 · Material Symbols Rounded) ───
// 보고서 제목이 이모지(🎯 📋 🔍 …)로 시작하던 것을 MD3 공식 아이콘 에셋으로 대체한다.
// 이모지는 OS·브라우저마다 모양이 달라 문서 톤이 흔들리고,
// PDF·HWPX로 내보낼 때 글꼴에 따라 깨지거나 흑백으로 떨어진다.
//
// 폰트는 app/layout.tsx에서 icon_names 서브셋으로 로드한다.
// ⚠️ 여기에 새 아이콘을 추가하면 layout.tsx의 icon_names 목록에도 반드시 넣어야 한다.
// (빠뜨리면 아이콘 대신 'assignment' 같은 리거처 이름이 글자로 노출된다)

/** 제목 앞머리의 이모지·기호를 제거하고 순수 텍스트만 남긴다 */
export function stripLeadingEmoji(text: string): string {
  return text
    .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '')
    .trim()
}

// 기존에 저장된 보고서는 본문에 이모지가 그대로 남아 있으므로
// 이모지로도, 제목 문구로도 찾을 수 있게 두 갈래로 매핑한다.
const BY_EMOJI: Record<string, string> = {
  '🎯': 'target',
  '📋': 'assignment',
  '📄': 'description',
  '🔍': 'search',
  '📊': 'bar_chart',
  '💡': 'lightbulb',
  '✅': 'check_circle',
  '⚠': 'warning',
  '⚠️': 'warning',
}

const BY_KEYWORD: Array<[RegExp, string]> = [
  [/핵심 요약/, 'target'],
  [/활동별 산출물/, 'assignment'],
  [/산출물 원문/, 'description'],
  [/심층 분석|분석 및 인사이트/, 'search'],
  [/완성도 평가/, 'bar_chart'],
  [/전문가 인사이트/, 'lightbulb'],
  [/강점/, 'check_circle'],
  [/점검 사항/, 'warning'],
  [/체크리스트|점검표/, 'checklist'],
]

/** 제목 텍스트에 맞는 Material Symbols 이름. 못 찾으면 null. */
export function pickReportIcon(raw: string): string | null {
  for (const [emoji, name] of Object.entries(BY_EMOJI)) {
    if (raw.startsWith(emoji)) return name
  }
  const text = stripLeadingEmoji(raw)
  for (const [re, name] of BY_KEYWORD) {
    if (re.test(text)) return name
  }
  return null
}

/** Material Symbols 아이콘 한 글자. size(px)·fill(0|1)로 MD3 축을 조정. */
export function ReportIcon({
  name,
  size = 18,
  fill = 1,
  color,
  style,
}: {
  name: string
  size?: number
  fill?: 0 | 1
  color?: string
  style?: CSSProperties
}) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden="true"
      style={{
        fontSize: size,
        lineHeight: 1,
        color,
        // MD3 가변 축 — 채움/굵기/광학 크기
        fontVariationSettings: `'FILL' ${fill}, 'wght' 500, 'GRAD' 0, 'opsz' ${size}`,
        ...style,
      }}
    >
      {name}
    </span>
  )
}

/** ReactMarkdown children(ReactNode[])에서 앞쪽 문자열만 추출 */
export function childrenToText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) {
    return children.map(c => (typeof c === 'string' ? c : '')).join('')
  }
  return ''
}
