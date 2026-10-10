import { describe, expect, it } from "vitest"
import { isGaCollect, namespaceProbeEvents, probeBrowser } from "./browser.js"

describe("GA probe isolation", () => {
  it("handles GET events, retaining the original event evidence", () => {
    const result = namespaceProbeEvents(
      "https://analytics.google.com/g/collect?tid=G-TEST123&en=page_view&dl=https%3A%2F%2Fwww.jesusfilm.org%2Fwatch%2Fjesus.html",
      null,
    )
    expect(result.events).toEqual([
      {
        name: "page_view",
        measurementId: "G-TEST123",
        pathname: "/watch/jesus.html",
      },
    ])
    expect(new URL(result.url).searchParams.get("en")).toBe(
      "forge_monitor_page_view",
    )
    expect(result.body).toBeNull()
  })
  it("handles POST batches with shared measurement and page parameters", () => {
    const result = namespaceProbeEvents(
      "https://region1.google-analytics.com/g/collect?tid=G-TEST123&dl=https%3A%2F%2Fwww.jesusfilm.org%2Fwatch%2Fjesus.html",
      "en=page_view\nen=share_opened",
    )
    expect(result.events.map((event) => event.name)).toEqual([
      "page_view",
      "share_opened",
    ])
    expect(result.body).toBe(
      "en=forge_monitor_page_view\nen=forge_monitor_share_opened",
    )
  })
  it("namespaces query events even when POST has other fields", () => {
    const result = namespaceProbeEvents(
      "https://analytics.google.com/g/collect?en=page_view&tid=G-TEST123",
      "dl=https%3A%2F%2Fexample.com%2Fwatch%2Fx",
    )
    expect(result.events[0].pathname).toBe("/watch/x")
    expect(new URL(result.url).searchParams.get("en")).toBe(
      "forge_monitor_page_view",
    )
  })
  it("bounds namespaced event names to Google's 40-character limit", () => {
    const result = namespaceProbeEvents(
      `https://analytics.google.com/g/collect?en=${"x".repeat(100)}`,
      null,
    )
    expect(new URL(result.url).searchParams.get("en")).toHaveLength(40)
  })
  it.each([
    "https://google-analytics.com.evil.test/g/collect",
    "https://example.com/g/collect",
    "https://analytics.google.com/other",
    "http://analytics.google.com/g/collect",
  ])("does not treat %s as a collector", (url) => {
    expect(isGaCollect(url)).toBe(false)
  })
  it("treats a failed browser launch as unknown, not an analytics outage", async () => {
    const result = await probeBrowser(
      {
        WATCH_URL: "https://www.jesusfilm.org/watch/jesus.html",
        WATCH_NEXT_PATH: "/watch/next.html",
        GA_MEASUREMENT_ID: "G-TEST123",
      },
      async () => {
        throw new Error("browser unavailable")
      },
    )
    expect(result.status).toBe("unknown")
    expect(result.deliveries).toEqual([])
  })
})
