// 화면과 PDF가 같은 단일 열 레이아웃·표 규칙을 사용한다.
export const REPORT_ICON_TONES = {
  strengths: { container: '#C4EED0', ink: '#072711' },
  improvements: { container: '#FFE7C7', ink: '#8A3D00' },
} as const

export function reportStageColors(hex: string): { band: string; container: string; line: string } {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16))
  const tone = (factor: number, base = 0) => '#' + rgb.map(value => Math.round(value * factor + base * (1 - factor)).toString(16).padStart(2, '0')).join('')
  // line: 표 선 — 바탕색(container)보다 진해 선이 잘 보이게 한다.
  return { band: tone(0.82), container: tone(0.1, 255), line: tone(0.32, 255) }
}

const ICON_CSS = Object.entries(REPORT_ICON_TONES).map(([kind, tone]) => `.report-section[data-report-kind="${kind}"] .report-section-icon{background:${tone.container};color:${tone.ink}}`).join('\n')

// 인쇄에서는 화면용 스크롤·고정 높이·고정 머리글을 풀고 전체 본문을 페이지에 배치한다.
export const REPORT_PRINT_CSS = `
@media print{
html,body,body *{max-height:none!important;overflow:visible!important;overflow-x:visible!important;overflow-y:visible!important}
body div,body section,body article,body aside,body pre{height:auto!important;min-height:0!important;contain:none!important}
.report-hero,.report-dashboard,.report-hero *,.report-dashboard *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.report-hero-banner,.report-metrics,.report-callout{break-inside:avoid;page-break-inside:avoid}
.report-section,.report-body,.report-activities,.report-activity,.report-table-scroll{break-inside:auto;page-break-inside:auto}
.report-section h2,.report-dashboard h3{break-after:avoid;page-break-after:avoid}
.report-dashboard table{width:100%;max-width:100%;min-width:0!important;table-layout:auto;font-size:10px}
.report-dashboard th,.report-dashboard td{min-width:0!important;padding:5px 7px}
.report-dashboard th,body [style*="sticky"],body [style*="fixed"]{position:static!important;top:auto!important;z-index:auto!important}
.report-dashboard thead{display:table-header-group}
.report-dashboard tbody{display:table-row-group}
.report-dashboard tr{break-inside:avoid;page-break-inside:avoid}
.report-dashboard .whitespace-nowrap{white-space:nowrap}
.report-dashboard pre{white-space:pre-wrap;overflow-wrap:anywhere}
.report-table-wide{border:0;background:transparent}
.report-table-wide table,.report-table-wide tbody{display:block;width:100%}
.report-table-wide thead{display:none}
.report-table-wide tbody tr{display:block;border:1.5px solid var(--report-stage-line,#B9CBEF);border-left:4px solid var(--report-stage-band,#1558D6);border-radius:8px;margin:14px 0;break-inside:avoid;page-break-inside:avoid;background:#fff}
.report-table-wide td{display:block;width:auto;min-width:0!important;text-align:left!important;padding:5px 12px;border:0!important;white-space:normal;word-break:keep-all;overflow-wrap:normal}
.report-table-wide td:first-child{background:var(--report-stage-container,#E8F0FE);padding:8px 12px;font-weight:700;color:var(--report-stage-band,#1558D6);border-radius:0 7px 0 0}
.report-table-wide td:first-child:before{color:inherit}
.report-table-wide td:before{content:attr(data-label);display:inline-block;white-space:nowrap;font-size:10px;font-weight:700;margin-right:8px;color:#1A1C1E}
.report-table-wide td[data-short-cell="true"]{white-space:nowrap}
.report-section.report-appendix{break-before:page;page-break-before:always;break-inside:auto;page-break-inside:auto}
}
`

export const REPORT_DASHBOARD_CSS = `
.report-hero,.report-dashboard{color:#1A1C1E;font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.65;min-width:0;max-width:100%;word-break:keep-all;overflow-wrap:normal}
.report-hero *,.report-dashboard *{box-sizing:border-box}
.report-hero svg,.report-dashboard svg{display:inline-block;vertical-align:middle;flex-shrink:0}
.report-hero{margin-bottom:24px}
.report-hero-banner{padding:18px;border-radius:12px}
.report-hero-title{display:flex;align-items:center;gap:10px}
.report-stage-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.report-hero-title h3{font-size:21px;line-height:1.3;margin:2px 0;font-weight:700}
.report-eyebrow{font-size:11px;margin:0}.report-project-name{font-size:13px;margin:4px 0 0;font-weight:600}
.report-hero-summary{font-size:15px;line-height:1.6;margin:12px 0 0}
.report-dates{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;margin-top:10px;color:#43474E}
.report-metrics{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin:10px 0 0}
.report-metric{display:flex;align-items:center;gap:5px}
.report-metric dt{order:2;font-size:11px;color:#43474E}
.report-metric dd{order:1;display:flex;align-items:center;gap:4px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;margin:0}
.report-metric small{font-size:10px;font-weight:400}
.report-section{width:100%;min-width:0;max-width:100%;margin:28px 0 0}
.report-section:first-of-type{margin-top:0}
.report-section h2{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:0 0 9px;font-size:17px;line-height:1.5;font-weight:700;border-bottom:1px solid var(--report-stage-container,#E8F0FE);color:#1A1C1E}
.report-section-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:var(--report-stage-container,#E8F0FE);color:var(--report-stage-band,#1558D6)}
${ICON_CSS}
.report-body{min-width:0}
.report-dashboard h1{font-size:21px;line-height:1.4;margin:0 0 18px;color:#1A1C1E}
.report-dashboard h3{font-size:15px;margin:18px 0 8px;line-height:1.5;font-weight:700}.report-dashboard h4{font-size:14px;margin:14px 0 6px;font-weight:600}
.report-dashboard p{margin:8px 0}.report-dashboard p:first-child{margin-top:0}.report-dashboard p:last-child{margin-bottom:0}
.report-dashboard strong{font-weight:700;color:inherit}
.report-dashboard ul,.report-dashboard ol{margin:8px 0;padding:0;list-style:none;display:block}
.report-dashboard li{display:flex;align-items:flex-start;gap:7px;margin:6px 0}.report-list-mark{flex-shrink:0;min-width:14px;font-size:13px;color:#43474E}
.report-list-content{flex:1;min-width:0}.report-list-content>p{margin:0}
.report-activities{display:block;width:100%}
.report-activity{width:100%;min-width:0;margin:20px 0 0}
.report-activity:first-child{margin-top:12px}
.report-activity-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin:0 0 8px}
.report-activity-heading h3{margin:0}.report-status{font-size:11px;color:#43474E}
.report-subhead{display:flex;align-items:center;gap:7px;margin-top:16px!important;margin-bottom:6px!important;font-size:14px;color:var(--report-stage-band,#1558D6)}
.report-subhead:before{content:'';flex-shrink:0;width:3px;height:14px;border-radius:2px;background:var(--report-stage-band,#1558D6)}
.report-subhead[data-icon]:before{display:none}.report-subhead>svg{color:var(--report-stage-band,#1558D6)}
.report-activity-heading h3{display:flex;align-items:center;gap:8px}
.report-activity-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:26px;height:26px;border-radius:50%;background:#fff;color:var(--report-stage-band,#1558D6)}
.report-section[data-report-kind="appendix"] .report-activity{margin-top:24px}
.report-section[data-report-kind="appendix"] .report-activity-heading{background:var(--report-stage-container,#E8F0FE);border-left:4px solid var(--report-stage-band,#1558D6);border-radius:6px;padding:8px 12px;margin:0 0 4px}
.report-section[data-report-kind="appendix"] .report-activity>:not(.report-activity-heading){margin-left:14px}
.report-callout{display:flex;align-items:flex-start;gap:8px;border-left:2px solid var(--report-stage-band,#1558D6);background:var(--report-stage-container,#E8F0FE);padding:10px 12px;margin:14px 0;color:#1A1C1E}
.report-callout>svg{margin-top:3px;color:var(--report-stage-band,#1558D6)}.report-callout>div{min-width:0}
.report-table-scroll{max-width:100%;max-height:60vh;overflow:auto;border:1.5px solid var(--report-stage-line,#B9CBEF);border-radius:6px;background:#fff;margin:12px 0;outline-offset:2px}
.report-dashboard table{width:100%;border-spacing:0;border-collapse:separate;font-size:12px;line-height:1.4;color:#1A1C1E;min-width:440px;text-align:left;word-break:keep-all}
.report-dashboard th{position:sticky;top:0;z-index:1;background:var(--report-stage-container,#E8F0FE);color:#1A1C1E;font-weight:600;white-space:nowrap}
.report-dashboard th,.report-dashboard td{padding:7px 10px;border-bottom:1.5px solid var(--report-stage-line,#B9CBEF);vertical-align:top;min-width:6rem}
.report-dashboard th:first-child,.report-dashboard td:first-child{min-width:7rem}
.report-dashboard td{word-break:keep-all;overflow-wrap:normal}.report-dashboard td[data-short-cell="true"]{white-space:nowrap}
.report-dashboard tr:last-child td{border-bottom:0}.report-dashboard .whitespace-nowrap{white-space:nowrap}
.report-dashboard .report-long-english{word-break:normal;overflow-wrap:anywhere}
.report-dashboard .report-standard{display:inline-block;border-radius:4px;padding:1px 4px;background:var(--report-stage-container,#E8F0FE);color:var(--report-stage-band,#1558D6);font-size:11px;font-weight:600;white-space:nowrap}
.report-dashboard pre{overflow:auto;max-width:100%;padding:12px;background:#F6F8FC;border-radius:6px}.report-dashboard code{background:#F6F8FC;border-radius:3px;padding:1px 4px;color:#1A1C1E}.report-dashboard a{color:var(--report-stage-band,#1558D6);text-decoration:underline}.report-dashboard hr{border:0;border-top:1px solid var(--report-stage-container,#E8F0FE);margin:18px 0}
@media(max-width:540px){.report-hero-banner{padding:16px}.report-hero-title h3{font-size:20px}.report-metrics{gap:6px 12px}}
${REPORT_PRINT_CSS}
`
