import { describe, expect, it, vi } from "vitest"
import {
  WATCH_ROUTE_MANIFEST_SNAPSHOT_KEY,
  WatchRouteManifestStore,
} from "./watch-route-manifest-store"
import type { WatchRouteManifest } from "./watch-route-manifest.service"

function mockPrisma() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const manifest: WatchRouteManifest = {
  version: "abc123",
  generatedAt: "2026-05-29T12:00:00.000Z",
  contentSlugs: ["easter", "jesus"],
  oneSegmentSlugs: ["easter"],
  episodePairsByParent: { series: ["episode-1"] },
  audioLanguageSlugs: ["english"],
  audioLanguageIndexesByContent: { jesus: [0] },
  audioLanguageIndexesByEpisode: { series: { "episode-1": [0] } },
  nestedContainerAudioLanguageIndexesByParent: {},
}

describe("WatchRouteManifestStore", () => {
  it("returns null when no latest snapshot exists", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([])
    const store = new WatchRouteManifestStore(prisma)

    await expect(store.getLatest()).resolves.toBeNull()
  })

  it("upserts the latest manifest and returns the stored snapshot", async () => {
    const prisma = mockPrisma()
    const payloadSizeBytes = Buffer.byteLength(JSON.stringify(manifest), "utf8")
    const generatedAt = new Date(manifest.generatedAt)
    const createdAt = new Date("2026-05-29T12:00:01.000Z")
    const updatedAt = new Date("2026-05-29T12:00:02.000Z")
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        key: WATCH_ROUTE_MANIFEST_SNAPSHOT_KEY,
        version: manifest.version,
        generatedAt,
        payload: manifest,
        payloadSizeBytes,
        createdAt,
        updatedAt,
      },
    ])
    const store = new WatchRouteManifestStore(prisma)

    const snapshot = await store.upsertLatest(manifest)

    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    expect(snapshot).toEqual({
      key: WATCH_ROUTE_MANIFEST_SNAPSHOT_KEY,
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
        key: WATCH_ROUTE_MANIFEST_SNAPSHOT_KEY,
        version: manifest.version,
        generatedAt: new Date(manifest.generatedAt),
        payload: JSON.stringify(manifest),
        payloadSizeBytes: BigInt(Buffer.byteLength(JSON.stringify(manifest))),
        createdAt: new Date("2026-05-29T12:00:01.000Z"),
        updatedAt: new Date("2026-05-29T12:00:02.000Z"),
      },
    ])
    const store = new WatchRouteManifestStore(prisma)

    const snapshot = await store.getLatest()

    expect(snapshot?.payload).toEqual(manifest)
    expect(snapshot?.payloadSizeBytes).toBe(
      Buffer.byteLength(JSON.stringify(manifest)),
    )
  })

  it("fails if an upsert does not produce a readable latest snapshot", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([])
    const store = new WatchRouteManifestStore(prisma)

    await expect(store.upsertLatest(manifest)).rejects.toThrow(
      "watch route manifest snapshot missing after upsert",
    )
  })
})
