// VTT (WebVTT) parsing and generation utilities.
// Extracted from transcription service for reuse in subtitle translation pipeline.

export type TranscriptSegment = {
  start: number // seconds
  end: number // seconds
  text: string
}

export function parseVTT(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  const lines = vtt.split("\n")
  let i = 0

  // Skip WEBVTT header
  while (i < lines.length && !lines[i]?.includes("-->")) {
    i++
  }

  while (i < lines.length) {
    const line = lines[i]?.trim() ?? ""

    if (line.includes("-->")) {
      const [startStr, endStr] = line.split("-->").map((s) => s.trim())
      const start = parseVTTTime(startStr ?? "")
      const end = parseVTTTime(endStr ?? "")

      // Collect text lines until empty line
      const textLines: string[] = []
      i++
      while (i < lines.length && lines[i]?.trim() !== "") {
        textLines.push(lines[i]?.trim() ?? "")
        i++
      }

      if (
        textLines.length > 0 &&
        Number.isFinite(start) &&
        Number.isFinite(end)
      ) {
        segments.push({ start, end, text: textLines.join(" ") })
      }
    } else {
      i++
    }
  }

  return segments
}

export function parseVTTTime(timeStr: string): number {
  const parts = timeStr.split(":")
  if (parts.length === 3) {
    const [h, m, s] = parts
    return (
      parseInt(h ?? "0") * 3600 + parseInt(m ?? "0") * 60 + parseFloat(s ?? "0")
    )
  }
  if (parts.length === 2) {
    const [m, s] = parts
    return parseInt(m ?? "0") * 60 + parseFloat(s ?? "0")
  }
  return parseFloat(timeStr)
}

export function segmentsToVTT(
  segments: TranscriptSegment[],
  metadata?: { language?: string; assetId?: string },
): string {
  const lines = ["WEBVTT"]

  if (metadata?.language) {
    lines.push(`NOTE language: ${metadata.language}`)
  }
  if (metadata?.assetId) {
    lines.push(`NOTE source: ${metadata.assetId}`)
  }
  lines.push(`NOTE generated: ${new Date().toISOString()}`)
  lines.push("")

  for (const seg of segments) {
    lines.push(formatVTTTime(seg.start) + " --> " + formatVTTTime(seg.end))
    lines.push(seg.text)
    lines.push("")
  }
  return lines.join("\n")
}

export function formatVTTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}
