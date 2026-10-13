---
module: Studio editor
problem_type: runtime_error
tags: [studio, manager, autosave, authentication, recovery, revisions]
date: 2026-10-12
---

# Studio autosave and session-expiry feedback

Local preview success is not persistence evidence. An interactive preview can
fail authentication while local edits remain valid; that failure must reach the
editor-level sign-in warning, not only a preview error panel.

`EditorSession` owns dirty state and the exact in-flight `StudioApply` receipt.
`startEditorAutosave` coalesces edits after 750ms, ignores playback/selection
notifications, serializes saves, and schedules newer local changes against the
accepted revision. Failure, conflict or an authentication warning pauses automatic
work until explicit retry/reconciliation. Editing after failure must preserve that
posture; clearing it would retry an ambiguous old snapshot while appearing to save
the newest edit.

Dirty state includes unresolved receipts, even when Undo restores a document that
looks like the original saved version. The receipt may already have committed, so
retry it first, then persist the later local version. Do not treat document equality
alone as proof that navigation is safe.

Session-storage recovery keeps document/revision/receipt together. Recovered
unsent edits can autosave; ambiguous flights require Retry save. Sign in in a new
tab to retain the original editor state and then retry in that editor.

Browser unload protection does not cover App Router same-document Back/Forward.
Use a cancelable Navigation API traversal event where supported, alongside link
capture and native beforeunload. Browsers without that API still have link/unload
warnings and tab-local recovery; their same-document history traversal cannot be
canceled by this guard. Do not claim cross-browser history protection from an
unload-only test.

Reproducible synthetic browser checks and baseline/candidate load measurements:
`docs/validation/studio-autosave/README.md`.
