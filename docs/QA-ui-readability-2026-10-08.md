# UI readability and project organization — 2026-10-08

Source session: 01a10c26-d14f-7cf3-b7cc-a7d777c402c4
Base deployment: f3fd2202. Hosting only; no rules, privacy or authentication changes.

## Changes
- Folder project cards: right-click / Shift+F10 / visible mobile More menu moves a project to the dashboard root. Folder persistence is ordered; failed writes restore the last confirmed state and show an error. Success includes a root navigation action. Project content and membership are unchanged.
- Waiting-room participants: avatar, name and recorder label; redundant self badge/crown removed.
- Existing box-drawing chat trees render as nested Markdown lists. Code fences/inline code/tables stay intact. New AI prompt uses semantic lists with explicit line breaks.
- Artifact body precedes section guidance in review and confirmed states. Expand/delete controls use MD3 components, readable labels and 44px targets.
- Slash palette: MD3 container, icons, selected state, readable descriptions, scrolling, destructive reset distinction. Command execution/filtering remains in ChatPanel.
- Standards/core-idea dialogs: 1600px maximum width, 94dvh height, responsive filter scrolling, larger type, keyboard focus management. Standards grouped by subject/area, area filter, independent per-row copy of bracketed code plus full text in one line. Selection persists across area filters.
- Teammate change reviewed: PendingConfirmationBanner maximum width 440→748px, enlarged typography/buttons; response callbacks unchanged.

## Verification
- Release test run: 1008 total, 1006 passed, 2 environment-dependent skips, 0 failures. `/tmp/astra-ui-release-tests-final.txt`.
- TypeScript: 0 errors. ESLint src: 0 errors, 28 existing warnings. git diff --check clean.
- Actual React components in isolated Chromium fixtures; local curriculum JSON, mocked persistence/clipboard/AI transport; no authentication or live Firestore writes.
- 390/1400px: saved tree hierarchy, no page overflow; command keyboard selection and pointer execution.
- Dashboard: right click near bottom, viewport clamp, Escape focus restore, Shift+F10, successful move/root visibility, failed save rollback/retry, mobile More action and non-recorder folder move.
- Finders: subject+grade+area filtering against real local math JSON, cross-area multiselection and insertion, clipboard success/rejection, copying does not toggle selection, Escape and focus return.
- Artifact: body before guidance, expand opens/closes; buttons remain visible at 430px.
- Confirmation banner: 748px desktop, viewport minus 32px at 320px mobile, 44px targets, reason entry/send via mock.

Screenshots: `/private/tmp/tcid-lead-browser/` — chat-tree-{390,1400}.png, commands-{390,1400}.png, standards-finder-{390,1400}.png, coreidea-finder-{390,1400}.png, dashboard-context-{desktop,mobile}.png, waiting-{before,after}.png, artifact-content-first.png, confirmation-{320,1400}.png.
Browser log: `/tmp/astra-ui-batch-browser.txt`.
