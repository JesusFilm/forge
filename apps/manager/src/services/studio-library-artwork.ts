import type { AdminVideoForEnrichment } from "@/backend/admin-client"

/** Decorative stills only; capture retains exact dub/edition/range admission. */
export async function libraryArtwork(
  rows: { videoId: string }[],
  videos: (ids: string[]) => Promise<AdminVideoForEnrichment[]>,
  sign: (id: string) => Promise<string>,
) {
  if (!rows.length) return {}
  const catalog = await Promise.resolve()
    .then(() => videos([...new Set(rows.map((row) => row.videoId))]))
    .catch(() => [])
  return Object.fromEntries(
    await Promise.all(
      rows.map(async (row) => {
        const video = catalog.find(
          (v) => v.documentId === row.videoId || v.coreId === row.videoId,
        )
        if (video?.imageUrl?.trim()) {
          try {
            const image = new URL(video.imageUrl.trim())
            if (
              image.protocol === "https:" &&
              !image.username &&
              !image.password
            ) {
              // Raw Cloudflare image IDs need a delivery variant.
              if (
                image.hostname === "imagedelivery.net" &&
                image.pathname.split("/").filter(Boolean).length === 2
              )
                image.pathname = `${image.pathname.replace(/\/+$/, "")}/public`
              return [row.videoId, image.href]
            }
          } catch {
            /* Fall back to a Mux frame when supplied artwork is unusable. */
          }
        }
        const playback = video?.variants?.find((v) => v?.muxVideo?.playbackId)
          ?.muxVideo?.playbackId
        if (!playback || !/^[a-zA-Z0-9]+$/.test(playback))
          return [row.videoId, undefined]
        const url = new URL(`https://image.mux.com/${playback}/thumbnail.webp`)
        try {
          url.searchParams.set("token", await sign(playback))
        } catch {
          // Public Mux playback does not require a signing key. Private playback
          // still denies unsigned requests; this does not grant media access.
          url.searchParams.set("width", "320")
          url.searchParams.set("time", "0")
        }
        return [row.videoId, url.href]
      }),
    ),
  ) as Record<string, string | undefined>
}
