import { CARD_TAIL_FRAMES } from "@forge/shorts-compositions/devotional-card-timing"

/**
 * Backdrop relevance (owner, 2026-09-30): while the reflection talks about the
 * older brother, the film behind it should show the older brother; when it
 * turns to the father, the father. A paragraph that names nothing the film
 * shows keeps the previous footage rolling, so the backdrop only jumps when
 * the words give it a reason to.
 *
 * Matching is lexical and deliberately plain: the film's own captions are the
 * words of the passage, and a paragraph about the pigs says "pigs". Words that
 * appear in many cues ("son", "father") weigh little; rare ones ("pods",
 * "robe", "field") decide.
 */

export type BrollCue = { start: number; end: number; text: string }
export type BrollAnchor = { atSec: number; sourceSec: number; why: string }

const STOP = new Set(
  (
    "a an the and or but if then so of to in on at by for with from into over " +
    "is are was were be been being am do does did done have has had having " +
    "he him his she her they them their we us our you your i me my it its " +
    "this that these those there here who whom whose which what when where why " +
    "how not no nor all any each every some one two very just only also even " +
    "can could would should will shall may might must said say says tell told " +
    "like as than too up down out off again now yet still about because while " +
    "jesus story look notice picture many much more most own same other such " +
    // Verbs of giving read as a match with the share-of-the-estate scene
    // whenever a reflection says "share his gladness".
    "share give gave gift " +
    // Spanish function words (the Spanish cut matched its backdrop on "los",
    // "que" and "también" until these were added, 2026-09-30).
    "el la los las un una unos unas y o pero si de del al a en con por para sin " +
    "que qué quien quién cual cuál como cómo cuando cuándo donde dónde " +
    "es son era eran fue ser estar está están estaba había ha han hay " +
    "él ella ellos ellas lo le les se su sus mi mis tu tus nos nosotros " +
    "este esta estos estas ese esa esos esas eso esto aquí allí ahí " +
    "no ni ya muy más menos también tan solo sólo todo toda todos todas " +
    "mira fíjate ahora así entonces historia jesús"
  ).split(" "),
)

function stem(w: string): string {
  let s = w
    .toLowerCase()
    .replace(/[’']s$/, "")
    // Keep Spanish letters: stripping them turned "también" into "tambin".
    .replace(/[^a-záéíóúñü]/g, "")
  if (STOP.has(s)) return ""
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3)
  else if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss"))
    s = s.slice(0, -1)
  return s
}

function tokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.split(/\s+/)) {
    const s = stem(raw)
    if (s.length > 2 && !STOP.has(s)) out.add(s)
  }
  return out
}

/** The cue a paragraph is about, or null when nothing in it is specific
 *  enough to point at a moment of the film. */
export function matchCue(
  text: string,
  cues: ReadonlyArray<BrollCue>,
  minScore = 2.2,
): { cue: BrollCue; score: number; words: string[] } | null {
  if (cues.length === 0) return null
  const cueTokens = cues.map((c) => tokens(c.text))
  const df = new Map<string, number>()
  for (const set of cueTokens)
    for (const w of set) df.set(w, (df.get(w) ?? 0) + 1)
  const want = tokens(text)
  let best: { cue: BrollCue; score: number; words: string[] } | null = null
  for (let i = 0; i < cues.length; i++) {
    const set = cueTokens[i]
    const words = [...want].filter((w) => set.has(w))
    const score = words.reduce(
      (s, w) => s + Math.log(cues.length / (df.get(w) ?? 1)),
      0,
    )
    if (!best || score > best.score) best = { cue: cues[i], score, words }
  }
  return best && best.score >= minScore ? best : null
}

/**
 * Backdrop pieces for `concatWithSeamXfade`, in source seconds: one run per
 * anchor, each playing on from its source point until the next anchor takes
 * over, wrapping to the window start if the film runs out. Every piece but the
 * last carries one dissolve of extra footage, because each seam overlaps its
 * two sides by `dissolveSec`: that keeps every new shot starting exactly at
 * its anchor instead of drifting a dissolve earlier per seam.
 */
export function planBrollSegments(input: {
  anchors: ReadonlyArray<BrollAnchor>
  windowStart: number
  windowLen: number
  coverSec: number
  speed: number
  dissolveSec: number
}): { startSec: number; lengthSec: number }[] {
  const { windowStart, windowLen, coverSec, speed, dissolveSec } = input
  const windowEnd = windowStart + windowLen
  // A run shorter than this is not worth a cut, and a piece this short
  // would also shrink every seam: concatWithSeamXfade caps the dissolve at
  // half the shortest piece.
  const MIN_PIECE_SEC = 2 * dissolveSec + 0.5
  const sorted = [
    { atSec: 0, sourceSec: windowStart },
    ...input.anchors.filter((a) => a.atSec > 0.5),
  ].sort((a, b) => a.atSec - b.atSec)
  const runs = sorted.filter(
    (run, k) =>
      k + 1 >= sorted.length ||
      sorted[k + 1].atSec - run.atSec >= MIN_PIECE_SEC,
  )
  const pieces: { startSec: number; screenSec: number }[] = []
  runs.forEach((run, k) => {
    // The tail runs a little past the timeline, so the last card never
    // reaches the end of the footage.
    const until = k + 1 < runs.length ? runs[k + 1].atSec : coverSec + 2
    let screen = until - run.atSec
    let src = Math.min(Math.max(run.sourceSec, windowStart), windowEnd - 1)
    while (screen > 0.01) {
      // Too little film left before the window ends: start over now rather
      // than cut to a sliver.
      if ((windowEnd - src) / speed < MIN_PIECE_SEC) src = windowStart
      // Leave room inside the window for the seam's overlap as well.
      const fits = (windowEnd - src - dissolveSec) / speed
      const take = Math.min(screen, fits)
      pieces.push({ startSec: src, screenSec: take })
      screen -= take
      src = windowStart
    }
  })
  // concatWithSeamXfade dissolves the SOURCE pieces and slows the joined
  // result afterwards, so each seam overlaps `dissolveSec` of source.
  return pieces.map((p, i) => {
    const extra = i + 1 < pieces.length ? dissolveSec : 0
    const lengthSec = Math.min(
      p.screenSec * speed + extra,
      windowEnd - p.startSec,
    )
    return { startSec: p.startSec, lengthSec }
  })
}

type PlanCard = {
  kind?: unknown
  text?: unknown
  durationSec?: unknown
  holdSec?: unknown
  tailSec?: unknown
  bgStartSec?: unknown
}

/** The composition's frame rate; broll-plan.test.ts pins this timeline to
 *  framesFromDurations so the two cannot drift apart. */
const FPS = 30

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

/**
 * Where on the backdrop's timeline each reflection paragraph begins, and the
 * film moment it is about. The timeline is counted the way the composition
 * walks the shared take (framesFromDurations): video cards show their own
 * clip and take no backdrop time. An anchor is dropped when the footage
 * already rolling would reach that moment within a few seconds anyway, so a
 * paragraph that continues the last one's scene does not cut.
 */
export function planBrollAnchors(input: {
  cards: ReadonlyArray<PlanCard>
  paragraphs: ReadonlyArray<{ text: string }>
  cues: ReadonlyArray<BrollCue>
  introHoldSec: number
  speed: number
  windowStart: number
  windowEnd: number
  /** Choose a paragraph's cue some other way (a localized cut maps the
   *  English match onto its own dub by verse); null keeps footage rolling. */
  pick?: (paragraphIndex: number) => { cue: BrollCue; words: string[] } | null
}): BrollAnchor[] {
  const { cards, paragraphs, cues, speed, windowStart, windowEnd } = input
  const inWindow = cues.filter(
    (c) => c.start >= windowStart && c.start < windowEnd - 4,
  )
  const paraTexts = paragraphs.map((p) => norm(p.text))
  const anchors: BrollAnchor[] = []
  let at = 0
  let lastPara = -1
  let rolling = { atSec: 0, sourceSec: windowStart }
  cards.forEach((card, i) => {
    const frames =
      Math.round((Number(card.durationSec) || 0) * FPS) +
      Math.round((Number(card.holdSec) || 0) * FPS) +
      (card.tailSec != null
        ? Math.round(Number(card.tailSec) * FPS)
        : CARD_TAIL_FRAMES) +
      (i === 0 ? Math.round(input.introHoldSec * FPS) : 0)
    // Neither takes backdrop time in the composition: a video card shows its
    // own clip, and a quote opening with its own shot picks it out of the
    // take without advancing it (see bgStartFrames in DevotionalVideo).
    if (card.kind === "video") return
    if (card.kind === "quote-intro" && card.bgStartSec != null) return
    // Counted in whole frames, as the composition does, so no float drift.
    const start = at / FPS
    at += frames
    if (!String(card.kind).startsWith("reflection")) return
    const head = norm(String(card.text ?? "")).slice(0, 40)
    if (!head) return
    // Paragraphs come in order: look forward from the last one first, so a
    // short sentence that also occurs earlier is not sent back there.
    const ahead = paraTexts.findIndex(
      (t, k) => k >= Math.max(0, lastPara) && t.includes(head),
    )
    const para =
      ahead >= 0 ? ahead : paraTexts.findIndex((t) => t.includes(head))
    if (para < 0 || para === lastPara) return
    lastPara = para
    const m = input.pick
      ? input.pick(para)
      : matchCue(paragraphs[para].text, inWindow)
    if (!m) return
    // Where the rolling footage is by now, wrapping as the segments do.
    const windowLen = windowEnd - windowStart
    const ran =
      rolling.sourceSec - windowStart + (start - rolling.atSec) * speed
    const natural = windowStart + (ran % windowLen)
    if (Math.abs(m.cue.start - natural) < 6) return
    // Two paragraphs about the same moment: keep rolling rather than replay
    // footage the viewer saw seconds ago.
    if (m.cue.start >= rolling.sourceSec - 1 && m.cue.start < natural) return
    const anchor = {
      atSec: start,
      sourceSec: m.cue.start,
      why: `paragraph ${para + 1}: ${m.words.join(", ")}`,
    }
    anchors.push(anchor)
    rolling = anchor
  })
  return anchors
}
