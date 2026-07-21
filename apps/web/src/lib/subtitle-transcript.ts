import type { WatchSubtitle } from "@/lib/content"

export type SubtitleCue = { start: number; end: number; text: string }

export type InitialSubtitleTranscript = {
  vttSrc: string
  compactText: string | null
} | null

export function formatCompactTranscript(cues: SubtitleCue[]): string {
  return cues.map(({ text }) => text).join("\n\n")
}

const TIMING_RE =
  /(?:(\d+):)?(\d+):(\d+)[.,](\d+)\s*-->\s*(?:(\d+):)?(\d+):(\d+)[.,](\d+)/

function toSeconds(
  h: string | undefined,
  m: string,
  s: string,
  ms: string,
): number {
  const hours = h ? parseInt(h, 10) : 0
  return (
    hours * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms.padEnd(3, "0").slice(0, 3), 10) / 1000
  )
}

// Entity map. Single-pass replace so a literal `&amp;lt;` in source decodes
// to `&lt;` (not `<`). Decoding `&amp;` last in a chained `.replace()` would
// double-unescape that case -- see CodeQL js/double-escaping.
const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
}
const HTML_ENTITY_RE = /&(?:amp|lt|gt|quot|#39|nbsp);/g

function decodeEntities(text: string): string {
  return text.replace(HTML_ENTITY_RE, (m) => HTML_ENTITY_MAP[m] ?? m)
}

// Strip VTT/HTML-ish tags. Iterate until the string stabilises so nested or
// overlapping payloads cannot survive a single pass. Output still flows into a
// React text node, so the regex is defense-in-depth over auto-escaped JSX.
function stripTags(text: string): string {
  let prev = ""
  let cur = text
  while (cur !== prev) {
    prev = cur
    cur = cur.replace(/<[^>]*>/g, "")
  }
  return cur
}

/**
 * SMPTE-offset normalization. Broadcast-authored VTT files often start at
 * 01:00:00 (the first hour reserved for color bars / leader), so cues run
 * 01:HH:MM:SS instead of 00:HH:MM:SS. The video file itself plays from 0:00,
 * so the raw cues never line up with `currentTime`. Detect by comparing the
 * last cue's end against the variant duration with a 60s grace; shift by the
 * largest whole-hour offset that brings cues back inside duration.
 */
export function normalizeCueOffset(
  cues: SubtitleCue[],
  durationSeconds: number | null | undefined,
): SubtitleCue[] {
  if (cues.length === 0) return cues
  if (!durationSeconds || durationSeconds <= 0) return cues
  const first = cues[0]!.start
  const last = cues[cues.length - 1]!.end
  if (last <= durationSeconds + 60) return cues
  if (first < 3600) return cues
  const offset = Math.floor(first / 3600) * 3600
  const candidateLast = last - offset
  if (candidateLast < 0 || candidateLast > durationSeconds + 60) return cues
  return cues.map((c) => ({
    start: c.start - offset,
    end: c.end - offset,
    text: c.text,
  }))
}

export function parseVtt(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const normalized = raw.replace(/\r\n?/g, "\n")
  const blocks = normalized.split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0)
    const timingIdx = lines.findIndex((l) => l.includes("-->"))
    if (timingIdx < 0) continue
    const m = lines[timingIdx]!.match(TIMING_RE)
    if (!m) continue
    const start = toSeconds(m[1], m[2]!, m[3]!, m[4]!)
    const end = toSeconds(m[5], m[6]!, m[7]!, m[8]!)
    const textLines = lines.slice(timingIdx + 1)
    const text = decodeEntities(stripTags(textLines.join(" ")).trim())
    if (text) cues.push({ start, end, text })
  }
  return cues
}

export function pickInitialSubtitleSlug(
  subtitles: WatchSubtitle[],
  audioSlug: string | null | undefined,
): string | null {
  if (subtitles.length === 0) return null
  if (audioSlug) {
    const match = subtitles.find((s) => s.language.slug === audioSlug)
    if (match) return match.language.slug
  }
  const primary = subtitles.find((s) => s.primary)
  if (primary) return primary.language.slug
  const human = subtitles.find((s) => !s.aiGenerated)
  if (human) return human.language.slug
  return subtitles[0]!.language.slug
}

export function filterTranscriptSubtitlesForAudio(
  subtitles: WatchSubtitle[],
  audioSlug: string | null | undefined,
): WatchSubtitle[] {
  if (!audioSlug) return subtitles
  return subtitles.filter((s) => s.language.slug === audioSlug)
}
