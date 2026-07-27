export const SAFE_DOWNLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
])

export function isAllowedDownloadOrigin(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  if (parsed.protocol !== "https:") return false

  const host = parsed.hostname
  return (
    host === "jesusfilm.org" ||
    host.endsWith(".jesusfilm.org") ||
    host === "stream.mux.com" ||
    host.endsWith(".mux.com")
  )
}
