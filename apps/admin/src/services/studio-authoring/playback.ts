import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { z } from "zod"

const resourceSchema = z
  .object({
    releaseId: z.string(),
    url: z.string(),
    expiresAt: z.number().int(),
    storyboard: z.boolean(),
  })
  .strict()
const TTL = 3600000,
  SEGMENT_LIMIT = 16 * 1024 * 1024,
  PLAYLIST_LIMIT = 262144
class PlaybackDenied extends Error {}
class PlaybackUpstreamError extends Error {}
type PlaybackIdentity = { playbackId: string }
function muxUrl(raw: string, base?: URL) {
  const url = new URL(raw, base)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "mux.com" || url.hostname.endsWith(".mux.com"))
  )
    throw new PlaybackUpstreamError()
  url.hash = ""
  return url
}
function rangeHeader(value: string | null) {
  if (!value) return undefined
  if (value.length > 80 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(value))
    throw new PlaybackDenied()
  const numbers = value.slice(6).split("-").filter(Boolean).map(Number)
  if (
    numbers.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    /^bytes=-0$/.test(value)
  )
    throw new PlaybackDenied()
  const [start, end] = value.slice(6).split("-")
  if (start && end && Number(end) < Number(start)) throw new PlaybackDenied()
  return value
}
function bounded<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted)
    return work.then(() => {
      throw signal.reason
    })
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}
async function readBounded(
  response: Response,
  max: number,
  signal: AbortSignal,
) {
  const reader = response.body?.getReader()
  if (!reader) throw new PlaybackUpstreamError()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await bounded(signal, reader.read())
      if (done) break
      size += value.byteLength
      if (size > max) throw new PlaybackUpstreamError()
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** All URLs re-enter current canonical authorization, even previously issued
 * encrypted resource URLs. No upstream Mux token is sent to a client or error.
 * Bytes already delivered cannot be recalled by a later unpublish operation. */
export class StudioPlaybackGateway {
  private active = 0
  constructor(
    private readonly port: {
      authorize: (
        releaseId: string,
        signal: AbortSignal,
      ) => Promise<PlaybackIdentity | null>
      sign: (
        playbackId: string,
        audience: "v" | "t" | "s",
        signal: AbortSignal,
      ) => Promise<string>
      resourceKey: Buffer
      fetcher?: typeof fetch
    },
  ) {
    if (port.resourceKey.length !== 32) throw new PlaybackUpstreamError()
  }
  private seal(releaseId: string, url: URL, storyboard = false) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.port.resourceKey, iv)
    cipher.setAAD(Buffer.from(releaseId))
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({
          releaseId,
          url: url.href,
          expiresAt: Date.now() + TTL,
          storyboard,
        }),
      ),
      cipher.final(),
    ])
    return `${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}.media`
  }
  private open(releaseId: string, resource: string) {
    if (resource.length > 12000 || !/^[-A-Za-z0-9_]+\.media$/.test(resource))
      throw new PlaybackDenied()
    try {
      const bytes = Buffer.from(resource.slice(0, -6), "base64url")
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.port.resourceKey,
        bytes.subarray(0, 12),
      )
      decipher.setAAD(Buffer.from(releaseId))
      decipher.setAuthTag(bytes.subarray(12, 28))
      const payload = resourceSchema.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(bytes.subarray(28)),
            decipher.final(),
          ]).toString(),
        ),
      )
      if (
        payload.releaseId !== releaseId ||
        payload.expiresAt < Date.now() ||
        payload.expiresAt > Date.now() + TTL
      )
        throw new PlaybackDenied()
      return { url: muxUrl(payload.url), storyboard: payload.storyboard }
    } catch {
      throw new PlaybackDenied()
    }
  }
  private rewrite(
    releaseId: string,
    raw: string,
    base: URL,
    storyboard = false,
  ) {
    const link = (value: string) => {
      if (value.length > 8192) throw new PlaybackUpstreamError()
      const parsed = new URL(value, base),
        fragment = parsed.hash
      const url = muxUrl(parsed.href)
      return `/api/studio/playback/${encodeURIComponent(releaseId)}/${this.seal(releaseId, url)}${fragment}`
    }
    if (storyboard) {
      if (!raw.startsWith("WEBVTT")) throw new PlaybackUpstreamError()
      return raw
        .split("\n")
        .map((line) =>
          /\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/.test(line.trim())
            ? link(line.trim())
            : line,
        )
        .join("\n")
    }
    if (!raw.startsWith("#EXTM3U")) throw new PlaybackUpstreamError()
    return raw
      .split("\n")
      .map((line) => {
        if (!line.trim()) return line
        if (line.startsWith("#"))
          return line.replace(
            /URI="([^"\r\n]+)"/g,
            (_match, value: string) => `URI="${link(value)}"`,
          )
        return link(line.trim())
      })
      .join("\n")
  }
  async serve(releaseId: string, resource: string, request: Request) {
    const headers = new Headers({
      "cache-control": "private, no-store, max-age=0",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    })
    const failure = (status: number) => {
      const safe = new Headers(headers)
      safe.delete("content-length")
      safe.delete("content-range")
      safe.set("content-type", "text/plain")
      return new Response(
        request.method === "HEAD" ? null : "Playback unavailable",
        { status, headers: safe },
      )
    }
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(releaseId) ||
      !["GET", "HEAD"].includes(request.method)
    )
      return failure(404)
    if (this.active >= 8) return failure(503)
    this.active++
    const deadline = new AbortController()
    const timer = setTimeout(
      () => deadline.abort(new Error("Playback deadline")),
      15000,
    )
    const signal = AbortSignal.any([request.signal, deadline.signal])
    try {
      signal.throwIfAborted()
      const identity = await bounded(
        signal,
        this.port.authorize(releaseId, signal),
      )
      if (!identity) return failure(404)
      let url: URL,
        storyboard = false
      if (
        resource === "index.m3u8" ||
        resource === "poster.webp" ||
        resource === "storyboard.vtt"
      ) {
        const audience =
          resource === "index.m3u8"
            ? "v"
            : resource === "poster.webp"
              ? "t"
              : "s"
        const path =
          resource === "index.m3u8"
            ? `${identity.playbackId}.m3u8`
            : resource === "poster.webp"
              ? `${identity.playbackId}/thumbnail.webp`
              : `${identity.playbackId}/storyboard.vtt`
        url = muxUrl(
          `https://${audience === "v" ? "stream" : "image"}.mux.com/${path}`,
        )
        url.searchParams.set(
          "token",
          await bounded(
            signal,
            this.port.sign(identity.playbackId, audience, signal),
          ),
        )
        storyboard = resource === "storyboard.vtt"
      } else ({ url, storyboard } = this.open(releaseId, resource))
      let range: string | undefined
      try {
        range =
          request.method === "HEAD"
            ? undefined
            : rangeHeader(request.headers.get("range"))
      } catch {
        return failure(416)
      }
      if (range && (url.pathname.endsWith(".m3u8") || storyboard))
        return failure(416)
      let response: Response | undefined
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await bounded<Response>(
          signal,
          (this.port.fetcher ?? fetch)(url, {
            method: request.method,
            headers: range ? { Range: range } : {},
            redirect: "manual",
            cache: "no-store",
            signal,
          }).then((value) => {
            if (signal.aborted) void value.body?.cancel().catch(() => {})
            return value
          }),
        )
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const location = response.headers.get("location")
        await bounded(signal, response.body?.cancel() ?? Promise.resolve())
        if (!location || redirects === 3) throw new PlaybackUpstreamError()
        url = muxUrl(location, url)
      }
      if (!response) throw new PlaybackUpstreamError()
      if (response.status === 416) {
        await bounded(signal, response.body?.cancel() ?? Promise.resolve())
        return failure(416)
      }
      if (![200, 206].includes(response.status)) {
        await bounded(signal, response.body?.cancel() ?? Promise.resolve())
        throw new PlaybackUpstreamError()
      }
      const type = (response.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase()
      const playlist =
        url.pathname.endsWith(".m3u8") ||
        [
          "application/vnd.apple.mpegurl",
          "application/x-mpegurl",
          "audio/mpegurl",
        ].includes(type)
      if (
        !playlist &&
        !storyboard &&
        !/^(?:video\/(?:mp2t|mp4)|audio\/(?:aac|mp4|mpeg)|application\/octet-stream|text\/vtt|image\/(?:jpeg|png|webp))$/.test(
          type,
        )
      ) {
        await bounded(signal, response.body?.cancel() ?? Promise.resolve())
        throw new PlaybackUpstreamError()
      }
      headers.set(
        "content-type",
        playlist
          ? "application/vnd.apple.mpegurl"
          : storyboard
            ? "text/vtt"
            : type,
      )
      let bytes: Buffer | undefined
      if (request.method !== "HEAD") {
        bytes = await readBounded(
          response,
          playlist || storyboard ? PLAYLIST_LIMIT : SEGMENT_LIMIT,
          signal,
        )
        if (playlist || storyboard)
          bytes = Buffer.from(
            this.rewrite(releaseId, bytes.toString(), url, storyboard),
          )
        if (bytes.length > SEGMENT_LIMIT) throw new PlaybackUpstreamError()
        headers.set("content-length", String(bytes.length))
      } else await bounded(signal, response.body?.cancel() ?? Promise.resolve())
      if (response.status === 206) {
        const value = response.headers.get("content-range") ?? "",
          match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value)
        if (
          !match ||
          match.slice(1).some((n) => !Number.isSafeInteger(Number(n))) ||
          Number(match[2]) < Number(match[1]) ||
          Number(match[3]) <= Number(match[2]) ||
          (bytes && Number(match[2]) - Number(match[1]) + 1 !== bytes.length)
        )
          throw new PlaybackUpstreamError()
        headers.set("content-range", value)
      }
      headers.set("accept-ranges", playlist || storyboard ? "none" : "bytes")
      const current = await bounded(
        signal,
        this.port.authorize(releaseId, signal),
      )
      if (!current || current.playbackId !== identity.playbackId)
        return failure(404)
      signal.throwIfAborted()
      return new Response(bytes ? new Uint8Array(bytes) : null, {
        status: response.status,
        headers,
      })
    } catch (error) {
      return failure(error instanceof PlaybackDenied ? 404 : 502)
    } finally {
      clearTimeout(timer)
      this.active--
    }
  }
}
