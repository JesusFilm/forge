import { z } from "zod"
import { openArtifactStream, writeArtifact } from "./storage"
import {
  applyTranscriptScriptureCorrections,
  buildTranscriptCorrectionReport,
} from "./transcript-scripture-correction"
import type { MastraTranscriptScriptureCorrection } from "./mastra-transcript-scripture-correction"
import { segmentsToVTT } from "@/lib/vtt"

const storedTranscript = z
  .object({
    text: z.string().max(8_000_000),
    segments: z
      .array(
        z
          .object({
            start: z.number().nonnegative(),
            end: z.number().nonnegative(),
            text: z.string().max(100_000),
          })
          .passthrough(),
      )
      .max(20_000),
    language: z.string().max(32),
  })
  .passthrough()

/** Applies already-judged candidates only, using canonical Manager artifacts. */
export async function applyStoredTranscriptCorrections(
  assetId: string,
  correction: MastraTranscriptScriptureCorrection,
) {
  const source = await openArtifactStream({
    assetId,
    artifactType: "transcript",
    ext: "json",
  })
  const reader = source.body.getReader()
  const maximum = 16 * 1024 * 1024
  if (source.totalSize > maximum) {
    await reader.cancel().catch(() => {})
    throw new Error("Source transcript too large")
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maximum) {
      await reader.cancel().catch(() => {})
      throw new Error("Source transcript too large")
    }
    chunks.push(value)
  }
  const raw = Buffer.concat(chunks)
  const transcript = storedTranscript.parse(
    JSON.parse(new TextDecoder().decode(raw)),
  )
  const application = applyTranscriptScriptureCorrections({
    ...transcript,
    correction,
  })
  const artifactKeys = ["transcript-correction-report"]
  const write = (artifactType: string, ext: string, body: string) =>
    writeArtifact({
      assetId,
      artifactType,
      ext,
      body,
      contentType: ext === "vtt" ? "text/vtt" : "application/json",
    })
  if (application.changed) {
    await write("transcript-raw", "json", new TextDecoder().decode(raw))
    artifactKeys.push("transcript-raw")
    if (transcript.segments.length) {
      await write("subtitles-raw", "vtt", segmentsToVTT(transcript.segments))
      artifactKeys.push("subtitles-raw")
    }
    await write(
      "transcript",
      "json",
      JSON.stringify({
        ...transcript,
        text: application.text,
        segments: application.segments,
      }),
    )
    artifactKeys.push("transcript")
    if (application.segments.length) {
      await write("subtitles", "vtt", segmentsToVTT(application.segments))
      artifactKeys.push("subtitles")
    }
  }
  await write(
    "transcript-correction-report",
    "json",
    JSON.stringify(buildTranscriptCorrectionReport(application.summary)),
  )
  return {
    artifactKeys,
    summary: application.summary,
    changed: application.changed,
  }
}
