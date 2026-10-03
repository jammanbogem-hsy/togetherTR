// 화면과 인쇄가 같은 클래스·색·표면 계층을 사용한다. 아이콘은 모두 인라인 SVG다.
export const REPORT_COLOR_TONES = {
  primary: { container: '#D3E3FD', ink: '#041E49', band: '#0B57D0', bandInk: '#FFFFFF', surface: '#EFF4FF' },
  secondary: { container: '#C2E7FF', ink: '#001D35', band: '#00639B', bandInk: '#FFFFFF', surface: '#EDF8FF' },
  tertiary: { container: '#C4EED0', ink: '#072711', band: '#146C2E', bandInk: '#FFFFFF', surface: '#EFFAF2' },
  green: { container: '#C4EED0', ink: '#072711', band: '#146C2E', bandInk: '#FFFFFF', surface: '#EFFAF2' },
  amber: { container: '#FFE7C7', ink: '#8A3D00', band: '#E65100', bandInk: '#1A1C1E', surface: '#FFF5E8' },
  blue: { container: '#B9D5FF', ink: '#041E49', band: '#1558D6', bandInk: '#FFFFFF', surface: '#EFF4FF' },
} as const

export const REPORT_SECTION_TONES = {
  summary: 'primary', overview: 'tertiary', activities: 'secondary',
  strengths: 'green', improvements: 'amber', next: 'blue', appendix: 'secondary',
} as const

/** 단계 원색의 채도는 유지하고, 흰 글자 대비를 확보한 진한 톤으로 만든다. */
export function reportStageColors(hex: string): { band: string; deep: string; container: string } {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16))
  const tone = (factor: number, base = 0) => '#' + rgb.map(value => Math.round(value * factor + base * (1 - factor)).toString(16).padStart(2, '0')).join('')
  return { band: tone(0.82), deep: tone(0.58), container: tone(0.28, 255) }
}

function toneVariables(tone: typeof REPORT_COLOR_TONES[keyof typeof REPORT_COLOR_TONES]): string {
  return `--report-container:${tone.container};--report-ink:${tone.ink};--report-band:${tone.band};--report-band-ink:${tone.bandInk};--report-surface:${tone.surface};`
}

const TONE_CSS = Object.entries(REPORT_COLOR_TONES).map(([name, tone]) => `.report-${name}{${toneVariables(tone)}background:${tone.container};color:${tone.ink}}`).join('\n')
const SECTION_CSS = Object.entries(REPORT_SECTION_TONES).map(([kind, name]) => `.report-card[data-report-kind="${kind}"]{${toneVariables(REPORT_COLOR_TONES[name])}}`).join('\n')
export const REPORT_DASHBOARD_CSS = `
.report-hero,.report-dashboard{color:#1A1C1E;font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.55;min-width:0;max-width:100%;word-break:keep-all;overflow-wrap:normal}
.report-hero *,.report-dashboard *{box-sizing:border-box}
.report-hero svg,.report-dashboard svg{display:inline-block;vertical-align:middle;flex-shrink:0}
.report-hero{margin-bottom:16px}
.report-hero-banner{position:relative;overflow:hidden;border:1px solid #C3C7CF;border-radius:20px;padding:20px;color:#FFFFFF;background-color:#0B57D0}
.report-hero-title{display:flex;align-items:center;gap:12px;position:relative}
.report-stage-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;flex-shrink:0;border-radius:14px;background:#ffffff24;color:#FFFFFF}
.report-hero-title h3{font-size:24px;line-height:1.25;margin:2px 0;font-weight:700}
.report-eyebrow{font-size:12px;margin:0}.report-project-name{font-size:14px;margin:4px 0 0;font-weight:600}
.report-hero-summary{font-size:17px;font-weight:600;line-height:1.5;margin:16px 0 8px;max-width:72ch}
.report-keywords{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.report-chip{display:inline-flex;align-items:center;gap:4px;border-radius:8px;padding:3px 8px;font-size:12px;line-height:1.5;background:#D3E3FD;color:#041E49;font-weight:600;max-width:100%}
.report-dates{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:11px;margin-top:12px;color:#FFFFFF}
.report-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 0}
.report-kpi{padding:12px;border-radius:14px;min-width:0;display:flex;flex-direction:column;gap:6px;border-top:5px solid var(--report-band);box-shadow:0 2px 8px #001d3510}
.report-kpi dt{font-size:12px;display:flex;align-items:center;gap:6px}.report-kpi dd{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;margin:0}
.report-kpi small{font-size:11px;font-weight:400;margin-left:3px}
${TONE_CSS}
.report-keywords .report-chip:nth-child(3n+2){background:#C4EED0;color:#072711}
.report-keywords .report-chip:nth-child(3n){background:#FFE7C7;color:#8A3D00}
.report-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
 .report-card{--report-container:#D3E3FD;--report-ink:#041E49;--report-band:#0B57D0;--report-band-ink:#FFFFFF;--report-surface:#EFF4FF;min-width:0;max-width:100%;border:1px solid var(--report-container);border-radius:16px;background:var(--report-surface);color:var(--report-ink);overflow:hidden;box-shadow:0 2px 6px #001d3510}
${SECTION_CSS}
.report-card[data-report-kind="alignment"]{--report-container:var(--report-stage-container,#D3E3FD);--report-ink:#1A1C1E;--report-band:var(--report-stage-band,#0B57D0);--report-band-ink:#FFFFFF;--report-surface:var(--report-stage-container,#D3E3FD)}
.report-card h2{display:flex;align-items:center;gap:10px;margin:0;padding:12px 14px;font-size:16px;line-height:1.4;font-weight:700;border-bottom:0;color:var(--report-band-ink);background:var(--report-band)}
.report-section-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;border-radius:10px;background:#ffffff24;color:inherit}
.report-body{min-width:0;padding:12px 14px}
.report-appendix{margin-top:14px}
.report-appendix-toggle{background:var(--report-band);color:var(--report-band-ink);display:flex;align-items:center;cursor:pointer;list-style:none;border-radius:16px}
.report-appendix-toggle::-webkit-details-marker{display:none}
.report-appendix-toggle:focus-visible{outline:2px solid #0B57D0;outline-offset:-3px}
.report-appendix-toggle h2{flex:1;min-width:0;border-bottom:0}
.report-appendix-action{display:flex;align-items:center;gap:6px;flex-shrink:0;margin-right:14px;font-size:12px;font-weight:600;color:inherit}
.report-appendix-collapse{display:none}
.report-appendix [open] .report-appendix-expand{display:none}
.report-appendix [open] .report-appendix-collapse{display:inline}
.report-appendix [open] .report-appendix-action svg{transform:rotate(90deg)}
.report-appendix [open]>.report-body{border-top:1px solid var(--report-container)}
.report-dashboard h1{font-size:21px;line-height:1.4;margin:0 0 14px;color:#1A1C1E}
.report-dashboard h3{font-size:14px;margin:12px 0 8px;line-height:1.5}.report-dashboard h4{font-size:14px;margin:12px 0 6px}
.report-dashboard p{max-width:72ch;margin:8px 0}.report-dashboard p:first-child{margin-top:0}.report-dashboard p:last-child{margin-bottom:0}
.report-dashboard strong{font-weight:700;color:inherit}
.report-dashboard ul,.report-dashboard ol{margin:8px 0;padding:0;list-style:none;display:grid;gap:7px}
.report-dashboard li{display:flex;align-items:flex-start;gap:8px}.report-list-mark{display:flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0;border-radius:50%;background:var(--report-band,#0B57D0);color:var(--report-band-ink,#FFFFFF);font-size:12px;font-weight:700;margin-top:1px}
.report-list-content{flex:1;min-width:0}.report-list-content>p{margin:0}
.report-card[data-report-kind="next"] li{position:relative;padding-bottom:8px}.report-card[data-report-kind="next"] li:not(:last-child):before{content:'';position:absolute;left:9px;top:23px;bottom:-4px;border-left:2px solid var(--report-band)}
.report-card[data-report-kind="alignment"] .report-body>ul{display:flex;flex-wrap:wrap;gap:8px}
.report-card[data-report-kind="alignment"] .report-body>ul>li{flex:1 1 180px;border:1px solid var(--report-band);border-radius:12px;padding:10px;background:#fff}
.report-activities{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin:10px 0}
.report-activity{min-width:0;padding:12px;border:1px solid var(--report-container);border-left:4px solid var(--report-band);border-radius:12px;background:#fff}
.report-activity h3{margin-top:0}.report-status{display:inline-flex;border-radius:999px;padding:3px 8px;margin:0 0 8px;font-size:11px;font-weight:600;background:#FFE7C7;color:#8A3D00}
.report-status[data-status="draft"]{background:#C2E7FF;color:#001D35}
.report-card .report-chip{background:var(--report-band);color:var(--report-band-ink)}
.report-status[data-status="confirmed"]{background:#C4EED0;color:#072711}
.report-callout{border-left:5px solid #00639B;display:flex;align-items:flex-start;gap:10px;background:#C2E7FF;color:#001D35;border-radius:12px;padding:12px;margin:12px 0}.report-callout-label{font-size:11px;font-weight:700;margin-bottom:5px}
.report-table-scroll{max-width:100%;max-height:60vh;overflow:auto;border:1px solid var(--report-band,#0B57D0);border-radius:10px;background:#fff;margin:10px 0;outline-offset:2px}
.report-dashboard table{width:100%;border-spacing:0;border-collapse:separate;font-size:12px;line-height:1.4;color:#1A1C1E;min-width:440px;text-align:left;word-break:keep-all}
.report-dashboard th{position:sticky;top:0;z-index:1;background:var(--report-band,#0B57D0);color:var(--report-band-ink,#FFFFFF);font-weight:600;white-space:nowrap}
.report-dashboard th,.report-dashboard td{padding:7px 10px;border-bottom:1px solid var(--report-container,#D3E3FD);vertical-align:top;min-width:6rem}
.report-dashboard th:first-child,.report-dashboard td:first-child{min-width:7rem}
.report-dashboard td{word-break:keep-all;overflow-wrap:normal}.report-dashboard td[data-short-cell="true"]{white-space:nowrap}
.report-dashboard tbody tr:nth-child(even){background:var(--report-surface,#EFF4FF)}
.report-dashboard tr:last-child td{border-bottom:0}.report-dashboard .whitespace-nowrap{white-space:nowrap}
.report-dashboard .report-long-english{word-break:normal;overflow-wrap:anywhere}
.report-dashboard .report-standard{display:inline-block;border-radius:5px;padding:1px 5px;background:var(--report-container,#D3E3FD);color:var(--report-ink,#041E49);font-size:11px;font-weight:600;white-space:nowrap}
.report-dashboard pre{overflow:auto;max-width:100%;padding:12px;background:#D3E3FD;border-radius:10px}.report-dashboard code{background:#D3E3FD;border-radius:4px;padding:1px 4px;color:#1A1C1E}.report-dashboard a{color:#0B57D0;text-decoration:underline}.report-dashboard hr{border:0;border-top:1px solid var(--report-container,#D3E3FD);margin:14px 0}
@media(min-width:720px){.report-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-card[data-report-wide="true"]{grid-column:1/-1}.report-activities{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:540px){.report-hero-banner{padding:16px}.report-hero-title h3{font-size:22px}.report-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.report-kpi dd{font-size:28px}.report-hero-summary{font-size:16px}}
@media print{.report-hero,.report-dashboard,.report-hero *,.report-dashboard *{-webkit-print-color-adjust:exact;print-color-adjust:exact}.report-hero-banner,.report-kpi,.report-card,.report-activity,.report-callout{break-inside:avoid;page-break-inside:avoid}.report-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-card[data-report-wide="true"]{grid-column:1/-1}.report-activities{grid-template-columns:repeat(2,minmax(0,1fr))}.report-table-scroll{overflow:visible;max-height:none}.report-dashboard table{min-width:0!important;table-layout:auto;font-size:10px}.report-dashboard th,.report-dashboard td{padding:5px 7px}.report-dashboard th{position:static}.report-dashboard tr{break-inside:avoid}.report-dashboard thead{display:table-header-group}.report-dashboard .whitespace-nowrap{white-space:nowrap}.report-dashboard pre{white-space:pre-wrap;overflow:visible}.report-card{box-shadow:none}.report-hero-summary{font-size:16px}.report-kpi dd{font-size:26px}}
@media print{
.report-table-wide{border:0;background:transparent}
.report-table-wide table,.report-table-wide tbody{display:block;width:100%}
.report-table-wide thead{display:none}
.report-table-wide tbody tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border:1px solid var(--report-band,#0B57D0);border-top:5px solid var(--report-band,#0B57D0);border-radius:10px;margin:10px 0;overflow:visible;break-inside:avoid;background:#fff}
.report-table-wide td{display:block;width:auto;min-width:0!important;text-align:left!important;padding:8px 10px;border-bottom:1px solid var(--report-container,#D3E3FD);white-space:normal;word-break:keep-all;overflow-wrap:normal}
.report-table-wide td[data-long-cell="true"]{grid-column:1/-1}
.report-table-wide td:before{content:attr(data-label);display:block;white-space:nowrap;font-size:10px;font-weight:700;margin-bottom:4px;color:var(--report-ink,#041E49)}
.report-table-wide td[data-short-cell="true"]{white-space:nowrap}
}
@media print{.report-card.report-appendix{break-before:page;page-break-before:always;break-inside:auto;page-break-inside:auto;overflow:visible}.report-appendix details{break-inside:auto}.report-appendix-action{display:none}.report-appendix-toggle{cursor:default}}
`
