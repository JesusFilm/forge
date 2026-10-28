import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { createRecommendationClickHouseClient } from "./clickhouse"
import { createRecommendationEventEnvelope } from "./envelope"

const run = env.RECOMMENDATION_CLICKHOUSE_DB_TEST === "1"
describe.skipIf(!run)("anonymous Watch report on isolated ClickHouse", () => {
  let endpoint: string
  let client: ReturnType<typeof createRecommendationClickHouseClient>
  const end = new Date("2099-10-28T00:00:00.000Z")
  const start = new Date("2099-10-27T00:00:00.000Z")
  const report = () => client.watchExposureBreakdown({ start, end, now: end })
  const sql = async (query: string) => {
    const url = new URL(endpoint)
    url.searchParams.set("database", "event_watch_reader_test")
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-ClickHouse-User": "event_test",
        "X-ClickHouse-Key": "event_test_password",
      },
      body: query,
    })
    if (!response.ok)
      throw new Error("Isolated Watch ClickHouse fixture failed")
  }
  const make = (
    eventId: string,
    kind: "served" | "rendered" | "eligible" | "selected",
    options: {
      revision?: number
      duplicateCount?: number
      occurredAt?: string
      receivedAt?: string
      acceptedAt?: string
      expiresAt?: string
      windowId?: string
      itemPath?: string
      policyVersion?: string
      visibilityCapability?: string | null
      surface?: string
      block?: string
      presentation?: string
      placement?: string
      position?: number
    } = {},
  ) => {
    const occurredAt = options.occurredAt ?? "2099-10-27T12:00:00.000Z"
    const receivedAt = options.receivedAt ?? "2099-10-27T12:00:01.000Z"
    const expiresAt = options.expiresAt ?? "2099-11-10T00:00:00.000Z"
    const payload = {
      eventId,
      rankId: eventId,
      windowId: options.windowId ?? "window-one",
      surface: options.surface ?? "watch-home",
      block: options.block ?? "hero",
      presentation: options.presentation ?? "hero-card",
      placement: options.placement ?? "primary",
      policyVersion: options.policyVersion ?? "watch-exposure-v2",
      position: options.position ?? 0,
      itemPath: options.itemPath ?? "/watch/one.html",
      kind,
      visibilityCapability: options.visibilityCapability ?? null,
      occurredAt,
      receivedAt,
      expiresAt,
      duplicateCount: options.duplicateCount ?? 0,
    }
    return createRecommendationEventEnvelope({
      family: "watch-exposure",
      logicalId: eventId,
      revision: options.revision ?? 1,
      occurredAt: new Date(occurredAt),
      acceptedAt: new Date(options.acceptedAt ?? receivedAt),
      expiresAt: new Date(expiresAt),
      payload,
      allowedFields: Object.keys(payload),
    })
  }
  beforeAll(() => {
    if (!env.RECOMMENDATION_CLICKHOUSE_TEST_URL)
      throw new Error("Isolated loopback ClickHouse URL required")
    const url = new URL(env.RECOMMENDATION_CLICKHOUSE_TEST_URL)
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "18123" ||
      url.pathname !== "/"
    )
      throw new Error("Owned loopback ClickHouse fixture required")
    endpoint = url.toString()
    client = createRecommendationClickHouseClient({
      endpoint,
      database: "event_watch_reader_test",
      username: "event_test",
      password: "event_test_password",
      allowLoopbackHttpForTest: true,
    })
  })
  beforeEach(async () => {
    await sql("TRUNCATE TABLE recommendation_event_history")
    await sql("TRUNCATE TABLE recommendation_event_erasure")
  })

  it("counts a served-only V2 card from the canonical stored event", async () => {
    await client.insert([make("reader:served:1", "served")])
    expect(await report()).toEqual({
      truncated: false,
      rows: [
        {
          surface: "watch-home",
          block: "hero",
          presentation: "hero-card",
          placement: "primary",
          policyVersion: "watch-exposure-v2",
          position: 0,
          served: 1,
          rendered: 0,
          eligible: 0,
          selected: 0,
          eligibleSelected: 0,
          repeats: 0,
          acceptedAttempts: 0,
          duplicates: 0,
          occlusionAware: 0,
          visibilityUnknown: 0,
        },
      ],
    })
  })

  it("ranks first facts before counting repeats and canonical duplicate corrections", async () => {
    const selected = make("reader:selected", "selected", {
      occurredAt: "2099-10-27T12:00:00.000Z",
    })
    const eligible = make("reader:eligible", "eligible", {
      occurredAt: "2099-10-27T12:01:00.000Z",
      visibilityCapability: "unknown",
    })
    const corrected = make("reader:eligible", "eligible", {
      revision: 2,
      duplicateCount: 2,
      occurredAt: "2099-10-27T12:01:00.000Z",
      visibilityCapability: "unknown",
      acceptedAt: "2099-10-27T12:03:00.000Z",
    })
    const repeat = make("reader:repeat", "eligible", {
      occurredAt: "2099-10-27T12:02:00.000Z",
      visibilityCapability: "occlusion-aware",
    })
    await client.insert([repeat, selected, eligible])
    await client.insert([corrected])
    await client.insert([corrected])
    expect((await report()).rows[0]).toMatchObject({
      selected: 1,
      eligible: 1,
      eligibleSelected: 0,
      repeats: 1,
      acceptedAttempts: 3,
      duplicates: 2,
      visibilityUnknown: 1,
      occlusionAware: 0,
    })
  })

  it("uses revision acceptance cutoff, then current expiry and erasure", async () => {
    const first = make("reader:asof", "eligible", {
      visibilityCapability: "unknown",
      acceptedAt: "2099-10-27T12:05:00.000Z",
    })
    const later = make("reader:asof", "eligible", {
      revision: 2,
      duplicateCount: 4,
      visibilityCapability: "unknown",
      acceptedAt: "2099-10-28T01:00:00.000Z",
    })
    await client.insert([first, later])
    expect((await report()).rows[0]).toMatchObject({ duplicates: 0 })
    expect(
      (
        await client.watchExposureBreakdown({
          start,
          end,
          asOf: new Date("2099-10-28T02:00:00.000Z"),
          now: new Date("2099-10-28T02:00:00.000Z"),
        })
      ).rows[0],
    ).toMatchObject({ duplicates: 4 })
    await client.erase({
      family: "watch-exposure",
      logicalIds: ["reader:asof"],
    })
    expect(await report()).toEqual({ rows: [], truncated: false })
  })

  it("does not revive an earlier unexpired revision after the latest expires", async () => {
    await client.insert([
      make("reader:expired", "eligible", {
        expiresAt: "2099-11-10T00:00:00.000Z",
      }),
      make("reader:expired", "eligible", {
        revision: 2,
        acceptedAt: "2099-10-27T13:00:00.000Z",
        expiresAt: "2099-10-27T23:00:00.000Z",
      }),
    ])
    expect(await report()).toEqual({ rows: [], truncated: false })
  })

  it("does not expose currently expired data through a historical cutoff", async () => {
    await client.insert([
      make("reader:historical-expiry", "served", {
        expiresAt: "2099-10-27T23:00:00.000Z",
      }),
    ])
    expect(
      await client.watchExposureBreakdown({
        start: new Date("2099-10-26T12:00:00.000Z"),
        end: new Date("2099-10-27T13:00:00.000Z"),
        asOf: new Date("2099-10-27T13:00:00.000Z"),
        now: new Date("2099-10-28T00:00:00.000Z"),
      }),
    ).toEqual({ rows: [], truncated: false })
  })

  it("detects same-revision conflicts after physical merge", async () => {
    const first = make("reader:conflict", "eligible")
    const conflicting = make("reader:conflict", "selected")
    await client.insert([first])
    await sql(
      `INSERT INTO recommendation_event_history FORMAT JSONEachRow\n${JSON.stringify(
        {
          family: conflicting.family,
          logical_id: conflicting.logicalId,
          revision: conflicting.revision,
          occurred_at: conflicting.occurredAt,
          accepted_at: conflicting.acceptedAt,
          expires_at: conflicting.expiresAt,
          payload_digest: conflicting.payloadDigest,
          payload: JSON.stringify(conflicting.payload),
        },
      )}\n`,
    )
    await sql("OPTIMIZE TABLE recommendation_event_history FINAL")
    await expect(report()).rejects.toMatchObject({ code: "conflict" })
  })

  it("does not hide a conflicting variant behind a registry filter", async () => {
    const first = make("reader:hidden-conflict", "eligible", {
      surface: "aaa-other",
    })
    const conflicting = make("reader:hidden-conflict", "selected", {
      surface: "aaa-other",
    })
    await client.insert([first])
    await sql(
      `INSERT INTO recommendation_event_history FORMAT JSONEachRow\n${JSON.stringify(
        {
          family: conflicting.family,
          logical_id: conflicting.logicalId,
          revision: conflicting.revision,
          occurred_at: conflicting.occurredAt,
          accepted_at: conflicting.acceptedAt,
          expires_at: conflicting.expiresAt,
          payload_digest: conflicting.payloadDigest,
          payload: JSON.stringify(conflicting.payload),
        },
      )}\n`,
    )
    await expect(
      client.watchExposureBreakdown({
        start,
        end,
        now: end,
        filter: {
          surface: "watch-home",
          block: "hero",
          presentation: "hero-card",
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" })
  })

  it("applies registry filters before the 128-group cap", async () => {
    const other = Array.from({ length: 130 }, (_, position) =>
      make(`reader:other:${position}`, "served", {
        surface: "aaa-other",
        position,
      }),
    )
    await client.insert(other.slice(0, 100))
    await client.insert(other.slice(100))
    await client.insert([make("reader:target", "served")])
    const unfiltered = await report()
    expect(unfiltered).toMatchObject({ truncated: true })
    expect(unfiltered.rows).toHaveLength(128)
    const filtered = await client.watchExposureBreakdown({
      start,
      end,
      now: end,
      filter: {
        surface: "watch-home",
        block: "hero",
        presentation: "hero-card",
      },
    })
    expect(filtered.rows).toHaveLength(1)
    expect(filtered).toMatchObject({ truncated: false, rows: [{ served: 1 }] })
  })

  it("keeps window, path and policy rank partitions separate", async () => {
    await client.insert([
      make("reader:prior", "eligible", {
        occurredAt: "2099-10-26T23:59:00.000Z",
        visibilityCapability: "unknown",
      }),
      make("reader:selection", "selected"),
      make("reader:other-window", "eligible", {
        windowId: "window-two",
        visibilityCapability: "unknown",
      }),
      make("reader:other-path", "eligible", {
        itemPath: "/watch/other.html",
        visibilityCapability: "unknown",
      }),
      make("reader:other-policy", "eligible", {
        policyVersion: "watch-exposure-v1",
        visibilityCapability: "unknown",
      }),
    ])
    const rows = (await report()).rows
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      policyVersion: "watch-exposure-v1",
      eligible: 1,
      selected: 0,
    })
    expect(rows[1]).toMatchObject({
      policyVersion: "watch-exposure-v2",
      eligible: 2,
      selected: 1,
      eligibleSelected: 0,
    })
  })

  it("excludes windows whose only fact was received after the report end", async () => {
    await client.insert([
      make("reader:late-received", "eligible", {
        receivedAt: "2099-10-28T01:00:00.000Z",
        acceptedAt: "2099-10-28T01:00:01.000Z",
        visibilityCapability: "unknown",
      }),
    ])
    expect(
      await client.watchExposureBreakdown({
        start,
        end,
        asOf: new Date("2099-10-28T02:00:00.000Z"),
        now: new Date("2099-10-28T02:00:00.000Z"),
      }),
    ).toEqual({ rows: [], truncated: false })
  })
})
