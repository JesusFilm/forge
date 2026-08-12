/**
 * Align a video-card clip window to a language's SUBTITLE cue boundaries.
 *
 * The curated windows in jesus-film-passages are tuned to the ENGLISH film's
 * sentence timing (whisper-verified). A dubbed language (e.g. Russian) says the
 * same scene with different word timing, so the same seconds cut mid-sentence.
 * Arclight ships per-language subtitle tracks (.srt/.vtt) with exact timing;
 * snapping the window to the nearest cue start/end makes the clip begin and end
 * on clean sentence boundaries in that language.
 *
 * Best-effort: if subtitles are missing or unparseable, callers fall back to the
 * curated (English-timed) window.
 */

const FETCH_TIMEOUT_MS = 15_000

export type SubtitleCue = { start: number; end: number; text: string }

/** "HH:MM:SS,mmm" (srt) or "HH:MM:SS.mmm" / "MM:SS.mmm" (vtt) → seconds. */
function timeToSeconds(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/)
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

/** Parse .srt or .vtt into cues (format auto-detected by the arrow line). */
export function parseSubtitles(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = raw.replace(/\r/g, "").replace(/^WEBVTT.*?\n/s, "").split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.trim().split("\n")
    const arrowIdx = lines.findIndex((l) => l.includes("-->"))
    if (arrowIdx === -1) continue
    const [a, b] = lines[arrowIdx].split("-->")
    const start = timeToSeconds(a ?? "")
    // The end side may carry cue settings after the time (vtt) and leading space.
    const end = timeToSeconds((b ?? "").trim().split(/\s+/)[0] ?? "")
    if (start == null || end == null) continue
    const text = lines
      .slice(arrowIdx + 1)
      .join(" ")
      .trim()
    cues.push({ start, end, text })
  }
  return cues.sort((x, y) => x.start - y.start)
}

export type AlignedWindow = { startSec: number; lengthSec: number }

/** True if the text ends a sentence (allowing trailing quotes/brackets). */
function endsSentence(text: string): boolean {
  return /[.!?…][»"')\]]*\s*$/.test(text.trim())
}

/**
 * Snap [desiredStart, desiredStart+desiredLen] to SENTENCE boundaries so the
 * clip begins and ends on a whole thought. A cue starts a sentence if it is the
 * first cue or the previous cue ended one; a cue ends a sentence if its text
 * ends with sentence punctuation. We snap the start to the latest sentence-start
 * at/just before desiredStart, and the end to the latest sentence-end
 * at/just before desiredEnd — falling back to plain cue boundaries, then to the
 * raw window. Returns null if the result is shorter than `minLengthSec`, so the
 * caller falls back to the full curated (English-timed) window instead of
 * airing a too-short clip.
 *
 * Owner rule: 30s floor — the video card must show enough of the scene to be
 * understood as a story, not just illustrate a single verse. A dubbed
 * language's sentence boundaries can otherwise snap to a single short cue
 * (observed: 12–15s on "Jesus Feeds 5,000") well under the curated window.
 */
export function alignWindow(
  cues: SubtitleCue[],
  desiredStart: number,
  desiredLen: number,
  minLengthSec = 30,
): AlignedWindow | null {
  if (cues.length === 0) return null
  const desiredEnd = desiredStart + desiredLen
  const tol = 1.5

  const startsSentence = (i: number): boolean =>
    i === 0 || endsSentence(cues[i - 1].text)

  // Start: latest SENTENCE-start ≤ desiredStart+tol; else latest cue start; else raw.
  let start = desiredStart
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].start > desiredStart + tol) break
    if (startsSentence(i)) start = cues[i].start
  }
  if (start === desiredStart) {
    const cue = [...cues].reverse().find((c) => c.start <= desiredStart + tol)
    if (cue) start = cue.start
  }

  // End: latest SENTENCE-end ≤ desiredEnd+tol; else latest cue end; else raw.
  let end = desiredEnd
  const sentenceEnd = [...cues]
    .reverse()
    .find((c) => c.end <= desiredEnd + tol && c.end > start && endsSentence(c.text))
  if (sentenceEnd) {
    end = sentenceEnd.end
  } else {
    const cue = [...cues]
      .reverse()
      .find((c) => c.end <= desiredEnd + tol && c.end > start)
    if (cue) end = cue.end
  }

  const lengthSec = end - start
  if (lengthSec < minLengthSec) return null
  return { startSec: Math.max(0, start), lengthSec }
}

export type ClipSegment = { startSec: number; lengthSec: number }

export type GapRemovalOptions = {
  /** Gaps shorter than this are left alone — a normal dramatic pause, not
   *  dead air. Owner rule: 10s (a 6.2s gap must NOT be cut). */
  minGapSec?: number
  /** Kept after the preceding line ends, before the cut. Owner: "секунду-две". */
  trailingBufferSec?: number
  /** Kept before the next line begins, after the cut. Owner: "несколько секунд". */
  leadingBufferSec?: number
  /** Ceiling on how much of a qualifying gap survives, in seconds, measured
   *  from right after the preceding line (overrides `trailingBufferSec` for
   *  gaps that qualify for cutting). A gap shorter than this isn't trimmed at
   *  all — only the excess beyond the cap is cut. Omit for the old
   *  behavior (trim straight down to `trailingBufferSec`). Use this for a
   *  scene where the silence itself is content (e.g. a storm visibly
   *  building) but a full, uncapped gap plays too long — a middle ground
   *  between "cut to a tiny bridge" and "keep the whole thing". */
  maxGapSec?: number
}

/**
 * Within an already-aligned [windowStart, windowStart+windowLen] window, cut
 * out any SILENT gap (no cue) of at least `minGapSec`, leaving a natural
 * buffer on each side rather than a word-to-word splice. Returns the pieces
 * to concatenate — `[{ startSec: windowStart, lengthSec: windowLen }]`
 * unchanged when no gap qualifies.
 *
 * Owner rule (established on "Jesus Feeds 5,000", RU + EN dubs): curated
 * windows are seeded WIDE — from the scene's setup dialogue, not just the
 * verse's key moment — so the video shows a whole story, not an
 * illustration. This function automatically trims the resulting dead air
 * back down, per language (a dub's pause timing differs from English), so
 * the rule applies to every devotional without a hand-edited cut list.
 */
export function removeInternalGaps(
  cues: SubtitleCue[],
  windowStart: number,
  windowLen: number,
  opts: GapRemovalOptions = {},
): ClipSegment[] {
  const minGapSec = opts.minGapSec ?? 10
  const trailingBufferSec = opts.trailingBufferSec ?? 1.5
  const leadingBufferSec = opts.leadingBufferSec ?? 3
  // Default (no cap) keeps only the tiny trailing bumper, same as before —
  // `maxGapSec` widens that to keep a longer, deliberate slice of the gap.
  const keepSec = opts.maxGapSec ?? trailingBufferSec
  const windowEnd = windowStart + windowLen
  const whole = [{ startSec: windowStart, lengthSec: windowLen }]

  const inWindow = cues
    .filter((c) => c.end > windowStart && c.start < windowEnd)
    .sort((a, b) => a.start - b.start)
  if (inWindow.length === 0) return whole

  const segments: ClipSegment[] = []
  let segStart = windowStart
  let prevEnd = windowStart
  for (const cue of inWindow) {
    const gap = cue.start - prevEnd
    if (gap >= minGapSec) {
      const keepUntil = Math.min(prevEnd + keepSec, cue.start)
      if (keepUntil > segStart) {
        segments.push({ startSec: segStart, lengthSec: keepUntil - segStart })
      }
      segStart = Math.max(cue.start - leadingBufferSec, keepUntil)
    }
    prevEnd = Math.max(prevEnd, cue.end)
  }
  if (windowEnd > segStart) {
    segments.push({ startSec: segStart, lengthSec: windowEnd - segStart })
  }
  return segments.length ? segments : whole
}

/**
 * Find the ACT BREAK inside an aligned window: the single longest silent
 * stretch, which in a film scene is the transition between beats (in the
 * Zacchaeus clip, the 16.1s walk from the tree to the house, between Jesus
 * calling him down and Zacchaeus pledging restitution).
 *
 * This is the same signal `removeInternalGaps` uses, read differently: a
 * SHORT gap is dead air to cut, the LONGEST gap is where the scene turns.
 * Returns the source-time seconds at which act 2 should start (the next cue,
 * minus a lead-in buffer), or null when no gap is long enough to be a real
 * beat change.
 */
export function findActBreak(
  cues: SubtitleCue[],
  windowStart: number,
  windowLen: number,
  minBreakSec = 8,
  leadingBufferSec = 3,
): { act1EndSec: number; act2StartSec: number } | null {
  const windowEnd = windowStart + windowLen
  const inWindow = cues
    .filter((c) => c.end > windowStart && c.start < windowEnd)
    .sort((a, b) => a.start - b.start)
  if (inWindow.length < 2) return null

  // Pick the qualifying gap CLOSEST TO THE MIDDLE of the window, not the
  // longest one. On the Zacchaeus clip the longest gap (20.8s) sits after the
  // pledge, which put the tree, the call AND the pledge all in act 1 and left
  // only the crowd's reaction for act 2 — so the second half of the
  // reflection commented on something the viewer had already seen. The 16.1s
  // gap nearer the middle is the real beat change (Jesus calls | Zacchaeus
  // responds) and gives two acts of comparable weight.
  const windowMid = windowStart + windowLen / 2
  let best: {
    distance: number
    gap: number
    prevEnd: number
    nextStart: number
  } | null = null
  let prevEnd = inWindow[0].end
  for (const cue of inWindow.slice(1)) {
    const gap = cue.start - prevEnd
    if (gap >= minBreakSec) {
      const distance = Math.abs((prevEnd + cue.start) / 2 - windowMid)
      if (!best || distance < best.distance) {
        best = { distance, gap, prevEnd, nextStart: cue.start }
      }
    }
    prevEnd = Math.max(prevEnd, cue.end)
  }
  if (!best) return null
  return {
    // Keep a beat of silence after the last line of act 1 so it doesn't cut
    // on the word; start act 2 slightly before its first line for the same
    // reason at the other end.
    act1EndSec: Math.min(best.prevEnd + 1.5, best.nextStart),
    act2StartSec: Math.max(best.nextStart - leadingBufferSec, best.prevEnd),
  }
}

export type FetchAlignedDeps = { fetchFn?: typeof fetch }

/** Fetch a subtitle track and align the window. Best-effort → null on any failure. */
export async function fetchAlignedWindow(
  subtitleUrl: string,
  desiredStart: number,
  desiredLen: number,
  deps: FetchAlignedDeps = {},
): Promise<AlignedWindow | null> {
  const fetchFn = deps.fetchFn ?? fetch
  try {
    const r = await fetchFn(subtitleUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const cues = parseSubtitles(await r.text())
    return alignWindow(cues, desiredStart, desiredLen)
  } catch {
    return null
  }
}

export type EditedWindow = AlignedWindow & {
  /** Pieces to concatenate — a single entry (the whole window) when no
   *  qualifying gap was found. */
  segments: ClipSegment[]
  /** Every parsed cue from the track (SOURCE timings), so the caller can
   *  remap them onto the edited clip with `mapCuesToEditedTimeline`. */
  cues: SubtitleCue[]
}

/** A caption timed against the FINAL, edited clip (gaps cut, speed applied). */
export type TimedCaption = { text: string; startSec: number; endSec: number }

/**
 * Remap subtitle cues from SOURCE film time onto the edited clip's timeline.
 *
 * The clip the viewer sees is not a straight slice: `removeInternalGaps` may
 * have cut dead air out of the middle (so later cues shift EARLIER by the
 * removed amount), and the whole thing is sped up (`speed`, pitch-preserved),
 * which compresses every timestamp. Captions must follow both or they drift
 * out of sync with the mouths on screen.
 *
 * Cues outside the kept segments are dropped; a cue straddling a cut is
 * clipped to the part that survives. Pure.
 */
export function mapCuesToEditedTimeline(
  cues: SubtitleCue[],
  segments: ReadonlyArray<ClipSegment>,
  speed = 1,
  minDurationSec = 0.25,
): TimedCaption[] {
  const out: TimedCaption[] = []
  let elapsed = 0 // edited-timeline seconds consumed by earlier segments
  for (const seg of segments) {
    const segEnd = seg.startSec + seg.lengthSec
    for (const cue of cues) {
      // Overlap of the cue with THIS segment, in source time.
      const from = Math.max(cue.start, seg.startSec)
      const to = Math.min(cue.end, segEnd)
      if (to - from < minDurationSec) continue
      const text = cue.text.trim()
      if (!text) continue
      out.push({
        text,
        startSec: (elapsed + (from - seg.startSec)) / speed,
        endSec: (elapsed + (to - seg.startSec)) / speed,
      })
    }
    elapsed += seg.lengthSec
  }
  return out.sort((a, b) => a.startSec - b.startSec)
}

/**
 * Fetch a subtitle track, align the window to sentence boundaries, and cut
 * any dead-air gap within it (see `removeInternalGaps`). Best-effort → null
 * on any failure or if the aligned window itself doesn't meet `minLengthSec`.
 * This is the single entry point the render pipeline uses to go from a
 * curated (English-timed) seed window to a per-language, pause-trimmed clip.
 */
export async function fetchEditedWindow(
  subtitleUrl: string,
  desiredStart: number,
  desiredLen: number,
  deps: FetchAlignedDeps = {},
  gapOpts: GapRemovalOptions = {},
): Promise<EditedWindow | null> {
  const fetchFn = deps.fetchFn ?? fetch
  try {
    const r = await fetchFn(subtitleUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const cues = parseSubtitles(await r.text())
    const aligned = alignWindow(cues, desiredStart, desiredLen)
    if (!aligned) return null
    const segments = removeInternalGaps(
      cues,
      aligned.startSec,
      aligned.lengthSec,
      gapOpts,
    )
    return { ...aligned, segments, cues }
  } catch {
    return null
  }
}
