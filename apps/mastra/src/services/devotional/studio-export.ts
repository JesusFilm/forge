import {
  CARD_TAIL_FRAMES,
  framesFromDurations,
} from "@forge/shorts-compositions/devotional-card-timing"

import {
  type BackgroundPlan,
  filmSecondAt,
  pieceAt,
} from "./background-timeline"
import type { FocusPoint } from "./clip-focus"
import type { Manifest } from "./shorts-cutdown"

/**
 * A cut-down short as a Shorts Studio document (owner, 2026-10-06): the
 * local pipeline still plans every short, and Studio is where the owner
 * trims clips, edits text and nudges timing by hand. The document reuses the
 * custom components that carry our look (uploaded once, referenced by
 * version id) and plays the catalog film itself, so every shot is mapped
 * from the backdrop's timeline back to film seconds.
 *
 * Timing follows the `devotional-short` composition (ShortFact.tsx) exactly,
 * so a Studio render lines up with the local one: cards are laid out by
 * framesFromDurations, a caption line runs from its first word to the next
 * line's first word, and the silent closing card lands half a second after
 * the last word.
 */

const FPS = 30
/** Studio's portrait frame over a 16:9 source: the cover-fitted window shows
 *  this share of the source width. */
const VISIBLE_SHARE = 1080 / 1920 / (1920 / 1080)

export type StudioRef = { assetId: string; versionId: string; digest: string }

/** A captured film source (shorts.capture's `source`), minus the trim. */
export type StudioFilmSource = {
  videoId: string
  dubId: string
  editionId: string
  language: string
  subtitle: null | Record<string, unknown>
  preview: StudioRef
  export: StudioRef
}

/** The look components, by registered version id. */
export type StudioComponents = {
  filmLook: string
  kineticQuestion: string
  historyCredit: string
  serifLine: string
  closeQuestion: string
}

type Word = { word: string; startSec: number; endSec: number }
type Line = { from: number; to: number; hero: string; accents: string[] }

export type StudioShot = {
  id: string
  startFrame: number
  durationInFrames: number
  filmStartMs: number
  filmEndMs: number
  focusX: number
}

export type StudioHistoryPlan = {
  durationInFrames: number
  /** Where each card's own audio starts (for mixing the narration track). */
  narration: { audioFile: string; startFrame: number }[]
  captionsEndFrame: number
  lines: {
    id: string
    startFrame: number
    durationInFrames: number
    text: string
    hero: string
    accents: string
    wordTimes: string
  }[]
  shots: StudioShot[]
  credit: { label: string; source: string }
  closeCard: string
}

export class StudioExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StudioExportError"
  }
}

/**
 * Studio `focus.x` (CSS object-position) for a crop window centred on
 * `centre` (a share of the source width, as Smart Crop reports it).
 */
export function objectPositionFor(centre: number): number {
  const half = VISIBLE_SHARE / 2
  const x = (centre - half) / (1 - VISIBLE_SHARE)
  return Number(Math.min(1, Math.max(0, x)).toFixed(3))
}

/** The focus path's middle value inside [fromSec, toSec), or the centre. */
function focusBetween(
  path: ReadonlyArray<FocusPoint> | undefined,
  fromSec: number,
  toSec: number,
): number {
  const xs = (path ?? [])
    .filter((p) => p.atSec >= fromSec && p.atSec < toSec)
    .map((p) => p.x)
    .sort((a, b) => a - b)
  if (xs.length === 0) {
    const before = (path ?? []).filter((p) => p.atSec < fromSec).at(-1)
    return objectPositionFor(before?.x ?? 0.5)
  }
  return objectPositionFor(xs[Math.floor(xs.length / 2)])
}

/**
 * Lay a history short out for Studio. Shots follow the caption lines (one
 * clip per line, then one under the closing card) so the owner can retime a
 * line and its picture together.
 *
 * Studio plays the film at 1×, while the backdrop played it slowed. Each
 * shot therefore continues where the previous one stopped, which keeps the
 * picture seamless across clip boundaries; only when the backdrop itself
 * cut to another piece of the film does the next shot jump there.
 */
export function planHistoryShort(input: {
  manifest: Manifest
  /** Focus path on the short's own clock (Smart Crop over its backdrop). */
  focusPath?: ReadonlyArray<FocusPoint>
}): StudioHistoryPlan {
  const m = input.manifest
  const fact = m.shortFact as
    | {
        layout?: string
        label?: string
        source?: string
        closeCard?: string
        lines?: Line[]
      }
    | undefined
  if (fact?.layout !== "history")
    throw new StudioExportError("only the history short exports to Studio yet")
  const plan = m.bgPlan as BackgroundPlan | undefined
  if (!plan?.segments?.length)
    throw new StudioExportError(
      "the source pack has no bgPlan: re-run the long form with --pack-only " +
        "to record what its backdrop was cut from",
    )
  if (!fact.lines?.length)
    throw new StudioExportError("the history short has no caption lines")

  const frames = framesFromDurations(
    m.cards as never,
    FPS,
    CARD_TAIL_FRAMES,
    Math.round((m.outroHoldSec ?? 1.5) * FPS),
    0,
  )
  const last = frames.at(-1)!
  const durationInFrames = last.from + last.durationInFrames
  const words: Word[] = m.cards.flatMap((c, i) =>
    ((c.words ?? []) as Word[]).map((w) => ({
      word: w.word,
      startSec: frames[i].from / FPS + w.startSec,
      endSec: frames[i].from / FPS + w.endSec,
    })),
  )
  if (words.length === 0)
    throw new StudioExportError("the short's cards carry no word timings")
  const captionsEndSec = words.at(-1)!.endSec + 0.5
  const captionsEndFrame = Math.round(captionsEndSec * FPS)

  const lines = fact.lines.map((ln, i) => {
    const ws = words.slice(ln.from, ln.to + 1)
    const from = ws[0].startSec
    const next = fact.lines![i + 1]
    const startFrame = Math.round(from * FPS)
    const endFrame = next
      ? Math.round(words[next.from].startSec * FPS)
      : captionsEndFrame
    return {
      id: `line-${i + 1}`,
      startFrame,
      durationInFrames: endFrame - startFrame,
      text: ws.map((w) => w.word).join(" "),
      hero: ln.hero,
      accents: ln.accents.join(","),
      wordTimes: ws.map((w) => (w.startSec - from).toFixed(2)).join(","),
    }
  })

  // One shot per line, then one under the closing card; the first shot
  // starts at frame 0 even when the voice starts a beat in.
  const cuts = [
    0,
    ...lines.slice(1).map((l) => l.startFrame),
    captionsEndFrame,
    durationInFrames,
  ]
  const bgStart = Number(m.bgStartOffsetSec ?? 0)
  const rate = Number(m.bgPlaybackRate ?? 1)
  const shots: StudioShot[] = []
  let cursor = filmSecondAt(plan, bgStart)
  let piece = pieceAt(plan, bgStart).index
  for (let k = 0; k + 1 < cuts.length; k++) {
    const startSec = cuts[k] / FPS
    const endSec = cuts[k + 1] / FPS
    const bgAt = bgStart + startSec * rate
    const p = pieceAt(plan, bgAt).index
    if (p !== piece) {
      cursor = filmSecondAt(plan, bgAt)
      piece = p
    }
    const filmStartMs = Math.round(cursor * 1000)
    const filmEndMs = filmStartMs + Math.round((endSec - startSec) * 1000)
    shots.push({
      id: `shot-${k + 1}`,
      startFrame: cuts[k],
      durationInFrames: cuts[k + 1] - cuts[k],
      filmStartMs,
      filmEndMs,
      focusX: focusBetween(input.focusPath, startSec, endSec),
    })
    cursor = filmEndMs / 1000
  }

  return {
    durationInFrames,
    narration: m.cards.map((c, i) => ({
      audioFile: String(c.audioFile),
      startFrame: frames[i].from,
    })),
    captionsEndFrame,
    lines,
    shots,
    credit: {
      // The credit card sets its title in title case ("Historical Context").
      label: (fact.label ?? "Historical context").replace(/\b\w/g, (ch) =>
        ch.toUpperCase(),
      ),
      source: fact.source ?? "",
    },
    closeCard: fact.closeCard ?? "",
  }
}

/**
 * The Studio document for a planned history short. Component properties are
 * the ones the owner approved on the Prodigal pilot (project
 * prodigal-history-devotional-look-20261005); the component registrations
 * themselves are copied from that project by the caller.
 */
export function historyStudioDocument(input: {
  title: string
  language: string
  runtimeVersion: string
  plan: StudioHistoryPlan
  film: StudioFilmSource
  components: StudioComponents
  componentRegistrations: unknown[]
  narration: StudioRef
  music: StudioRef
  musicVolume: number
}) {
  const { plan, components: c } = input
  const kinetic = {
    side: "left",
    scrim: 0.6,
    fadeOutSec: 0.35,
    accentColor: "#f4efe8",
    wordStepSec: 0.25,
    bottomPercent: 38,
    startDelaySec: 0,
    keepPunctuation: true,
  }
  return {
    version: 1 as const,
    title: input.title,
    language: input.language,
    runtimeVersion: input.runtimeVersion,
    width: 1080,
    height: 1920,
    fps: FPS,
    durationInFrames: plan.durationInFrames,
    tracks: [
      { id: "clips", kind: "visual" },
      { id: "look", kind: "visual" },
      { id: "captions", kind: "caption" },
      { id: "narration-track", kind: "audio" },
      { id: "music-track", kind: "audio" },
    ],
    components: input.componentRegistrations,
    packRevisionIds: [],
    items: [
      ...plan.shots.map((s) => ({
        id: s.id,
        trackId: "clips",
        startFrame: s.startFrame,
        durationInFrames: s.durationInFrames,
        kind: "video",
        volume: 0,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
        },
        focus: { x: s.focusX, y: 0.5 },
        source: { ...input.film, startMs: s.filmStartMs, endMs: s.filmEndMs },
      })),
      {
        id: "film-look",
        trackId: "look",
        startFrame: 0,
        durationInFrames: plan.durationInFrames,
        kind: "component",
        componentVersionId: c.filmLook,
        properties: {
          dim: 0.28,
          grade: false,
          grain: 0,
          warmth: 0,
          vignette: true,
          fadeInSec: 0.3,
          fadeOutSec: 0.6,
        },
      },
      {
        id: "history-credit",
        trackId: "captions",
        startFrame: 0,
        durationInFrames: plan.captionsEndFrame,
        kind: "component",
        componentVersionId: c.historyCredit,
        properties: {
          title: plan.credit.label,
          source: plan.credit.source,
          fadeOutSec: 0.35,
        },
      },
      {
        id: "from-full-devotional",
        trackId: "captions",
        startFrame: 0,
        durationInFrames: plan.captionsEndFrame,
        kind: "component",
        componentVersionId: c.serifLine,
        properties: {
          top: 1100,
          left: 96,
          text: "From Full Devotional",
          align: "left",
          fadeOutSec: 0.35,
          inDelaySec: 1.2,
        },
      },
      ...plan.lines.map((l) => ({
        id: l.id,
        trackId: "captions",
        startFrame: l.startFrame,
        durationInFrames: l.durationInFrames,
        kind: "component",
        componentVersionId: c.kineticQuestion,
        properties: {
          ...kinetic,
          hero: l.hero,
          text: l.text,
          accents: l.accents,
          wordTimes: l.wordTimes,
        },
      })),
      ...(plan.closeCard
        ? [
            {
              id: "close-question",
              trackId: "captions",
              startFrame: plan.captionsEndFrame,
              durationInFrames: plan.durationInFrames - plan.captionsEndFrame,
              kind: "component",
              componentVersionId: c.closeQuestion,
              properties: { dim: 0.35, top: 675, text: plan.closeCard },
            },
          ]
        : []),
      {
        id: "narration",
        trackId: "narration-track",
        startFrame: 0,
        durationInFrames: plan.durationInFrames,
        kind: "audio",
        asset: input.narration,
        sourceStartMs: 0,
        volume: 1,
      },
      {
        id: "music",
        trackId: "music-track",
        startFrame: 0,
        durationInFrames: plan.durationInFrames,
        kind: "audio",
        asset: input.music,
        sourceStartMs: 0,
        volume: input.musicVolume,
      },
    ],
  }
}
