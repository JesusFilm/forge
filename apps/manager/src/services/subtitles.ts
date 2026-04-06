// Subtitle service — fetch and parse VTT subtitles from the Core API.
// Videos already have human-produced subtitles synced from the Core API.
// This service fetches and parses them to plain text for scene analysis.

const VTT_FETCH_TIMEOUT_MS = 15_000
const VTT_MAX_BYTES = 5 * 1024 * 1024 // 5MB — generous limit for a VTT file

/**
 * Parse VTT content to plain text, stripping timestamps, cue metadata,
 * and NOTE blocks (which can span multiple lines until the next blank line).
 */
export function parseVttToText(vttContent: string): string {
  const lines = vttContent.split("\n")
  const textLines: string[] = []
  let inNoteBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    // NOTE blocks span until the next blank line
    if (trimmed.startsWith("NOTE")) {
      inNoteBlock = true
      continue
    }
    if (trimmed === "") {
      inNoteBlock = false
      continue
    }
    if (inNoteBlock) continue

    // Skip WEBVTT header and metadata
    if (trimmed.startsWith("WEBVTT")) continue
    if (trimmed.startsWith("Kind:")) continue
    if (trimmed.startsWith("Language:")) continue
    if (/^\d+$/.test(trimmed)) continue // cue index numbers
    if (/^\d{2}:\d{2}/.test(trimmed) && trimmed.includes("-->")) continue // timestamps

    // Strip inline VTT tags like <v Speaker>, <c>, etc.
    const cleaned = trimmed.replace(/<[^>]+>/g, "")
    if (cleaned) textLines.push(cleaned)
  }

  return textLines.join(" ")
}

/**
 * Fetch a VTT file from the Core API and parse it to plain text.
 */
export async function fetchSubtitleText(vttUrl: string): Promise<string> {
  // SSRF protection — only fetch from known JesusFilm domains
  const url = new URL(vttUrl)
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "jesusfilm.org" &&
      !url.hostname.endsWith(".jesusfilm.org"))
  ) {
    throw new Error(`Untrusted subtitle URL hostname: ${url.hostname}`)
  }

  console.log(
    JSON.stringify({
      event: "subtitle_fetch_start",
      host: url.hostname,
      path: url.pathname,
    }),
  )

  const response = await fetch(vttUrl, {
    signal: AbortSignal.timeout(VTT_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch subtitle: ${response.status} ${response.statusText}`,
    )
  }

  // Response size guard — prevent OOM from unexpectedly large responses
  const contentLength = response.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > VTT_MAX_BYTES) {
    throw new Error(
      `Subtitle response too large: ${contentLength} bytes (max ${VTT_MAX_BYTES})`,
    )
  }

  const vttContent = await response.text()

  if (vttContent.length > VTT_MAX_BYTES) {
    throw new Error(
      `Subtitle content too large: ${vttContent.length} bytes (max ${VTT_MAX_BYTES})`,
    )
  }

  const text = parseVttToText(vttContent)

  console.log(
    JSON.stringify({
      event: "subtitle_fetch_complete",
      host: url.hostname,
      textLength: text.length,
    }),
  )

  return text
}
