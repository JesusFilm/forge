// Transcription service — generates transcripts from Mux's built-in subtitles.
// Uses Mux's generated_subtitles feature — no OpenRouter fallback.
// OpenRouter does not expose a Whisper transcription endpoint.

import { getMux } from "@/services/mux"
import { writeArtifact } from "@/services/storage"

export type TranscriptSegment = {
  start: number
  end: number
  text: string
}

export type TranscriptionResult = {
  text: string
  segments: TranscriptSegment[]
  language: string
}

// Retrieve Mux-generated subtitles and parse into transcript.
export async function transcribe(
  assetId: string,
  muxAssetId: string,
  language = "en",
): Promise<TranscriptionResult> {
  const result = await transcribeViaMux(muxAssetId, language)

  await writeArtifact({
    assetId,
    artifactType: "transcript",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  if (result.segments.length > 0) {
    const vtt = segmentsToVTT(result.segments)
    await writeArtifact({
      assetId,
      artifactType: "subtitles",
      ext: "vtt",
      body: vtt,
      contentType: "text/vtt",
    })
  }

  return result
}

async function transcribeViaMux(
  muxAssetId: string,
  language: string,
): Promise<TranscriptionResult> {
  const asset = await getMux().video.assets.retrieve(muxAssetId)
  const track = asset.tracks?.find(
    (t) => t.type === "text" && t.text_type === "subtitles",
  )

  if (!track?.id) {
    throw new Error(
      `No subtitle track found for Mux asset ${muxAssetId}. ` +
        "Ensure the asset was created with generated_subtitles enabled.",
    )
  }

  // Fetch the subtitle track content from Mux
  const playbackId = asset.playback_ids?.[0]?.id
  if (!playbackId) {
    throw new Error(`No playback ID found for Mux asset ${muxAssetId}`)
  }

  const vttUrl = `https://stream.mux.com/${playbackId}/text/${track.id}.vtt`
  const response = await fetch(vttUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch subtitle track: ${response.status} ${response.statusText}`,
    )
  }

  const vttContent = await response.text()
  const segments = parseVTT(vttContent)
  const text = segments.map((s) => s.text).join(" ")

  return {
    text,
    segments,
    language: track.language_code ?? language,
  }
}

function parseVTT(vtt: string): TranscriptSegment[] {
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

      if (textLines.length > 0) {
        segments.push({ start, end, text: textLines.join(" ") })
      }
    } else {
      i++
    }
  }

  return segments
}

function parseVTTTime(timeStr: string): number {
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

function segmentsToVTT(segments: TranscriptSegment[]): string {
  const lines = ["WEBVTT", ""]
  for (const seg of segments) {
    lines.push(formatVTTTime(seg.start) + " --> " + formatVTTTime(seg.end))
    lines.push(seg.text)
    lines.push("")
  }
  return lines.join("\n")
}

function formatVTTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}
