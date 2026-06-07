// SYNC: ported from apps/mobile/src/lib/parseVtt.ts, with two TV additions —
// SMPTE-offset normalization (broadcast VTTs that start at 01:00:00 → 0:00)
// and an exported findActiveCue() binary search (the overlay component owns
// the playhead poll, but the lookup is a pure function so it can be tested
// in isolation under jest-expo).

export type VttCue = {
  start: number
  end: number
  text: string
}

function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(":")
  if (parts.length === 3) {
    return (
      parseInt(parts[0], 10) * 3600 +
      parseInt(parts[1], 10) * 60 +
      parseFloat(parts[2])
    )
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1])
  }
  // Unrecognised shape — return NaN (not 0) so the caller's isFinite guard
  // drops the cue instead of letting a malformed timestamp flash at t=0.
  return NaN
}

function stripVttTags(text: string): string {
  // VTT cues can carry inline tags (<b>, <i>, <u>, <v Speaker>, <c.classname>,
  // timing tags like <00:00:01.000>, etc.). Strip them for plain-text rendering.
  // Loop until the string stabilises so a crafted nested tag (e.g.
  // "<scr<script>ipt>") can't survive a single pass — a complete strip, not the
  // one-shot replace CodeQL flags as incomplete multi-character sanitization.
  let out = text
  let prev: string
  do {
    prev = out
    out = out.replace(/<[^>]*>/g, "")
  } while (out !== prev)
  return out
}

// Broadcast/SMPTE VTT files often start their first cue at the one-hour mark
// (01:00:00.000) — an authoring convention where 01:00:00 is "program start".
// Our playhead is media-relative (0:00 is the first frame), so without
// normalization every cue lands an hour late and nothing ever shows. If the
// earliest cue starts at or after one hour, subtract a whole number of hours so
// the first cue lands near zero — only shifting by exact-hour multiples avoids
// corrupting a genuinely long film whose subtitles legitimately pass 01:00:00.
const ONE_HOUR = 3600

function normalizeSmpteOffset(cues: VttCue[]): VttCue[] {
  if (cues.length === 0) return cues
  let earliest = Infinity
  for (const cue of cues) {
    if (cue.start < earliest) earliest = cue.start
  }
  if (earliest < ONE_HOUR) return cues
  const offset = Math.floor(earliest / ONE_HOUR) * ONE_HOUR
  if (offset === 0) return cues
  return cues.map((cue) => ({
    start: cue.start - offset,
    end: cue.end - offset,
    text: cue.text,
  }))
}

export function parseVtt(content: string): VttCue[] {
  const lines = content.split(/\r?\n/)
  const cues: VttCue[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ""
    if (line.includes("-->")) {
      const [startStr, endStr] = line.split("-->")
      if (startStr && endStr) {
        const start = parseTimestamp(startStr.trim())
        // endStr may carry trailing cue settings ("00:00:08.000 line:50%").
        // Trim first, then take the timestamp before any whitespace.
        const endTimestamp = endStr.trim().split(/\s+/)[0] ?? ""
        const end = parseTimestamp(endTimestamp)
        const textLines: string[] = []
        i++
        while (i < lines.length && (lines[i] ?? "").trim() !== "") {
          textLines.push(lines[i] ?? "")
          i++
        }
        // Skip cues with unparseable timestamps (NaN) or non-positive
        // duration — they would never match the playhead and silently
        // suppress otherwise-valid subtitles.
        if (
          textLines.length > 0 &&
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          end > start
        ) {
          cues.push({ start, end, text: stripVttTags(textLines.join("\n")) })
        }
      }
    }
    i++
  }
  return normalizeSmpteOffset(cues)
}

// Cues are sorted by start time. Binary-search the last cue whose start is <= t,
// then check t is still before its (exclusive) end — keeping the poll cheap even
// for a feature-length VTT with hundreds of cues. Exported as a pure function so
// the playhead lookup is unit-testable without a player.
export function findActiveCue(cues: VttCue[], t: number): VttCue | undefined {
  let lo = 0
  let hi = cues.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // `ans` is the last cue that started at or before t — usually the active one.
  // But cues can overlap (a short cue nested in a longer one): the most-recent
  // may have already ended while an earlier, longer cue is still active. Walk
  // back a BOUNDED number of steps to find it. The bound keeps a gap in a long,
  // non-overlapping VTT O(1) instead of scanning to the start of the list.
  for (
    let i = ans, steps = 0;
    i >= 0 && steps < 16 && cues[i].start <= t;
    i--, steps++
  ) {
    if (t < cues[i].end) return cues[i]
  }
  return undefined
}
