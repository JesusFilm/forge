/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest"
vi.mock("@/env", () => ({
  env: { REVALIDATION_SECRET: "public-manifest-test-secret" },
}))
import {
  signWatchSurfaceManifest,
  signWatchHomeHeroManifestCatalog,
  verifyWatchSurfaceManifest,
  WATCH_SURFACE_MANIFEST_TTL_MS,
  WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS,
} from "./watch-surface-manifest.server"
import { selectWatchHomeHeroManifest } from "./watch-home-hero-manifest"
import { createHash } from "node:crypto"
import {
  watchSurfaceSource,
  type WatchSurfaceManifestSource,
} from "./watch-surface-manifest"

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

function heroSource(count: number): WatchSurfaceManifestSource {
  return {
    surface: "watch-home",
    block: "hero",
    presentation: "hero-card",
    placement: "home-hero",
    items: Array.from({ length: count }, (_, index) => ({
      position: 0,
      itemPath: `/watch/synthetic-${index}.html`,
    })),
  }
}

describe("compact server-owned hero catalogues", () => {
  it.each([101, 1000])(
    "authenticates all %i candidates as bounded singleton descriptors",
    (count) => {
      const input = heroSource(count)
      const catalog = signWatchHomeHeroManifestCatalog(input, now)!
      expect(catalog.items).toHaveLength(count)
      expect(signWatchSurfaceManifest(input, now)).toBeNull()
      expect(catalog.manifest.sourceVersion).toBe(
        createHash("sha256")
          .update(
            JSON.stringify([
              input.surface,
              input.block,
              input.presentation,
              input.placement,
              input.items.map(({ position, itemPath }) => [position, itemPath]),
            ]),
          )
          .digest("hex"),
      )
      for (const item of input.items) {
        const singleton = selectWatchHomeHeroManifest(catalog, item.itemPath)!
        expect(singleton.manifest.items).toEqual([item])
        expect(verifyWatchSurfaceManifest(singleton, now)).toEqual(
          singleton.manifest,
        )
      }
    },
  )
  it("deduplicates repeated paths, keeps first-seen order and binds the full catalogue digest", () => {
    const input = heroSource(2)
    const duplicate = {
      ...input,
      items: [input.items[0], input.items[0], input.items[1]],
    }
    const catalog = signWatchHomeHeroManifestCatalog(duplicate, now)!
    expect(catalog).toEqual(signWatchHomeHeroManifestCatalog(input, now))
    expect(catalog.items.map(([path]) => path)).toEqual(
      input.items.map(({ itemPath }) => itemPath),
    )
    for (const changed of [
      { ...input, items: input.items.slice(0, 1) },
      { ...input, items: [...input.items].reverse() },
      { ...input, placement: "authored-hero-3" },
    ])
      expect(
        signWatchHomeHeroManifestCatalog(changed, now)?.manifest.sourceVersion,
      ).not.toBe(catalog.manifest.sourceVersion)
  })
  it("shares the catalogue digest across active paths and changes authority for a retained path when the catalogue changes", () => {
    const catalog = signWatchHomeHeroManifestCatalog(heroSource(2), now)!
    const first = selectWatchHomeHeroManifest(catalog, "/synthetic-0.html")!
    const second = selectWatchHomeHeroManifest(catalog, "/synthetic-1.html")!
    expect(first.manifest.sourceVersion).toBe(second.manifest.sourceVersion)
    expect(first.signature).not.toBe(second.signature)
    const changed = signWatchHomeHeroManifestCatalog(heroSource(3), now)!
    const retained = selectWatchHomeHeroManifest(changed, "/synthetic-0.html")!
    expect(retained.manifest.sourceVersion).not.toBe(
      first.manifest.sourceVersion,
    )
    expect(retained.signature).not.toBe(first.signature)
    expect(verifyWatchSurfaceManifest(first, now)).toEqual(first.manifest)
    expect(verifyWatchSurfaceManifest(retained, now)).toEqual(retained.manifest)
    expect(
      verifyWatchSurfaceManifest(
        {
          ...first,
          manifest: {
            ...first.manifest,
            sourceVersion: retained.manifest.sourceVersion,
          },
        },
        now,
      ),
    ).toBeNull()
  })
  it("withholds the entire catalogue on invalid configuration, empty input or any invalid candidate", () => {
    const input = heroSource(101)
    for (const invalid of [
      null,
      { ...input, items: [] },
      source,
      { ...input, placement: "bad placement" },
      { ...input, placement: "x".repeat(65) },
      {
        ...input,
        items: [...input.items, { position: 1, itemPath: "/watch/later.html" }],
      },
      {
        ...input,
        items: [...input.items, { position: 0, itemPath: "/watch/invalid" }],
      },
    ])
      expect(signWatchHomeHeroManifestCatalog(invalid, now)).toBeNull()
    expect(signWatchHomeHeroManifestCatalog(input, NaN)).toBeNull()
    expect(signWatchHomeHeroManifestCatalog(input, Number.MAX_VALUE)).toBeNull()
  })
  it("rejects tampering with singleton path, configuration, digest or expiry and expires normally", () => {
    const catalog = signWatchHomeHeroManifestCatalog(heroSource(2), now)!
    const signed = selectWatchHomeHeroManifest(catalog, catalog.items[0][0])!
    for (const patch of [
      { surface: "watch-video" },
      { policyVersion: "watch-exposure-v1" },
      { block: "editorial" },
      { presentation: "grid" },
      { placement: "authored-hero-2" },
      { sourceVersion: "a".repeat(64) },
      { expiresAt: new Date(now + 1000).toISOString() },
      { items: [{ position: 0, itemPath: catalog.items[1][0] }] },
      { items: [{ position: 1, itemPath: catalog.items[0][0] }] },
    ])
      expect(
        verifyWatchSurfaceManifest(
          { ...signed, manifest: { ...signed.manifest, ...patch } },
          now,
        ),
      ).toBeNull()
    expect(
      verifyWatchSurfaceManifest(
        { ...signed, signature: catalog.items[1][1] },
        now,
      ),
    ).toBeNull()
    expect(
      verifyWatchSurfaceManifest(
        signed,
        Date.parse(catalog.manifest.expiresAt),
      ),
    ).toBeNull()
    expect(
      verifyWatchSurfaceManifest(
        signed,
        now - WATCH_SURFACE_MANIFEST_CLOCK_SKEW_MS - 1,
      ),
    ).toBeNull()
  })
  it("measures synthetic payload scaling without emitting authority or secret values", () => {
    const input = heroSource(1000)
    const start = performance.now()
    const catalog = signWatchHomeHeroManifestCatalog(input, now)!
    const signingMs = performance.now() - start
    const catalogBytes = Buffer.byteLength(JSON.stringify(catalog))
    const singletonsBytes = Buffer.byteLength(
      JSON.stringify(
        catalog.items.map(([path]) =>
          selectWatchHomeHeroManifest(catalog, path),
        ),
      ),
    )
    const activeBytes = Buffer.byteLength(
      JSON.stringify(
        selectWatchHomeHeroManifest(catalog, catalog.items[999][0]),
      ),
    )
    expect(catalogBytes).toBeLessThan(singletonsBytes / 3)
    expect(activeBytes).toBeLessThan(1024)
    expect(Number.isFinite(signingMs)).toBe(true)
    console.info(
      "hero-catalog-synthetic",
      JSON.stringify({
        candidateCount: input.items.length,
        catalogBytes,
        singletonsBytes,
        activeBytes,
        signingMs: Number(signingMs.toFixed(3)),
      }),
    )
  })
})
