'use client'

// 루브릭을 한글(HWP)에 표로 붙여 넣을 수 있게 복사하고, HWPX 파일로 내려받는다.

import { rubricToClipboardHtml, rubricToMarkdown, rubricToTsv, type RubricRow } from '@/lib/rubric/rubric'

/**
 * 한글 붙여넣기용 복사. 브라우저는 HWPX 형식을 클립보드에 직접 쓸 수 없으므로,
 * 한글이 표 개체로 바꿔 주는 text/html 표와 탭 구분 글을 함께 담는다.
 */
export async function copyRubricForHangul(rows: readonly RubricRow[], title: string): Promise<'table' | 'text'> {
  const html = rubricToClipboardHtml(rows, title)
  const plain = rubricToTsv(rows)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })])
      return 'table'
    } catch {
      // 일부 브라우저는 text/html 쓰기를 막는다 — 아래 글 복사로 대신한다.
    }
  }
  await navigator.clipboard.writeText(plain)
  return 'text'
}

export async function downloadRubricHwpx(rows: readonly RubricRow[], title: string): Promise<void> {
  const { generateHwpx } = await import('@/lib/hwpx/generateHwpx')
  const blob = await generateHwpx(`# ${title}\n\n${rubricToMarkdown(rows)}\n`, title)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[\\/:*?"<>|]/g, ' ').trim() || '평가 루브릭'}.hwpx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
