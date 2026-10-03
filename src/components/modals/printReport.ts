import { REPORT_DASHBOARD_CSS } from './reportDashboardStyles'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

/** 별도 본문 템플릿 없이 표시 중인 React DOM과 공통 CSS를 인쇄한다. */
export function buildReportPrintDocument(markup: string, title: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>${REPORT_DASHBOARD_CSS}
*{box-sizing:border-box}body{margin:0 auto;padding:20px;max-width:1000px;background:#fff;color:#1A1C1E}
@page{size:A4;margin:12mm}@media print{body{padding:0;max-width:none}}</style></head><body>${markup}</body></html>`
}

export function printReport(content: HTMLElement, title: string): void {
  const win = window.open('', '_blank')
  if (!win) return
  win.onload = async () => {
    // 로컬 글꼴의 레이아웃까지 준비한 뒤 SVG가 포함된 같은 화면을 인쇄한다.
    await win.document.fonts.ready
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      win.onafterprint = () => win.close()
      win.print()
    }))
  }
  win.document.write(buildReportPrintDocument(content.innerHTML, title))
  win.document.close()
}
