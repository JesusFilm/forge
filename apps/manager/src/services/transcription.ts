// Transcription service — generates transcripts from Mux's built-in subtitles.
// Uses Mux's generated_subtitles feature — no OpenRouter fallback.
// OpenRouter does not expose a Whisper transcription endpoint.

import { getMux } from "@/services/mux"
import { writeArtifact } from "@/services/storage"
import { parseVTT, segmentsToVTT, type TranscriptSegment } from "@/lib/vtt"

export type { TranscriptSegment }

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
