import { describe, expect, it, vi } from "vitest"
import {
  WATCH_SEO_MANIFEST_SNAPSHOT_KEY,
  WatchSeoManifestStore,
} from "./watch-seo-manifest-store"
import type { WatchSeoManifest } from "./watch-seo-manifest.service"

function mockPrisma() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const manifest: WatchSeoManifest = {
  version: "abc123",
  generatedAt: "2026-06-12T12:00:00.000Z",
  videoRouteGroups: [
    {
      contentSlug: "jesus",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  episodeRouteGroups: [
    {
      parentSlug: "series",
      childSlug: "episode-1",
      alternates: [{ hreflang: "es", languageSlug: "spanish" }],
    },
  ],
  skippedHreflangValues: { "es-419": 1 },
}

describe("WatchSeoManifestStore", () => {
  it("returns null when no latest snapshot exists", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([])
    const store = new WatchSeoManifestStore(prisma)

    await expect(store.getLatest()).resolves.toBeNull()
  })

  it("upserts the latest manifest and returns the stored snapshot", async () => {
    const prisma = mockPrisma()
    const payloadSizeBytes = Buffer.byteLength(JSON.stringify(manifest), "utf8")
    const generatedAt = new Date(manifest.generatedAt)
    const createdAt = new Date("2026-06-12T12:00:01.000Z")
    const updatedAt = new Date("2026-06-12T12:00:02.000Z")
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        key: WATCH_SEO_MANIFEST_SNAPSHOT_KEY,
        version: manifest.version,
        generatedAt,
        payload: manifest,
        payloadSizeBytes,
        createdAt,
        updatedAt,
      },
    ])
    const store = new WatchSeoManifestStore(prisma)

    const snapshot = await store.upsertLatest(manifest)

    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    expect(snapshot).toEqual({
      key: WATCH_SEO_MANIFEST_SNAPSHOT_KEY,
      version: manifest.version,
      generatedAt,
      payload: manifest,
      payloadSizeBytes,
      createdAt,
      updatedAt,
    })
  })

  it("parses string JSON payloads from raw SQL reads", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        key: WATCH_SEO_MANIFEST_SNAPSHOT_KEY,
        version: manifest.version,
        generatedAt: new Date(manifest.generatedAt),
        payload: JSON.stringify(manifest),
        payloadSizeBytes: BigInt(Buffer.byteLength(JSON.stringify(manifest))),
        createdAt: new Date("2026-06-12T12:00:01.000Z"),
        updatedAt: new Date("2026-06-12T12:00:02.000Z"),
      },
    ])
    const store = new WatchSeoManifestStore(prisma)

    const snapshot = await store.getLatest()

    expect(snapshot?.payload).toEqual(manifest)
    expect(snapshot?.payloadSizeBytes).toBe(
      Buffer.byteLength(JSON.stringify(manifest)),
    )
  })

  it("fails if an upsert does not produce a readable latest snapshot", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([])
    const store = new WatchSeoManifestStore(prisma)

    await expect(store.upsertLatest(manifest)).rejects.toThrow(
      "watch seo manifest snapshot missing after upsert",
    )
  })
})
