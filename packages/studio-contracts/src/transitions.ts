import type { StudioDocument, StudioTimelineItem } from "./index"

type VideoItem = Extract<StudioTimelineItem, { kind: "video" }>
export type StudioCut = {
  incomingId: string
  outgoingId: string
  type: "crossfade" | "fade-black"
  frames: number
  cutFrame: number
  incomingOnTop: boolean
}

/** Transitions decorate an unambiguous same-track cut; they never move clips. */
export function studioCuts(document: StudioDocument): StudioCut[] {
  const videos = document.items.filter(
    (i): i is VideoItem => i.kind === "video",
  )
  return videos.flatMap((incoming) => {
    if (!incoming.transition) return []
    const previous = videos.filter(
      (i) =>
        i.trackId === incoming.trackId &&
        i.startFrame + i.durationInFrames === incoming.startFrame,
    )
    if (previous.length !== 1) return []
    const outgoing = previous[0]!
    let frames = Math.min(
      incoming.transition.durationInFrames,
      Math.floor(outgoing.durationInFrames / 2),
      Math.floor(incoming.durationInFrames / 2),
    )
    if (incoming.transition.type === "crossfade") {
      // Incoming pre-roll ends at its existing source-in. No frozen or invented
      // frames and no changes to speech, source-out or other timeline positions.
      frames = Math.min(
        frames,
        Math.floor((incoming.source.startMs * document.fps) / 1000),
      )
    }
    if (frames < 1) return []
    // Ambiguous stacked cuts must be resolved by the editor, not guessed.
    if (
      videos.some(
        (i) =>
          i !== incoming &&
          i !== outgoing &&
          i.trackId === incoming.trackId &&
          i.startFrame < incoming.startFrame + frames &&
          i.startFrame + i.durationInFrames > incoming.startFrame - frames,
      )
    )
      return []
    return [
      {
        incomingId: incoming.id,
        outgoingId: outgoing.id,
        type: incoming.transition.type,
        frames,
        cutFrame: incoming.startFrame,
        incomingOnTop:
          document.items.indexOf(incoming) > document.items.indexOf(outgoing),
      },
    ]
  })
}

export function studioMediaStartTimes(
  document: StudioDocument,
): Map<string, number> {
  const starts = new Map(
    document.items.flatMap((item) =>
      item.kind === "video" ? [[item.id, item.source.startMs] as const] : [],
    ),
  )
  for (const cut of studioCuts(document)) {
    if (cut.type !== "crossfade") continue
    starts.set(
      cut.incomingId,
      Math.max(
        0,
        starts.get(cut.incomingId)! -
          Math.ceil((cut.frames * 1000) / document.fps),
      ),
    )
  }
  return starts
}

export function transitionPresentation(
  cuts: StudioCut[],
  itemId: string,
  frame: number,
) {
  let opacity = 1
  let brightness = 1
  let preRoll = 0
  for (const cut of cuts) {
    const incoming = cut.incomingId === itemId
    const outgoing = cut.outgoingId === itemId
    if (!incoming && !outgoing) continue
    if (cut.type === "crossfade") {
      if (incoming) preRoll = cut.frames
      if (frame >= cut.cutFrame - cut.frames && frame < cut.cutFrame) {
        const progress = (frame - cut.cutFrame + cut.frames) / cut.frames
        if (incoming && cut.incomingOnTop) opacity *= progress
        if (outgoing && !cut.incomingOnTop) opacity *= 1 - progress
      }
    } else {
      if (outgoing)
        brightness *= Math.max(
          0,
          Math.min(1, (cut.cutFrame - 1 - frame) / cut.frames),
        )
      if (incoming)
        brightness *= Math.max(
          0,
          Math.min(1, (frame - cut.cutFrame) / cut.frames),
        )
    }
  }
  return { opacity, brightness, preRoll }
}
