import type {
  StudioDocument,
  StudioTimelineItem,
} from "@forge/studio-contracts"

export type TimelineGroup = "Visual" | "Audio"
export const timelineGroups: TimelineGroup[] = ["Visual", "Audio"]
export const groupTrackKind = { Visual: "visual", Audio: "audio" } as const
export const itemGroup = (item: StudioTimelineItem): TimelineGroup =>
  item.kind === "audio" ? "Audio" : "Visual"

function itemsByTrack(document: StudioDocument) {
  const result = new Map<string, StudioTimelineItem[]>()
  for (const item of document.items) {
    const members = result.get(item.trackId)
    if (members) members.push(item)
    else result.set(item.trackId, [item])
  }
  return result
}

function orderedTracks(
  document: StudioDocument,
  group: TimelineGroup,
  items: Map<string, StudioTimelineItem[]>,
) {
  const tracks = document.tracks.filter((track) => {
    const members = items.get(track.id)
    return members?.length
      ? members.some((item) => itemGroup(item) === group)
      : group === "Visual"
        ? track.kind === "visual" || track.kind === "caption"
        : track.kind === "audio"
  })
  return group === "Visual" ? tracks.reverse() : tracks
}

/** Composition paints later tracks/items on top. Display foreground first. */
export function tracksForGroup(document: StudioDocument, group: TimelineGroup) {
  return orderedTracks(document, group, itemsByTrack(document))
}

export type TimelineRow = {
  id: string
  trackId: string | null
  group: TimelineGroup
  items: StudioTimelineItem[]
  linkedSourceAudio?: boolean
}

const overlaps = (a: StudioTimelineItem, b: StudioTimelineItem) =>
  a.startFrame < b.startFrame + b.durationInFrames &&
  b.startFrame < a.startFrame + a.durationInFrames

/** Presentation lanes only: never reorder stored tracks or composited items. */
export function timelineRows(document: StudioDocument): TimelineRow[] {
  const items = itemsByTrack(document)
  const allRows = timelineGroups.flatMap((group) => {
    const rows: TimelineRow[] = []
    for (const track of orderedTracks(document, group, items)) {
      const members = (items.get(track.id) ?? []).filter(
        (item) => itemGroup(item) === group,
      )
      if (group === "Visual") members.reverse()
      const lanes: StudioTimelineItem[][] = [[]]
      for (const item of members) {
        // A lower visual must stay below every overlapping foreground item.
        const minimumLane =
          group === "Visual"
            ? lanes.reduce(
                (minimum, items, index) =>
                  items.some((other) => overlaps(item, other))
                    ? index + 1
                    : minimum,
                0,
              )
            : 0
        let lane = lanes.find(
          (items, index) =>
            index >= minimumLane &&
            items.every((other) => !overlaps(item, other)),
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
  const visuals = allRows.filter((row) => row.group === "Visual")
  const sourceAudio: TimelineRow[] = visuals.flatMap((row) => {
    const videos = row.items.filter((item) => item.kind === "video")
    return videos.length
      ? [
          {
            id: `source-audio:${row.id}`,
            trackId: null,
            group: "Audio",
            linkedSourceAudio: true,
            items: videos,
          },
        ]
      : []
  })
  return [
    ...visuals,
    ...sourceAudio,
    ...allRows.filter((row) => row.group === "Audio"),
  ]
}
