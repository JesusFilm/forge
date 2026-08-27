import type { TranscriptSegment } from "../../services/subtitle-enrichment/types"

const TIMING_PATTERN = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/
const ENTITY_REPLACEMENTS: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&lrm;": "",
  "&rlm;": "",
}

export type VttCue = TranscriptSegment

export function parseVtt(
  input: string,
  options: { emptyCue?: "skip" | "preserve" | "reject" } = {},
): VttCue[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  if (lines[0]?.trim().split(/\s+/)[0] !== "WEBVTT") {
    throw new Error("VTT is missing the WEBVTT header")
  }

  const cues: VttCue[] = []
  let index = 1
  while (index < lines.length) {
    while (index < lines.length && lines[index]!.trim() === "") index++
    if (index >= lines.length) break

    const firstLine = lines[index]!.trim()
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(firstLine)) {
      index++
      while (index < lines.length && lines[index]!.trim() !== "") index++
      continue
    }

    let timingLine = firstLine
    if (!timingLine.includes("-->")) {
      index++
      timingLine = lines[index]?.trim() ?? ""
    }

    const timing = TIMING_PATTERN.exec(timingLine)
    if (!timing) {
      throw new Error(`Invalid VTT timing line: ${timingLine || "<empty>"}`)
    }
    const start = parseVttTimestamp(timing[1]!)
    const end = parseVttTimestamp(timing[2]!)
    index++

    const textLines: string[] = []
    while (index < lines.length && lines[index]!.trim() !== "") {
      textLines.push(lines[index]!)
      index++
    }

    const text = cleanVttText(textLines.join("\n"))
    if (text.length === 0) {
      if (options.emptyCue === "reject") {
        throw new Error(`VTT cue at ${timing[1]} has no text`)
      }
      if (options.emptyCue !== "preserve") continue
    }
    cues.push({ start, end, text })
  }

  return cues
}

export function parseVttTimestamp(value: string): number {
  const parts = value.replace(",", ".").split(":")
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(`Invalid VTT timestamp: ${value}`)
  }

  const seconds = Number(parts.at(-1))
  const minutes = Number(parts.at(-2))
  const hours = parts.length === 3 ? Number(parts[0]) : 0
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours) ||
    seconds < 0 ||
    seconds >= 60 ||
    minutes < 0 ||
    minutes >= 60 ||
    hours < 0
  ) {
    throw new Error(`Invalid VTT timestamp: ${value}`)
  }
  return hours * 3600 + minutes * 60 + seconds
}

export function cleanVttText(value: string): string {
  let cleaned = value.replace(/<[^>]+>/g, "")
  for (const [entity, replacement] of Object.entries(ENTITY_REPLACEMENTS)) {
    cleaned = cleaned.replaceAll(entity, replacement)
  }
  return cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

export function cropVttCues(
  cues: readonly VttCue[],
  startSeconds: number,
  endSeconds: number,
): VttCue[] {
  return cues
    .filter((cue) => cue.end > startSeconds && cue.start < endSeconds)
    .map((cue) => ({
      start: Math.max(cue.start, startSeconds),
      end: Math.min(cue.end, endSeconds),
      text: cue.text,
    }))
    .filter((cue) => cue.end > cue.start)
}

export function serializeVtt(cues: readonly VttCue[]): string {
  const blocks = cues.map(
    (cue) =>
      `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`,
  )
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`
}

export function formatVttTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000)
  const milliseconds = totalMilliseconds % 1000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`
}
