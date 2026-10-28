import { randomUUID } from "node:crypto"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createRecommendationEventEnvelope } from "./envelope"
import {
  acknowledgeRecommendationEvents,
  claimRecommendationEvents,
  deferRecommendationEvent,
  disposeExpiredRecommendationEvents,
  enqueueRecommendationEvent,
  getRecommendationOutboxUsage,
} from "./outbox"

const run = process.env.RECOMMENDATION_OUTBOX_DB_TEST === "1"
describe.skipIf(!run)("recommendation event outbox on owned PostgreSQL", () => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  })
  const limits = { maxEvents: 3, maxBytes: 50_000 }
  const at = new Date("2099-10-28T01:00:01.000Z")
  let ordinal = 0
  const envelope = (overrides: Record<string, unknown> = {}) =>
    createRecommendationEventEnvelope({
      family: "playback-fact",
      logicalId: `fact-${++ordinal}-${randomUUID()}`,
      revision: 1,
      occurredAt: new Date("2099-10-28T01:00:00.000Z"),
      acceptedAt: at,
      expiresAt: new Date("2099-11-11T01:00:00.000Z"),
      payload: { kind: "STARTED" },
      allowedFields: ["kind"],
      ...overrides,
    })
  beforeAll(async () => {
    // The test runner supplies an owned disposable database with only this migration applied.
    if (new URL(process.env.DATABASE_URL!).pathname !== "/outbox_test")
      throw new Error(
        "Outbox integration tests require the disposable outbox_test database",
      )
    await db.$connect()
    await db.$executeRaw`TRUNCATE recommendation_event_outbox, recommendation_event_outbox_capacity`
  })
  afterAll(async () => {
    await db.$disconnect()
  })

  it("commits with the caller transaction and leaves no outbox entry on rollback", async () => {
    const event = envelope()
    await expect(
      db.$transaction(async (tx) => {
        expect(await enqueueRecommendationEvent(tx, event, limits)).toBe(
          "enqueued",
        )
        throw new Error("caller failed")
      }),
    ).rejects.toThrow("caller failed")
    expect(
      await db.$transaction((tx) => getRecommendationOutboxUsage(tx)),
    ).toEqual({ events: 0, bytes: 0 })
    expect(
      await db.$transaction((tx) =>
        enqueueRecommendationEvent(tx, event, limits),
      ),
    ).toBe("enqueued")
  })

  it("deduplicates identical identity and rejects changed original expiry", async () => {
    const event = envelope()
    expect(
      await db.$transaction((tx) =>
        enqueueRecommendationEvent(tx, event, limits),
      ),
    ).toBe("enqueued")
    expect(
      await db.$transaction((tx) =>
        enqueueRecommendationEvent(tx, event, limits),
      ),
    ).toBe("duplicate")
    const changedExpiry = envelope({
      logicalId: event.logicalId,
      expiresAt: new Date("2099-11-12T01:00:00.000Z"),
    })
    expect(changedExpiry.payloadDigest).toBe(event.payloadDigest)
    await expect(
      db.$transaction((tx) =>
        enqueueRecommendationEvent(tx, changedExpiry, limits),
      ),
    ).rejects.toThrow("identity conflicts")
    expect(
      (await db.$transaction((tx) => getRecommendationOutboxUsage(tx))).events,
    ).toBe(2)
  })

  it("enforces event and byte caps atomically under concurrent admission", async () => {
    const candidates = [envelope(), envelope(), envelope()]
    const results = await Promise.allSettled(
      candidates.map((event) =>
        db.$transaction((tx) => enqueueRecommendationEvent(tx, event, limits)),
      ),
    )
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(2)
    expect(
      (await db.$transaction((tx) => getRecommendationOutboxUsage(tx))).events,
    ).toBe(3)
  })

  it("leases bounded due rows, fences stale acknowledgements, and retries after expiry", async () => {
    const first = await db.$transaction((tx) =>
      claimRecommendationEvents(tx, { now: at, limit: 2, leaseMs: 1000 }),
    )
    expect(first).toHaveLength(2)
    const other = await db.$transaction((tx) =>
      claimRecommendationEvents(tx, { now: at, limit: 2, leaseMs: 1000 }),
    )
    expect(other).toHaveLength(1)
    const next = await db.$transaction((tx) =>
      claimRecommendationEvents(tx, {
        now: new Date(at.getTime() + 1001),
        limit: 1,
        leaseMs: 1000,
      }),
    )
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(first[0].id)
    expect(
      await db.$transaction((tx) =>
        acknowledgeRecommendationEvents(tx, [
          { id: first[0].id, token: first[0].token },
        ]),
      ),
    ).toBe(0)
    expect(
      await db.$transaction((tx) =>
        deferRecommendationEvent(
          tx,
          next[0].id,
          next[0].token,
          new Date(at.getTime() + 5000),
        ),
      ),
    ).toBe(true)
    expect(
      await db.$transaction((tx) =>
        acknowledgeRecommendationEvents(tx, [
          { id: other[0].id, token: other[0].token },
        ]),
      ),
    ).toBe(1)
    expect(
      await db.$transaction((tx) =>
        claimRecommendationEvents(tx, {
          now: new Date(at.getTime() + 2000),
          limit: 3,
          leaseMs: 1000,
        }),
      ),
    ).toHaveLength(1)
  })

  it("disposes original-expired pending rows and releases capacity", async () => {
    const expiredAt = new Date("2099-11-12T01:00:00.000Z")
    expect(
      await db.$transaction((tx) =>
        disposeExpiredRecommendationEvents(tx, { now: expiredAt, limit: 10 }),
      ),
    ).toBe(2)
    expect(
      await db.$transaction((tx) => getRecommendationOutboxUsage(tx)),
    ).toEqual({ events: 0, bytes: 0 })
  })

  it("serializes concurrent duplicate admission without consuming a second slot", async () => {
    const event = envelope()
    const results = await Promise.all([
      db.$transaction((tx) => enqueueRecommendationEvent(tx, event, limits)),
      db.$transaction((tx) => enqueueRecommendationEvent(tx, event, limits)),
    ])
    expect(results.sort()).toEqual(["duplicate", "enqueued"])
    expect(
      (await db.$transaction((tx) => getRecommendationOutboxUsage(tx))).events,
    ).toBe(1)
    expect(
      await db.$transaction((tx) =>
        disposeExpiredRecommendationEvents(tx, {
          now: new Date("2099-11-12T01:00:00.000Z"),
          limit: 10,
        }),
      ),
    ).toBe(1)
  })

  it("skips a row claimed by another live transaction", async () => {
    await db.$transaction((tx) =>
      enqueueRecommendationEvent(tx, envelope(), limits),
    )
    await db.$transaction((tx) =>
      enqueueRecommendationEvent(tx, envelope(), limits),
    )
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let claimed!: (
      value: Awaited<ReturnType<typeof claimRecommendationEvents>>,
    ) => void
    const entered = new Promise<
      Awaited<ReturnType<typeof claimRecommendationEvents>>
    >((resolve) => {
      claimed = resolve
    })
    const firstTransaction = db.$transaction(async (tx) => {
      const first = await claimRecommendationEvents(tx, {
        now: at,
        limit: 1,
        leaseMs: 1000,
      })
      claimed(first)
      await held
      return first
    })
    const first = await entered
    const second = await db.$transaction((tx) =>
      claimRecommendationEvents(tx, { now: at, limit: 1, leaseMs: 1000 }),
    )
    release()
    await firstTransaction
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0].id).not.toBe(first[0].id)
    expect(
      await db.$transaction((tx) =>
        disposeExpiredRecommendationEvents(tx, {
          now: new Date("2099-11-12T01:00:00.000Z"),
          limit: 10,
        }),
      ),
    ).toBe(2)
  })

  it("recovers a pending lease with a fresh worker client", async () => {
    const event = envelope()
    await db.$transaction((tx) => enqueueRecommendationEvent(tx, event, limits))
    const old = await db.$transaction((tx) =>
      claimRecommendationEvents(tx, {
        now: at,
        limit: 1,
        leaseMs: 1000,
      }),
    )
    const restarted = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    })
    try {
      const replay = await restarted.$transaction((tx) =>
        claimRecommendationEvents(tx, {
          now: new Date(at.getTime() + 1001),
          limit: 1,
          leaseMs: 1000,
        }),
      )
      expect(replay).toHaveLength(1)
      expect(replay[0].id).toBe(old[0].id)
      expect(replay[0].envelope).toEqual(event)
      expect(replay[0].attempts).toBe(2)
      expect(
        await restarted.$transaction((tx) =>
          acknowledgeRecommendationEvents(tx, [
            { id: replay[0].id, token: replay[0].token },
          ]),
        ),
      ).toBe(1)
    } finally {
      await restarted.$disconnect()
    }
  })

  it("enforces the measured serialized byte cap", async () => {
    const event = envelope()
    const bytes = Buffer.byteLength(JSON.stringify(event))
    // Fixture reconfiguration is safe only while this owned outbox is empty.
    await db.$executeRaw`DELETE FROM recommendation_event_outbox_capacity WHERE id = 1`
    const byteLimits = { maxEvents: 3, maxBytes: bytes }
    expect(
      await db.$transaction((tx) =>
        enqueueRecommendationEvent(tx, event, byteLimits),
      ),
    ).toBe("enqueued")
    await expect(
      db.$transaction((tx) =>
        enqueueRecommendationEvent(tx, envelope(), byteLimits),
      ),
    ).rejects.toThrow("capacity exhausted")
  })
})
