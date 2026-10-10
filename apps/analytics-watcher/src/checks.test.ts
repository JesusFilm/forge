import { describe, expect, it, vi } from "vitest"
import { checkDatadog, checkGa, latestGaActivity, rumQuery } from "./checks.js"
import { readConfig } from "./config.js"
import { emptyState, MINUTE } from "./state.js"

const now = Date.parse("2026-09-14T00:00:00Z")
export const config = readConfig({
  GA_MEASUREMENT_ID: "G-TEST123",
  DD_API_KEY: "test-api-key",
  DD_APP_KEY: "test-read-key",
  GA4_PROPERTY_ID: "123",
  GA4_STREAM_ID: "456",
  GA4_CREDENTIALS_JSON: "{}",
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_CHANNEL_ID: "CTEST",
  HEARTBEAT_URL: "https://example.com/heartbeat",
})
const gaReport = (rows?: unknown[]) => ({
  dimensionHeaders: [{ name: "minutesAgo" }, { name: "streamId" }],
  metricHeaders: [{ name: "eventCount" }],
  ...(rows ? { rows } : {}),
})
const row = (minute: string, count: string, stream = "456") => ({
  dimensionValues: [{ value: minute }, { value: stream }],
  metricValues: [{ value: count }],
})
const response = (body: unknown, status = 200) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))

describe("Datadog read-only intake", () => {
  it("uses the canonical production Watch query and exactly two hours", async () => {
    const fetchImpl = response({ data: [] })
    expect((await checkDatadog(config, now, fetchImpl)).status).toBe("bad")
    const [url, request] = fetchImpl.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe("/api/v2/rum/events")
    expect(parsed.searchParams.get("filter[from]")).toBe(
      "2026-09-13T22:00:00.000Z",
    )
    expect(parsed.searchParams.get("filter[query]")).toBe(rumQuery(config))
    expect(parsed.searchParams.get("page[limit]")).toBe("1")
    expect(request?.method).toBeUndefined()
    expect(rumQuery(config)).toContain("env:prod")
    expect(rumQuery(config)).toContain("@view.url_path:/watch/*")
  })
  it("recognizes a recent indexed RUM event", async () => {
    expect(
      (
        await checkDatadog(
          config,
          now,
          response({
            data: [
              {
                attributes: { timestamp: new Date(now - MINUTE).toISOString() },
              },
            ],
          }),
        )
      ).status,
    ).toBe("good")
  })
  it.each([
    {},
    { data: null },
    { data: [{}] },
    { data: [{ attributes: { timestamp: "nonsense" } }] },
  ])("does not interpret malformed responses as silence: %j", async (body) => {
    expect((await checkDatadog(config, now, response(body))).status).toBe(
      "unknown",
    )
  })
  it.each([401, 403, 429, 500])(
    "does not interpret HTTP %i as silence",
    async (status) => {
      expect(
        (await checkDatadog(config, now, response({}, status))).status,
      ).toBe("unknown")
    },
  )
  it("rejects an event outside the query window", async () => {
    expect(
      (
        await checkDatadog(
          config,
          now,
          response({
            data: [
              {
                attributes: {
                  timestamp: new Date(now - 180 * MINUTE).toISOString(),
                },
              },
            ],
          }),
        )
      ).status,
    ).toBe("unknown")
  })
})

describe("GA Realtime evidence", () => {
  it("queries the configured stream and real page_view events only", async () => {
    const state = emptyState("test")
    const fetchImpl = response(gaReport([row("02", "8")]))
    const result = await checkGa(
      config,
      state,
      now,
      fetchImpl,
      async () => "test-token",
    )
    expect(result.status).toBe("good")
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(request.dimensionFilter.andGroup.expressions).toEqual([
      {
        filter: {
          fieldName: "streamId",
          stringFilter: { matchType: "EXACT", value: "456" },
        },
      },
      {
        filter: {
          fieldName: "eventName",
          stringFilter: { matchType: "EXACT", value: "page_view" },
        },
      },
    ])
    expect(state.ga?.lastActivityAt).toBe(now - MINUTE)
  })
  it("accepts a valid empty report without inventing an outage at startup", async () => {
    expect(
      (
        await checkGa(
          config,
          emptyState("test"),
          now,
          response(gaReport()),
          async () => "token",
        )
      ).status,
    ).toBe("waiting")
  })
  it.each([
    {},
    gaReport([row("bad", "1")]),
    gaReport([row("30", "1")]),
    gaReport([row("01", "1", "wrong-stream")]),
    gaReport([row("01", "NaN")]),
    { ...gaReport(), rowCount: 5 },
    { ...gaReport(), metadata: { subjectToThresholding: true } },
  ])("rejects invalid or incomplete reports: %j", (body) => {
    expect(() => latestGaActivity(body, "456", now)).toThrow()
  })
  it("invalidates historical coverage after a failed query", async () => {
    const state = emptyState("test")
    state.ga = { lastQueryAt: now - MINUTE, lastActivityAt: now - 180 * MINUTE }
    const result = await checkGa(
      config,
      state,
      now,
      response({}, 403),
      async () => "token",
    )
    expect(result.status).toBe("unknown")
    expect(state.ga).toBeUndefined()
  })
})
