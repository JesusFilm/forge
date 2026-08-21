import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
  readSession: vi.fn(),
  createClient: vi.fn(),
  query: vi.fn(),
  consume: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}))
vi.mock("@/auth/web-session", () => ({
  WEB_AUTH_SESSION_COOKIE: "forge_web_session",
  readWebAuthSessionCookie: mocks.readSession,
}))
vi.mock("@/env", () => ({
  env: {
    WEB_BASE_URL: "https://www.jesusfilm.org",
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://www.jesusfilm.org",
    USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET:
      "viewer-context-secret-that-is-at-least-32-bytes",
    USER_PLAYLIST_TERMS_VERSION: "2026-08-21",
    USER_PLAYLIST_PRIVACY_VERSION: "2026-08-21",
    USER_PLAYLIST_COMMUNITY_GUIDELINES_VERSION: "2026-08-21",
    USER_PLAYLIST_TERMS_URL: "https://www.jesusfilm.org/terms/",
    USER_PLAYLIST_PRIVACY_URL: "https://www.jesusfilm.org/privacy/",
    USER_PLAYLIST_COMMUNITY_GUIDELINES_URL:
      "https://www.jesusfilm.org/community-guidelines/",
  },
}))
vi.mock("@/lib/admin-client", () => ({
  createUserPlaylistAdminClient: mocks.createClient,
}))
vi.mock("@/lib/user-playlist-action-rate-limit", () => ({
  getUserPlaylistActionLimiter: () => ({ consume: mocks.consume }),
}))
vi.mock("@/lib/user-playlist-operations", () => ({
  getMyUserPlaylistOperation: "get",
  listMyUserPlaylistsOperation: "list",
}))

import {
  loadMyUserPlaylistForPage,
  loadMyUserPlaylistsForPage,
  loadUserPlaylistPolicyForPage,
} from "./user-playlist-loaders"

describe("User Playlist server-only RSC loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(
      new Headers({
        host: "www.jesusfilm.org",
        "cf-ray": "1234567890abcdef-YUL",
        "cf-connecting-ip": "203.0.113.8",
        "cf-ipcountry": "CA",
      }),
    )
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: "encrypted-session" })),
    })
    mocks.readSession.mockResolvedValue({
      subject: "consumer-user-1",
      accessToken: "delegated-access-token",
      scopes: ["playlist:read"],
    })
    mocks.consume.mockResolvedValue("admitted")
    mocks.createClient.mockReturnValue({ query: mocks.query })
  })

  it("loads the initial page on GET without requiring an Origin or action marker", async () => {
    mocks.query.mockResolvedValue({
      data: {
        myUserPlaylists: {
          items: [
            {
              id: "playlist-1",
              title: "Hope",
              description: "A playlist",
              locale: "en",
              countryCode: "CA",
              version: 1,
              shared: true,
            },
          ],
          nextCursor: null,
        },
      },
    })

    await expect(loadMyUserPlaylistsForPage()).resolves.toMatchObject({
      ok: true,
      data: { items: [{ id: "playlist-1", shareState: "SHARED" }] },
    })
    expect(mocks.createClient).toHaveBeenCalledWith(
      "delegated-access-token",
      expect.objectContaining({
        "x-forge-viewer-context-signature": expect.any(String),
      }),
    )
  })

  it("keeps session and exact read-scope authorization on server renders", async () => {
    mocks.readSession.mockResolvedValueOnce(null)
    await expect(loadMyUserPlaylistsForPage()).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    })

    mocks.readSession.mockResolvedValueOnce({
      subject: "email-user",
      accessToken: "watch-only-token",
      scopes: ["web:watch-events:write"],
    })
    await expect(loadMyUserPlaylistsForPage()).resolves.toEqual({
      ok: false,
      code: "INELIGIBLE",
    })
  })

  it("rejects raw internal render hosts before cookie access", async () => {
    mocks.headers.mockResolvedValueOnce(
      new Headers({ host: "forge-web.railway.internal" }),
    )
    await expect(loadMyUserPlaylistForPage("playlist-1")).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
    })
    expect(mocks.cookies).not.toHaveBeenCalled()
  })

  it("returns public policy metadata without exposing server configuration", async () => {
    await expect(loadUserPlaylistPolicyForPage()).resolves.toMatchObject({
      ok: true,
      data: {
        terms: { version: "2026-08-21" },
        privacy: { version: "2026-08-21" },
        communityGuidelines: { version: "2026-08-21" },
      },
    })
  })
})
