import type {
  StudioDocument,
  StudioTimelineItem,
} from "@forge/studio-contracts"

export type TimelineGroup = "Video" | "Audio" | "Text"
export const timelineGroups: TimelineGroup[] = ["Video", "Audio", "Text"]
export const groupTrackKind = {
  Video: "visual",
  Audio: "audio",
  Text: "caption",
} as const
export const itemGroup = (item: StudioTimelineItem): TimelineGroup =>
  item.kind === "audio" ? "Audio" : item.kind === "text" ? "Text" : "Video"

export type TimelineRow = {
  id: string
  trackId: string | null
  group: TimelineGroup
  items: StudioTimelineItem[]
}

/** Presentation lanes only: never reorder stored tracks or composited items. */
export function timelineRows(document: StudioDocument): TimelineRow[] {
  return timelineGroups.flatMap((group) => {
    const rows: TimelineRow[] = []
    for (const track of document.tracks) {
      const items = document.items.filter((i) => i.trackId === track.id)
      const members = items.filter((i) => itemGroup(i) === group)
      if (
        !members.length &&
        (items.length || track.kind !== groupTrackKind[group])
      )
        continue
      const lanes: StudioTimelineItem[][] = [[]]
      for (const item of members) {
        let lane = lanes.find((items) =>
          items.every(
            (other) =>
              item.startFrame >= other.startFrame + other.durationInFrames ||
              other.startFrame >= item.startFrame + item.durationInFrames,
          ),
        )
        if (!lane) {
          lane = []
          lanes.push(lane)
        }
        lane.push(item)
      }
      lanes.forEach((items, index) =>
        rows.push({
          id: `${group}:${track.id}:${index}`,
          trackId: track.id,
          group,
          items,
        }),
      )
    }
    return rows.length ? rows : [{ id: group, trackId: null, group, items: [] }]
  })
}
