import type { Mark } from "./annotations"

export type PhotoDraft = {
  source: File
  file: File
  marks: Mark[]
  note: string
}

let pendingDraft: PhotoDraft | null = null

export function savePhotoDraft(draft: PhotoDraft): void {
  pendingDraft = draft
}

export function takePhotoDraft(): PhotoDraft | null {
  const draft = pendingDraft
  pendingDraft = null
  return draft
}
