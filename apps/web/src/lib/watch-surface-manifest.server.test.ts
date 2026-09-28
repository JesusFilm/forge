/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest"
vi.mock("@/env", () => ({
  env: { REVALIDATION_SECRET: "public-manifest-test-secret" },
}))
import {
  signWatchSurfaceManifest,
  verifyWatchSurfaceManifest,
  WATCH_SURFACE_MANIFEST_TTL_MS,
  WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS,
} from "./watch-surface-manifest.server"
import { watchSurfaceSource } from "./watch-surface-manifest"

const now = Date.parse("2026-09-29T00:00:00.000Z")
const source = watchSurfaceSource(
  {
    surface: "watch-home",
    block: "collections",
    presentation: "carousel",
    placement: "rail-1",
  },
  ["/jesus.html/english.html", "/jesus.html/english.html"],
)

describe("public origin manifest authority", () => {
  it("returns unknown authority for invalid source projections without breaking rendering", () => {
    expect(
      signWatchSurfaceManifest({ ...source, placement: "bad placement" }, now),
    ).toBeNull()
    expect(
      signWatchSurfaceManifest({ ...source, placement: "a".repeat(65) }, now),
    ).toBeNull()
    expect(
      signWatchSurfaceManifest(
        {
          ...source,
          items: Array.from({ length: 101 }, () => source.items[0]),
        },
        now,
      ),
    ).toBeNull()
  })

  it("round trips deterministic public descriptors without request identity", () => {
    const signed = signWatchSurfaceManifest(source, now)!
    expect(signWatchSurfaceManifest(source, now)).toEqual(signed)
    expect(
      verifyWatchSurfaceManifest(JSON.parse(JSON.stringify(signed)), now),
    ).toEqual(signed.manifest)
    expect(signWatchSurfaceManifest(null, now)).toBeNull()
  })
  it("binds placement, positions, target path, version and expiry to origin authority", () => {
    const signed = signWatchSurfaceManifest(source, now)!
    for (const patch of [
      { placement: "rail-2" },
      { sourceVersion: "a".repeat(64) },
      { expiresAt: new Date(now + 1_000).toISOString() },
      { items: [{ position: 1, itemPath: source.items[0].itemPath }] },
      { items: [{ position: 0, itemPath: "/watch/other.html/english.html" }] },
    ])
      expect(
        verifyWatchSurfaceManifest(
          { ...signed, manifest: { ...signed.manifest, ...patch } },
          now,
        ),
      ).toBeNull()
    expect(
      verifyWatchSurfaceManifest({ ...signed, signature: "a" }, now),
    ).toBeNull()
  })
  it("rejects expired descriptors, invalid input and out-of-window future authority", () => {
    const signed = signWatchSurfaceManifest(source, now)!
    expect(
      verifyWatchSurfaceManifest(signed, now + WATCH_SURFACE_MANIFEST_TTL_MS),
    ).toBeNull()
    expect(
      verifyWatchSurfaceManifest(
        signed,
        now - WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS - 1,
      ),
    ).toBeNull()
    expect(verifyWatchSurfaceManifest(null, now)).toBeNull()
    expect(
      verifyWatchSurfaceManifest({ ...signed, identity: "forbidden" }, now),
    ).toBeNull()
    expect(
      verifyWatchSurfaceManifest(
        { ...signed, manifest: { ...signed.manifest, identity: "forbidden" } },
        now,
      ),
    ).toBeNull()
  })
  it("reserves bounded signer clock skew within the 48-hour lifetime ceiling", () => {
    for (const skew of [1_000, WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS]) {
      const signed = signWatchSurfaceManifest(source, now + skew)!
      expect(verifyWatchSurfaceManifest(signed, now)).toEqual(signed.manifest)
      expect(Date.parse(signed.manifest.expiresAt) - now).toBeLessThanOrEqual(
        WATCH_SURFACE_MANIFEST_TTL_MS,
      )
      expect(
        verifyWatchSurfaceManifest(
          signed,
          Date.parse(signed.manifest.expiresAt),
        ),
      ).toBeNull()
    }
    expect(
      verifyWatchSurfaceManifest(
        signWatchSurfaceManifest(
          source,
          now + WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS + 1,
        ),
        now,
      ),
    ).toBeNull()
  })
  it("changes source digest when card order or repeated occurrence changes", () => {
    const signed = signWatchSurfaceManifest(source, now)!
    expect(
      signWatchSurfaceManifest(
        { ...source, items: source.items.slice(0, 1) },
        now,
      )?.manifest.sourceVersion,
    ).not.toBe(signed.manifest.sourceVersion)
  })
})
