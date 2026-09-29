import { afterEach, describe, expect, it, vi } from "vitest"

import {
  attributeEpisodeAfterPushOpen,
  attributeEpisodeToStoredOpen,
  attributeOpenToIssuedEpisode,
  attributePushOpenAfterIssuance,
  PUSH_ATTRIBUTION_BUDGET_MS,
  PUSH_ATTRIBUTION_WINDOW_HOURS,
} from "./attribution.service"
import type { PushStoredOpen } from "./open-report.service"

const VIEWER_DIGEST = "a".repeat(64)
const OTHER_VIEWER_DIGEST = "b".repeat(64)
const SESSION_DIGEST = "c".repeat(64)
const ROTATED_SESSION_DIGEST = "d".repeat(64)
const HOUR_MS = 60 * 60 * 1_000
const WINDOW_MS = PUSH_ATTRIBUTION_WINDOW_HOURS * HOUR_MS

const OPEN_AT = new Date("2026-10-01T21:00:00.000Z")
const SENDING_AT = new Date("2026-10-01T20:00:00.000Z")

type OpenRow = {
  id: string
  campaignId: string
  registrationId: string | null
  viewerDigest: string | null
  sessionDigest: string | null
  languageSlug: string | null
  country: string | null
  viewerMismatch: boolean
  receivedAt: Date
}

type EpisodeRow = {
  id: string
  mediaId: string
  sessionDigest: string
  createdAt: Date
}

function openRow(overrides: Partial<OpenRow> = {}): OpenRow {
  return {
    id: "open_1",
    campaignId: "campaign_1",
    registrationId: "reg_1",
    viewerDigest: VIEWER_DIGEST,
    sessionDigest: SESSION_DIGEST,
    languageSlug: "french",
    country: "FR",
    viewerMismatch: false,
    receivedAt: OPEN_AT,
    ...overrides,
  }
}

function episodeRow(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: "episode_1",
    mediaId: "the-video",
    sessionDigest: SESSION_DIGEST,
    createdAt: new Date(OPEN_AT.getTime() - 200),
    ...overrides,
  }
}

function storedOpen(overrides: Partial<PushStoredOpen> = {}): PushStoredOpen {
  return {
    id: "open_1",
    deliveryId: "delivery_1",
    campaignId: "campaign_1",
    registrationId: "reg_1",
    viewerDigest: VIEWER_DIGEST,
    sessionDigest: SESSION_DIGEST,
    languageSlug: "french",
    country: "FR",
    viewerMismatch: false,
    receivedAt: OPEN_AT,
    deliverySendingAt: SENDING_AT,
    ...overrides,
  }
}

type Bound = { gte?: Date; lte?: Date }

/**
 * A stand-in for the two indexed reads. It honours only the operators the
 * service uses, so the window and mismatch rules are exercised as behaviour.
 * The real Postgres contract lives in `attribution.db.test.ts`.
 */
function inBound(value: Date, bound: Bound | undefined): boolean {
  if (!bound) return true
  if (bound.gte && value.getTime() < bound.gte.getTime()) return false
  if (bound.lte && value.getTime() > bound.lte.getTime()) return false
  return true
}

function newest<T extends { id: string }>(
  rows: T[],
  at: (row: T) => Date,
): T | null {
  const sorted = [...rows].sort((left, right) => {
    const gap = at(right).getTime() - at(left).getTime()
    return gap !== 0 ? gap : right.id.localeCompare(left.id)
  })
  return sorted[0] ?? null
}

function buildPrisma(
  options: {
    opens?: OpenRow[]
    episodes?: EpisodeRow[]
    createFails?: unknown
  } = {},
) {
  const created: Record<string, unknown>[] = []
  const openWheres: Record<string, Bound | unknown>[] = []
  const episodeWheres: Record<string, Bound | unknown>[] = []
  const opens = options.opens ?? []
  const episodes = options.episodes ?? []
  const client = {
    pushOpen: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, never> }) => {
        openWheres.push(where)
        const match = opens.filter((row) => {
          const filter = where as unknown as {
            viewerDigest?: string
            sessionDigest?: string
            viewerMismatch?: boolean
            receivedAt?: Bound
          }
          if (
            filter.viewerDigest !== undefined &&
            row.viewerDigest !== filter.viewerDigest
          )
            return false
          if (
            filter.sessionDigest !== undefined &&
            row.sessionDigest !== filter.sessionDigest
          )
            return false
          if (
            filter.viewerMismatch !== undefined &&
            row.viewerMismatch !== filter.viewerMismatch
          )
            return false
          return inBound(row.receivedAt, filter.receivedAt)
        })
        return newest(match, (row) => row.receivedAt)
      }),
    },
    recommendationPlaybackEpisode: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, never> }) => {
        episodeWheres.push(where)
        const match = episodes.filter((row) => {
          const filter = where as unknown as {
            sessionDigest?: string
            createdAt?: Bound
          }
          if (
            filter.sessionDigest !== undefined &&
            row.sessionDigest !== filter.sessionDigest
          )
            return false
          return inBound(row.createdAt, filter.createdAt)
        })
        return newest(match, (row) => row.createdAt)
      }),
    },
    pushAttribution: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (options.createFails) throw options.createFails
        if (created.some((row) => row.episodeId === data.episodeId)) {
          throw Object.assign(new Error("unique"), { code: "P2002" })
        }
        created.push(data)
        return { id: `attribution_${created.length}` }
      }),
    },
  }
  return { client, created, openWheres, episodeWheres }
}

function issued(overrides: Record<string, unknown> = {}) {
  return {
    episodeId: "episode_1",
    mediaId: "the-video",
    viewerDigest: VIEWER_DIGEST,
    sessionDigest: SESSION_DIGEST,
    issuedAt: new Date(OPEN_AT.getTime() + HOUR_MS),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("attributing an open to a context the app just issued", () => {
  it("attributes a context one hour after the open (AE16)", async () => {
    const { client, created } = buildPrisma({ opens: [openRow()] })
    const result = await attributeOpenToIssuedEpisode(client as never, issued())
    expect(result).toEqual({ outcome: "attributed", campaignId: "campaign_1" })
    expect(created).toHaveLength(1)
    expect(created[0]).toEqual({
      episodeId: "episode_1",
      openId: "open_1",
      campaignId: "campaign_1",
      registrationId: "reg_1",
      viewerDigest: VIEWER_DIGEST,
      languageSlug: "french",
      country: "FR",
      mediaId: "the-video",
      attributedAt: new Date(OPEN_AT.getTime() + HOUR_MS),
    })
  })

  it("does not attribute a context a day and an hour after the open (AE16)", async () => {
    const { client, created } = buildPrisma({ opens: [openRow()] })
    const result = await attributeOpenToIssuedEpisode(
      client as never,
      issued({ issuedAt: new Date(OPEN_AT.getTime() + 25 * HOUR_MS) }),
    )
    expect(result.outcome).toBe("no_open")
    expect(created).toHaveLength(0)
  })

  it("holds the window open at exactly a day and shuts it one millisecond later", async () => {
    // The two cases below derive their instants from this constant, so the
    // bound itself is pinned here or a widened window passes them both.
    expect(PUSH_ATTRIBUTION_WINDOW_HOURS).toBe(24)
    const onTheEdge = buildPrisma({ opens: [openRow()] })
    await expect(
      attributeOpenToIssuedEpisode(
        onTheEdge.client as never,
        issued({ issuedAt: new Date(OPEN_AT.getTime() + WINDOW_MS) }),
      ),
    ).resolves.toMatchObject({ outcome: "attributed" })

    const pastTheEdge = buildPrisma({ opens: [openRow()] })
    await expect(
      attributeOpenToIssuedEpisode(
        pastTheEdge.client as never,
        issued({ issuedAt: new Date(OPEN_AT.getTime() + WINDOW_MS + 1) }),
      ),
    ).resolves.toMatchObject({ outcome: "no_open" })
    expect(pastTheEdge.created).toHaveLength(0)
  })

  it("never attributes a context to an open that predates the issuance window's end", async () => {
    // An open the phone reported after this context was issued belongs to the
    // reverse join, never to this one.
    const { client, created } = buildPrisma({
      opens: [openRow({ receivedAt: new Date(OPEN_AT.getTime() + HOUR_MS) })],
    })
    const result = await attributeOpenToIssuedEpisode(
      client as never,
      issued({ issuedAt: OPEN_AT }),
    )
    expect(result.outcome).toBe("no_open")
    expect(created).toHaveLength(0)
  })

  it("picks the more recent of two opens inside the window", async () => {
    const { client, created } = buildPrisma({
      opens: [
        openRow({
          id: "open_old",
          campaignId: "campaign_old",
          receivedAt: new Date(OPEN_AT.getTime() - 2 * HOUR_MS),
        }),
        openRow({ id: "open_new", campaignId: "campaign_new" }),
      ],
    })
    const result = await attributeOpenToIssuedEpisode(client as never, issued())
    expect(result.campaignId).toBe("campaign_new")
    expect(created[0]).toMatchObject({ openId: "open_new" })
  })

  it("attributes through the viewer digest when the session rotated", async () => {
    const { client, created, openWheres } = buildPrisma({
      opens: [openRow({ sessionDigest: SESSION_DIGEST })],
    })
    const result = await attributeOpenToIssuedEpisode(
      client as never,
      issued({ sessionDigest: ROTATED_SESSION_DIGEST }),
    )
    expect(result.outcome).toBe("attributed")
    expect(created).toHaveLength(1)
    // The viewer rung answered, so the session rung never ran.
    expect(openWheres).toHaveLength(1)
    expect(openWheres[0]).toMatchObject({ viewerDigest: VIEWER_DIGEST })
  })

  it("falls back to the session digest when the viewer digest finds nothing", async () => {
    const { client, created, openWheres } = buildPrisma({
      opens: [openRow({ viewerDigest: null })],
    })
    const result = await attributeOpenToIssuedEpisode(client as never, issued())
    expect(result.outcome).toBe("attributed")
    expect(openWheres).toHaveLength(2)
    expect(openWheres[1]).toMatchObject({ sessionDigest: SESSION_DIGEST })
    expect(created[0]).toMatchObject({ viewerDigest: null })
  })

  it("never attributes a mismatched open, and does attribute the same row once the flag clears", async () => {
    const mismatched = buildPrisma({
      opens: [openRow({ viewerMismatch: true })],
    })
    await expect(
      attributeOpenToIssuedEpisode(mismatched.client as never, issued()),
    ).resolves.toMatchObject({ outcome: "no_open" })
    expect(mismatched.created).toHaveLength(0)

    const matched = buildPrisma({ opens: [openRow({ viewerMismatch: false })] })
    await expect(
      attributeOpenToIssuedEpisode(matched.client as never, issued()),
    ).resolves.toMatchObject({ outcome: "attributed" })
  })

  it("reads nothing for a caller that carries no identity", async () => {
    const { client, openWheres, created } = buildPrisma({
      opens: [openRow()],
    })
    const result = await attributeOpenToIssuedEpisode(
      client as never,
      issued({ viewerDigest: null, sessionDigest: null }),
    )
    expect(result).toEqual({ outcome: "no_identity", campaignId: null })
    expect(openWheres).toHaveLength(0)
    expect(created).toHaveLength(0)
  })

  it("inserts nothing for a second issuance of the same episode", async () => {
    const { client, created } = buildPrisma({ opens: [openRow()] })
    await attributeOpenToIssuedEpisode(client as never, issued())
    const second = await attributeOpenToIssuedEpisode(client as never, issued())
    expect(second.outcome).toBe("duplicate")
    expect(created).toHaveLength(1)
  })
})

describe("attributing a stored open to a context already issued", () => {
  it("attributes a context issued 200 milliseconds before the open", async () => {
    const { client, created } = buildPrisma({ episodes: [episodeRow()] })
    const result = await attributeEpisodeToStoredOpen(
      client as never,
      storedOpen(),
    )
    expect(result).toEqual({ outcome: "attributed", campaignId: "campaign_1" })
    expect(created[0]).toEqual({
      episodeId: "episode_1",
      openId: "open_1",
      campaignId: "campaign_1",
      registrationId: "reg_1",
      viewerDigest: VIEWER_DIGEST,
      languageSlug: "french",
      country: "FR",
      mediaId: "the-video",
      attributedAt: new Date(OPEN_AT.getTime() - 200),
    })
  })

  it("does not attribute a context issued five minutes before the open", async () => {
    const { client, created } = buildPrisma({
      episodes: [
        episodeRow({ createdAt: new Date(OPEN_AT.getTime() - 5 * 60_000) }),
      ],
    })
    const result = await attributeEpisodeToStoredOpen(
      client as never,
      storedOpen(),
    )
    expect(result.outcome).toBe("no_episode")
    expect(created).toHaveLength(0)
  })

  it("does not attribute a context issued before the delivery went out", async () => {
    // Inside the 60-second grace, so only the sending-time bound can refuse it.
    const { client, created } = buildPrisma({
      episodes: [
        episodeRow({ createdAt: new Date(OPEN_AT.getTime() - 40_000) }),
      ],
    })
    const result = await attributeEpisodeToStoredOpen(
      client as never,
      storedOpen({ deliverySendingAt: new Date(OPEN_AT.getTime() - 30_000) }),
    )
    expect(result.outcome).toBe("no_episode")
    expect(created).toHaveLength(0)
  })

  it("picks the most recent context inside the grace", async () => {
    const { client, created } = buildPrisma({
      episodes: [
        episodeRow({
          id: "episode_old",
          mediaId: "an-older-video",
          createdAt: new Date(OPEN_AT.getTime() - 40_000),
        }),
        episodeRow({ id: "episode_new", mediaId: "the-newer-video" }),
      ],
    })
    await attributeEpisodeToStoredOpen(client as never, storedOpen())
    expect(created[0]).toMatchObject({
      episodeId: "episode_new",
      mediaId: "the-newer-video",
    })
  })

  it("reads nothing for a mismatched open (KTD14)", async () => {
    const { client, created, episodeWheres } = buildPrisma({
      episodes: [episodeRow()],
    })
    const result = await attributeEpisodeToStoredOpen(
      client as never,
      storedOpen({ viewerMismatch: true, viewerDigest: OTHER_VIEWER_DIGEST }),
    )
    expect(result).toEqual({ outcome: "mismatch", campaignId: "campaign_1" })
    expect(episodeWheres).toHaveLength(0)
    expect(created).toHaveLength(0)
  })

  it("reads nothing for an open that carries no session digest", async () => {
    const { client, episodeWheres } = buildPrisma({
      episodes: [episodeRow()],
    })
    const result = await attributeEpisodeToStoredOpen(
      client as never,
      storedOpen({ sessionDigest: null }),
    )
    expect(result.outcome).toBe("no_identity")
    expect(episodeWheres).toHaveLength(0)
  })

  it("reads only the open's own session digest", async () => {
    const { client, episodeWheres } = buildPrisma({
      episodes: [episodeRow({ sessionDigest: ROTATED_SESSION_DIGEST })],
    })
    await attributeEpisodeToStoredOpen(client as never, storedOpen())
    expect(episodeWheres[0]).toMatchObject({ sessionDigest: SESSION_DIGEST })
  })
})

describe("the bounded wrappers the two call sites use", () => {
  it("answers a failure instead of throwing at the issuance resolver", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = buildPrisma({
      opens: [openRow()],
      createFails: new Error("the database fell over"),
    })
    await expect(
      attributePushOpenAfterIssuance(client as never, issued()),
    ).resolves.toMatchObject({ outcome: "failed" })
  })

  it("answers a failure instead of throwing at the open report", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = buildPrisma({
      episodes: [episodeRow()],
      createFails: new Error("the database fell over"),
    })
    await expect(
      attributeEpisodeAfterPushOpen(client as never, storedOpen()),
    ).resolves.toMatchObject({ outcome: "failed" })
  })

  it("gives up on its own budget rather than holding the caller", async () => {
    vi.useFakeTimers()
    const client = {
      pushOpen: { findFirst: () => new Promise(() => {}) },
      pushAttribution: { create: vi.fn() },
    }
    const pending = attributePushOpenAfterIssuance(client as never, issued())
    await vi.advanceTimersByTimeAsync(PUSH_ATTRIBUTION_BUDGET_MS)
    await expect(pending).resolves.toMatchObject({ outcome: "timeout" })
  })

  it("leaves no unhandled rejection when the read fails after the deadline", async () => {
    vi.useFakeTimers()
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on("unhandledRejection", onUnhandled)
    try {
      let reject: (error: unknown) => void = () => {}
      const client = {
        pushOpen: {
          findFirst: () =>
            new Promise((_resolve, fail) => {
              reject = fail
            }),
        },
        pushAttribution: { create: vi.fn() },
      }
      const pending = attributePushOpenAfterIssuance(client as never, issued())
      await vi.advanceTimersByTimeAsync(PUSH_ATTRIBUTION_BUDGET_MS)
      await expect(pending).resolves.toMatchObject({ outcome: "timeout" })
      reject(new Error("the read failed after the deadline"))
      // Real timers again: the flush below must be a real macrotask, or the
      // rejection has not reached the process yet.
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("writes no digest, media id, or episode id into a log line", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    const { client } = buildPrisma({
      opens: [openRow()],
      episodes: [episodeRow()],
    })
    await attributePushOpenAfterIssuance(client as never, issued())
    await attributeEpisodeAfterPushOpen(client as never, storedOpen())
    const combined = spies
      .flatMap((spy) => spy.mock.calls.map((args) => String(args[0] ?? "")))
      .join("\n")
    expect(combined).toContain("[push] event=attribution")
    expect(combined).not.toContain(VIEWER_DIGEST)
    expect(combined).not.toContain(SESSION_DIGEST)
    expect(combined).not.toContain("episode_1")
    expect(combined).not.toContain("the-video")
  })
})
