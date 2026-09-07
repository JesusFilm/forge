import { createHash, createPrivateKey } from "node:crypto"
import { env } from "@/config/env"

/** Only the trusted Admin playback broker holds this Mux signing key. Renderer
 * containers receive neither it nor a provider/storage/database credential. */
export function studioPlaybackConfiguration() {
  if (
    !env.STUDIO_PUBLIC_PLAYBACK_ORIGIN ||
    !env.STUDIO_MUX_SIGNING_KEY ||
    !env.STUDIO_MUX_PRIVATE_KEY
  )
    return null
  const url = new URL(env.STUDIO_PUBLIC_PLAYBACK_ORIGIN)
  const local =
    env.STUDIO_ENVIRONMENT === "local" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    return null
  const raw = env.STUDIO_MUX_PRIVATE_KEY
  try {
    const key = createPrivateKey(
      raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64"),
    )
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      return null
    const resourceKey = createHash("sha256")
      .update("studio-playback-resources-v1")
      .update(key.export({ format: "der", type: "pkcs8" }))
      .digest()
    return {
      origin: url.origin,
      keyId: env.STUDIO_MUX_SIGNING_KEY,
      key,
      resourceKey,
    }
  } catch {
    return null
  }
}
export function studioPlaybackUrl(
  releaseId: string,
  resource: "index.m3u8" | "poster.webp" | "storyboard.vtt",
) {
  const config = studioPlaybackConfiguration()
  return config
    ? `${config.origin}/api/studio/playback/${encodeURIComponent(releaseId)}/${resource}`
    : null
}
