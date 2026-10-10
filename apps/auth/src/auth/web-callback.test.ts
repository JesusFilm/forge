import { afterEach, describe, expect, it, vi } from "vitest"

async function importWebCallback() {
  vi.resetModules()
  return import("./web-callback")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("resolveWebWatchCallbackURL", () => {
  it("allows https production watch callbacks", async () => {
    const { resolveWebWatchCallbackURL } = await importWebCallback()

    expect(
      resolveWebWatchCallbackURL("https://jesusfilm.org/watch/jesus/english"),
    ).toBe("https://jesusfilm.org/watch/jesus/english")
    expect(resolveWebWatchCallbackURL("https://jesusfilm.org/watch")).toBe(
      "https://jesusfilm.org/watch",
    )
  })

  it("allows http localhost watch callbacks for local dev", async () => {
    const { resolveWebWatchCallbackURL } = await importWebCallback()

    expect(
      resolveWebWatchCallbackURL("http://localhost:3030/watch/jesus/english"),
    ).toBe("http://localhost:3030/watch/jesus/english")
  })

  it("allows configured trusted web callback origins", async () => {
    vi.stubEnv("AUTH_WEB_TRUSTED_ORIGINS", "https://preview.example.test")
    const { resolveWebWatchCallbackURL } = await importWebCallback()

    expect(
      resolveWebWatchCallbackURL(
        "https://preview.example.test/watch/jesus/english",
      ),
    ).toBe("https://preview.example.test/watch/jesus/english")
  })

  it("rejects non-http localhost protocols", async () => {
    const { resolveWebWatchCallbackURL } = await importWebCallback()

    expect(
      resolveWebWatchCallbackURL("ftp://localhost/watch/jesus/english"),
    ).toBeUndefined()
  })

  it("rejects watch API and media URL callbacks", async () => {
    const { resolveWebWatchCallbackURL } = await importWebCallback()

    expect(
      resolveWebWatchCallbackURL(
        "http://localhost:3030/watch/api/download?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
      ),
    ).toBeUndefined()
  })

  it("rejects callback params that contain any allowlisted media URL", async () => {
    const { resolveWebWatchCallbackURL } = await importWebCallback()

    expect(
      resolveWebWatchCallbackURL(
        "http://localhost:3030/watch/jesus/english?next=https%3A%2F%2Fapi-media-core.jesusfilm.org%2Fabc.mp4",
      ),
    ).toBeUndefined()
  })
})
