import { sourceAdmissionDocument } from "./studio-source-admission"
import { z } from "zod"
import type { StudioDocument } from "@forge/studio-contracts"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import type { StudioBrokerClient } from "./studio-broker"
import type { AdminVideoForEnrichment } from "@/backend/admin-client"
import {
  footageKey,
  footageSampleTimes,
  type FootagePresentation,
} from "@/features/video-studio/footage-presentation"

/** Use only source URLs admitted by Admin, never browser-supplied playback IDs. */
export async function prepareFootagePresentation(
  call: StudioBrokerClient,
  projectId: string,
  document: StudioDocument,
  videos: (ids: string[]) => Promise<AdminVideoForEnrichment[]>,
  sign: (id: string, time: number) => Promise<string>,
) {
  const sources = z
    .array(
      z.object({ itemId: z.string(), snapshot: studioSourceSnapshotSchema }),
    )
    .parse(
      await call("preview-sources", {
        projectId,
        document: sourceAdmissionDocument(document),
      }),
    )
  const ids = [...new Set(sources.map((s) => s.snapshot.source.videoId))]
  const catalog: AdminVideoForEnrichment[] = []
  // Existing Manager read model accepts at most 100 IDs per request.
  for (let offset = 0; offset < ids.length; offset += 100) {
    catalog.push(
      ...(await videos(ids.slice(offset, offset + 100)).catch(() => [])),
    )
  }
  const result: Record<string, FootagePresentation> = {}
  for (const { itemId, snapshot } of sources) {
    const item = document.items.find((i) => i.id === itemId)
    if (item?.kind !== "video") continue
    const key = footageKey(item)
    if (result[key]) continue
    const name =
      catalog
        .find(
          (v) =>
            v.documentId === item.source.videoId ||
            v.coreId === item.source.videoId,
        )
        ?.title?.trim() || item.source.videoId
    const presentation: FootagePresentation = { name, frames: [] }
    result[key] = presentation
    const hls = new URL(snapshot.hlsUrl)
    const match = hls.pathname.match(/^\/([a-zA-Z0-9]+)\.m3u8$/)
    if (
      hls.protocol !== "https:" ||
      hls.hostname !== "stream.mux.com" ||
      !match
    )
      continue
    const playbackId = match[1]!
    try {
      presentation.frames = await Promise.all(
        footageSampleTimes(item.source.startMs, item.source.endMs).map(
          async (time) => {
            const url = new URL(
              `https://image.mux.com/${playbackId}/thumbnail.webp`,
            )
            if (hls.searchParams.has("token"))
              url.searchParams.set("token", await sign(playbackId, time))
            else {
              url.searchParams.set("width", "160")
              url.searchParams.set("time", String(time))
            }
            return url.href
          },
        ),
      )
    } catch {
      /* Titles remain usable when image signing is unavailable. */
    }
  }
  return result
}
