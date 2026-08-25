import type { GeneratedDevotional } from "./generate-devotional"
import { splitReflection } from "./reflection-split"

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
  /** Silent beat on the FIRST card before narration starts (s). Set by the
   *  renderer so its background budget can't drift from the composition's
   *  own default. */
  introHoldSec?: number
  /** Held beat on the LAST card after its narration ends (s). Same reason. */
  outroHoldSec?: number
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
  /** Localized on-screen section labels (defaults to English). */
  labels?: { reflect: string; askYourself: string; pray: string }
  /** Fixed-date occasion tag for the cover (e.g. "World Humanitarian Day"),
   *  from `devotional-occasions.ts`. Most days have none. */
  occasion?: string
  /** Captions for the video card, ALREADY timed against the edited clip
   *  (pauses cut + speed applied) — see `mapCuesToEditedTimeline`. */
  videoCaptions?: ReadonlyArray<{
    text: string
    startSec: number
    endSec: number
  }>
  /** TWO-ACT LAYOUT (opt-in per chapter). The clip's second act, played after
   *  the first half of the reflection. When set — together with
   *  `devotional.reflection.parts` — the card order becomes
   *  video act 1 → reflection half 1 → video act 2 → reflection half 2,
   *  so each half comments on the act the viewer just watched. */
  act2?: {
    /** staticFile name of the second act's clip, e.g. "clip2.mp4". */
    clipFile: string
    durationSec: number
    captions?: ReadonlyArray<{ text: string; startSec: number; endSec: number }>
  }
}

export function buildDevotionalManifest(
  input: BuildManifestInput,
): DevotionalManifest {
  const d = input.devotional
  const clip = input.clipFile
  const labels = input.labels ?? {
    reflect: "Reflect",
    askYourself: "Ask yourself",
    pray: "Pray",
  }
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

  const cover = withAudio("cover", {
    kind: "cover",
    title: d.title,
    ...(input.occasion ? { occasion: input.occasion } : {}),
  })
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
  const videoDurationSec = Math.min(
    input.clipDurationSec,
    input.videoCardSec ?? 18,
  )
  // Only captions that actually START while the card is on screen — the clip
  // file carries a few extra margin seconds past the card's own duration.
  const captions = (input.videoCaptions ?? []).filter(
    (c) => c.startSec < videoDurationSec,
  )
  cards.push({
    kind: "video",
    videoFile: clip,
    durationSec: videoDurationSec,
    ...(videoSeg ? { audioFile: videoSeg.file } : {}),
    ...(captions.length ? { subtitles: captions } : {}),
  })

  // One reflection card per narrated chunk — the on-screen text is exactly what
  // is spoken on that card, so it advances with the voice.
  const reflectionSegments = input.segments
    .filter((s) => /^reflection-\d+$/.test(s.id))
    .sort((a, b) => Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]))

  // TWO-ACT LAYOUT: where the second act's video card goes. The halves were
  // written separately but `reflection.text` is their concatenation, so the
  // narration chunks are already in order and act 2 slots in at the boundary.
  // Count with `splitReflection` — the SAME function that produced the audio
  // chunks — so the boundary can't drift from the cards it has to sit between.
  const act2 = input.act2
  const rawBoundary =
    act2 && d.reflection.parts?.length === 2
      ? splitReflection(d.reflection.parts[0]).length
      : -1
  // Clamp INTO the reflection run. Without this, a boundary at or past the
  // last chunk means the loop never reaches it and act 2 is dropped from the
  // video with no error at all — the exact kind of silent loss this pipeline
  // has been bitten by before.
  const act2At =
    rawBoundary >= 0 && reflectionSegments.length > 1
      ? Math.min(Math.max(rawBoundary, 1), reflectionSegments.length - 1)
      : -1

  // Card text = the chunk, with the "Reflect on this." connector (narration
  // only) stripped, plus one accent phrase, aligned by index with the highlights.
  /** Highlights already placed, so one phrase cannot claim two cards. */
  const usedHighlights = new Set<number>()
  reflectionSegments.forEach((seg, k) => {
    // Second act plays BEFORE the half that comments on it.
    if (k === act2At && act2) {
      const act2Captions = (act2.captions ?? []).filter(
        (c) => c.startSec < act2.durationSec,
      )
      cards.push({
        kind: "video",
        videoFile: act2.clipFile,
        durationSec: act2.durationSec,
        ...(act2Captions.length ? { subtitles: act2Captions } : {}),
      })
    }
    // Match the highlight to the card by CONTENT, not by position.
    //
    // These used to be read as `reflectionHighlights[k]`, which silently
    // assumes the reflection still splits into exactly the chunks it did when
    // the highlights were picked. Fixing a sentence-splitting bug (a closing
    // quote after the full stop) changed that chunk count, and every cached
    // devotional's highlights would have shifted onto the wrong cards —
    // invisibly, because a phrase that isn't in the card's text just doesn't
    // render. A phrase belongs to the card that contains it; each is used once.
    const cardText = (seg.text ?? "").replace(/^Reflect on this\.\s*/, "")
    const highlightIndex = (d.reflectionHighlights ?? []).findIndex(
      (h, i) => h && !usedHighlights.has(i) && cardText.includes(h),
    )
    if (highlightIndex >= 0) usedHighlights.add(highlightIndex)
    const highlight =
      highlightIndex >= 0 ? d.reflectionHighlights?.[highlightIndex] : undefined
    cards.push({
      kind: "reflection-focus",
      // The reflect label shows on the FIRST card of each half; the rest pass
      // "" to suppress it.
      ...(k === 0 || k === act2At
        ? { sectionLabel: labels.reflect }
        : { sectionLabel: "" }),
      text: cardText,
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
      askLabel: labels.askYourself,
      prayLabel: labels.pray,
      audioFile: qp.file,
      durationSec: qp.durationSec,
      holdSec: 5,
      bgFile: clip,
    })
  }

  // No CTA card: this is the FULL devotional, not a teaser. (The "watch the
  // full devotional" end-card belongs only on teasers.)

  // Owner rule: the VERY LAST card (normally "questions"; "conclusion" if the
  // questions narration wasn't produced) holds 5s LONGER than its own base
  // hold, so viewers have time to actually sit with the question/prayer
  // before the video ends — not the specific kind, whichever card is last.
  const finalCard = cards[cards.length - 1]
  if (finalCard) {
    finalCard.holdSec = (Number(finalCard.holdSec) || 0) + 5
  }

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
