import { quoteIntroTimeline } from "@forge/shorts-compositions/devotional-timing"

import type { GeneratedDevotional, SourceMark } from "./generate-devotional"
import { splitReflection } from "./reflection-split"

// The lead lives with the audio that carries it (devotional-audio.ts), so the
// silence baked into a step segment and the delay the card reports are one
// number rather than two that can drift.
import { STEP_LEAD_SEC } from "./devotional-audio"

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
  /** Seconds of background skipped before the first card on it; see schema. */
  bgStartOffsetSec?: number
  /** Clip-first: intro overlay over the film's muted lead (see card schema). */
  intro?: "cover" | "bands" | "hook" | "watch" | "opening" | "montage"
  /** `montage`: captions keyed by 0-based spoken line. */
  introCaptions?: Record<number, string>
  /** `montage`: the localized words under the Jesus Film mark. */
  introKicker?: string
  /** `montage`: kinetic captions per spoken line. */
  introKinetic?: {
    line: number
    hero: string
    accents: string[]
    side: "left" | "right"
  }[]
  /** `montage` teaser: the last line is a call to action. */
  introCta?: boolean
  /** `montage`, vertical: horizontal focus per shot. */
  introFocus?: number[]
  /** Mark of the film the clip comes from (top-left while it plays). */
  filmMark?: "lumo"
  /** Source credits by segment id (authored devotionals): drawn on the
   *  reflection card whose paragraph uses that source. */
  sourceMarks?: Record<string, SourceMark>
  /** Verse callouts by narration segment id (see VerseCallout). */
  verseCallouts?: Record<
    string,
    { text: string; highlight: string; reference: string }
  >
  /** `intro: "hook"`: the question drawn on screen as the piece's title. */
  hookText?: string
  /** `intro: "watch"`: the spoken opening split into its sentences. */
  hookParts?: string[]
  /** `opening`: the first and last hook parts are the spoken welcome and
   *  "Let's watch", not lines to draw (see frameOpening). */
  openingFrame?: boolean
  /** Clip-first: corner progress ring clocking each step (composition prop). */
  stepRing?: boolean
  /** Shape of that clock: orbit ring (default) or a line across the top. */
  stepProgress?: "ring" | "bar"
  /** 16:9 film captions: karaoke (default), typewriter or ghost. */
  filmCaptionStyle?: "karaoke" | "typewriter" | "ghost" | "scroll"
  /** 16:9 source credits: centred above the text (default) or beside it. */
  markLayout?: "above" | "side"
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
  /** Real per-word times from ElevenLabs' alignment, in seconds from this
   *  segment's own audio start. Present only when the render asked for
   *  timestamps AND the audio was not re-timed after synthesis, so a card
   *  either carries trustworthy word timing or none at all. */
  words?: { word: string; startSec: number; endSec: number }[]
  /** Which voice read it (ElevenLabs id), for the pauses between cards. */
  voiceId?: string
}

export type BuildManifestInput = {
  /** Running order; see `buildNarrationSegments`. Defaults to classic. */
  structure?: "classic" | "clip-first"
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
  labels?: {
    reflect: string
    askYourself: string
    pray: string
    askLead?: string
    prayLead?: string
  }
  /** Localized three-step column (clip-first). Defaults to English. */
  stepLabels?: readonly [string, string, string]
  /** Fixed-date occasion tag for the cover (e.g. "World Humanitarian Day"),
   *  from `devotional-occasions.ts`. Most days have none. */
  occasion?: string
  /** The settle line the cover's narration actually speaks, to show it under
   *  the hook (see `settleLineFor`). */
  settleLine?: string
  /** Open the video card SILENT for this many seconds, with `leadLabel` on
   *  screen, before the clip's own audio eases in. */
  mutedLeadSec?: number
  /** Clip-first: intro overlay over the film's muted lead (see card schema). */
  intro?: "cover" | "bands" | "hook" | "watch" | "opening" | "montage"
  /** `montage`: captions keyed by 0-based spoken line. */
  introCaptions?: Record<number, string>
  /** `montage`: the localized words under the Jesus Film mark. */
  introKicker?: string
  /** `montage`: kinetic captions per spoken line. */
  introKinetic?: {
    line: number
    hero: string
    accents: string[]
    side: "left" | "right"
  }[]
  /** `montage` teaser: the last line is a call to action. */
  introCta?: boolean
  /** `montage`, vertical: horizontal focus per shot. */
  introFocus?: number[]
  /** Mark of the film the clip comes from (top-left while it plays). */
  filmMark?: "lumo"
  /** Source credits by segment id (authored devotionals): drawn on the
   *  reflection card whose paragraph uses that source. */
  sourceMarks?: Record<string, SourceMark>
  /** Verse callouts by narration segment id (see VerseCallout). */
  verseCallouts?: Record<
    string,
    { text: string; highlight: string; reference: string }
  >
  /** `intro: "hook"`: the question drawn on screen as the piece's title. */
  hookText?: string
  /** `intro: "watch"`: the spoken opening split into its sentences. */
  hookParts?: string[]
  /** `opening`: the first and last hook parts are the spoken welcome and
   *  "Let's watch", not lines to draw (see frameOpening). */
  openingFrame?: boolean
  /** Social opening card placed before the film (`--intro=quote`). */
  quoteIntro?: {
    quoteA: string
    quoteAStrong?: string
    quoteB: string
    quoteBStrong?: string
    questions: string[]
    watchLabel: string
    durationSec?: number
    /** Where in the background take the opening shot starts (seconds). */
    bgStartSec?: number
    /** Play that shot at this rate, so one take can cover the whole read. */
    bgRate?: number
    /** Teaser: close on this line instead of "Let's watch." */
    ctaLine?: string
    ctaLabel?: string
    /** File names (staged next to the clip) for the opening's sounds. */
    keySfx?: string
    transitionSfx?: string
  }
  /** The line shown over that silent opening, e.g. "Let's watch". */
  leadLabel?: string
  /** Captions for the video card, ALREADY timed against the edited clip
   *  (pauses cut + speed applied) — see `mapCuesToEditedTimeline`. */
  videoCaptions?: ReadonlyArray<{
    text: string
    startSec: number
    endSec: number
    words?: number[]
    verse?: string
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

/**
 * The clip-first running order (owner's A/B variant): the film, full-frame,
 * comes first and there is no cover. Then a three-step stepper — WATCH already
 * done, REFLECT lighting up — the reflection, the takeaway, the verse as the
 * reflection's last word, the stepper again landing on PRAY, and the question
 * and prayer.
 */
function buildClipFirstManifest(
  input: BuildManifestInput,
  byId: Map<string, BuildManifestInput["segments"][number]>,
  withAudio: (id: string, base: ManifestCard) => ManifestCard | null,
  stepCard: (
    id: string,
    stepIndex: number,
    extra?: Record<string, unknown>,
  ) => ManifestCard | null,
): DevotionalManifest {
  const d = input.devotional
  const clip = input.clipFile
  const labels = input.labels ?? {
    reflect: "Reflect",
    askYourself: "Ask yourself",
    pray: "Pray",
  }
  const STEPS = [...(input.stepLabels ?? ["WATCH", "REFLECT", "PRAY"])]
  const cards: ManifestCard[] = []

  const videoDurationSec = Math.min(
    input.clipDurationSec,
    input.videoCardSec ?? 18,
  )
  const captions = (input.videoCaptions ?? []).filter(
    (c) => c.startSec < videoDurationSec,
  )
  // Social opening (`--intro=quote`): the quotation, the three questions and
  // "Let's watch", over the background slice, BEFORE the film starts. Unlike
  // `hook` this is its own card: it is 13s long and carries no film sound, so
  // it cannot ride the scene's run-up.
  if (input.quoteIntro) {
    const q = input.quoteIntro
    // The card is exactly as long as its words take to READ — same model the
    // composition lays its beats out with, so the two can never drift.
    const plan = quoteIntroTimeline({
      quoteA: q.quoteA,
      quoteB: q.quoteB,
      questions: q.questions,
      ...(q.ctaLine ? { cta: q.ctaLine } : {}),
    })
    cards.push({
      kind: "quote-intro",
      durationSec: q.durationSec ?? plan.totalSec,
      quoteA: q.quoteA,
      ...(q.quoteAStrong ? { quoteAStrong: q.quoteAStrong } : {}),
      quoteB: q.quoteB,
      ...(q.quoteBStrong ? { quoteBStrong: q.quoteBStrong } : {}),
      questionsList: q.questions,
      watchLabel: q.watchLabel,
      ...(q.bgStartSec != null ? { bgStartSec: q.bgStartSec } : {}),
      ...(q.bgRate != null ? { bgRate: q.bgRate } : {}),
      ...(q.ctaLine ? { ctaLine: q.ctaLine } : {}),
      ...(q.ctaLabel != null ? { ctaLabel: q.ctaLabel } : {}),
      ...(q.keySfx ? { keySfx: q.keySfx } : {}),
      ...(q.transitionSfx ? { transitionSfx: q.transitionSfx } : {}),
    })
  }

  // `intro: "hook"` (YouTube): the one spoken line that runs over the film's
  // opening seconds. Every other opening is silent, so this is the only case
  // where the clip-first film card carries narration.
  // ONLY when this cut actually opens on the spoken hook. The segment lives in
  // the audio cache once it has been recorded, and attaching it on sight put
  // the YouTube welcome over the film's first line in a cut that never asked
  // for it (owner-reported: "the voice overlaps with the video sound").
  // `opening` is spoken too when the cut was given its lines to say (owner,
  // 2026-09-25: "we start with the female voice"); without a hook line it
  // stays the silent, read-only opening and there is no segment to find.
  const hookSeg =
    input.intro === "hook" ||
    input.intro === "watch" ||
    input.intro === "opening" ||
    input.intro === "montage"
      ? input.segments.find((s) => s.id === "hook")
      : undefined
  cards.push({
    kind: "video",
    videoFile: clip,
    durationSec: videoDurationSec,
    // Full-frame vertical crop, not the square window: the film IS the
    // opening here, so it gets the whole frame. No spoken lead-in — nothing
    // was said before it — but an optional silent lead carries the intro
    // overlay that says what this is.
    videoFill: "full",
    ...(hookSeg ? { audioFile: hookSeg.file } : {}),
    ...(captions.length ? { subtitles: captions } : {}),
    ...(input.mutedLeadSec ? { mutedLeadSec: input.mutedLeadSec } : {}),
    // The intro names the three steps in the locale's words, same as the
    // stepper screens (a Spanish cut once opened on WATCH / REFLECT / PRAY).
    // `hook` draws no steps at all — it is only a voice over the film.
    ...(input.filmMark ? { filmMark: input.filmMark } : {}),
    ...(input.intro
      ? input.intro === "hook" ||
        input.intro === "watch" ||
        input.intro === "opening" ||
        input.intro === "montage"
        ? {
            intro: input.intro,
            ...(input.intro === "watch" ? { steps: STEPS } : {}),
            // The opening's beats follow the voice, so the card carries both
            // the sentences and the narration's word times.
            // The `opening` beats carry no voice, so its lines come straight
            // from the render option rather than from narration segments.
            ...((input.intro === "watch" ||
              input.intro === "opening" ||
              input.intro === "montage") &&
            input.hookParts?.length
              ? { introParts: input.hookParts }
              : {}),
            ...(input.intro === "montage" && input.introCta
              ? { introCta: true }
              : {}),
            ...(input.intro === "montage" && input.introFocus?.length
              ? { introFocus: input.introFocus }
              : {}),
            // The passage the scene reads, over WATCH as the film begins.
            ...((input.intro === "montage" || input.intro === "opening") &&
            d.passage?.reference
              ? { passageRef: d.passage.reference }
              : {}),
            ...(input.intro === "montage" && input.introKinetic?.length
              ? { introKinetic: input.introKinetic }
              : {}),
            ...(input.intro === "montage" && input.introKicker
              ? { introKicker: input.introKicker }
              : {}),
            ...(input.intro === "montage" && input.introCaptions
              ? {
                  // "The others worked|One hour": small lead, big caption.
                  introCaptions: Object.entries(input.introCaptions).map(
                    ([line, spec]) => {
                      const [a, b] = spec.split("|").map((x) => x.trim())
                      return b != null
                        ? {
                            line: Number(line),
                            text: b,
                            ...(a ? { lead: a } : {}),
                          }
                        : { line: Number(line), text: a }
                    },
                  ),
                }
              : {}),
            ...(input.intro === "opening" && input.openingFrame
              ? { introFrame: true }
              : {}),
            // The spoken openings' beats follow the voice, so their card
            // carries the narration's word times.
            ...((input.intro === "watch" ||
              input.intro === "opening" ||
              input.intro === "montage") &&
            hookSeg?.words?.length
              ? { words: hookSeg.words }
              : {}),
            // The spoken question doubles as the on-screen title. It comes
            // from the render option, not from the produced segment: a reused
            // cached take carries whatever display text it was made with.
            ...((input.hookText ?? hookSeg?.text)
              ? { hookText: input.hookText ?? hookSeg?.text }
              : {}),
          }
        : { intro: input.intro, steps: STEPS }
      : {}),
  })

  // WATCH is already behind us; the light travels from it onto REFLECT.
  const stepReflect = stepCard("step-reflect", 1, { steps: STEPS })
  if (stepReflect) cards.push(stepReflect)

  const reflectionSegments = input.segments
    .filter((s) => /^reflection-\d+$/.test(s.id))
    .sort((a, b) => Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]))
  const usedHighlights = new Set<number>()
  // Two sentences read by the same voice need only a short breath between
  // them; a change of voice keeps the full pause (owner, 2026-09-30).
  const SAME_VOICE_TAIL_SEC = 0.35
  const sameVoiceNext = (i: number) => {
    const a = reflectionSegments[i]
    const b = reflectionSegments[i + 1]
    return !!(a?.voiceId && b?.voiceId && a.voiceId === b.voiceId)
  }
  reflectionSegments.forEach((seg, segIndex) => {
    const cardText = seg.text ?? ""
    const highlightIndex = (d.reflectionHighlights ?? []).findIndex(
      (h, i) => h && !usedHighlights.has(i) && cardText.includes(h),
    )
    if (highlightIndex >= 0) usedHighlights.add(highlightIndex)
    const highlight =
      highlightIndex >= 0 ? d.reflectionHighlights?.[highlightIndex] : undefined
    const mark = input.sourceMarks?.[seg.id]
    const callout = input.verseCallouts?.[seg.id]
    cards.push({
      kind: "reflection-focus",
      sectionLabel: "",
      text: cardText,
      ...(highlight ? { highlight } : {}),
      ...(mark ? { sourceMark: mark } : {}),
      ...(callout ? { verseCallout: callout } : {}),
      ...(sameVoiceNext(segIndex) ? { tailSec: SAME_VOICE_TAIL_SEC } : {}),
      audioFile: seg.file,
      durationSec: seg.durationSec,
      bgFile: clip,
      ...(seg.words && seg.words.length > 0 ? { words: seg.words } : {}),
    })
  })

  const conclusion = withAudio("conclusion", {
    kind: "conclusion",
    text: d.conclusion,
    highlight: d.conclusion,
    holdSec: 2,
  })
  if (conclusion) cards.push(conclusion)

  const endCredit = d.reflection.paragraphs?.some((p) => p.mark)
    ? undefined
    : d.reflection.attribution

  // The verse is the reflection's closing word, not its opening. It holds a
  // second after the voice finishes (owner, 2026-09-26: it "disappears too
  // quickly").
  const scripture = withAudio("scripture", {
    kind: "scripture",
    verse: d.scripture.text,
    citation: d.scripture.reference,
    holdSec: 1,
    // Shown after the citation ("LUKE 8:16 · BSB"): the viewer should know
    // which translation they are hearing. Absent when the verse could not be
    // verified against a corpus (the model's own wording, flagged upstream).
    ...(d.scripture.translation
      ? { translation: d.scripture.translation }
      : {}),
  })
  if (scripture) cards.push(scripture)

  const stepPray = stepCard("step-pray", 2, { steps: STEPS })
  if (stepPray) cards.push(stepPray)

  const qp = byId.get("questions")
  if (qp) {
    cards.push({
      kind: "questions",
      questions: [d.question],
      prayer: d.prayer,
      askLabel: labels.askYourself,
      prayLabel: labels.pray,
      ...closingCueTimes(qp.words, d.question, labels),
      // No cover in this structure, so the source credit — otherwise only on
      // the cover — lands on the closing card. Not when the reflection credits
      // its sources inline, as it goes: saying it again at the end is a repeat
      // (owner, 2026-09-26).
      ...(endCredit ? { attribution: endCredit } : {}),
      audioFile: qp.file,
      durationSec: qp.durationSec,
      holdSec: 5,
      bgFile: clip,
    })
  }
  const finalCard = cards[cards.length - 1]
  if (finalCard) finalCard.holdSec = (Number(finalCard.holdSec) || 0) + 5

  return {
    schemaVersion: "2",
    headerDate: input.headerDate,
    // The take fades in from black over 0.6s; the stepper is the first card
    // on it here and would flash black after the film.
    bgStartOffsetSec: 0.75,
    ...(endCredit ? { attribution: endCredit } : {}),
    ...(input.musicFile ? { musicFile: input.musicFile } : {}),
    cards,
  }
}

type TimedWord = { word: string; startSec: number; endSec: number }

/**
 * Where the closing card's spoken parts begin, from the narration's word
 * times: the question after its lead-in, the prayer's lead-in, and the prayer
 * itself. The card lights each block as the voice reaches it; without word
 * times it keeps its fixed pacing.
 */
export function closingCueTimes(
  words: ReadonlyArray<TimedWord> | undefined,
  question: string,
  labels: { askLead?: string; prayLead?: string },
): { questionAtSec?: number; prayerAtSec?: number; prayerTextAtSec?: number } {
  if (!words || words.length === 0 || !labels.askLead || !labels.prayLead)
    return {}
  const count = (t: string) => t.split(/\s+/).filter(Boolean).length
  const nAsk = count(labels.askLead)
  const nQuestion = count(question)
  const nPray = count(labels.prayLead)
  // The spoken text is "<ask lead> <question>\n\n<pray lead> <prayer>", and
  // the TTS words split on whitespace the same way; if the counts do not add
  // up the alignment is not trusted.
  const prayAt = nAsk + nQuestion
  if (words.length <= prayAt + nPray) return {}
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "")
  if (norm(words[prayAt].word) !== norm(labels.prayLead.split(/\s+/)[0]))
    return {}
  return {
    questionAtSec: words[nAsk].startSec,
    prayerAtSec: words[prayAt].startSec,
    prayerTextAtSec: words[prayAt + nPray].startSec,
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
      ...(seg.words && seg.words.length > 0 ? { words: seg.words } : {}),
    }
  }

  /**
   * The stepper screen before a stage. Dropped silently when its narration
   * segment does not exist, which is what makes `--steps` a flag rather than a
   * fork: without those segments no step card is emitted and the running order
   * is exactly what it was.
   */
  const stepCard = (
    id: string,
    stepIndex: number,
    extra: Record<string, unknown> = {},
  ): ManifestCard | null =>
    withAudio(id, {
      kind: "step",
      stepIndex,
      stepLeadSec: STEP_LEAD_SEC,
      ...extra,
    })

  // The cover shows the settle line only when the voice SAYS it. With the
  // stepper on, that line moved to the stepper's opening screen, so showing it
  // here would put words on the cover the narration never speaks.
  if (input.structure === "clip-first") {
    return buildClipFirstManifest(input, byId, withAudio, stepCard)
  }

  const hasSteps = byId.has("step-read")
  const cover = withAudio("cover", {
    kind: "cover",
    title: d.title,
    ...(input.occasion ? { occasion: input.occasion } : {}),
    ...(input.settleLine && !hasSteps ? { settleLine: input.settleLine } : {}),
    // No held beat: the cover leaves as soon as the hook has been spoken
    // (owner). The logo now stamps at a fixed two seconds and the credit
    // follows it, so both land inside the hook rather than after it.
  })
  if (cover) cards.push(cover)

  // ONE opening stepper screen. Its narration is the opening line followed by
  // "here's where we're reading today", so the card shows the line filling in
  // with the voice and then lights READ under it — no crossfade between two
  // near-identical stepper frames. `headline` is the part that is also on
  // screen; the composition finds the hand-over point in the word alignment.
  // The line does NOT follow the later steps (owner): by WATCH the viewer has
  // been in the passage for a minute and it has nothing left to introduce.
  const readSeg = byId.get("step-read")
  const stepRead = stepCard(
    "step-read",
    0,
    readSeg?.text ? { headline: readSeg.text } : {},
  )
  if (stepRead) cards.push(stepRead)

  const scripture = withAudio("scripture", {
    kind: "scripture",
    verse: d.scripture.text,
    citation: d.scripture.reference,
    // Shown after the citation ("LUKE 8:16 · BSB"): the viewer should know
    // which translation they are hearing. Absent when the verse could not be
    // verified against a corpus (the model's own wording, flagged upstream).
    ...(d.scripture.translation
      ? { translation: d.scripture.translation }
      : {}),
  })
  if (scripture) cards.push(scripture)

  const stepWatch = stepCard("step-watch", 1)
  if (stepWatch) cards.push(stepWatch)

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
    ...(input.mutedLeadSec
      ? {
          mutedLeadSec: input.mutedLeadSec,
          ...(input.leadLabel ? { leadLabel: input.leadLabel } : {}),
        }
      : {}),
  })

  const stepReflect = stepCard("step-reflect", 2)
  if (stepReflect) cards.push(stepReflect)
  // With the stepper on screen, the "Reflect" eyebrow above the first
  // reflection card is the third time the same word appears in ten seconds
  // (step card, voice, label). Owner: drop the label — the stepper names the
  // stage now. Without step cards it stays exactly as it was.
  const stepperNamesStages = stepReflect != null

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
      ...((k === 0 || k === act2At) && !stepperNamesStages
        ? { sectionLabel: labels.reflect }
        : { sectionLabel: "" }),
      text: cardText,
      ...(highlight ? { highlight } : {}),
      audioFile: seg.file,
      durationSec: seg.durationSec,
      bgFile: clip,
      ...(seg.words && seg.words.length > 0 ? { words: seg.words } : {}),
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
  const stepPray = stepCard("step-pray", 3)
  if (stepPray) cards.push(stepPray)

  const qp = byId.get("questions")
  if (qp) {
    cards.push({
      kind: "questions",
      questions: [d.question],
      prayer: d.prayer,
      askLabel: labels.askYourself,
      prayLabel: labels.pray,
      ...closingCueTimes(qp.words, d.question, labels),
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
