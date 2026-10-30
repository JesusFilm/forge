import type { StudioDocument } from "@forge/studio-contracts"
import { timelineRows, tracksForGroup } from "./timeline-layout"
import type { MediaLocation } from "./library-insertion"

export function mediaDropLocation(
  document: StudioDocument,
  kind: "video" | "audio" | "image" | "text",
  rowId: string,
  frame: number,
): MediaLocation | null {
  const row = timelineRows(document).find((row) => row.id === rowId)
  if (!row || !Number.isFinite(frame)) return null
  const group = kind === "audio" ? "Audio" : "Visual"
  if (row.group !== group && !(kind === "video" && row.linkedSourceAudio))
    return null
  // Linked audio belongs to its source's visual track; standalone audio must
  // never be placed on that presentation-only row.
  if (kind === "audio" && row.linkedSourceAudio) return null
  const source = row.linkedSourceAudio
    ? timelineRows(document).find(
        (visual) => `source-audio:${visual.id}` === row.id,
      )
    : row
  return {
    startFrame: Math.max(0, Math.round(frame)),
    trackId: source?.trackId ?? tracksForGroup(document, group)[0]?.id,
  }
}
