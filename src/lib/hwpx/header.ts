// ─── header.xml 프로그래매틱 빌더 ────────────────────────────────────────
// rhwp 패턴: 템플릿 문자열 대신 빌더 함수로 header 구성
// → 속성 추가/수정이 안전, ID 참조 무결성 보장

import { buildCharPr, buildParShape, buildBorderFill } from './xml'

// ─── Font 정의 (정적) ────────────────────────────────────────────────────

const FONT_FACE = '<hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>'
const SYMBOL_FACE = '<hh:font id="0" face="Symbol" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>'

const FONT_FACES = [
  'HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'USER',
].map(lang => `<hh:fontface lang="${lang}" fontCnt="1">${FONT_FACE}</hh:fontface>`)
  .concat(`<hh:fontface lang="SYMBOL" fontCnt="1">${SYMBOL_FACE}</hh:fontface>`)

// ─── BorderFill 정의 ────────────────────────────────────────────────────

const BORDER_FILLS = [
  buildBorderFill({ id: 1 }),
  buildBorderFill({
    id: 2,
    left: { type: 'SOLID', width: '0.12 mm', color: '#000000' },
    right: { type: 'SOLID', width: '0.12 mm', color: '#000000' },
    top: { type: 'SOLID', width: '0.12 mm', color: '#000000' },
    bottom: { type: 'SOLID', width: '0.12 mm', color: '#000000' },
  }),
  // 표 본문 셀 — 굵기는 HWP 허용 열거값(HWP_LINE_WIDTHS)만 사용해야 한글이 선을 그린다.
  // 0.18mm 같은 비허용 값은 테두리가 통째로 사라지는 원인이었다.
  buildBorderFill({
    id: 3,
    left: { type: 'SOLID', width: '0.2 mm', color: '#B8C1D1' },
    right: { type: 'SOLID', width: '0.2 mm', color: '#B8C1D1' },
    top: { type: 'SOLID', width: '0.2 mm', color: '#8B96A8' },
    bottom: { type: 'SOLID', width: '0.2 mm', color: '#8B96A8' },
  }),
  // 표 헤더 셀 — 본문보다 한 단계 굵게 (0.25mm) 하여 머리행 위계를 만든다.
  buildBorderFill({
    id: 4,
    left: { type: 'SOLID', width: '0.25 mm', color: '#1557B0' },
    right: { type: 'SOLID', width: '0.25 mm', color: '#1557B0' },
    top: { type: 'SOLID', width: '0.25 mm', color: '#0D47A1' },
    bottom: { type: 'SOLID', width: '0.25 mm', color: '#0D47A1' },
    fill: { faceColor: '#1A73E8', hatchColor: '#1A73E8' },
  }),
  buildBorderFill({
    id: 5,
    left: { type: 'SOLID', width: '1.0 mm', color: '#1A73E8' },
    right: { type: 'SOLID', width: '0.15 mm', color: '#DADCE0' },
    top: { type: 'SOLID', width: '0.15 mm', color: '#DADCE0' },
    bottom: { type: 'SOLID', width: '0.15 mm', color: '#DADCE0' },
    fill: { faceColor: '#EDE8F5', hatchColor: '#EDE8F5' },  // 화면의 gradient(#EAF2FF→#F3E5F5) 중간색
  }),
  // H2 배지 박스: 연블루 배경 + 좌측 두꺼운 파란 바 (화면의 #E8F0FE badge 재현)
  buildBorderFill({
    id: 6,
    left: { type: 'SOLID', width: '1.0 mm', color: '#1A73E8' },
    right: { type: 'NONE', width: '0.1 mm', color: '#000000' },
    top: { type: 'NONE', width: '0.1 mm', color: '#000000' },
    bottom: { type: 'SOLID', width: '0.3 mm', color: '#1A73E8' },
    fill: { faceColor: '#E8F0FE', hatchColor: '#E8F0FE' },
  }),
  // H3 좌측 파란 바 (화면의 borderLeft: 3px solid #1A73E8)
  buildBorderFill({
    id: 7,
    left: { type: 'SOLID', width: '0.7 mm', color: '#1A73E8' },
    right: { type: 'NONE', width: '0.1 mm', color: '#000000' },
    top: { type: 'NONE', width: '0.1 mm', color: '#000000' },
    bottom: { type: 'NONE', width: '0.1 mm', color: '#000000' },
  }),
  // H4 좌측 회색 바 (화면의 borderLeft: 2px solid #DADCE0)
  buildBorderFill({
    id: 8,
    left: { type: 'SOLID', width: '0.5 mm', color: '#DADCE0' },
    right: { type: 'NONE', width: '0.1 mm', color: '#000000' },
    top: { type: 'NONE', width: '0.1 mm', color: '#000000' },
    bottom: { type: 'NONE', width: '0.1 mm', color: '#000000' },
  }),
]

// ─── CharPr 정의 ─────────────────────────────────────────────────────────

const CHAR_PROPERTIES = [
  buildCharPr({ id: 0,  height: 1000, textColor: '#000000' }),                                          // BODY
  buildCharPr({ id: 1,  height: 1800, textColor: '#000000', bold: true }),                               // legacy H1
  buildCharPr({ id: 2,  height: 1400, textColor: '#000000', bold: true }),                               // legacy H2
  buildCharPr({ id: 3,  height: 1200, textColor: '#000000', bold: true }),                               // legacy H3
  buildCharPr({ id: 4,  height: 1000, textColor: '#000000', bold: true }),                               // legacy H4
  buildCharPr({ id: 5,  height: 1000, textColor: '#5F6368', italic: true }),                             // ITALIC
  buildCharPr({ id: 6,  height: 950,  textColor: '#0B57D0' }),                                           // CODE
  buildCharPr({ id: 7,  height: 1000, textColor: '#202124', bold: true, italic: true }),                 // BOLD_ITALIC
  buildCharPr({ id: 8,  height: 900,  textColor: '#202124' }),                                           // TABLE_DENSE
  buildCharPr({ id: 9,  height: 900,  textColor: '#202124', bold: true }),                               // TABLE_DENSE_BOLD
  buildCharPr({ id: 10, height: 2600, textColor: '#0D47A1', bold: true,                                 // H1
    underline: { type: 'BOTTOM', shape: 'DOUBLE', color: '#0D47A1' } }),
  buildCharPr({ id: 11, height: 2000, textColor: '#1A73E8', bold: true,                                 // H2
    underline: { type: 'BOTTOM', shape: 'SOLID', color: '#1A73E8' } }),
  buildCharPr({ id: 12, height: 1500, textColor: '#1557B0', bold: true }),                               // H3
  buildCharPr({ id: 13, height: 1250, textColor: '#3C4043', bold: true }),                               // H4
  buildCharPr({ id: 14, height: 1000, textColor: '#0B57D0', bold: true }),                               // BOLD
  buildCharPr({ id: 15, height: 1000, textColor: '#FFFFFF', bold: true }),                               // TH_WHITE
  buildCharPr({ id: 16, height: 900,  textColor: '#FFFFFF', bold: true }),                               // TH_WHITE_SM
  buildCharPr({ id: 17, height: 1200, textColor: '#1A73E8', bold: true }),                               // H2_BADGE (배지 내부)
  buildCharPr({ id: 18, height: 1300, textColor: '#1557B0', bold: true }),                               // H3_BAR (좌측바 내부)
]

// ─── ParShape 정의 ───────────────────────────────────────────────────────

const PAR_SHAPES = [
  buildParShape({ id: 0, lineSpacing: { value: 160 }, align: { horizontal: 'JUSTIFY' } }),
  buildParShape({ id: 1, margin: { next: 520 }, lineSpacing: { value: 140 }, align: { horizontal: 'LEFT' } }),
  buildParShape({ id: 2, margin: { prev: 280, next: 340 }, lineSpacing: { value: 145 }, align: { horizontal: 'LEFT' } }),
  buildParShape({ id: 3, margin: { prev: 220, next: 220 }, lineSpacing: { value: 150 }, align: { horizontal: 'LEFT' } }),
  buildParShape({ id: 4, margin: { prev: 180, next: 180 }, lineSpacing: { value: 155 }, align: { horizontal: 'LEFT' } }),
  buildParShape({ id: 5, margin: { left: 1200, indent: -420, next: 80 }, lineSpacing: { value: 160 }, align: { horizontal: 'JUSTIFY' } }),
  buildParShape({ id: 6, margin: { left: 900, right: 300, prev: 80, next: 180 }, lineSpacing: { value: 160 }, align: { horizontal: 'JUSTIFY' } }),
  buildParShape({ id: 7, lineSpacing: { value: 135 }, align: { horizontal: 'CENTER' } }),
  buildParShape({ id: 8, lineSpacing: { value: 138 }, align: { horizontal: 'LEFT' } }),
]

// ─── Styles ──────────────────────────────────────────────────────────────

const STYLES = [
  '<hh:style id="0" type="PARA" name="바탕글" engName="Normal" parPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langIDRef="0" lockForm="0"/>',
  '<hh:style id="1" type="PARA" name="표 머리글" engName="TableHeader" parPrIDRef="7" charPrIDRef="15" nextStyleIDRef="0" langIDRef="0" lockForm="0"/>',
]

// ─── 최종 header.xml 조립 ────────────────────────────────────────────────

export function createHeaderXml(): string {
  const fontFacesXml = `<hh:fontfaces itemCnt="${FONT_FACES.length}">${FONT_FACES.join('')}</hh:fontfaces>`
  const borderFillsXml = `<hh:borderFills itemCnt="${BORDER_FILLS.length}">${BORDER_FILLS.join('')}</hh:borderFills>`
  const charPropsXml = `<hh:charProperties itemCnt="${CHAR_PROPERTIES.length}">${CHAR_PROPERTIES.join('')}</hh:charProperties>`
  const parShapesXml = `<hh:parShapes itemCnt="${PAR_SHAPES.length}">${PAR_SHAPES.join('')}</hh:parShapes>`
  const stylesXml = `<hh:styles itemCnt="${STYLES.length}">${STYLES.join('')}</hh:styles>`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" version="1.5" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>${fontFacesXml}${borderFillsXml}${charPropsXml}${parShapesXml}${stylesXml}</hh:refList><hh:compatibleDocument targetProgram="HWP2014"/><hh:docOption><hh:linkinfo path="" pageInherit="1" footnoteInherit="0"/></hh:docOption></hh:head>`
}
