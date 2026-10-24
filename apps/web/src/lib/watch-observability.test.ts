import { afterEach, describe, expect, it, vi } from "vitest"

import {
  formatWatchServerLogLine,
  logWatchServerEvent,
} from "./watch-observability"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("formatWatchServerLogLine", () => {
  it("emits a deterministic Watch event line with key-value fields", () => {
    expect(
      formatWatchServerLogLine("watch_route_manifest.fetch.failed", {
        status: 503,
        url: "https://admin.test/api/watch-route-manifest",
      }),
    ).toBe(
      "[watch] event=watch_route_manifest.fetch.failed status=503 url=https://admin.test/api/watch-route-manifest",
    )
  })

  it("sanitizes whitespace and skips empty values", () => {
    expect(
      formatWatchServerLogLine(" watch bad event ", {
        detail: "Apollo error\nwith spaces",
        empty: "",
        missing: undefined,
      }),
    ).toBe("[watch] event=watch_bad_event detail=Apollo_error_with_spaces")
  })

  it("bounds long values", () => {
    const detail = "x".repeat(600)

    const line = formatWatchServerLogLine("watch.long", { detail })

    expect(line).toHaveLength("[watch] event=watch.long detail=".length + 500)
    expect(line.endsWith("...")).toBe(true)
  })
})

describe("logWatchServerEvent", () => {
  it("logs warnings by default", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    logWatchServerEvent("watch_route_manifest.fetch.failed", { status: 503 })

    expect(warnSpy).toHaveBeenCalledWith(
      "[watch] event=watch_route_manifest.fetch.failed status=503",
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("can log errors when requested", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    logWatchServerEvent(
      "watch_metadata.video.fallback",
      { detail: new Error("metadata failed") },
      { level: "error" },
    )

    expect(errorSpy).toHaveBeenCalledWith(
      "[watch] event=watch_metadata.video.fallback detail=metadata_failed",
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
