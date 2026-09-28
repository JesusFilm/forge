import "server-only"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { env } from "@/env"
import {
  watchSurfaceManifestSchema,
  signedWatchSurfaceManifestSchema,
  type WatchSurfaceManifestSource,
  type SignedWatchSurfaceManifest,
} from "./watch-surface-manifest"

import type { WatchHomeHeroManifestCatalog } from "./watch-home-hero-manifest"

const DOMAIN = "watch-public-surface-manifest-v2"
export const WATCH_SURFACE_MANIFEST_TTL_MS = 48 * 60 * 60 * 1000
export const WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS = 5 * 60 * 1000
function sourcePayload(source: WatchSurfaceManifestSource): string {
  return JSON.stringify([
    source.surface,
    source.block,
    source.presentation,
    source.placement,
    source.items.map((item) => [item.position, item.itemPath]),
  ])
}
function signature(manifest: SignedWatchSurfaceManifest["manifest"]): string {
  return createHmac("sha256", env.REVALIDATION_SECRET)
    .update(
      JSON.stringify([
        DOMAIN,
        sourcePayload(manifest),
        manifest.policyVersion,
        manifest.sourceVersion,
        manifest.expiresAt,
      ]),
    )
    .digest("base64url")
}
/** Cache-safe public authority. This function reads no request identity and writes nothing. */
export function signWatchSurfaceManifest(
  source: WatchSurfaceManifestSource | null,
  now = Date.now(),
): SignedWatchSurfaceManifest | null {
  if (source === null) return null
  const parsed = watchSurfaceManifestSchema.safeParse({
    ...source,
    policyVersion: "watch-exposure-v2",
    sourceVersion: "0".repeat(64),
    // Reserve clock skew inside the 48-hour verifier ceiling, never after expiry.
    expiresAt: new Date(
      now +
        WATCH_SURFACE_MANIFEST_TTL_MS -
        WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS,
    ).toISOString(),
  })
  if (!parsed.success) return null
  const manifest = {
    ...parsed.data,
    sourceVersion: createHash("sha256")
      .update(sourcePayload(parsed.data))
      .digest("hex"),
  }
  return { manifest, signature: signature(manifest) }
}
export function verifyWatchSurfaceManifest(
  input: unknown,
  now = Date.now(),
): SignedWatchSurfaceManifest["manifest"] | null {
  const parsed = signedWatchSurfaceManifestSchema.safeParse(input)
  if (
    !parsed.success ||
    Date.parse(parsed.data.manifest.expiresAt) <= now ||
    Date.parse(parsed.data.manifest.expiresAt) >
      now + WATCH_SURFACE_MANIFEST_TTL_MS
  )
    return null
  const expected = Buffer.from(signature(parsed.data.manifest))
  const supplied = Buffer.from(parsed.data.signature)
  return expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
    ? parsed.data.manifest
    : null
}

/** Signs every trusted hero candidate without widening the universal slate limit. */
export function signWatchHomeHeroManifestCatalog(
  source: WatchSurfaceManifestSource | null,
  now = Date.now(),
): WatchHomeHeroManifestCatalog | null {
  if (
    source === null ||
    source.surface !== "watch-home" ||
    source.block !== "hero" ||
    source.presentation !== "hero-card" ||
    !Array.isArray(source.items) ||
    source.items.length === 0 ||
    !Number.isFinite(now)
  )
    return null
  const expiry = new Date(
    now + WATCH_SURFACE_MANIFEST_TTL_MS - WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS,
  )
  if (!Number.isFinite(expiry.getTime())) return null
  const { items: sourceItems, ...config } = source
  const parsed = watchSurfaceManifestSchema.omit({ items: true }).safeParse({
    ...config,
    policyVersion: "watch-exposure-v2",
    sourceVersion: "0".repeat(64),
    expiresAt: expiry.toISOString(),
  })
  if (!parsed.success) return null
  const items: SignedWatchSurfaceManifest["manifest"]["items"] = []
  const paths = new Set<string>()
  for (const item of sourceItems) {
    const singleton = watchSurfaceManifestSchema.safeParse({
      ...parsed.data,
      items: [item],
    })
    if (!singleton.success || singleton.data.items[0].position !== 0)
      return null
    const validated = singleton.data.items[0]
    if (!paths.has(validated.itemPath)) {
      paths.add(validated.itemPath)
      items.push(validated)
    }
  }
  const manifest = {
    ...parsed.data,
    sourceVersion: createHash("sha256")
      .update(sourcePayload({ ...parsed.data, items }))
      .digest("hex"),
  }
  return {
    manifest,
    items: items.map(({ itemPath }) => [
      itemPath,
      signature({ ...manifest, items: [{ position: 0, itemPath }] }),
    ]),
  }
}
