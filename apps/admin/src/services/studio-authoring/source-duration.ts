import {
  studioHlsRendition,
  studioHlsSegments,
} from "@forge/studio-contracts/hls"
import { StudioCommandError } from "./errors"

/** Measure the same complete renditions the broker will stage. Catalog identity
 * remains unchanged; only the admitted range is narrowed to available media. */
export async function descriptorDurationMs(
  catalog: { hlsUrl: string; exportHeight: number | null; durationMs: number },
  download: (url: string, maxBytes: number) => Promise<Uint8Array>,
) {
  if (!catalog.exportHeight) throw new StudioCommandError("INVALID")
  const read = async (url: string) =>
    new TextDecoder().decode(await download(url, 1048576))
  const master = await read(catalog.hlsUrl)
  const preview = studioHlsRendition(master, catalog.hlsUrl, 270, false)
  const exported = studioHlsRendition(
    master,
    catalog.hlsUrl,
    catalog.exportHeight,
    true,
  )
  const urls = [...new Set([preview.url, exported.url])]
  const durations = await Promise.all(
    urls.map(async (url) => {
      const segments = studioHlsSegments(await read(url), url)
      return segments.at(-1)!.endMs
    }),
  )
  const durationMs = Math.floor(Math.min(catalog.durationMs, ...durations))
  if (durationMs <= 0) throw new StudioCommandError("INVALID")
  return durationMs
}
