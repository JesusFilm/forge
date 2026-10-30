"use client"
import { useCallback, useState } from "react"
import type { StudioDocument } from "@forge/studio-contracts"
import type { EditorSnapshot } from "./editor-session"

/** Keep scrub drafts out of the session's save, recovery and undo document. */
export function useInspectorPreview(state: EditorSnapshot) {
  const { document: base, selection } = state
  const [draft, setDraft] = useState<{
    base: StudioDocument
    selection: string | null
    document: StudioDocument
  } | null>(null)
  const onPreview = useCallback(
    (document: StudioDocument | null) =>
      setDraft(document ? { base, selection, document } : null),
    [base, selection],
  )
  return {
    onPreview,
    state:
      draft?.base === base && draft.selection === selection
        ? { ...state, document: draft.document }
        : state,
  }
}
