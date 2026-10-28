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
    }
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
  },
)
