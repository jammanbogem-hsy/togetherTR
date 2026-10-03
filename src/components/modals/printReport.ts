import { REPORT_DASHBOARD_CSS, REPORT_PRINT_CSS } from './reportDashboardStyles'

// 별도 인쇄 창은 미리보기 화면에서도 같은 전체 높이·A4 표 배치를 사용한다.
export const REPORT_PRINT_WINDOW_CSS = REPORT_PRINT_CSS.replace(/^\s*@media print\s*\{/, '').replace(/\}\s*$/, '') + `
html,body,body *{position:static!important}
.report-table-scroll{height:auto!important;max-height:none!important;overflow:visible!important}
`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

/** 별도 본문 템플릿 없이 표시 중인 React DOM과 공통 CSS를 인쇄한다. */
export function buildReportPrintDocument(markup: string, title: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>${REPORT_DASHBOARD_CSS}
*{box-sizing:border-box}body{margin:0 auto;padding:20px;max-width:1000px;background:#fff;color:#1A1C1E}
${REPORT_PRINT_WINDOW_CSS}
@page{size:A4;margin:12mm}@media print{body{padding:0;max-width:none}}</style></head><body>${markup}</body></html>`
}

/** 원래 화면은 유지하고 인쇄 복제본만 펼침·스크롤 없는 DOM으로 정리한다. */
export function cloneReportForPrint(content: HTMLElement): HTMLElement {
  const clone = content.cloneNode(true) as HTMLElement
  const elements = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  for (const element of elements) {
    const wasScrollable = ['overflow', 'overflow-x', 'overflow-y', 'max-height'].some(property => element.style.getPropertyValue(property))
    for (const property of ['overflow', 'overflow-x', 'overflow-y', 'max-height']) element.style.removeProperty(property)
    if (wasScrollable) element.style.removeProperty('height')
    if (['sticky', 'fixed'].includes(element.style.getPropertyValue('position'))) {
      for (const property of ['position', 'top', 'bottom']) element.style.removeProperty(property)
    }
  }

  // 레거시 details 및 별도 collapsed 본문도 원문을 빠뜨리지 않고 펼친다.
  const expandable = elements.filter(element => element.matches('details,.report-appendix,[data-report-kind="appendix"],[data-report-appendix]'))
  for (const root of expandable) {
    if (root.tagName === 'DETAILS') root.setAttribute('open', '')
    for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      element.removeAttribute('hidden')
      element.removeAttribute('inert')
      if (element.getAttribute('aria-hidden') === 'true') element.removeAttribute('aria-hidden')
      for (const name of Array.from(element.classList)) {
        if (/(?:^|:)(?:hidden|collapsed|collapse|invisible|opacity-0|h-0|max-h-0)$/.test(name) || name === 'is-collapsed') element.classList.remove(name)
      }
      if (element.style.getPropertyValue('display') === 'none') element.style.removeProperty('display')
      if (['hidden', 'collapse'].includes(element.style.getPropertyValue('visibility'))) element.style.removeProperty('visibility')
      if (element.style.getPropertyValue('opacity') === '0') element.style.removeProperty('opacity')
      if (/^0(?:px|rem|em|%)?$/.test(element.style.getPropertyValue('height'))) element.style.removeProperty('height')
      if (['closed', 'collapsed'].includes(element.getAttribute('data-state') ?? '')) element.setAttribute('data-state', 'open')
    }
  }

  for (const element of clone.querySelectorAll<HTMLElement>('.report-appendix-action,.report-appendix-expand,.report-appendix-collapse,button,[role="button"],[aria-expanded]')) {
    if (element.tagName === 'SUMMARY') continue
    const label = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`
    const control = element.matches('button,[role="button"]')
    if (element.matches('.report-appendix-action,.report-appendix-expand,.report-appendix-collapse') || (control && (element.hasAttribute('aria-expanded') || /펼치기|접기/.test(label)))) element.remove()
    else if (element.hasAttribute('aria-expanded')) {
      // 컨트롤이 아니라 본문을 감싼 경우에는 자식 내용을 보존한다.
      element.replaceWith(...Array.from(element.childNodes))
    }
  }
  for (const summary of clone.querySelectorAll<HTMLElement>('summary')) {
    for (const element of summary.querySelectorAll<HTMLElement>('span')) {
      if (!element.childElementCount && /^(?:펼치기|접기)(?:\s*\/\s*(?:펼치기|접기))?$/.test(element.textContent?.trim() ?? '')) element.remove()
    }
    for (const node of Array.from(summary.childNodes)) {
      if (node.nodeType === 3) node.textContent = node.textContent?.replace(/펼치기|접기/g, '') ?? ''
    }
    summary.replaceWith(...Array.from(summary.childNodes))
  }
  for (const details of clone.querySelectorAll<HTMLElement>('details')) details.replaceWith(...Array.from(details.childNodes))
  return clone
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
  win.document.write(buildReportPrintDocument(cloneReportForPrint(content).innerHTML, title))
  win.document.close()
}
