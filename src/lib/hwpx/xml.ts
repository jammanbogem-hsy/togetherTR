// ─── XML 유틸리티 ────────────────────────────────────────────────────────
// rhwp 패턴: 타입 안전한 XML 빌더 + canonical defaults (기본값 생략)

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Canonical Defaults (rhwp SerializeContext 패턴) ─────────────────────
// 한컴 HWPX의 기본값. 이 값과 같으면 속성을 생략해도 정상 렌더링.

const CHAR_PR_DEFAULTS = {
  shadeColor: 'none',
  useFontSpace: '0',
  useKerning: '0',
  symMark: 'NONE',
} as const

const FONT_REF_DEFAULTS = { hangul: '0', latin: '0', hanja: '0', japanese: '0', other: '0', symbol: '0', user: '0' } as const
const RATIO_DEFAULTS   = { hangul: '100', latin: '100', hanja: '100', japanese: '100', other: '100', symbol: '100', user: '100' } as const
const ZERO_DEFAULTS    = { hangul: '0', latin: '0', hanja: '0', japanese: '0', other: '0', symbol: '0', user: '0' } as const

const UL_DEFAULTS  = { type: 'NONE', shape: 'SOLID', color: '#000000' } as const
const SO_DEFAULTS  = { shape: 'NONE', color: '#000000' } as const
const OUT_DEFAULT  = { type: 'NONE' } as const
const SHADOW_DEFAULTS = { type: 'NONE', color: '#B2B2B2', offsetX: '10', offsetY: '10' } as const

// ─── charPr 빌더 (프로그래매틱 XML 생성) ─────────────────────────────────

interface CharPrDef {
  id: number
  height: number          // 1/100pt (1000 = 10pt)
  textColor: string       // '#000000'
  bold?: boolean
  italic?: boolean
  borderFillIDRef?: number // default 1
  underline?: { type: string; shape: string; color: string }
}

export function buildCharPr(def: CharPrDef): string {
  const bfId = def.borderFillIDRef ?? 1
  const attrs = [
    `id="${def.id}"`,
    `height="${def.height}"`,
    `textColor="${def.textColor}"`,
    `shadeColor="${CHAR_PR_DEFAULTS.shadeColor}"`,
    `useFontSpace="${CHAR_PR_DEFAULTS.useFontSpace}"`,
    `useKerning="${CHAR_PR_DEFAULTS.useKerning}"`,
    `symMark="${CHAR_PR_DEFAULTS.symMark}"`,
    `borderFillIDRef="${bfId}"`,
  ]

  const fontRef = `<hh:fontRef ${Object.entries(FONT_REF_DEFAULTS).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
  const ratio   = `<hh:ratio ${Object.entries(RATIO_DEFAULTS).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
  const spacing = `<hh:spacing ${Object.entries(ZERO_DEFAULTS).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
  const relSz   = `<hh:relSz ${Object.entries(RATIO_DEFAULTS).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
  const offset  = `<hh:offset ${Object.entries(ZERO_DEFAULTS).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`

  const children = [fontRef, ratio, spacing, relSz, offset]
  if (def.bold)   children.push('<hh:bold/>')
  if (def.italic) children.push('<hh:italic/>')

  const ul = def.underline ?? UL_DEFAULTS
  children.push(`<hh:underline type="${ul.type}" shape="${ul.shape}" color="${ul.color}"/>`)
  children.push(`<hh:strikeout shape="${SO_DEFAULTS.shape}" color="${SO_DEFAULTS.color}"/>`)
  children.push(`<hh:outline type="${OUT_DEFAULT.type}"/>`)
  children.push(`<hh:shadow type="${SHADOW_DEFAULTS.type}" color="${SHADOW_DEFAULTS.color}" offsetX="${SHADOW_DEFAULTS.offsetX}" offsetY="${SHADOW_DEFAULTS.offsetY}"/>`)

  return `<hh:charPr ${attrs.join(' ')}>${children.join('')}</hh:charPr>`
}

// ─── parShape 빌더 ───────────────────────────────────────────────────────

interface ParShapeDef {
  id: number
  margin?: { left?: number; right?: number; prev?: number; next?: number; indent?: number }
  lineSpacing?: { type?: string; value: number }
  align?: { horizontal: string }
}

export function buildParShape(def: ParShapeDef): string {
  const m = def.margin ?? {}
  const ls = def.lineSpacing ?? { value: 160 }
  const al = def.align ?? { horizontal: 'JUSTIFY' }

  return `<hh:parShape id="${def.id}" tabIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:margin left="${m.left ?? 0}" right="${m.right ?? 0}" prev="${m.prev ?? 0}" next="${m.next ?? 0}" indent="${m.indent ?? 0}"/><hh:lineSpacing type="${ls.type ?? 'PERCENT'}" value="${ls.value}"/><hh:align horizontal="${al.horizontal}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:parShape>`
}

// ─── borderFill 빌더 ────────────────────────────────────────────────────

interface BorderFillDef {
  id: number
  left?: { type: string; width: string; color: string }
  right?: { type: string; width: string; color: string }
  top?: { type: string; width: string; color: string }
  bottom?: { type: string; width: string; color: string }
  fill?: { faceColor: string; hatchColor: string }
}

/**
 * HWPML이 허용하는 테두리 굵기 열거값. 이 목록에 없는 값(예: '0.18 mm')을 쓰면
 * 한글이 해당 테두리를 그리지 못해 **표 선이 사라지거나 일부만 그려진다**.
 * 자유 수치를 쓰지 못하므로 가장 가까운 허용값으로 스냅한다.
 */
export const HWP_LINE_WIDTHS = [
  0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0,
] as const

/** 임의의 'N mm' 문자열을 허용 열거값으로 스냅. 파싱 실패 시 최소값으로 안전 폴백. */
export function snapLineWidth(width: string): string {
  const mm = Number.parseFloat(width)
  if (!Number.isFinite(mm)) return '0.1 mm'
  const nearest = HWP_LINE_WIDTHS.reduce((best, cand) =>
    Math.abs(cand - mm) < Math.abs(best - mm) ? cand : best)
  // 0.1 → '0.1 mm', 1 → '1.0 mm' (한글이 쓰는 표기 그대로)
  return `${nearest < 1 ? nearest : nearest.toFixed(1)} mm`
}

export function buildBorderFill(def: BorderFillDef): string {
  const none = { type: 'NONE', width: '0.1 mm', color: '#000000' }
  const l = def.left ?? none
  const r = def.right ?? none
  const t = def.top ?? none
  const b = def.bottom ?? none

  let fillXml = ''
  if (def.fill) {
    fillXml = `<hc:fillBrush><hc:winBrush faceColor="${def.fill.faceColor}" hatchColor="${def.fill.hatchColor}"/></hc:fillBrush>`
  }

  const w = snapLineWidth
  return `<hh:borderFill id="${def.id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="${l.type}" width="${w(l.width)}" color="${l.color}"/><hh:rightBorder type="${r.type}" width="${w(r.width)}" color="${r.color}"/><hh:topBorder type="${t.type}" width="${w(t.width)}" color="${t.color}"/><hh:bottomBorder type="${b.type}" width="${w(b.width)}" color="${b.color}"/><hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>${fillXml}</hh:borderFill>`
}

// ─── XML validation (dev only) ──────────────────────────────────────────

export function validateXml(xml: string, label: string): void {
  if (typeof DOMParser === 'undefined') return
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  if (parsed.querySelector('parsererror')) {
    throw new Error(`${label} XML 생성 실패`)
  }
}
