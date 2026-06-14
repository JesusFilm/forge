import type { TranscriptSegment } from "./types"

export function segmentsToVtt(
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

  for (const segment of segments) {
    lines.push(
      `${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}`,
    )
    lines.push(segment.text)
    lines.push("")
  }

  return lines.join("\n")
}

export function formatVttTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  const milliseconds = Math.floor((seconds % 1) * 1000)
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`
}
