import { afterEach, describe, expect, it, vi } from "vitest"

import {
  openPublicUserPlaylistCapability,
  preflightPublicUserPlaylist,
  sealPublicUserPlaylistCapability,
  setPublicUserPlaylistBoundaryDependenciesForTest,
} from "./user-playlist-public-boundary"

const CAPABILITY = "a".repeat(43)

afterEach(() => {
  setPublicUserPlaylistBoundaryDependenciesForTest()
  vi.restoreAllMocks()
})

describe("public playlist boundary", () => {
  it("seals the route capability in an authenticated envelope with a 30-second lifetime", () => {
    const capability = "c".repeat(43)
    const secret = "s".repeat(32)
    const issuedAt = new Date("2026-08-21T12:00:00.000Z")
    const envelope = sealPublicUserPlaylistCapability(capability, {
      secret,
      now: issuedAt,
    })!

    expect(envelope).not.toContain(capability)
    expect(
      openPublicUserPlaylistCapability(envelope, {
        secret,
        now: new Date(issuedAt.getTime() + 30_000),
      }),
    ).toBe(capability)
    expect(
      openPublicUserPlaylistCapability(envelope, {
        secret,
        now: new Date(issuedAt.getTime() + 30_001),
      }),
    ).toBeNull()
    expect(
      openPublicUserPlaylistCapability(`${envelope.slice(0, -1)}x`, {
        secret,
        now: issuedAt,
      }),
    ).toBeNull()
    const base64UrlAlphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    const segments = envelope.split(".")
    const encodedTag = segments[3]!
    const lastIndex = base64UrlAlphabet.indexOf(encodedTag.at(-1)!)
    segments[3] = `${encodedTag.slice(0, -1)}${base64UrlAlphabet[lastIndex + 1]}`
    const nonCanonicalTagEnvelope = segments.join(".")
    expect(
      Buffer.from(segments[3]!, "base64url").equals(
        Buffer.from(encodedTag, "base64url"),
      ),
    ).toBe(true)
    expect(
      openPublicUserPlaylistCapability(nonCanonicalTagEnvelope, {
        secret,
        now: issuedAt,
      }),
    ).toBeNull()
    expect(
      openPublicUserPlaylistCapability(envelope, {
        secret: "different-secret-material-123456789",
        now: issuedAt,
      }),
    ).toBeNull()
  })

  it("signs only trusted fresh edge country/IP and uses a bounded no-store fetch", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            userPlaylistByToken: {
              title: "Community playlist",
              description: "",
              locale: "en",
              countryCode: null,
              reportIntent: "r".repeat(86),
              blocks: [],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const consume = vi.fn().mockResolvedValue("admitted")
    setPublicUserPlaylistBoundaryDependenciesForTest({
      fetch,
      consume,
      adminGraphqlUrl: "https://admin.jesusfilm.org/api/graphql",
      consumerBearer: "web-key",
      contextSecret: "s".repeat(32),
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    })

    const result = await preflightPublicUserPlaylist({
      capability: CAPABILITY,
      requestHeaders: new Headers({
        "cf-ray": "1234567890abcdef-YHZ",
        "cf-ipcountry": "ca",
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.8",
      }),
    })

    expect(result).toBe("available")
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({ viewerIp: "203.0.113.7" }),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = fetch.mock.calls[0]!
    expect(init.cache).toBe("no-store")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe("Bearer web-key")
    expect(headers.get("x-forge-viewer-context")).toBeTruthy()
    expect(headers.get("x-forge-viewer-context-signature")).toBeTruthy()
    expect(headers.get("x-forwarded-for")).toBeNull()
  })

  it("maps null/forged capabilities to unavailable and dependency failures to 503", async () => {
    const consume = vi.fn().mockResolvedValue("admitted")
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { userPlaylistByToken: null } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "hidden",
                extensions: { code: "SERVICE_UNAVAILABLE" },
              },
            ],
          }),
          { status: 503 },
        ),
      )
    setPublicUserPlaylistBoundaryDependenciesForTest({
      fetch,
      consume,
      adminGraphqlUrl: "https://admin.jesusfilm.org/api/graphql",
      consumerBearer: "web-key",
      contextSecret: "s".repeat(32),
    })

    await expect(
      preflightPublicUserPlaylist({
        capability: CAPABILITY,
        requestHeaders: new Headers(),
      }),
    ).resolves.toBe("unavailable")
    await expect(
      preflightPublicUserPlaylist({
        capability: CAPABILITY,
        requestHeaders: new Headers(),
      }),
    ).resolves.toBe("service-unavailable")
  })

  it("fails closed when ingress limiting or configuration is unavailable", async () => {
    setPublicUserPlaylistBoundaryDependenciesForTest({
      fetch: vi.fn(),
      consume: vi.fn().mockResolvedValue("limited"),
      adminGraphqlUrl: "https://admin.jesusfilm.org/api/graphql",
      consumerBearer: "web-key",
      contextSecret: "s".repeat(32),
    })
    await expect(
      preflightPublicUserPlaylist({
        capability: CAPABILITY,
        requestHeaders: new Headers(),
      }),
    ).resolves.toBe("unavailable")
  })
})
