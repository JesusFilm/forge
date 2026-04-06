// Subtitle service — fetch and parse VTT subtitles from the Core API.
// Videos already have human-produced subtitles synced from the Core API.
// This service fetches and parses them to plain text for scene analysis.

const VTT_FETCH_TIMEOUT_MS = 15_000

/**
 * Parse VTT content to plain text, stripping timestamps and cue metadata.
 */
export function parseVttToText(vttContent: string): string {
  const lines = vttContent.split("\n")
  const textLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines, WEBVTT header, NOTE blocks, and timestamp lines
    if (trimmed === "") continue
    if (trimmed.startsWith("WEBVTT")) continue
    if (trimmed.startsWith("NOTE")) continue
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
  // Basic URL validation — only fetch from known Core API domain
  const url = new URL(vttUrl)
  if (url.protocol !== "https:" || !url.hostname.endsWith("jesusfilm.org")) {
    throw new Error(`Untrusted subtitle URL: ${vttUrl}`)
  }

  console.log(
    JSON.stringify({
      event: "subtitle_fetch_start",
      url: vttUrl,
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

  const vttContent = await response.text()
  const text = parseVttToText(vttContent)

  console.log(
    JSON.stringify({
      event: "subtitle_fetch_complete",
      url: vttUrl,
      textLength: text.length,
    }),
  )

  return text
}
