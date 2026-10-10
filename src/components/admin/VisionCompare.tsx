'use client'

import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { adminButton, adminFetch } from './adminClient'
import { shrinkImage } from '@/lib/chat/uploadAttachment'

type Result = { model: string; ms: number; text: string; inputTokens: number | null; outputTokens: number | null; error?: string }

/** Read one teacher photo/PDF with several models side by side to pick the attachment reader. */
export function VisionCompare() {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<{ current: string; results: Result[] } | null>(null)

  async function run() {
    if (!file || busy) return
    setBusy(true); setError(''); setData(null)
    try {
      const body = file.type.startsWith('image/') ? await shrinkImage(file) : file
      const bytes = new Uint8Array(await body.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      setData(await adminFetch('/api/admin/vision-compare', { method: 'POST', body: JSON.stringify({ fileName: file.name, contentType: body.type || file.type, data: btoa(binary) }) }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '비교하지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <section aria-label="사진 읽기 모델 비교" className="rounded-[28px] border border-[#C4C7C5] bg-white p-5 sm:p-7">
    <h2 className="flex items-center gap-2 text-xl font-bold"><FlaskConical size={20} /> 사진·파일 읽기 모델 비교</h2>
    <p className="mt-2 text-sm text-[#444746]">선생님 자료 한 장을 여러 모델이 동시에 읽습니다. 결과는 저장하지 않고, 선생님 화면에도 영향이 없습니다. 모델마다 몇 초~수십 초 걸립니다.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={event => { setFile(event.target.files?.[0] ?? null); setData(null) }}
        className="min-h-12 max-w-full text-sm file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-[#D3E3FD] file:px-4 file:font-semibold file:text-[#0842A0]" />
      <button type="button" disabled={!file || busy} onClick={() => { void run() }} className={adminButton}>{busy ? '모델들이 읽는 중…' : '비교 시작'}</button>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[#F9DEDC] p-3 text-[#8C1D18]">{error}</p>}
    {data && <>
      <p className="mt-4 text-sm text-[#444746]">지금 첨부 읽기에 쓰는 모델: <b>{data.current}</b></p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {data.results.map(result => <article key={result.model} className="flex min-w-0 flex-col rounded-2xl bg-[#F8FAFD] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">{result.model}</h3>
            {result.model === data.current && <span className="rounded-full bg-[#D3E3FD] px-2 py-0.5 text-xs font-semibold text-[#0842A0]">현재</span>}
          </div>
          <p className="mt-1 text-xs text-[#444746]">{(result.ms / 1000).toFixed(1)}초 · 입력 {result.inputTokens ?? '—'} · 출력 {result.outputTokens ?? '—'} 토큰 · {result.text.length.toLocaleString()}자</p>
          {result.error
            ? <p className="mt-3 rounded-xl bg-[#F9DEDC] p-3 text-sm text-[#8C1D18]">실패: {result.error}</p>
            : <p className="mt-3 max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">{result.text || '(빈 응답)'}</p>}
        </article>)}
      </div>
    </>}
  </section>
}
