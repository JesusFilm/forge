import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { createRecommendationEventEnvelope } from "./envelope"
import {
  createRecommendationClickHouseClient,
  RecommendationClickHouseError,
} from "./clickhouse"

const run = env.RECOMMENDATION_CLICKHOUSE_DB_TEST === "1"
describe.skipIf(!run)(
  "recommendation event history on owned ClickHouse",
  () => {
    let endpoint: string
    let client: ReturnType<typeof createRecommendationClickHouseClient>
    const make = (
      logicalId: string,
      revision = 1,
      payload = "first",
      expiresAt = "2099-11-11T00:00:00.000Z",
      acceptedAt = "2099-10-28T00:00:01.000Z",
    ) =>
      createRecommendationEventEnvelope({
        family: "watch-exposure",
        logicalId,
        revision,
        occurredAt: new Date("2099-10-28T00:00:00.000Z"),
        acceptedAt: new Date(acceptedAt),
        expiresAt: new Date(expiresAt),
        payload: { kind: payload },
        allowedFields: ["kind"],
      })
    const fixtureSql = async (sql: string) => {
      const url = new URL(endpoint)
      url.searchParams.set("database", "event_clickhouse_test")
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-ClickHouse-User": "event_test",
          "X-ClickHouse-Key": "event_test_password",
        },
        body: sql,
      })
      if (!response.ok)
        throw new Error(
          `Owned ClickHouse fixture setup failed: ${response.status}`,
        )
      return response.text()
    }
    const finishServerInsert = (event: ReturnType<typeof make>) =>
      fixtureSql(
        `INSERT INTO recommendation_event_history FORMAT JSONEachRow\n${JSON.stringify(
          {
            family: event.family,
            logical_id: event.logicalId,
            revision: event.revision,
            occurred_at: event.occurredAt,
            accepted_at: event.acceptedAt,
            expires_at: event.expiresAt,
            payload_digest: event.payloadDigest,
            payload: JSON.stringify(event.payload),
          },
        )}\n`,
      )
    beforeAll(() => {
      if (!env.RECOMMENDATION_CLICKHOUSE_TEST_URL)
        throw new Error("Owned ClickHouse test URL required")
      const url = new URL(env.RECOMMENDATION_CLICKHOUSE_TEST_URL)
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.port !== "18123" ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback ClickHouse fixture required")
      endpoint = url.toString()
      client = createRecommendationClickHouseClient({
        endpoint,
        database: "event_clickhouse_test",
        username: "event_test",
        password: "event_test_password",
        allowLoopbackHttpForTest: true,
      })
    })
    beforeEach(async () => {
      await fixtureSql("TRUNCATE TABLE recommendation_event_history")
      await fixtureSql("TRUNCATE TABLE recommendation_event_erasure")
    })

    it("reads one canonical event after regrouped duplicate deliveries and a correction", async () => {
      const first = make("watch:stable")
      const correction = make("watch:stable", 2, "corrected")
      await client.insert([first])
      await client.insert([first, correction])
      await client.insert([correction])
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:stable"],
          asOf: new Date("2099-10-30"),
        }),
      ).toEqual([correction])
    })

    it("uses only revisions accepted by the report cutoff", async () => {
      const first = make("watch:as-of")
      const later = make(
        "watch:as-of",
        2,
        "corrected",
        "2099-11-11T00:00:00.000Z",
        "2099-10-29T00:00:01.000Z",
      )
      await client.insert([first, later])
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:as-of"],
          asOf: new Date("2099-10-28T12:00:00.000Z"),
        }),
      ).toEqual([first])
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:as-of"],
          asOf: new Date("2099-10-30T00:00:00.000Z"),
        }),
      ).toEqual([later])
    })

    it("retains same-revision conflicts even after physical merge", async () => {
      await client.insert([make("watch:conflict", 1, "one")])
      await expect(
        client.insert([make("watch:conflict", 1, "two")]),
      ).rejects.toMatchObject({ code: "conflict" })
      await fixtureSql("OPTIMIZE TABLE recommendation_event_history FINAL")
      await expect(
        client.read({
          family: "watch-exposure",
          logicalIds: ["watch:conflict"],
          asOf: new Date("2099-10-28T12:00:00.000Z"),
        }),
      ).rejects.toMatchObject({
        code: "conflict",
      } satisfies Partial<RecommendationClickHouseError>)
    })

    it("recovers a partially persisted failed batch by replaying stable identities", async () => {
      const first = make("watch:first")
      const second = make("watch:second")
      await client.insert([first]) // prior request may have committed before its reply failed
      await client.insert([first, second])
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:first", "watch:second"],
          asOf: new Date("2099-10-30"),
        }),
      ).toEqual([first, second])
    })

    it("does not revive an earlier revision when the latest is expired", async () => {
      await client.insert([make("watch:expiry", 1, "old")])
      await client.insert([
        make("watch:expiry", 2, "new", "2099-11-01T00:00:00.000Z"),
      ])
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:expiry"],
          asOf: new Date("2099-11-02"),
        }),
      ).toEqual([])
    })

    it("suppresses erased history and later replay", async () => {
      const value = make("watch:erased")
      await client.insert([value])
      await client.erase({
        family: "watch-exposure",
        logicalIds: ["watch:erased"],
      })
      await client.erase({
        family: "watch-exposure",
        logicalIds: ["watch:erased"],
      })
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:erased"],
          asOf: new Date("2099-10-28T12:00:00.000Z"),
        }),
      ).toEqual([])
      await expect(client.insert([value])).rejects.toMatchObject({
        code: "conflict",
      })
    })

    it("retains all revisions until every historical expiry passes, then physically sweeps the logical ID", async () => {
      const old = make("watch:retire", 1, "old", "2099-11-11T00:00:00.000Z")
      const latest = make(
        "watch:retire",
        2,
        "new",
        "2099-11-01T00:00:00.000Z",
        "2099-10-29T00:00:01.000Z",
      )
      await client.insert([old, latest])
      expect(
        await client.sweepClosedExpired({
          family: "watch-exposure",
          entries: [
            {
              logicalId: "watch:retire",
              maxOriginalExpiry: new Date(old.expiresAt),
            },
          ],
          now: new Date("2099-11-02T00:00:00.000Z"),
        }),
      ).toEqual({ swept: [], pending: ["watch:retire"] })
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:retire"],
          asOf: new Date("2099-10-28T12:00:00.000Z"),
          now: new Date("2099-11-02T00:00:00.000Z"),
        }),
      ).toEqual([old])
      expect(
        await client.sweepClosedExpired({
          family: "watch-exposure",
          entries: [
            {
              logicalId: "watch:retire",
              maxOriginalExpiry: new Date(old.expiresAt),
            },
          ],
          now: new Date("2099-11-12T00:00:00.000Z"),
        }),
      ).toEqual({ swept: ["watch:retire"], pending: [] })
      expect(
        await fixtureSql(
          "SELECT count() FROM recommendation_event_history WHERE logical_id = 'watch:retire' FORMAT TSVRaw",
        ),
      ).toBe("0\n")
      await expect(client.insert([old])).rejects.toMatchObject({
        code: "conflict",
      })
    })

    it("keeps a read fence after a delayed server insert and removes the late physical row on replay", async () => {
      const value = make("watch:late", 1, "late", "2099-11-01T00:00:00.000Z")
      await client.insert([value])
      const input = {
        family: "watch-exposure",
        entries: [
          {
            logicalId: "watch:late",
            maxOriginalExpiry: new Date(value.expiresAt),
          },
        ],
        now: new Date("2099-11-02T00:00:00.000Z"),
      } as const
      await client.sweepClosedExpired(input)
      await finishServerInsert(value)
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:late"],
          asOf: new Date("2099-10-30T00:00:00.000Z"),
          now: input.now,
        }),
      ).toEqual([])
      expect(
        await fixtureSql(
          "SELECT count() FROM recommendation_event_history WHERE logical_id = 'watch:late' FORMAT TSVRaw",
        ),
      ).toBe("1\n")
      expect(await client.sweepClosedExpired(input)).toEqual({
        swept: ["watch:late"],
        pending: [],
      })
      expect(
        await fixtureSql(
          "SELECT count() FROM recommendation_event_history WHERE logical_id = 'watch:late' FORMAT TSVRaw",
        ),
      ).toBe("0\n")
      expect(
        await fixtureSql(
          "SELECT sum(rows) FROM system.parts WHERE database = 'event_clickhouse_test' AND table = 'recommendation_event_history' AND active FORMAT TSVRaw",
        ),
      ).toBe("0\n")
    })

    it("does not report physical cleanup when a late correction has a future original expiry", async () => {
      const first = make(
        "watch:late-correction",
        1,
        "first",
        "2099-11-01T00:00:00.000Z",
      )
      await client.insert([first])
      const input = {
        family: "watch-exposure",
        entries: [
          {
            logicalId: "watch:late-correction",
            maxOriginalExpiry: new Date(first.expiresAt),
          },
        ],
        now: new Date("2099-11-02T00:00:00.000Z"),
      } as const
      await client.sweepClosedExpired(input)
      const late = make(
        "watch:late-correction",
        2,
        "late",
        "2099-11-11T00:00:00.000Z",
      )
      await finishServerInsert(late)
      expect(await client.sweepClosedExpired(input)).toEqual({
        swept: [],
        pending: ["watch:late-correction"],
      })
      expect(
        await client.read({
          family: "watch-exposure",
          logicalIds: ["watch:late-correction"],
          asOf: new Date("2099-10-30T00:00:00.000Z"),
          now: input.now,
        }),
      ).toEqual([])
      expect(
        await fixtureSql(
          "SELECT count() FROM recommendation_event_history WHERE logical_id = 'watch:late-correction' FORMAT TSVRaw",
        ),
      ).toBe("1\n")
    })

    it("fences a closed source ID with no stored row before an unknown insert arrives", async () => {
      const value = make(
        "watch:missing",
        1,
        "missing",
        "2099-11-01T00:00:00.000Z",
      )
      const entries = [
        {
          logicalId: value.logicalId,
          maxOriginalExpiry: new Date(value.expiresAt),
        },
      ]
      expect(
        await client.sweepClosedExpired({
          family: value.family,
          entries,
          now: new Date("2099-10-31T00:00:00.000Z"),
        }),
      ).toEqual({ swept: [], pending: [value.logicalId] })
      expect(
        await client.sweepClosedExpired({
          family: value.family,
          entries,
          now: new Date("2099-11-02T00:00:00.000Z"),
        }),
      ).toEqual({ swept: [value.logicalId], pending: [] })
      await finishServerInsert(value)
      expect(
        await client.read({
          family: value.family,
          logicalIds: [value.logicalId],
          asOf: new Date("2099-10-30T00:00:00.000Z"),
          now: new Date("2099-11-02T00:00:00.000Z"),
        }),
      ).toEqual([])
    })
  },
)
