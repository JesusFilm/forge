/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

const CANONICAL = "https://www.jesusfilm.org"

async function importGetRequestOrigin({
  canonicalOrigin = CANONICAL,
  webBaseUrl = "https://web.jesusfilm.org",
  nodeEnv = "production",
}: {
  canonicalOrigin?: string
  webBaseUrl?: string
  nodeEnv?: string
} = {}) {
  vi.resetModules()
  vi.stubEnv("NODE_ENV", nodeEnv)
  vi.stubEnv("NEXT_PUBLIC_CANONICAL_ORIGIN", canonicalOrigin)
  vi.stubEnv("WEB_BASE_URL", webBaseUrl)
  const { getRequestOrigin } = await import("./request-origin")
  return getRequestOrigin
}

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getRequestOrigin in production", () => {
  it("uses the canonical origin for the production internal-alias host (FGE-175)", async () => {
    const getRequestOrigin = await importGetRequestOrigin()
    const alias = "dd541ea7-e468-4159-af6c-25a59cba326c.jesusfilm.org"

    expect(
      getRequestOrigin(
        makeRequest(`https://${alias}/watch/api/auth/session`, {
          "x-forwarded-host": alias,
          "x-forwarded-proto": "https",
          host: alias,
        }),
      ),
    ).toBe(CANONICAL)
  })

  it.each([
    ["an attacker-controlled forwarded host", "evil.example"],
    [
      "a lookalike suffix of the canonical host",
      "www.jesusfilm.org.evil.example",
    ],
    ["a lookalike prefix of the canonical host", "evil-www.jesusfilm.org"],
    ["a non-default port on the canonical host", "www.jesusfilm.org:8443"],
  ])("ignores %s", async (_label, host) => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("https://www.jesusfilm.org/watch", {
          "x-forwarded-host": host,
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(CANONICAL)
  })

  it("ignores an attacker-controlled Host header when no forwarded host is sent", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("https://evil.example/watch", { host: "evil.example" }),
      ),
    ).toBe(CANONICAL)
  })

  it("does not fall back to an attacker-controlled Host when the forwarded host is unapproved", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("https://watch.jesusfilm.org/watch", {
          "x-forwarded-host": "evil.example",
          host: "watch.jesusfilm.org",
        }),
      ),
    ).toBe(CANONICAL)
  })

  it.each([
    "https://jesusfilm.org",
    "https://www.jesusfilm.org",
    "https://watch.jesusfilm.org",
  ])("keeps the shared Watch callback origin %s", async (origin) => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest(`${origin}/watch`, {
          "x-forwarded-host": new URL(origin).host,
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(origin)
  })

  it("accepts the configured WEB_BASE_URL host", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("https://web.jesusfilm.org/watch", {
          "x-forwarded-host": "web.jesusfilm.org",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://web.jesusfilm.org")
  })

  it("matches hosts case-insensitively and uses the first forwarded-host entry", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("https://www.jesusfilm.org/watch", {
          "x-forwarded-host": "Watch.JesusFilm.org, evil.example",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://watch.jesusfilm.org")
  })

  it("does not let the first forwarded-host entry be an attacker's", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("https://www.jesusfilm.org/watch", {
          "x-forwarded-host": "evil.example, watch.jesusfilm.org",
        }),
      ),
    ).toBe(CANONICAL)
  })

  it("takes the scheme from the approved origin, not x-forwarded-proto", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("https://www.jesusfilm.org/watch", {
          "x-forwarded-host": "www.jesusfilm.org",
          "x-forwarded-proto": "http",
        }),
      ),
    ).toBe(CANONICAL)
  })

  it("does not trust loopback hosts", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(
        makeRequest("http://localhost:9999/watch", {
          "x-forwarded-host": "localhost:9999",
          "x-forwarded-proto": "http",
        }),
      ),
    ).toBe(CANONICAL)
  })

  it("uses the canonical origin when the request carries no host information beyond an unapproved URL", async () => {
    const getRequestOrigin = await importGetRequestOrigin()

    expect(
      getRequestOrigin(makeRequest("https://elsewhere.example/watch")),
    ).toBe(CANONICAL)
  })

  it("accepts an explicitly configured preview origin", async () => {
    const getRequestOrigin = await importGetRequestOrigin({
      canonicalOrigin: "https://preview.example.up.railway.app",
    })

    expect(
      getRequestOrigin(
        makeRequest("https://preview.example.up.railway.app/watch", {
          "x-forwarded-host": "preview.example.up.railway.app",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://preview.example.up.railway.app")
  })
})

describe("getRequestOrigin outside production", () => {
  it.each([
    ["http://localhost:3102/watch", "http://localhost:3102"],
    ["http://127.0.0.1:3102/watch", "http://127.0.0.1:3102"],
    ["http://localhost:4567/watch", "http://localhost:4567"],
    ["http://[::1]:4567/watch", "http://[::1]:4567"],
  ])("keeps the loopback request origin for %s", async (url, expected) => {
    const getRequestOrigin = await importGetRequestOrigin({
      canonicalOrigin: "http://localhost:3000",
      webBaseUrl: "http://localhost:3000",
      nodeEnv: "development",
    })

    expect(getRequestOrigin(makeRequest(url))).toBe(expected)
  })

  it("honours a loopback forwarded host from a local preview proxy", async () => {
    const getRequestOrigin = await importGetRequestOrigin({
      canonicalOrigin: "http://localhost:3000",
      webBaseUrl: "http://localhost:3000",
      nodeEnv: "development",
    })

    expect(
      getRequestOrigin(
        makeRequest("http://localhost:3000/watch", {
          "x-forwarded-host": "localhost:3102",
          "x-forwarded-proto": "http",
        }),
      ),
    ).toBe("http://localhost:3102")
  })

  it("still ignores a non-loopback hostile host", async () => {
    const getRequestOrigin = await importGetRequestOrigin({
      canonicalOrigin: "http://localhost:3000",
      webBaseUrl: "http://localhost:3000",
      nodeEnv: "development",
    })

    expect(
      getRequestOrigin(
        makeRequest("http://localhost:3000/watch", {
          "x-forwarded-host": "evil.example",
        }),
      ),
    ).toBe("http://localhost:3000")
  })

  it("does not treat a loopback-looking subdomain as loopback", async () => {
    const getRequestOrigin = await importGetRequestOrigin({
      canonicalOrigin: "http://localhost:3000",
      webBaseUrl: "http://localhost:3000",
      nodeEnv: "development",
    })

    expect(
      getRequestOrigin(
        makeRequest("http://localhost:3000/watch", {
          "x-forwarded-host": "localhost.evil.example",
        }),
      ),
    ).toBe("http://localhost:3000")
  })
})
