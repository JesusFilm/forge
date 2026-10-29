import { createPrivateKey } from "node:crypto"
import { SignJWT } from "jose"
import { z } from "zod"

import { env } from "../../config/env"
import { parseVtt } from "../../evals/subtitle-translation/vtt"
import { SubtitleSourceError, subtitleLanguageRoot } from "./source-errors"
import { SubtitleSegmentsSchema } from "./transcript"

const MuxAssetSchema = z.object({
  data: z.object({
    status: z.string(),
    duration: z.number().optional(),
    playback_ids: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
          policy: z.enum(["public", "signed", "drm"]),
        }),
      )
      .default([]),
    tracks: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
          type: z.string(),
          text_type: z.string().optional(),
          text_source: z.string().optional(),
          language_code: z.string().optional(),
          status: z.string().optional(),
          primary: z.boolean().optional(),
        }),
      )
      .default([]),
  }),
})

// Same supported generated-subtitle language set as Manager's mux-language.ts.
// An existing ready source track can be reused in any explicitly matching language.
const GENERATION_LANGUAGES = new Set([
  "bg",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "hr",
  "it",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sv",
  "tr",
  "uk",
])

export type ReadMuxSubtitleSourceOptions = {
  fetchImpl?: typeof fetch
  tokenId?: string
  tokenSecret?: string
  signingKeyId?: string
  privateKey?: string
  timeoutMs?: number
  pollIntervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

async function readBoundedText(
  response: Response,
  limit: number,
): Promise<string> {
  if (!response.ok || !response.body)
    throw new SubtitleSourceError(
      "source_failed",
      true,
      "Mux subtitle source request failed.",
    )
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel()
    throw new SubtitleSourceError(
      "source_invalid",
      false,
      "Mux subtitle source exceeds the size limit.",
    )
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > limit)
        throw new SubtitleSourceError(
          "source_invalid",
          false,
          "Mux subtitle source exceeds the size limit.",
        )
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks).toString("utf8")
}

export async function readMuxSubtitleSource(
  input: { muxAssetId: string; sourceLanguage: string },
  options: ReadMuxSubtitleSourceOptions = {},
) {
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(input.muxAssetId)) {
    throw new SubtitleSourceError(
      "source_invalid",
      false,
      "Mux asset identity is invalid.",
    )
  }
  const tokenId = options.tokenId ?? env.MUX_TOKEN_ID
  const tokenSecret = options.tokenSecret ?? env.MUX_TOKEN_SECRET
  if (!tokenId || !tokenSecret)
    throw new SubtitleSourceError(
      "source_config_missing",
      false,
      "Mux source credentials are required.",
    )
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline =
    now() + Math.min(900_000, Math.max(1, options.timeoutMs ?? 900_000))
  const signal = AbortSignal.timeout(
    Math.min(900_000, Math.max(1, options.timeoutMs ?? 900_000)),
  )
  const language = subtitleLanguageRoot(input.sourceLanguage)
  let requestedGeneration = false

  const api = async (path: string, body?: unknown) => {
    if (now() >= deadline)
      throw new SubtitleSourceError(
        "source_failed",
        true,
        "Mux subtitle source timed out.",
      )
    const response = await fetchImpl(
      `https://api.mux.com/video/v1/assets/${input.muxAssetId}${path}`,
      {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal,
        headers: {
          authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64")}`,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    )
    // Do not include provider response text, credentials or signed URLs in errors.
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new SubtitleSourceError(
        "source_config_missing",
        false,
        "Mux source credentials were rejected.",
      )
    }
    return response
  }

  try {
    while (now() < deadline) {
      const asset = MuxAssetSchema.parse(
        JSON.parse(await readBoundedText(await api(""), 2 * 1024 * 1024)),
      ).data
      if (asset.status === "errored")
        throw new SubtitleSourceError(
          "source_failed",
          false,
          "Mux source asset is errored.",
        )
      const tracks = asset.tracks.filter(
        (track) =>
          track.type === "text" &&
          track.text_type === "subtitles" &&
          subtitleLanguageRoot(track.language_code ?? "") === language,
      )
      const ready = tracks.find((track) => track.status === "ready")
      if (ready) {
        const playback =
          asset.playback_ids.find((item) => item.policy === "public") ??
          asset.playback_ids.find((item) => item.policy === "signed")
        if (!playback)
          throw new SubtitleSourceError(
            "source_invalid",
            false,
            "Mux source has no supported playback policy.",
          )
        const url = new URL(
          `https://stream.mux.com/${playback.id}/text/${ready.id}.vtt`,
        )
        if (playback.policy === "signed") {
          const keyId = options.signingKeyId ?? env.MUX_SIGNING_KEY
          const privateKey = options.privateKey ?? env.MUX_PRIVATE_KEY
          if (!keyId || !privateKey)
            throw new SubtitleSourceError(
              "source_config_missing",
              false,
              "Mux signed source requires signing credentials.",
            )
          // Match Manager/Mux SDK support for PKCS1/PKCS8 PEM, including
          // base64-encoded PEM values supplied by the Mux signing-key API.
          let key: ReturnType<typeof createPrivateKey>
          try {
            key = createPrivateKey(
              privateKey.includes("-----BEGIN")
                ? privateKey
                : Buffer.from(privateKey, "base64").toString("utf8"),
            )
          } catch {
            throw new SubtitleSourceError(
              "source_config_missing",
              false,
              "Mux source signing credentials are invalid.",
            )
          }
          url.searchParams.set(
            "token",
            await new SignJWT({})
              .setProtectedHeader({ alg: "RS256", kid: keyId })
              .setSubject(playback.id)
              .setAudience("v")
              .setExpirationTime("5m")
              .sign(key),
          )
        }
        const response = await fetchImpl(url, { redirect: "error", signal })
        const segments = SubtitleSegmentsSchema.parse(
          parseVtt(await readBoundedText(response, 5 * 1024 * 1024), {
            emptyCue: "reject",
          }),
        )
        return { language: input.sourceLanguage, segments }
      }
      const generated = tracks.find(
        (track) =>
          track.text_source === "generated_vod" && track.status !== "deleted",
      )
      const preparing = tracks.some((track) => track.status === "preparing")
      if (!preparing && generated?.status === "errored")
        throw new SubtitleSourceError(
          "source_failed",
          false,
          "Mux generated source subtitles are errored.",
        )
      if (!preparing && !generated && !requestedGeneration) {
        if (!language || !GENERATION_LANGUAGES.has(language))
          throw new SubtitleSourceError(
            "source_invalid",
            false,
            "Mux cannot generate the requested subtitle language.",
          )
        const audio =
          asset.tracks.find(
            (track) => track.type === "audio" && track.primary,
          ) ?? asset.tracks.find((track) => track.type === "audio")
        if (!audio)
          throw new SubtitleSourceError(
            "source_invalid",
            false,
            "Mux source asset has no audio track.",
          )
        const response = await api(`/tracks/${audio.id}/generate-subtitles`, {
          generated_subtitles: [
            { language_code: language, name: "Generated subtitles" },
          ],
        })
        await readBoundedText(response, 2 * 1024 * 1024)
        requestedGeneration = true
      }
      const remaining = deadline - now()
      if (remaining <= 0) break
      await sleep(
        Math.min(Math.max(1, options.pollIntervalMs ?? 5_000), remaining),
      )
    }
    throw new SubtitleSourceError(
      "source_failed",
      true,
      "Mux subtitle source timed out.",
    )
  } catch (error) {
    if (error instanceof SubtitleSourceError) throw error
    throw new SubtitleSourceError(
      "source_failed",
      true,
      "Mux subtitle source could not be acquired or validated.",
    )
  }
}
