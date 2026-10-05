type CursorEntry = { cellKey: string; caretPos?: number; relativeCaret?: string }
type CursorSession = {
  enabled: boolean
  resolveCaretLocation: (fieldKey: string, encoded: string) => { fieldKey: string; caretPos: number } | null
}

/** Resolve against this editor's current document, never against another user's numeric offset. */
export function resolveWorkspacePresence<T extends CursorEntry>(entries: T[], session: CursorSession): T[] {
  if (!session.enabled) return entries
  return entries.map(entry => {
    if (!entry.relativeCaret) return entry
    const location = session.resolveCaretLocation(entry.cellKey, entry.relativeCaret)
    return location
      ? { ...entry, cellKey: location.fieldKey, caretPos: location.caretPos }
      : { ...entry, cellKey: 'modal:idle', caretPos: undefined }
  })
}

/** Restoration can emit select events. They are not a new user cursor movement. */
export function shouldReportWorkspaceCaret(session: { enabled: boolean; shouldSendPresence: (input: HTMLInputElement | HTMLTextAreaElement) => boolean }): boolean {
  if (!session.enabled) return true
  const input = document.activeElement
  return !(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || session.shouldSendPresence(input)
}
