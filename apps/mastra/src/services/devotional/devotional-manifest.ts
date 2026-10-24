import type { GeneratedDevotional } from "./generate-devotional"

/**
 * Build the render manifest (the JSON the Remotion `devotional` composition +
 * `render-devotional-video.mjs` consume) from a generated devotional and its
 * produced audio.
 *
 * Layout mirrors the teaser pattern: the film clip is the (blurred) background
 * behind every text card, and one `video` card plays it clear. Each text card
 * carries its narration MP3 + that clip's measured duration. Best-effort: only
 * cards whose narration was produced are narrated; the clip always renders.
 *
 * Pure: durations are measured (ffprobe) by the caller and passed in, so this
 * stays testable and free of IO.
 */

export type ManifestCard = Record<string, unknown> & { kind: string }

export type DevotionalManifest = {
  schemaVersion: "2"
  headerDate: string
  /** Source credit for the reflection, e.g. "Adapted from Matthew Henry". */
  attribution?: string
  musicFile?: string
  /** One continuous background clip shared by every non-video card (each card
   *  windows into it via trimBefore for a seamless walk). Set by the renderer. */
  bgFile?: string
  bgDurationSec?: number
  bgPlaybackRate?: number
  cards: ManifestCard[]
}

/** A produced narration segment staged beside the manifest. */
export type StagedSegment = {
  id: string
  file: string
  durationSec: number
  /** The narrated text (shown on-screen for reflection cards). */
  text?: string
}

export type BuildManifestInput = {
  devotional: GeneratedDevotional
  /** Narration segments that were produced (by id: cover/scripture/reflection/question/prayer). */
  segments: StagedSegment[]
  /** staticFile name of the clip (background + video card), e.g. "clip.mp4". */
  clipFile: string
  /** Clip length (s); the video card plays up to `videoCardSec` of it. */
  clipDurationSec: number
  /** staticFile name of the music bed, if produced. */
  musicFile?: string
  /** Header date label, e.g. "Jul 10". */
  headerDate: string
  /** Cap for the clear video card (s). */
  videoCardSec?: number
}

export function buildDevotionalManifest(
  input: BuildManifestInput,
): DevotionalManifest {
  const d = input.devotional
  const clip = input.clipFile
  const byId = new Map(input.segments.map((s) => [s.id, s]))
  const cards: ManifestCard[] = []

  const withAudio = (id: string, base: ManifestCard): ManifestCard | null => {
    const seg = byId.get(id)
    if (!seg) return null // narration skipped → drop this card
    return {
      ...base,
      audioFile: seg.file,
      durationSec: seg.durationSec,
      bgFile: clip,
    }
  }

  const cover = withAudio("cover", { kind: "cover", title: d.title })
  if (cover) cards.push(cover)

  const scripture = withAudio("scripture", {
    kind: "scripture",
    verse: d.scripture.text,
    citation: d.scripture.reference,
  })
  if (scripture) cards.push(scripture)

  // The clip, played clear — narrated with its connector ("Let's watch") if
  // that segment was produced.
  const videoSeg = byId.get("video")
  cards.push({
    kind: "video",
    videoFile: clip,
    durationSec: Math.min(input.clipDurationSec, input.videoCardSec ?? 18),
    ...(videoSeg ? { audioFile: videoSeg.file } : {}),
  })

  // One reflection card per narrated chunk — the on-screen text is exactly what
  // is spoken on that card, so it advances with the voice.
  const reflectionSegments = input.segments
    .filter((s) => /^reflection-\d+$/.test(s.id))
    .sort((a, b) => Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]))
  // Card text = the chunk, with the "Reflect on this." connector (narration
  // only) stripped, plus one accent phrase, aligned by index with the highlights.
  reflectionSegments.forEach((seg, k) => {
    const highlight = d.reflectionHighlights?.[k]
    cards.push({
      kind: "reflection-focus",
      // "Reflect" shows on the FIRST card only; the rest pass "" to suppress it.
      ...(k === 0 ? {} : { sectionLabel: "" }),
      text: (seg.text ?? "").replace(/^Reflect on this\.\s*/, ""),
      ...(highlight ? { highlight } : {}),
      audioFile: seg.file,
      durationSec: seg.durationSec,
      bgFile: clip,
    })
  })

  // Closing takeaway line — hold a beat after the voice finishes before moving
  // on to the question.
  const conclusion = withAudio("conclusion", {
    kind: "conclusion",
    text: d.conclusion,
    highlight: d.conclusion,
    holdSec: 2,
  })
  if (conclusion) cards.push(conclusion)

  // Question + invitation-to-pray on ONE card, with extra hold so the viewer
  // has time to sit with it.
  const qp = byId.get("questions")
  if (qp) {
    cards.push({
      kind: "questions",
      questions: [d.question],
      prayer: d.prayer,
      audioFile: qp.file,
      durationSec: qp.durationSec,
      holdSec: 5,
      bgFile: clip,
    })
  }

  // No CTA card: this is the FULL devotional, not a teaser. (The "watch the
  // full devotional" end-card belongs only on teasers.)

  return {
    schemaVersion: "2",
    headerDate: input.headerDate,
    ...(d.reflection.attribution
      ? { attribution: d.reflection.attribution }
      : {}),
    ...(input.musicFile ? { musicFile: input.musicFile } : {}),
    cards,
  }
}
