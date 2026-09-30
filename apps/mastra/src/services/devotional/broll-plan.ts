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
    "share give gave gift"
  ).split(" "),
)

function stem(w: string): string {
  let s = w
    .toLowerCase()
    .replace(/[’']s$/, "")
    .replace(/[^a-z]/g, "")
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
  cueTokens.forEach((set, i) => {
    const words = [...want].filter((w) => set.has(w))
    const score = words.reduce(
      (s, w) => s + Math.log(cues.length / (df.get(w) ?? 1)),
      0,
    )
    if (!best || score > best.score) best = { cue: cues[i], score, words }
  })
  const b = best as { cue: BrollCue; score: number; words: string[] } | null
  return b && b.score >= minScore ? b : null
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
  const runs = [
    { atSec: 0, sourceSec: windowStart },
    ...input.anchors.filter((a) => a.atSec > 0.5),
  ].sort((a, b) => a.atSec - b.atSec)
  const pieces: { startSec: number; screenSec: number }[] = []
  runs.forEach((run, k) => {
    const until = k + 1 < runs.length ? runs[k + 1].atSec : coverSec + 2
    let screen = until - run.atSec
    let src = Math.min(Math.max(run.sourceSec, windowStart), windowEnd - 1)
    while (screen > 0.01) {
      const fits = (windowEnd - src) / speed
      const take = Math.min(screen, fits)
      pieces.push({ startSec: src, screenSec: take })
      screen -= take
      src = windowStart
    }
  })
  return pieces.map((p, i) => {
    const extra = i + 1 < pieces.length ? dissolveSec : 0
    const lengthSec = Math.min(
      (p.screenSec + extra) * speed,
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
}

const FPS = 30
const TAIL_FRAMES = 24

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
        : TAIL_FRAMES) +
      (i === 0 ? Math.round(input.introHoldSec * FPS) : 0)
    if (card.kind === "video") return
    const start = at
    at += frames / FPS
    if (!String(card.kind).startsWith("reflection")) return
    const head = norm(String(card.text ?? "")).slice(0, 40)
    if (!head) return
    const para = paraTexts.findIndex((t) => t.includes(head))
    if (para < 0 || para === lastPara) return
    lastPara = para
    const m = matchCue(paragraphs[para].text, inWindow)
    if (!m) return
    const natural = rolling.sourceSec + (start - rolling.atSec) * speed
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
