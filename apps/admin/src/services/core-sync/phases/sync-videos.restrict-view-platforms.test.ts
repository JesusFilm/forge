// Regression suite for JesusFilm/forge#2324.
//
// Core Sync identified itself to Core as `watch` and then read Core's PUBLIC
// `videos` root field, which excludes every video restricted from the caller's
// own client name. The sync exists partly to observe those restrictions, so it
// was structurally unable to see the only rows it cared about.
//
// These tests run the REAL `core-client.ts` against a Core-semantics double
// installed at `fetch`, so the client-name header and the root field are both
// live inputs rather than assumptions. See `../test-doubles/core-gateway.ts`
// for the 2026-09-16 live-gateway probes each modelled rule came from.

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createCoreGatewayDouble,
  type CoreGatewayVideo,
} from "../test-doubles/core-gateway"
import { createPrismaVideoStore } from "../test-doubles/prisma-video-store"
import { syncVideos } from "./sync-videos"
import { syncVideoImages } from "./sync-video-images"

const RESTRICTED_ID = "2_ElCamImpulsesVert"
const VISIBLE_ID = "2_ElCamImpulses"

function coreVideo(
  id: string,
  overrides: Partial<CoreGatewayVideo> = {},
): CoreGatewayVideo {
  return {
    id,
    restrictViewPlatforms: [],
    published: true,
    ...overrides,
  }
}

function noopProgress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("core sync reads restrictions Core would hide from `watch`", () => {
  it("records a restriction applied in Core after Forge already synced the video", async () => {
    // The production bug, exactly: the video syncs cleanly while unrestricted,
    // an editor restricts it from Watch in Nexus, and the next sync must see
    // that. Before the fix the second sync reads the public field as `watch`,
    // Core hides the row, and Forge keeps believing it is unrestricted — so
    // jesusfilm.org/watch keeps serving it.
    const gateway = createCoreGatewayDouble({
      videos: [coreVideo(VISIBLE_ID), coreVideo(RESTRICTED_ID)],
    })
    vi.stubGlobal("fetch", gateway.fetch)
    const store = createPrismaVideoStore()

    await syncVideos({
      prisma: store.client as never,
      progress: noopProgress(),
    })
    expect(store.get(RESTRICTED_ID)?.restrictViewPlatforms).toEqual([])

    gateway.videos = [
      coreVideo(VISIBLE_ID),
      coreVideo(RESTRICTED_ID, { restrictViewPlatforms: ["watch"] }),
    ]

    await syncVideos({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(store.get(RESTRICTED_ID)?.restrictViewPlatforms).toEqual(["watch"])
  })

  it("records a restriction on a video Forge has never seen before", async () => {
    // Cold start: the restriction predates Forge's first sync. The public
    // field never yields the row at all, so Forge does not just miss the
    // restriction — it misses the video.
    const gateway = createCoreGatewayDouble({
      videos: [
        coreVideo(VISIBLE_ID),
        coreVideo(RESTRICTED_ID, {
          restrictViewPlatforms: ["watch", "arclight"],
        }),
      ],
    })
    vi.stubGlobal("fetch", gateway.fetch)
    const store = createPrismaVideoStore()

    await syncVideos({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(store.get(RESTRICTED_ID)?.restrictViewPlatforms).toEqual([
      "watch",
      "arclight",
    ])
  })

  it("clears a restriction that was lifted in Core", async () => {
    // Convergence in the other direction: reading the publisher field means an
    // empty `restrictViewPlatforms` is an OBSERVATION, not an absence of data.
    //
    // Honest note — this is the ONE test in this file that does NOT go red when
    // the fix is reverted, and it cannot be made to. Lifting a restriction is
    // precisely the case the public field already handled: once Core clears
    // `restrictViewPlatforms`, the row reappears on `videos` too. Its job is
    // not to catch #2324 but to stop a future "fix" that only ever ACCUMULATES
    // restrictions (e.g. merging instead of replacing), which would leave a
    // lifted restriction stuck on forever. Every other test here was falsified
    // against a targeted revert; see the pull request for the matrix.
    const gateway = createCoreGatewayDouble({
      videos: [
        coreVideo(VISIBLE_ID),
        coreVideo(RESTRICTED_ID, { restrictViewPlatforms: ["watch"] }),
      ],
    })
    vi.stubGlobal("fetch", gateway.fetch)
    const store = createPrismaVideoStore()
    store.seed({ coreId: RESTRICTED_ID, restrictViewPlatforms: ["watch"] })

    gateway.videos = [coreVideo(VISIBLE_ID), coreVideo(RESTRICTED_ID)]
    await syncVideos({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(store.get(RESTRICTED_ID)?.restrictViewPlatforms).toEqual([])
  })

  it("does not soft-delete a restricted video, and restores one an earlier sync tombstoned", async () => {
    // Soft-delete means "Core no longer has this video". While the sync read
    // the public field as `watch`, restriction was indistinguishable from
    // deletion, so a full sync tombstoned every Watch-restricted video. The
    // restore needs no repair step: the ordinary upsert sets `deletedAt: null`.
    const gateway = createCoreGatewayDouble({
      videos: [
        coreVideo(VISIBLE_ID),
        coreVideo(RESTRICTED_ID, { restrictViewPlatforms: ["watch"] }),
      ],
    })
    vi.stubGlobal("fetch", gateway.fetch)
    const store = createPrismaVideoStore()
    const tombstoned = store.seed({
      coreId: RESTRICTED_ID,
      deletedAt: new Date("2026-09-01T00:00:00.000Z"),
    })
    expect(tombstoned.deletedAt).not.toBeNull()

    const stats = await syncVideos({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(store.get(RESTRICTED_ID)?.deletedAt).toBeNull()
    expect(stats.softDeleted).toBe(0)
  })

  it("keeps sending x-graphql-client-name: watch while reading the publisher field", async () => {
    // Deliberate, and load-bearing: Core's downloads resolver keys off this
    // header, so dropping it would silently change which download variants the
    // sync observes. #2324's fix is to change the FIELD, not the identity — the
    // publisher field applies no restriction filter, so the header is harmless
    // there. If a future change removes the header, this assertion fails and
    // the reason is right here rather than in a Core changelog.
    const gateway = createCoreGatewayDouble({
      videos: [coreVideo(VISIBLE_ID)],
    })
    vi.stubGlobal("fetch", gateway.fetch)
    const store = createPrismaVideoStore()

    await syncVideos({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(gateway.requests.length).toBeGreaterThan(0)
    for (const request of gateway.requests) {
      expect(request.clientName).toBe("watch")
      expect(request.rootField).toBe("adminVideos")
    }
  })

  it("fails loudly and soft-deletes nothing if Core rejects the publisher field", async () => {
    // The one belief the 2026-09-16 live probes could not confirm with Core
    // Sync's own credential is that it satisfies Core's publisher gate. If it
    // does not, Core answers with a GraphQL error rather than an empty list —
    // so the failure mode is a failed sync, never a silently emptied catalogue.
    const gateway = createCoreGatewayDouble({
      videos: [coreVideo(VISIBLE_ID), coreVideo(RESTRICTED_ID)],
      unauthorizedForPublisherField: true,
    })
    vi.stubGlobal("fetch", gateway.fetch)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const store = createPrismaVideoStore()
    const existing = store.seed({ coreId: VISIBLE_ID })

    await expect(
      syncVideos({ prisma: store.client as never, progress: noopProgress() }),
    ).rejects.toThrow(/Not authorized to resolve Query.adminVideos/)

    expect(store.get(VISIBLE_ID)?.deletedAt).toBeNull()
    expect(existing.deletedAt).toBeNull()
  })
})

describe("core sync reads images for restricted videos", () => {
  it("syncs images for a Watch-restricted video", async () => {
    const gateway = createCoreGatewayDouble({
      videos: [
        coreVideo(RESTRICTED_ID, {
          restrictViewPlatforms: ["watch"],
          images: [{ id: "image-restricted" }],
        }),
      ],
    })
    vi.stubGlobal("fetch", gateway.fetch)
    const store = createPrismaVideoStore()
    const row = store.seed({ coreId: RESTRICTED_ID })

    const stats = await syncVideoImages({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(stats.errors).toBe(0)
    expect(store.images.get("image-restricted")?.videoId).toBe(row.id)
  })

  it("does not sync images for an unpublished video", async () => {
    // Behavioural proof that the images phase now sends `published: true`. The
    // publisher field applies no implicit published filter, so without that
    // clause the images phase would start importing images for drafts that the
    // catalogue phase deliberately never creates a Video row for.
    const gateway = createCoreGatewayDouble({
      videos: [
        coreVideo("draft-video", {
          published: false,
          images: [{ id: "image-draft" }],
        }),
      ],
    })
    vi.stubGlobal("fetch", gateway.fetch)
    const store = createPrismaVideoStore()
    store.seed({ coreId: "draft-video" })

    await syncVideoImages({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(store.images.has("image-draft")).toBe(false)
    expect(gateway.requests[0]?.variables.where).toMatchObject({
      published: true,
    })
  })

  it("gives up instead of paginating forever when Core rejects every page", async () => {
    // The images phase isolates page failures: record, advance `offset`,
    // continue. That is right for a transient hiccup and wrong for a permanent
    // rejection — and moving to a gated root field makes a permanent rejection
    // plausible in a way it was not before. Without a bound this test hangs
    // until vitest's timeout rather than failing an assertion.
    const gateway = createCoreGatewayDouble({
      videos: [coreVideo(RESTRICTED_ID, { images: [{ id: "image-1" }] })],
      unauthorizedForPublisherField: true,
    })
    vi.stubGlobal("fetch", gateway.fetch)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const store = createPrismaVideoStore()
    store.seed({ coreId: RESTRICTED_ID })

    const stats = await syncVideoImages({
      prisma: store.client as never,
      progress: noopProgress(),
    })

    expect(gateway.requests.length).toBe(3)
    expect(stats.errors).toBe(3)
    // errors > 0 keeps the soft-delete pass from running, so a sync that could
    // not read anything never tombstones what it failed to see.
    expect(stats.softDeleted).toBe(0)
  })
})
