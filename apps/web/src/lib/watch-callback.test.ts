import { describe, expect, it } from "vitest"

import { resolveWatchCallbackURL } from "./watch-callback"

describe("resolveWatchCallbackURL", () => {
  it("allows https production watch callbacks", () => {
    expect(
      resolveWatchCallbackURL("https://jesusfilm.org/watch/jesus/english"),
    ).toBe("https://jesusfilm.org/watch/jesus/english")
  })

  it("allows http localhost watch callbacks for local dev", () => {
    expect(
      resolveWatchCallbackURL("http://localhost:3030/watch/jesus/english"),
    ).toBe("http://localhost:3030/watch/jesus/english")
  })

  it("rejects non-http localhost protocols", () => {
    expect(
      resolveWatchCallbackURL("ftp://localhost/watch/jesus/english"),
    ).toBeUndefined()
  })

  it("rejects watch API and media URL callbacks", () => {
    expect(
      resolveWatchCallbackURL(
        "http://localhost:3030/watch/api/download?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
      ),
    ).toBeUndefined()
  })
})
