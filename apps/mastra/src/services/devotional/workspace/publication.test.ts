import { describe, expect, it, vi } from "vitest"

import type { DevotionalDatabase, QueryExecutor } from "./database"
import { publishWithDurableIntent } from "./publication"

function databaseFixture() {
  let intent:
    | {
        id: string
        attempt_id: string
        request_hash: string
        receiver_idempotency_key: string
        state: "pending" | "accepted" | "failed" | "ambiguous"
        receiver_reference: string | null
      }
    | undefined
  const clip = {
    chapterId: "chapter-1",
    reservationId: "reservation-1" as string | null,
    attemptId: null as string | null,
    useCount: 0,
  }
  let historyCount = 0

  const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    const normalized = sql.replace(/\s+/gu, " ").toLowerCase()
    if (normalized.includes("pg_advisory_xact_lock")) {
      return { rows: [], rowCount: 1 }
    }
    if (
      normalized.includes("from devotional_workspace.publication_intents") &&
      normalized.includes("for update")
    ) {
      return { rows: intent ? [intent] : [], rowCount: intent ? 1 : 0 }
    }
    if (
      normalized.includes(
        "insert into devotional_workspace.publication_intents",
      )
    ) {
      intent = {
        id: String(values[0]),
        attempt_id: String(values[1]),
        request_hash: String(values[2]),
        receiver_idempotency_key: String(values[3]),
        state: "pending",
        receiver_reference: null,
      }
      return { rows: [intent], rowCount: 1 }
    }
    if (
      normalized.includes("update devotional_workspace.clip_state") &&
      normalized.includes("reservation_attempt_id = $3")
    ) {
      const owned =
        clip.chapterId === values[0] && clip.reservationId === values[1]
      if (owned) clip.attemptId = String(values[2])
      return {
        rows: owned ? [{ chapter_id: clip.chapterId }] : [],
        rowCount: owned ? 1 : 0,
      }
    }
    if (
      normalized.includes("update devotional_workspace.publication_intents") &&
      normalized.includes("state = 'ambiguous'")
    ) {
      if (intent && intent.state !== "accepted") intent.state = "ambiguous"
      return { rows: [], rowCount: intent ? 1 : 0 }
    }
    if (
      normalized.includes("update devotional_workspace.publication_intents") &&
      normalized.includes("state = 'failed'")
    ) {
      if (intent) intent.state = "failed"
      return { rows: [], rowCount: intent ? 1 : 0 }
    }
    if (
      normalized.includes("update devotional_workspace.clip_state") &&
      normalized.includes("use_count = use_count + 1")
    ) {
      const owned =
        clip.chapterId === values[0] && clip.reservationId === values[1]
      if (owned) {
        clip.useCount += 1
        clip.reservationId = null
        clip.attemptId = null
      }
      return {
        rows: owned ? [{ chapter_id: clip.chapterId }] : [],
        rowCount: owned ? 1 : 0,
      }
    }
    if (
      normalized.includes(
        "insert into devotional_workspace.publication_history",
      )
    ) {
      historyCount = Math.max(historyCount, 1)
      return { rows: [], rowCount: 1 }
    }
    if (
      normalized.includes("update devotional_workspace.publication_intents") &&
      normalized.includes("state = 'accepted'")
    ) {
      if (intent) {
        intent.state = "accepted"
        intent.receiver_reference = String(values[1])
      }
      return { rows: [], rowCount: intent ? 1 : 0 }
    }
    if (
      normalized.includes("update devotional_workspace.clip_state") &&
      normalized.includes("reservation_id = null")
    ) {
      const owned =
        clip.chapterId === values[0] && clip.reservationId === values[1]
      if (owned) {
        clip.reservationId = null
        clip.attemptId = null
      }
      return { rows: [], rowCount: owned ? 1 : 0 }
    }
    throw new Error(`Unhandled test query: ${normalized}`)
  })
  const client = { query: query as unknown as QueryExecutor["query"] }
  const database = {
    pool: {},
    maxConnections: 3,
    query: client.query,
    transaction: async <T>(work: (value: QueryExecutor) => Promise<T>) =>
      work(client),
    close: async () => {},
  } as unknown as DevotionalDatabase
  return {
    database,
    clip,
    get intent() {
      return intent
    },
    get historyCount() {
      return historyCount
    },
  }
}

const input = {
  attemptId: "attempt-1",
  chapterId: "chapter-1",
  reservationId: "reservation-1",
  requestHash: "a".repeat(64),
  receiverIdempotencyKey: "daily-devotional:2026-07-31",
}

describe("durable devotional publication", () => {
  it("commits one clip usage and one history row across accepted replay", async () => {
    const fixture = databaseFixture()
    const send = vi.fn(async () => ({ ok: true as const, published: true }))

    await expect(
      publishWithDurableIntent({ ...input, database: fixture.database, send }),
    ).resolves.toMatchObject({ ok: true, published: true })
    await expect(
      publishWithDurableIntent({ ...input, database: fixture.database, send }),
    ).resolves.toMatchObject({ ok: true, published: true, replayed: true })

    expect(send).toHaveBeenCalledOnce()
    expect(fixture.clip.useCount).toBe(1)
    expect(fixture.historyCount).toBe(1)
    expect(fixture.intent?.state).toBe("accepted")
  })

  it("retains an ambiguous reservation and safely replays the receiver key", async () => {
    const fixture = databaseFixture()
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "upstream_failed",
        retryable: true,
      })
      .mockResolvedValueOnce({ ok: true, published: true })

    await expect(
      publishWithDurableIntent({ ...input, database: fixture.database, send }),
    ).resolves.toMatchObject({ ambiguous: true })
    expect(fixture.intent?.state).toBe("ambiguous")
    expect(fixture.clip.reservationId).toBe("reservation-1")

    await expect(
      publishWithDurableIntent({ ...input, database: fixture.database, send }),
    ).resolves.toMatchObject({ ok: true, published: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(fixture.clip.useCount).toBe(1)
  })

  it("releases the reservation on a definitive non-acceptance", async () => {
    const fixture = databaseFixture()
    const send = vi.fn(async () => ({ ok: true as const, published: false }))

    await expect(
      publishWithDurableIntent({ ...input, database: fixture.database, send }),
    ).resolves.toEqual({ ok: true, published: false })
    expect(fixture.intent?.state).toBe("failed")
    expect(fixture.clip.reservationId).toBeNull()
    expect(fixture.clip.useCount).toBe(0)
  })
})
