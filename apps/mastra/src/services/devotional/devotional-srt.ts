/**
 * SubRip (.srt) subtitles for a rendered long-form devotional, built from its
 * manifest alone (no re-render). YouTube cannot read the captions burned into
 * the picture; an uploaded .srt is searchable and auto-translatable.
 *
 * Timeline: cards are laid out exactly as the composition does
 * (`framesFromDurations` in packages/shorts-compositions/src/devotional/
 * timing.ts): each card runs its audio length + holdSec + tail (tailSec, else
 * 24 frames), the first card adds introHoldSec and the last outroHoldSec.
 * Narration word times are relative to their card's audio, which starts on the
 * card's first frame; a step card's words sit after its `stepLeadSec` (the
 * silence baked into the step audio after synthesis). The film's own lines
 * come from the video card's `subtitles`, already on the card's clock.
 */

export type SrtWord = { word: string; startSec: number; endSec: number }

export type SrtManifestCard = {
  kind: string
  durationSec?: number
  holdSec?: number
  tailSec?: number
  stepLeadSec?: number
  text?: string
  verse?: string
  words?: SrtWord[]
  subtitles?: {
    text: string
    startSec: number
    endSec: number
    words?: number[]
  }[]
  // questions card
  questions?: string[]
  prayer?: string
  askLabel?: string
  prayLabel?: string
  questionAtSec?: number
  prayerAtSec?: number
  prayerTextAtSec?: number
}

export type SrtManifest = {
  cards: SrtManifestCard[]
  introHoldSec?: number
  outroHoldSec?: number
}

export type SrtCue = { startSec: number; endSec: number; text: string }

export const SRT_LINE_CHARS = 42
export const SRT_MAX_CUE_SEC = 6

const FPS = 30
const CARD_TAIL_FRAMES = 24
const OUTRO_HOLD_FRAMES = 240
const INTRO_HOLD_FRAMES = 30

/** Card start times (s), the composition's framesFromDurations. */
export function cardStarts(m: SrtManifest, fps = FPS): number[] {
  const intro =
    m.introHoldSec != null
      ? Math.round(m.introHoldSec * fps)
      : INTRO_HOLD_FRAMES
  const outro =
    m.outroHoldSec != null
      ? Math.round(m.outroHoldSec * fps)
      : OUTRO_HOLD_FRAMES
  let from = 0
  const last = m.cards.length - 1
  return m.cards.map((c, i) => {
    const start = from / fps
    from += Math.max(
      1,
      Math.round((c.durationSec ?? 0) * fps) +
        Math.round((c.holdSec ?? 0) * fps) +
        (c.tailSec != null ? Math.round(c.tailSec * fps) : CARD_TAIL_FRAMES) +
        (i === 0 ? intro : 0) +
        (i === last ? outro : 0),
    )
    return start
  })
}

/** Words of `text` spread over [from, to], each weighted by its length. */
export function spreadWords(text: string, from: number, to: number): SrtWord[] {
  const ws = text.split(/\s+/).filter(Boolean)
  const total = ws.reduce((n, w) => n + w.length + 1, 0)
  let at = from
  return ws.map((w) => {
    const len = ((to - from) * (w.length + 1)) / Math.max(1, total)
    const out = { word: w, startSec: at, endSec: at + len }
    at += len
    return out
  })
}

/** Every spoken word on the video's clock, in order. Film lines become
 *  "phrases" kept whole (their words carry only start times). */
function timedWords(m: SrtManifest): SrtWord[] {
  const starts = cardStarts(m)
  const out: SrtWord[] = []
  m.cards.forEach((c, i) => {
    const t0 = starts[i]
    const lead = c.kind === "step" ? (c.stepLeadSec ?? 0) : 0
    if (c.words?.length) {
      for (const w of c.words)
        out.push({
          word: w.word,
          startSec: t0 + lead + w.startSec,
          endSec: t0 + lead + w.endSec,
        })
    } else if (c.kind === "questions" && c.questions?.length) {
      const dur = c.durationSec ?? 0
      const q = c.questionAtSec ?? 0
      const p = c.prayerAtSec ?? dur
      const pt = c.prayerTextAtSec ?? p
      if (c.askLabel && q > 0.3)
        out.push(...spreadWords(`${c.askLabel}:`, t0, t0 + q - 0.2))
      out.push(...spreadWords(c.questions.join(" "), t0 + q, t0 + p - 0.3))
      if (c.prayLabel && pt - p > 0.3)
        out.push(...spreadWords(`${c.prayLabel}:`, t0 + p, t0 + pt - 0.2))
      if (c.prayer) out.push(...spreadWords(c.prayer, t0 + pt, t0 + dur))
    } else if (c.text && c.durationSec) {
      out.push(...spreadWords(c.text, t0, t0 + c.durationSec))
    }
    for (const s of c.subtitles ?? []) {
      const ws = s.text.split(/\s+/).filter(Boolean)
      ws.forEach((w, k) => {
        const st =
          s.words?.[k] ?? s.startSec + ((s.endSec - s.startSec) * k) / ws.length
        const nx =
          s.words?.[k + 1] ??
          s.startSec + ((s.endSec - s.startSec) * (k + 1)) / ws.length
        out.push({
          word: w,
          startSec: t0 + st,
          endSec: t0 + (k === ws.length - 1 ? s.endSec : nx),
        })
      })
    }
  })
  return out.sort((a, b) => a.startSec - b.startSec)
}

/** Wrap into at most two lines of `max` chars, broken near the middle. */
export function wrapTwoLines(text: string, max = SRT_LINE_CHARS): string {
  if (text.length <= max) return text
  const words = text.split(" ")
  let best = -1
  let bestScore = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ")
    const b = words.slice(i).join(" ")
    if (a.length > max || b.length > max) continue
    const score =
      Math.abs(a.length - b.length) - (/[,;:]$/.test(words[i - 1]) ? 14 : 0)
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return best < 0
    ? text
    : `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`
}

/**
 * Group words into cues: two lines of ~42 chars at most, no cue over ~6 s, a
 * new cue after a sentence end or a pause over 0.7 s. Each cue ends with its
 * last word (plus a beat), never into the next cue.
 */
export function buildCues(words: SrtWord[]): SrtCue[] {
  const cues: SrtCue[] = []
  let cur: SrtWord[] = []
  const flush = () => {
    if (!cur.length) return
    cues.push({
      startSec: cur[0].startSec,
      endSec: cur[cur.length - 1].endSec,
      text: cur.map((w) => w.word).join(" "),
    })
    cur = []
  }
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1]
      const text = [...cur, w].map((x) => x.word).join(" ")
      const tooLong =
        text.length > SRT_LINE_CHARS * 2 ||
        wrapTwoLines(text)
          .split("\n")
          .some((l) => l.length > SRT_LINE_CHARS)
      const tooSlow = w.endSec - cur[0].startSec > SRT_MAX_CUE_SEC
      const pause = w.startSec - prev.endSec > 0.7
      const sentence = /[.!?]["”’)]?$/.test(prev.word) && text.length > 18
      if (tooLong || tooSlow || pause || sentence) flush()
    }
    cur.push(w)
  }
  flush()
  return cues.map((c, i) => {
    const next = cues[i + 1]?.startSec ?? Infinity
    return {
      ...c,
      endSec: Math.max(
        c.startSec + 0.6,
        Math.min(c.endSec + 0.25, next - 0.04),
      ),
      text: wrapTwoLines(c.text),
    }
  })
}

/** Remove [from, to) ranges (edits made after the render) and shift later cues. */
export function applyCuts(
  cues: SrtCue[],
  cuts: { fromSec: number; toSec: number }[],
): SrtCue[] {
  const sorted = [...cuts].sort((a, b) => a.fromSec - b.fromSec)
  const shift = (t: number) =>
    sorted.reduce((s, c) => (t >= c.toSec ? s + (c.toSec - c.fromSec) : s), 0)
  return cues
    .filter(
      (c) =>
        !sorted.some((k) => c.startSec >= k.fromSec && c.startSec < k.toSec),
    )
    .map((c) => {
      const end = sorted.reduce(
        (e, k) => (c.startSec < k.fromSec && e > k.fromSec ? k.fromSec : e),
        c.endSec,
      )
      return {
        ...c,
        startSec: c.startSec - shift(c.startSec),
        endSec: end - shift(c.startSec),
      }
    })
}

/** No em/en dashes in our copy (house rule): a range dash becomes a hyphen,
 *  a dash between words a comma. */
export function noDashes(text: string): string {
  return text.replace(/(\S)[–—](\S)/g, "$1-$2").replace(/\s+[–—]\s+/g, ", ")
}

function stamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function toSrt(cues: SrtCue[]): string {
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${stamp(c.startSec)} --> ${stamp(c.endSec)}\n${noDashes(c.text)}`,
      )
      .join("\n\n") + "\n"
  )
}

/** The whole path: manifest → cues (with optional post-render cuts) → .srt. */
export function manifestToSrt(
  m: SrtManifest,
  cuts: { fromSec: number; toSec: number }[] = [],
): string {
  return toSrt(applyCuts(buildCues(timedWords(m)), cuts))
}
