'use client'

// 피드백에 '최근 오류 기록'을 함께 담기 위한 브라우저 오류 고리 버퍼(최근 10줄). 개인 정보가 아닌 오류 문구만.
import { FEEDBACK_LIMITS } from './feedbackModel'

const buffer: string[] = []
let installed = false

function stamp(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
}

export function recordClientError(line: string): void {
  const text = line.replace(/\s+/g, ' ').trim()
  if (!text) return
  buffer.push(`${stamp()} ${text}`.slice(0, FEEDBACK_LIMITS.errorLineMax))
  if (buffer.length > FEEDBACK_LIMITS.errorsMax) buffer.splice(0, buffer.length - FEEDBACK_LIMITS.errorsMax)
}

export function recentClientErrors(): string[] {
  return [...buffer]
}

const describe = (value: unknown): string => value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) } catch { return String(value) } })()

/** 한 번만 설치 — window 오류·처리 안 된 Promise 거부·console.error 를 기록한다(원래 동작은 그대로). */
export function installClientErrorLog(target: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (installed || !target) return
  installed = true
  target.addEventListener('error', event => {
    const where = event.filename ? ` (${event.filename.split('/').pop()}:${event.lineno})` : ''
    recordClientError(`[오류] ${event.message || describe(event.error)}${where}`)
  })
  target.addEventListener('unhandledrejection', event => recordClientError(`[처리 안 된 오류] ${describe(event.reason)}`))
  const original = target.console.error.bind(target.console)
  target.console.error = (...args: unknown[]) => {
    recordClientError(`[console] ${args.map(describe).join(' ')}`)
    original(...args)
  }
}
