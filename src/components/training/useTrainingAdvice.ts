'use client'

import { useSyncExternalStore } from 'react'
import { trainingAdviceKey } from './trainingFormState'

const memory = new Map<string, boolean>()
const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener) }
}

export function useTrainingAdvice(projectId: string): [boolean, (value: boolean) => void] {
  const key = trainingAdviceKey(projectId)
  const enabled = useSyncExternalStore(subscribe, () => {
    if (memory.has(key)) return memory.get(key)!
    try { return localStorage.getItem(key) !== 'false' } catch { return true }
  }, () => true)
  return [enabled, value => {
    try { localStorage.setItem(key, String(value)); memory.delete(key) }
    catch { memory.set(key, value) }
    listeners.forEach(listener => listener())
  }]
}
