import { z } from "zod"

import {
  CARD_TAIL_FRAMES,
  framesFromDurations,
} from "@forge/shorts-compositions/devotional-card-timing"

import type { DevotionalLlm } from "./llm"

/**
 * Cut a finished devotional into vertical shorts (feat-573).
 *
 * Pure planning and manifest building: reads the long-form manifest and the
 * devotional text from a source pack (see source-pack.ts) and decides which
 * stretch of the devotional becomes which short. Rendering lives in
 * `src/scripts/cut-devotional-shorts.ts`.
 *
 * Owner rules (2026-10-01): no added hook, no call to action, no music bed on
 * these shorts; each short is 15 to 45 seconds; a kind the devotional does not
 * have is skipped, never invented. Both film shorts keep the scrolling
 * Scripture captions.
 */

export const SHORT_MIN_SEC = 15
/** A fact short is ONE thought (owner, 2026-10-02: "fifteen seconds is
 *  enough, one short thought that still sounds finished"): the credited
 *  paragraph alone, extended only when it is shorter than this. */
export const FACT_MIN_SEC = 10
export const SHORT_MAX_SEC = 45
const FPS = 30

export type ShortKind =
  | "film-turn"
  | "film-verse"
  | "history"
  | "language"
  | "reflection"
  | "question"

export const SHORT_KINDS: readonly ShortKind[] = [
  "film-turn",
  "film-verse",
  "history",
  "language",
  "reflection",
  "question",
]

/** The fields of a manifest card this module reads. Everything else is copied. */
export type Card = {
  kind: string
  text?: string
  durationSec?: number
  holdSec?: number
  tailSec?: number
  audioFile?: string
  videoFile?: string
  sourceMark?: unknown
  verse?: string
  citation?: string
  subtitles?: Subtitle[]
  [k: string]: unknown
}

export type Subtitle = {
  text: string
  startSec: number
  endSec: number
  words?: number[]
  [k: string]: unknown
}

export type Manifest = {
  cards: Card[]
  introHoldSec?: number
  outroHoldSec?: number
  bgStartOffsetSec?: number
  bgPlaybackRate?: number
  musicFile?: string
  stepRing?: boolean
  [k: string]: unknown
}

export type Paragraph = { text: string; role: string; mark?: unknown }
export type DevotionalText = { reflection?: { paragraphs?: Paragraph[] } }

export type ShortPlan = {
  kind: ShortKind
  /** Long-form card indices the short is built from, in order. */
  cards: number[]
  /** Film shorts: the window of the long-form clip, seconds. */
  film?: { fromSec: number; toSec: number }
  durationSec: number
  /** One line on why this stretch, for shorts.md. */
  why: string
}

export type SkippedShort = { kind: ShortKind; reason: string }

export type CutdownPlan = { shorts: ShortPlan[]; skipped: SkippedShort[] }

/** Choices that need taste, made by a person or a model, not by rules. */
export type CutdownOverrides = {
  /** Reflection run, as paragraph indices (inclusive). */
  reflection?: { from: number; to: number }
  /** The turn of the scene, seconds into the long-form clip. */
  filmTurn?: { fromSec: number; toSec: number; why?: string }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim()

/**
 * Which paragraph each `reflection-focus` card speaks, by walking the cards in
 * order and consuming each paragraph's text sentence by sentence. Cards are
 * one sentence each, cut from the paragraphs in order, so a card's text must
 * be the next piece of the current paragraph. Throws when that fails: a wrong
 * mapping would put the history credit on a short about something else.
 */
export function mapCardsToParagraphs(
  cards: Card[],
  paragraphs: Paragraph[],
): Map<number, number> {
  const out = new Map<number, number>()
  let p = 0
  let rest = norm(paragraphs[0]?.text ?? "")
  cards.forEach((c, i) => {
    if (c.kind !== "reflection-focus") return
    const t = norm(c.text ?? "")
    while (p < paragraphs.length && !rest.startsWith(t)) {
      if (rest.length > 0) {
        throw new Error(
          `card ${i} ("${c.text}") does not continue paragraph ${p} ("${rest.slice(0, 60)}")`,
        )
      }
      p++
      rest = norm(paragraphs[p]?.text ?? "")
    }
    if (p >= paragraphs.length) {
      throw new Error(`card ${i} ("${c.text}") is in no paragraph`)
    }
    out.set(i, p)
    rest = rest.slice(t.length).trim()
  })
  return out
}

/** On-screen seconds of each long-form card, holds and tails included. */
function cardSeconds(m: Manifest): number[] {
  return framesFromDurations(m.cards as never, FPS, CARD_TAIL_FRAMES, 0, 0).map(
    (f) => f.durationInFrames / FPS,
  )
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * Grow a paragraph run outward until it lasts at least `SHORT_MIN_SEC`:
 * forward first (what a fact is FOR comes after it), then back. Stops before
 * passing `SHORT_MAX_SEC` and never crosses into `blocked` paragraphs.
 */
function growRun(
  from: number,
  to: number,
  paraSec: number[],
  blocked: (p: number) => boolean,
  minSec = SHORT_MIN_SEC,
): { from: number; to: number } {
  const len = (a: number, b: number) => sum(paraSec.slice(a, b + 1))
  while (len(from, to) < minSec) {
    const next = to + 1
    if (next < paraSec.length && !blocked(next)) {
      if (len(from, next) > SHORT_MAX_SEC) break
      to = next
      continue
    }
    const prev = from - 1
    if (prev >= 0 && !blocked(prev) && len(prev, to) <= SHORT_MAX_SEC) {
      from = prev
      continue
    }
    break
  }
  return { from, to }
}

// Words that say nothing about WHICH line this is. Matching on them found
// "In the beginning was the Word" in the Prodigal Son.
const STOP = new Set(
  "a an and are as at be but by for from had has have he her him his i in is it its me my no not of on or our she so that the their them then there they this to was we were what when which who will with you your".split(
    " ",
  ),
)
const words = (s: string) =>
  new Set(
    norm(s)
      .split(" ")
      .filter((w) => w && !STOP.has(w)),
  )

/**
 * The film window around the verse the devotional quotes: the cue that shares
 * the most words with it, then whole cues before it until the window is long
 * enough to stand alone, ending half a second after the verse's last cue.
 */
export function verseWindow(
  subtitles: Subtitle[],
  verse: string,
  targetSec = 30,
): { fromSec: number; toSec: number } | null {
  if (subtitles.length === 0) return null
  const v = words(verse)
  const score = (s: Subtitle) =>
    [...words(s.text)].filter((w) => v.has(w)).length
  // A cue belongs to the verse when most of ITS meaningful words are in it.
  const matches = (s: Subtitle) =>
    score(s) >= 2 && score(s) >= 0.6 * words(s.text).size
  let best = 0
  subtitles.forEach((s, i) => {
    if (score(s) > score(subtitles[best])) best = i
  })
  if (!matches(subtitles[best]) || score(subtitles[best]) < 3) return null
  // The verse may run over two cues ("...dead and is alive again! / He was
  // lost and is found!"): take the next one too when it also matches.
  let last = best
  while (last + 1 < subtitles.length && matches(subtitles[last + 1])) last++
  const toSec = subtitles[last].endSec + 0.5
  let first = best
  while (first > 0 && toSec - subtitles[first - 1].startSec <= targetSec)
    first--
  return { fromSec: Math.max(0, subtitles[first].startSec - 0.5), toSec }
}

export function planCutdown(
  manifest: Manifest,
  devo: DevotionalText,
  overrides: CutdownOverrides = {},
): CutdownPlan {
  const shorts: ShortPlan[] = []
  const skipped: SkippedShort[] = []
  const cards = manifest.cards
  const secs = cardSeconds(manifest)
  const paragraphs = devo.reflection?.paragraphs ?? []
  const cardPara = mapCardsToParagraphs(cards, paragraphs)
  const cardsOf = (p: number) =>
    [...cardPara.entries()].filter(([, q]) => q === p).map(([c]) => c)
  const paraSec = paragraphs.map((_, p) => sum(cardsOf(p).map((c) => secs[c])))
  const runCards = (from: number, to: number) =>
    paragraphs.flatMap((_, p) => (p >= from && p <= to ? cardsOf(p) : []))
  const isFact = (p: number) =>
    paragraphs[p].role === "history" || paragraphs[p].role === "language"

  // --- film shorts -------------------------------------------------------
  const filmIdx = cards.findIndex((c) => c.kind === "video")
  const film = cards[filmIdx]
  const scripture = cards.find((c) => c.kind === "scripture")
  const filmShort = (
    kind: ShortKind,
    w: { fromSec: number; toSec: number },
    why: string,
  ) => {
    const len = w.toSec - w.fromSec
    if (len < SHORT_MIN_SEC || len > SHORT_MAX_SEC) {
      skipped.push({ kind, reason: `film window is ${len.toFixed(1)}s` })
    } else {
      shorts.push({ kind, cards: [filmIdx], film: w, durationSec: len, why })
    }
  }
  if (!film) {
    skipped.push({ kind: "film-turn", reason: "no film card" })
    skipped.push({ kind: "film-verse", reason: "no film card" })
  } else {
    if (overrides.filmTurn) {
      const { why, ...w } = overrides.filmTurn
      filmShort(
        "film-turn",
        w,
        why ? `the turn of the scene: ${why}` : "the turn of the scene",
      )
    } else {
      skipped.push({
        kind: "film-turn",
        reason: "needs a chosen window (--film-turn=<from>-<to>)",
      })
    }
    const w =
      scripture?.verse && film.subtitles
        ? verseWindow(film.subtitles, scripture.verse)
        : null
    if (w) {
      filmShort(
        "film-verse",
        w,
        `the film up to the verse the devotional quotes (${scripture?.citation})`,
      )
    } else {
      skipped.push({
        kind: "film-verse",
        reason: "the quoted verse was not found in the film captions",
      })
    }
  }

  // --- fact shorts -------------------------------------------------------
  const factShort = (kind: "history" | "language") => {
    const role = kind
    const withMark = paragraphs.findIndex((p) => p.role === role && p.mark)
    const at =
      withMark >= 0 ? withMark : paragraphs.findIndex((p) => p.role === role)
    if (at < 0) {
      skipped.push({ kind, reason: `the devotional has no ${role} paragraph` })
      return
    }
    // One fact per short: never run into another credited paragraph.
    const run = growRun(
      at,
      at,
      paraSec,
      (p) => p !== at && isFact(p),
      FACT_MIN_SEC,
    )
    const c = runCards(run.from, run.to)
    const len = sum(c.map((i) => secs[i]))
    if (len < FACT_MIN_SEC || len > SHORT_MAX_SEC) {
      skipped.push({ kind, reason: `run is ${len.toFixed(1)}s` })
      return
    }
    shorts.push({
      kind,
      cards: c,
      durationSec: len,
      why:
        run.from === run.to
          ? `${role} paragraph ${at}, one thought with its credit`
          : `${role} paragraph ${at} with its credit, carried to where it lands (paragraphs ${run.from}-${run.to})`,
    })
  }
  factShort("history")
  factShort("language")

  // --- reflection ----------------------------------------------------------
  {
    let run = overrides.reflection
    let why = "chosen reflection run"
    if (!run) {
      // Default: the first run of plain reflection that stands between 15
      // and 45 seconds. The opening picture of a devotional is written to
      // pull a listener in, which is what a short has to do.
      for (let p = 0; p < paragraphs.length && !run; p++) {
        if (isFact(p)) continue
        let to = p
        while (
          sum(paraSec.slice(p, to + 1)) < SHORT_MIN_SEC &&
          to + 1 < paragraphs.length &&
          !isFact(to + 1)
        ) {
          to++
        }
        const len = sum(paraSec.slice(p, to + 1))
        if (len >= SHORT_MIN_SEC && len <= SHORT_MAX_SEC) run = { from: p, to }
      }
      why = "the first stretch of reflection that stands alone"
    }
    if (!run) {
      skipped.push({ kind: "reflection", reason: "no reflection run fits" })
    } else {
      const c = runCards(run.from, run.to)
      const len = sum(c.map((i) => secs[i]))
      if (len < SHORT_MIN_SEC || len > SHORT_MAX_SEC) {
        skipped.push({
          kind: "reflection",
          reason: `run is ${len.toFixed(1)}s`,
        })
      } else {
        shorts.push({
          kind: "reflection",
          cards: c,
          durationSec: len,
          why: `${why} (paragraphs ${run.from}-${run.to})`,
        })
      }
    }
  }

  // --- question ----------------------------------------------------------
  {
    const q = cards.findIndex((c) => c.kind === "questions")
    const concl = cards.findIndex((c) => c.kind === "conclusion")
    if (q < 0) {
      skipped.push({ kind: "question", reason: "no questions card" })
    } else {
      // The closing line sets up the question; the step card ("Let's bring
      // this to God") and the verse between them belong to the long form.
      const c = concl >= 0 ? [concl, q] : [q]
      const len = sum(c.map((i) => secs[i]))
      if (len > SHORT_MAX_SEC) {
        skipped.push({ kind: "question", reason: `${len.toFixed(1)}s` })
      } else {
        shorts.push({
          kind: "question",
          cards: c,
          durationSec: len,
          why: "the closing line, then the question and prayer",
        })
      }
    }
  }

  const order = (k: ShortKind) => SHORT_KINDS.indexOf(k)
  shorts.sort((a, b) => order(a.kind) - order(b.kind))
  return { shorts, skipped }
}

/** Where the shared background stood when each long-form card began. */
export function backgroundStarts(m: Manifest): number[] {
  const frames = framesFromDurations(
    m.cards as never,
    FPS,
    CARD_TAIL_FRAMES,
    Math.round((m.outroHoldSec ?? 8) * FPS),
    Math.round((m.introHoldSec ?? 1) * FPS),
  )
  const rate = m.bgPlaybackRate ?? 1
  let acc = Math.round((m.bgStartOffsetSec ?? 0) * FPS)
  return m.cards.map((c, i) => {
    if (c.kind === "video") return 0
    const start = acc
    acc += frames[i].durationInFrames * rate
    return start / FPS
  })
}

type Mark = { label?: string; source?: string; portrait?: string }
type Callout = { text?: string; highlight?: string }

/**
 * The fact shorts' own layout (rendered by the `devotional-short`
 * composition): history carries its credit on screen; language carries the
 * verse and the word to ring, and its credit goes in the post caption only.
 */
function factLayout(m: Manifest, plan: ShortPlan): Partial<Manifest> {
  const cards = plan.cards.map((i) => m.cards[i])
  if (plan.kind === "history") {
    const mark = cards.find((c) => c.sourceMark)?.sourceMark as Mark | undefined
    return {
      shortFact: {
        layout: "history",
        label: mark?.label ?? "Historical context",
        source: mark?.source ?? "",
        emblem: mark?.portrait === "scroll" ? "scroll" : "book",
      },
    }
  }
  if (plan.kind === "reflection") {
    // Plain reflection carries no credit; a run that quotes a credited
    // source (a commentary paragraph) shows it under the text.
    const mark = cards.find((c) => c.sourceMark)?.sourceMark as Mark | undefined
    return {
      shortFact: {
        layout: "reflection",
        ...(mark
          ? {
              label: mark.label ?? "Commentary",
              source: mark.source ?? "",
              ...(mark.portrait ? { portrait: mark.portrait } : {}),
            }
          : {}),
      },
    }
  }
  if (plan.kind === "language") {
    const callout = cards.find((c) => c.verseCallout)?.verseCallout as
      | Callout
      | undefined
    return {
      shortFact: {
        layout: "language",
        verse: callout?.text ?? "",
        highlight: callout?.highlight ?? "",
      },
    }
  }
  return {}
}

/** The composition a short renders through. */
export function shortComposition(m: Manifest): string {
  return m.shortFact ? "devotional-short" : "devotional"
}

/** Seconds of picture after the last word, before the fade to black. A film
 *  short trims this much extra footage so the film keeps playing (and
 *  sounding) through it rather than freezing. */
export const SHORT_OUTRO_SEC = 1.5

/**
 * The portrait manifest for one short. Same composition, same files, so the
 * text, credits and captions lay out for 9:16 properly instead of being
 * cropped out of the 16:9 video. A film short points at `clip.mp4`, which the
 * caller must trim to `plan.film` first.
 */
export function buildShortManifest(m: Manifest, plan: ShortPlan): Manifest {
  const top: Partial<Manifest> = { ...m }
  delete top.cards
  delete top.musicFile
  const bg = backgroundStarts(m)
  const firstText = plan.cards.find((i) => m.cards[i].kind !== "video")
  const cards = plan.cards.map((i) => {
    const c = { ...m.cards[i] }
    if (c.kind === "video" && plan.film) {
      const { fromSec, toSec } = plan.film
      const shifted = (c.subtitles ?? [])
        .map((s) => ({
          ...s,
          startSec: s.startSec - fromSec,
          endSec: s.endSec - fromSec,
          ...(s.words ? { words: s.words.map((w) => w - fromSec) } : {}),
        }))
        .filter((s) => s.endSec > 0 && s.startSec < toSec - fromSec)
        .map((s) => ({ ...s, startSec: Math.max(0, s.startSec) }))
      // The long-form opening lives on this card (montage, spoken lines,
      // step labels); a short is the scene alone.
      for (const k of [
        "intro",
        "introParts",
        "introKinetic",
        "introShots",
        "introFocus",
        "hookText",
        "mutedLeadSec",
        "steps",
        // The series mark sits at the top instead (owner's Figma 411-2366);
        // the film is credited in the post caption.
        "filmMark",
      ]) {
        delete c[k]
      }
      return {
        ...c,
        videoFile: "clip.mp4",
        durationSec: toSec - fromSec,
        subtitles: shifted,
        // Full frame, the verses scrolling over a dark pool in the middle
        // (owner's Figma "Video clip · Scrolling (vert)", 2026-10-02; the
        // square window with the verses under it was the first try).
        videoFill: "full",
      }
    }
    if (c.kind === "step") delete c.steps
    return c
  })
  // The last sentence would otherwise cut to black on its final word.
  const last = cards[cards.length - 1]
  if (last && last.kind === "reflection-focus") delete last.tailSec
  return {
    ...top,
    cards,
    introHoldSec: 0,
    outroHoldSec: SHORT_OUTRO_SEC,
    // The step clock and the stepper are the long form's map: in a short
    // there is nowhere to navigate.
    stepRing: false,
    // A fact short without its credit would be an unsourced claim.
    portraitMarks: true,
    // Film shorts: the series mark on top, the film's sound to the end.
    ...(plan.film ? { shortForm: true } : {}),
    ...factLayout(m, plan),
    ...(firstText != null ? { bgStartOffsetSec: bg[firstText] } : {}),
  }
}

const FILM_TURN_JSON_SCHEMA = {
  name: "film_turn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["first", "last", "why"],
    properties: {
      first: { type: "integer" },
      last: { type: "integer" },
      why: { type: "string" },
    },
  },
}

export const _internal = { JSON_SCHEMA: FILM_TURN_JSON_SCHEMA }

/** The slice of `DevotionalLlm` this module needs (injected; faked in tests). */
export type TurnPicker = Pick<DevotionalLlm, "complete">

/**
 * Ask a model for the turn of the scene: the stretch of the film where the
 * story changes direction, the part that holds a viewer on its own. Taste is
 * the model's; the rules are code's: the answer must be whole cues, 15 to 45
 * seconds, and not the scene's opening lines. Returns null when the model's
 * pick breaks a rule, so a bad pick is skipped, never rendered.
 */
export async function chooseFilmTurn(
  llm: TurnPicker,
  input: {
    subtitles: Subtitle[]
    title: string
    message?: string
    /** Told why a pick was refused. */
    log?: (msg: string) => void
  },
): Promise<{ fromSec: number; toSec: number; why: string } | null> {
  const subs = input.subtitles
  if (subs.length < 4) return null
  const lines = subs
    .map(
      (s, i) =>
        `${i}. [${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s] ${s.text}`,
    )
    .join("\n")
  const parsed = await llm.complete<{
    first: number
    last: number
    why: string
  }>({
    system:
      "You cut short vertical clips from Bible films for social media. " +
      "Pick the TURN of the scene: the moment the story changes direction, " +
      "a stretch that grips a viewer who has seen nothing else. Never the " +
      "opening lines. Prefer the turn that matches the devotional's message.",
    user:
      `Film scene: ${input.title}\n` +
      (input.message ? `Devotional message: ${input.message}\n` : "") +
      `\nNumbered caption lines with times:\n${lines}\n\n` +
      `Choose the first and last line of the clip. It must run between ` +
      `${SHORT_MIN_SEC} and ${SHORT_MAX_SEC - 5} seconds, start at the start ` +
      `of a sentence and end at the end of one. Answer in one short sentence ` +
      `why (no dashes).`,
    jsonSchema: FILM_TURN_JSON_SCHEMA,
    schema: z.object({
      first: z.number().int(),
      last: z.number().int(),
      why: z.string(),
    }),
    maxTokens: 300,
    temperature: 0.2,
  })
  const { first, last } = parsed
  const refuse = (why: string) => {
    input.log?.(`film turn pick ${first}-${last} refused: ${why}`)
    return null
  }
  if (first < 2) return refuse("it is the scene's opening")
  if (last < first || last >= subs.length) return refuse("not a line range")
  const fromSec = Math.max(0, subs[first].startSec - 0.5)
  // Models judge WHERE the turn is well and its LENGTH badly (Haiku picked
  // the same right moment three times running, 50s long each time). Keep the
  // start, then fit the end to the limits a whole line at a time.
  const end = (i: number) => subs[i].endSec + 0.5
  let to = last
  while (to > first && end(to) - fromSec > SHORT_MAX_SEC) to--
  while (to + 1 < subs.length && end(to) - fromSec < SHORT_MIN_SEC) to++
  const toSec = end(to)
  const len = toSec - fromSec
  if (len < SHORT_MIN_SEC || len > SHORT_MAX_SEC) {
    return refuse(`${len.toFixed(1)}s long even after fitting`)
  }
  if (to !== last)
    input.log?.(`film turn: fitted lines ${first}-${last} to ${first}-${to}`)
  return { fromSec, toSec, why: parsed.why }
}
