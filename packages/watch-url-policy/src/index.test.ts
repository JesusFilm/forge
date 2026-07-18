import { describe, expect, it } from "vitest"

import {
  getDefaultWatchCallbackOrigins,
  isAllowedDownloadOrigin,
  resolveWatchCallbackURL,
} from "./index"

describe("watch URL policy", () => {
  it("allows watch-page callbacks from exact configured origins", () => {
    expect(
      resolveWatchCallbackURL("https://preview.example.test/watch/jesus", [
        "https://preview.example.test",
      ]),
    ).toBe("https://preview.example.test/watch/jesus")
    expect(
      resolveWatchCallbackURL("https://preview.example.test/watch", [
        "https://preview.example.test",
      ]),
    ).toBe("https://preview.example.test/watch")
  })

  it.each([
    "https://attacker.example.test/watch",
    "https://preview.example.test/watcher",
    "https://preview.example.test/watch-evil",
    "https://preview.example.test/watch/api/download",
    "https://preview.example.test/watch/api%2Fdownload",
    "https://preview.example.test/watch?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
    "https://preview.example.test/watch?next=https%3A%2F%2Fapi-media-core.jesusfilm.org%2Fabc.mp4",
    "https://preview.example.test/watch?next=stream.mux.com%2Fabc.mp4",
  ])("rejects unsafe callback %s", (callbackURL) => {
    expect(
      resolveWatchCallbackURL(callbackURL, ["https://preview.example.test"]),
    ).toBeUndefined()
  })

  it("rejects watch API callbacks and embedded media download references", () => {
    expect(
      resolveWatchCallbackURL(
        "https://preview.example.test/watch/api/download",
        ["https://preview.example.test"],
      ),
    ).toBeUndefined()
    expect(
      resolveWatchCallbackURL(
        "https://preview.example.test/watch/jesus?next=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
        ["https://preview.example.test"],
      ),
    ).toBeUndefined()
  })

  it("keeps localhost callback origins out of production defaults", () => {
    expect(getDefaultWatchCallbackOrigins("production")).not.toContain(
      "http://localhost:3000",
    )
    expect(getDefaultWatchCallbackOrigins("production")).toContain(
      "https://watch.jesusfilm.org",
    )
    expect(getDefaultWatchCallbackOrigins("production")).not.toContain(
      "https://web.jesusfilm.org",
    )
    expect(getDefaultWatchCallbackOrigins("test")).toContain(
      "http://localhost:3000",
    )
  })

  it("shares the download origin allowlist used by callback sanitizers and download routes", () => {
    expect(isAllowedDownloadOrigin("https://stream.mux.com/abc.mp4")).toBe(true)
    expect(
      isAllowedDownloadOrigin("https://api-media-core.jesusfilm.org/abc.mp4"),
    ).toBe(true)
    expect(isAllowedDownloadOrigin("http://stream.mux.com/abc.mp4")).toBe(false)
    expect(isAllowedDownloadOrigin("https://evil.example/abc.mp4")).toBe(false)
  })
})
