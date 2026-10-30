import { StudioProofError } from "@forge/shorts-compositions/studio-proof/manifest"

// Bounded subset of canonical WebVTT: plain timed cues. Reject unsupported markup
// rather than silently inventing/substituting text. No transcription path.
export function parseSourceVtt(
  bytes: Uint8Array,
  range?: { startMs: number; endMs: number },
) {
  if (bytes.byteLength > 1_048_576)
    throw new StudioProofError("Subtitle track too large")
  const text = new TextDecoder()
    .decode(bytes)
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
  if (!text.startsWith("WEBVTT"))
    throw new StudioProofError("Canonical WEBVTT track required")
  const timestamp = (value: string) => {
    const parts = value.split(":").map(Number)
    if (
      parts.length < 2 ||
      parts.length > 3 ||
      parts.some((n) => !Number.isFinite(n))
    )
      throw new StudioProofError("Invalid cue timestamp")
    return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000)
  }
  return text
    .split(/\n\s*\n/)
    .slice(1)
    .flatMap((block) => {
      if (!block.trim() || block.startsWith("NOTE")) return []
      const lines = block.split("\n")
      const index = lines.findIndex((line) => line.includes(" --> "))
      if (index < 0) throw new StudioProofError("Unsupported subtitle block")
      const [start, end] = lines[index]!.split(" --> ")
      const cueText = lines
        .slice(index + 1)
        .join("\n")
        .trim()
      if (!start || !end) throw new StudioProofError("Invalid subtitle timing")
      const startMs = timestamp(start)
      const endMs = timestamp(end.split(" ")[0]!)
      if (range && (endMs <= range.startMs || startMs >= range.endMs)) return []
      if (/[<>]/.test(cueText))
        throw new StudioProofError(
          "Unsupported subtitle markup in selected range",
        )
      return [
        {
          startMs,
          endMs,
          text: cueText,
        },
      ]
    })
}
