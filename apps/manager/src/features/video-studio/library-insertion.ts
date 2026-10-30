import type { StudioTimelineItem } from "@forge/studio-contracts"
import type { EditorSession } from "./editor-session"
import { groupTrackKind, itemGroup, tracksForGroup } from "./timeline-layout"

export type MediaLocation = { startFrame: number; trackId?: string }

/** Resolve against the current document, including edits made during capture. */
export function insertLibraryItem(
  session: EditorSession,
  item: StudioTimelineItem,
  location: MediaLocation,
) {
  if (!session.getSnapshot().editable) return
  const group = itemGroup(item)
  session.edit((doc) => {
    const tracks = tracksForGroup(doc, group)
    const trackId =
      tracks.find((track) => track.id === location.trackId)?.id ??
      tracks[0]?.id ??
      item.trackId
    const inserted = {
      ...item,
      trackId,
      startFrame: Math.max(0, Math.round(location.startFrame)),
    }
    return {
      ...doc,
      tracks: doc.tracks.some((track) => track.id === trackId)
        ? doc.tracks
        : [...doc.tracks, { id: trackId, kind: groupTrackKind[group] }],
      durationInFrames: Math.max(
        doc.durationInFrames,
        inserted.startFrame + inserted.durationInFrames,
      ),
      items: [...doc.items, inserted],
    }
  })
  session.select(item.id)
}
