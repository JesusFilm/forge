export class StudioHlsError extends Error {}
export type StudioHlsSegment = {
  url: string
  duration: number
  startMs: number
  endMs: number
}

export function studioHlsRendition(
  master: string,
  base: string,
  target: number,
  exact: boolean,
) {
  const lines = master.trim().split(/\r?\n/),
    choices: { url: string; height: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const resolution = lines[i]!.match(
      /^#EXT-X-STREAM-INF:.*RESOLUTION=(\d+)x(\d+)/,
    )
    if (resolution && lines[i + 1] && !lines[i + 1]!.startsWith("#"))
      choices.push({
        url: new URL(lines[i + 1]!, base).href,
        height: Number(resolution[2]),
      })
  }
  const selected = exact
    ? choices.find((c) => c.height === target)
    : (choices
        .filter((c) => c.height <= target)
        .sort((a, b) => b.height - a.height)[0] ??
      choices.sort((a, b) => a.height - b.height)[0])
  if (!selected)
    throw new StudioHlsError("The admitted source rendition is unavailable")
  return selected
}
export function studioHlsSegments(text: string, base: string) {
  if (
    /#EXT-X-(KEY|MAP|BYTERANGE|DISCONTINUITY|MEDIA)(?::|\r?$)/m.test(text) ||
    !text.includes("#EXT-X-ENDLIST")
  )
    throw new StudioHlsError(
      "Unsupported HLS structure; select another catalog source",
    )
  const lines = text.trim().split(/\r?\n/)
  let elapsed = 0
  const all: StudioHlsSegment[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith("#EXTINF:")) continue
    const duration = Number(lines[i]!.slice(8).split(",")[0])
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 30 ||
      !lines[i + 1] ||
      lines[i + 1]!.startsWith("#")
    )
      throw new StudioHlsError("Invalid HLS segment")
    const segment = {
      url: new URL(lines[i + 1]!, base).href,
      duration,
      startMs: elapsed,
      endMs: elapsed + duration * 1000,
    }
    elapsed = segment.endMs
    all.push(segment)
  }
  if (!all.length) throw new StudioHlsError("Empty HLS playlist")
  return all
}
