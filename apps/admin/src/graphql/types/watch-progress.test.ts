import { beforeEach, describe, expect, it, vi } from "vitest"

const { listWatchProgress, upsertWatchProgress, deleteWatchProgressForVideo } =
  vi.hoisted(() => ({
    listWatchProgress: vi.fn(),
    upsertWatchProgress: vi.fn(),
    deleteWatchProgressForVideo: vi.fn(),
  }))

vi.mock("@/services/watch-progress.service", () => ({
  listWatchProgress,
  upsertWatchProgress,
  deleteWatchProgressForVideo,
}))

import { schema } from "@/graphql/schema"
import type { Principal } from "@/auth/principal"

const MOBILE_USER: Principal = {
  id: "auth-user-123",
  role: "MOBILE_USER",
  rateLimitBucketKey: "auth-user-123",
}

type UpsertEntryArg = {
  videoId?: string | null
  videoSlug?: string | null
  languageSlug?: string | null
  positionSeconds: number
  durationSeconds: number
  updatedAt: string
}

type FieldWithResolve<Args> = {
  resolve: (
    root: unknown,
    args: Args,
    ctx: { user: Principal | null },
    info: unknown,
  ) => unknown
  extensions?: { pothosOptions?: { authScopes?: unknown } }
}

function queryField<Args>(name: string): FieldWithResolve<Args> {
  return schema.getQueryType()!.getFields()[
    name
  ] as unknown as FieldWithResolve<Args>
}

function mutationField<Args>(name: string): FieldWithResolve<Args> {
  return schema.getMutationType()!.getFields()[
    name
  ] as unknown as FieldWithResolve<Args>
}

beforeEach(() => {
  listWatchProgress.mockReset()
  upsertWatchProgress.mockReset()
  deleteWatchProgressForVideo.mockReset()
})

describe("auth-gate declarations", () => {
  // The permission matrix tests prove these keys resolve true ONLY for
  // MOBILE_USER (+ ADMIN override); pinning the declarations here closes
  // the loop — anonymous/consumer/web callers are denied by scope-auth.
  it("gates every progress operation on its own-data permission key", () => {
    expect(
      queryField("myWatchProgress").extensions?.pothosOptions?.authScopes,
    ).toEqual({ hasPermission: "read:watch-progress:own" })
    expect(
      mutationField("upsertMyWatchProgress").extensions?.pothosOptions
        ?.authScopes,
    ).toEqual({ hasPermission: "write:watch-progress:own" })
    expect(
      mutationField("clearMyWatchProgress").extensions?.pothosOptions
        ?.authScopes,
    ).toEqual({ hasPermission: "delete:watch-progress:own" })
  })

  it("requires the updatedAt recording timestamp at the schema level", () => {
    const inputType = schema.getType("WatchProgressUpsertInput")
    const fields = (
      inputType as unknown as {
        getFields: () => Record<string, { type: { toString: () => string } }>
      }
    ).getFields()
    // NonNull String: the service's now-time fallback would defeat the
    // monotonic guard for flushed offline entries.
    expect(fields.updatedAt?.type.toString()).toBe("String!")
    expect(fields.videoId?.type.toString()).toBe("ID")
    expect(fields.videoSlug?.type.toString()).toBe("String")
  })
})

describe("myWatchProgress", () => {
  it("resolves the caller's own entries — identity from the principal, no args", async () => {
    listWatchProgress.mockResolvedValueOnce([
      {
        videoId: "video-1",
        languageSlug: "english",
        positionSeconds: 30,
        durationSeconds: 100,
        completed: false,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ])

    const result = await queryField("myWatchProgress").resolve(
      null,
      {},
      { user: MOBILE_USER },
      {},
    )

    expect(result).toHaveLength(1)
    expect(listWatchProgress).toHaveBeenCalledWith({
      userId: "auth-user-123",
    })
  })

  it("denies anonymous, consumer-bearer, and web-user callers at the scope-auth gate", async () => {
    const deniedPrincipals: Array<Principal | null> = [
      null,
      { id: null, role: "CONSUMER_BEARER", rateLimitBucketKey: "consumer" },
      {
        id: "auth-user-9",
        role: "WEB_USER",
        rateLimitBucketKey: "auth-user-9",
      },
      { id: null, role: "WORKFLOW_TRIGGER" },
    ]
    for (const user of deniedPrincipals) {
      await expect(async () =>
        queryField("myWatchProgress").resolve(null, {}, { user }, {}),
      ).rejects.toThrow(/not authorized/i)
    }
    expect(listWatchProgress).not.toHaveBeenCalled()
  })
})

describe("upsertMyWatchProgress", () => {
  const resolve = () =>
    mutationField<{ entries: UpsertEntryArg[] }>("upsertMyWatchProgress")
      .resolve

  it("passes id- and slug-keyed entries through with the principal's identity", async () => {
    upsertWatchProgress.mockResolvedValueOnce([])

    await resolve()(
      null,
      {
        entries: [
          {
            videoId: "video-1",
            positionSeconds: 42.9,
            durationSeconds: 100,
            updatedAt: "2026-07-02T00:00:00.000Z",
          },
          {
            videoSlug: "birth-of-jesus",
            positionSeconds: 7,
            durationSeconds: 60,
            updatedAt: "2026-07-02T00:01:00.000Z",
          },
        ],
      },
      { user: MOBILE_USER },
      {},
    )

    expect(upsertWatchProgress).toHaveBeenCalledWith({
      userId: "auth-user-123",
      entries: [
        expect.objectContaining({
          videoId: "video-1",
          updatedAt: "2026-07-02T00:00:00.000Z",
        }),
        expect.objectContaining({
          videoId: null,
          videoSlug: "birth-of-jesus",
          updatedAt: "2026-07-02T00:01:00.000Z",
        }),
      ],
    })
  })

  it("rejects an entry with neither a videoId nor a videoSlug", async () => {
    await expect(async () =>
      resolve()(
        null,
        {
          entries: [
            {
              positionSeconds: 1,
              durationSeconds: 60,
              updatedAt: "2026-07-02T00:00:00.000Z",
            },
          ],
        },
        { user: MOBILE_USER },
        {},
      ),
    ).rejects.toThrow(/videoId or a videoSlug/)
    expect(upsertWatchProgress).not.toHaveBeenCalled()
  })

  it("rejects batches over the 200-entry ceiling", async () => {
    const entries = Array.from({ length: 201 }, (_, index) => ({
      videoId: `video-${index}`,
      positionSeconds: 1,
      durationSeconds: 60,
      updatedAt: "2026-07-02T00:00:00.000Z",
    }))

    await expect(async () =>
      resolve()(null, { entries }, { user: MOBILE_USER }, {}),
    ).rejects.toThrow(/at most 200/i)
    expect(upsertWatchProgress).not.toHaveBeenCalled()
  })

  it("short-circuits an empty batch without a service call", async () => {
    const result = await resolve()(
      null,
      { entries: [] },
      { user: MOBILE_USER },
      {},
    )
    expect(result).toEqual([])
    expect(upsertWatchProgress).not.toHaveBeenCalled()
  })
})

describe("clearMyWatchProgress", () => {
  const resolve = () =>
    mutationField<{ videoId: string }>("clearMyWatchProgress").resolve

  it("clears one video's row for the principal's own account", async () => {
    deleteWatchProgressForVideo.mockResolvedValueOnce({ deletedCount: 1 })

    await expect(
      resolve()(null, { videoId: "video-1" }, { user: MOBILE_USER }, {}),
    ).resolves.toBe(true)

    expect(deleteWatchProgressForVideo).toHaveBeenCalledWith({
      userId: "auth-user-123",
      videoId: "video-1",
    })
  })

  it("reports false when no row existed", async () => {
    deleteWatchProgressForVideo.mockResolvedValueOnce({ deletedCount: 0 })

    await expect(
      resolve()(null, { videoId: "video-404" }, { user: MOBILE_USER }, {}),
    ).resolves.toBe(false)
  })

  it("denies anonymous callers at the scope-auth gate", async () => {
    await expect(async () =>
      resolve()(null, { videoId: "video-1" }, { user: null }, {}),
    ).rejects.toThrow(/not authorized/i)
    expect(deleteWatchProgressForVideo).not.toHaveBeenCalled()
  })
})
