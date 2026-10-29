import { z } from "zod"
import { env } from "../../config/env"
import { EnrichmentSettledError } from "./provider-spend"

export function getThumbnailUrl(
  playbackId: string,
  options?: { width?: number; time?: number },
): string {
  const params = new URLSearchParams()
  if (options?.width != null) params.set("width", String(options.width))
  if (options?.time != null) params.set("time", String(options.time))
  const qs = params.toString()
  return `https://image.mux.com/${playbackId}/thumbnail.webp${qs ? `?${qs}` : ""}`
}

/**
 * Generate thumbnail URLs for scene analysis — extracts representative frames
 * at specified timestamps. Mux thumbnail API is public (no signing needed for
 * Core API-synced assets) and CDN-cached at no extra cost.
 */
export function getSceneThumbnailUrls(
  playbackId: string,
  startSeconds: number,
  endSeconds: number | null,
  count: number = 3,
): string[] {
  if (!playbackId) {
    throw new Error("Cannot generate thumbnail URLs: playbackId is empty")
  }

  const end = endSeconds ?? startSeconds + 60
  const duration = end - startSeconds

  if (count === 1 || duration <= 0) {
    return [getThumbnailUrl(playbackId, { width: 768, time: startSeconds })]
  }

  const urls: string[] = []
  for (let i = 0; i < count; i++) {
    const time = startSeconds + (duration * i) / (count - 1)
    urls.push(
      getThumbnailUrl(playbackId, { width: 768, time: Math.round(time) }),
    )
  }
  return urls
}

/** Resolve the optional caller playback id using the same Mux asset as the source. */
export async function resolveScenePlaybackId(
  input: { muxAssetId: string; playbackId?: string },
  options: {
    fetchImpl?: typeof fetch
    tokenId?: string
    tokenSecret?: string
  } = {},
): Promise<string> {
  if (input.playbackId) {
    if (!/^[a-zA-Z0-9_-]+$/.test(input.playbackId))
      throw new EnrichmentSettledError("Invalid Mux playback id")
    return input.playbackId
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.muxAssetId))
    throw new EnrichmentSettledError("Invalid Mux asset id")
  const tokenId = options.tokenId ?? env.MUX_TOKEN_ID
  const tokenSecret = options.tokenSecret ?? env.MUX_TOKEN_SECRET
  if (!tokenId || !tokenSecret)
    throw new EnrichmentSettledError(
      "Mux credentials are required to resolve scene playback",
    )
  const response = await (options.fetchImpl ?? fetch)(
    `https://api.mux.com/video/v1/assets/${input.muxAssetId}`,
    {
      headers: {
        authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64")}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new EnrichmentSettledError("Mux scene playback lookup failed")
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 1024 * 1024)
        throw new EnrichmentSettledError("Mux asset response too large")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    throw new EnrichmentSettledError("Mux asset response is invalid")
  }
  const asset = z
    .object({
      data: z.object({
        playback_ids: z.array(
          z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) }),
        ),
      }),
    })
    .safeParse(raw)
  const playbackId = asset.success
    ? asset.data.data.playback_ids[0]?.id
    : undefined
  if (!playbackId)
    throw new EnrichmentSettledError("Mux asset has no playback id")
  return playbackId
}
