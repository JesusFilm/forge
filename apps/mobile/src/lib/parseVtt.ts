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
  // Strip VTT inline tags (<b>, <v Speaker>, timing tags, etc.) for plain text.
  // Loop until stable so nested tags ("<scr<script>ipt>") can't survive one pass
  // — a complete strip, not the one-shot replace CodeQL flags as incomplete.
  let out = text
  let prev: string
  do {
    prev = out
    out = out.replace(/<[^>]*>/g, "")
  } while (out !== prev)
  return out
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
  return cues
}
