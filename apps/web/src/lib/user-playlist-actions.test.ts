import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
  readSession: vi.fn(),
  createClient: vi.fn(),
  query: vi.fn(),
  mutate: vi.fn(),
  consume: vi.fn(),
  authoringEnabled: vi.fn(),
}))

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

vi.mock("@/lib/feature-flags", () => ({
  isUserPlaylistAuthoringUxEnabled: mocks.authoringEnabled,
}))

vi.mock("@/lib/user-playlist-action-rate-limit", () => ({
  getUserPlaylistActionLimiter: () => ({ consume: mocks.consume }),
}))

vi.mock("@/lib/user-playlist-operations", () => ({
  createUserPlaylistOperation: "create",
  deleteUserPlaylistOperation: "delete",
  getMyUserPlaylistOperation: "get",
  listMyUserPlaylistsOperation: "list",
  reshareUserPlaylistOperation: "reshare",
  revealUserPlaylistCapabilityOperation: "reveal",
  rotateUserPlaylistCapabilityOperation: "rotate",
  unshareUserPlaylistOperation: "unshare",
  updateUserPlaylistOperation: "update",
}))

import {
  createUserPlaylist,
  deleteUserPlaylist,
  getMyUserPlaylist,
  getUserPlaylistPolicy,
  listMyUserPlaylists,
  reshareUserPlaylist,
  revealUserPlaylistCapability,
  rotateUserPlaylistCapability,
  unshareUserPlaylist,
  updateUserPlaylist,
} from "./user-playlist-actions"
import type {
  CreateUserPlaylistInput,
  UserPlaylistVersionedInput,
} from "./user-playlist-contract"

const ownerPlaylist = {
  id: "playlist-1",
  title: "Hope",
  description: "A playlist",
  locale: "en",
  countryCode: "CA",
  version: 2,
  shared: true,
  unavailableVideoIds: ["video-2"],
  blocks: [
    { __typename: "UserPlaylistTextBlock", text: "Welcome" },
    {
      __typename: "UserPlaylistVideoCarouselBlock",
      title: "Stories",
      items: [{ videoId: "video-1" }],
    },
  ],
}

const createInput: CreateUserPlaylistInput = {
  title: "Hope",
  description: "A playlist",
  locale: "en",
  countryCode: "CA",
  blocks: [
    { kind: "TEXT", text: "Welcome" },
    {
      kind: "VIDEO_CAROUSEL",
      title: "Stories",
      items: [{ videoId: "video-1" }],
    },
  ],
  acceptance: {
    termsVersion: "2026-08-21",
    privacyVersion: "2026-08-21",
    communityGuidelinesVersion: "2026-08-21",
  },
}

const versioned: UserPlaylistVersionedInput = {
  id: "playlist-1",
  expectedVersion: 2,
}

const updateInput = {
  id: "playlist-1",
  expectedVersion: 2,
  title: createInput.title,
  description: createInput.description,
  locale: createInput.locale,
  countryCode: createInput.countryCode,
  blocks: createInput.blocks,
}

function requestHeaders(overrides: HeadersInit = {}): Headers {
  return new Headers({
    host: "www.jesusfilm.org",
    origin: "https://www.jesusfilm.org",
    "next-action": "0085b246c2b7639365ce6f2316b2d46f40df3d4d51",
    "sec-fetch-site": "same-origin",
    "cf-ray": "1234567890abcdef-YUL",
    "cf-connecting-ip": "203.0.113.2",
    "cf-ipcountry": "CA",
    ...Object.fromEntries(new Headers(overrides)),
  })
}

describe("User Playlist owner Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(requestHeaders())
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: "encrypted-session" })),
    })
    mocks.readSession.mockResolvedValue({
      subject: "consumer-user-1",
      accessToken: "delegated-access-token",
      scopes: ["playlist:read", "playlist:write", "playlist:share"],
    })
    mocks.consume.mockResolvedValue("admitted")
    mocks.authoringEnabled.mockResolvedValue(true)
    mocks.createClient.mockReturnValue({
      query: mocks.query,
      mutate: mocks.mutate,
    })
  })

  it("lists safe owner summaries with the delegated token kept server-side", async () => {
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
              version: 2,
              shared: true,
            },
          ],
          nextCursor: null,
        },
      },
    })

    await expect(listMyUserPlaylists({ first: 10 })).resolves.toEqual({
      ok: true,
      data: {
        items: [
          expect.objectContaining({
            id: "playlist-1",
            shareState: "SHARED",
          }),
        ],
        nextCursor: null,
      },
    })

    expect(mocks.createClient).toHaveBeenCalledWith(
      "delegated-access-token",
      expect.objectContaining({
        "x-forge-viewer-context": expect.any(String),
        "x-forge-viewer-context-signature": expect.any(String),
      }),
    )
    expect(
      JSON.stringify(await listMyUserPlaylists({ first: 10 })),
    ).not.toContain("delegated-access-token")
  })

  it("rejects cross-site and host-confused submissions before session or GraphQL access", async () => {
    mocks.headers.mockResolvedValueOnce(
      requestHeaders({ origin: "https://attacker.example" }),
    )
    await expect(deleteUserPlaylist(versioned)).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
    })
    expect(mocks.readSession).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it("distinguishes signed-out, ineligible, throttled, and unavailable ingress", async () => {
    mocks.readSession.mockResolvedValueOnce(null)
    await expect(listMyUserPlaylists()).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    })

    mocks.readSession.mockResolvedValueOnce({
      subject: "email-user",
      accessToken: "watch-only-token",
      scopes: ["web:watch-events:write"],
    })
    await expect(createUserPlaylist(createInput)).resolves.toEqual({
      ok: false,
      code: "INELIGIBLE",
    })

    mocks.consume.mockResolvedValueOnce("limited")
    await expect(deleteUserPlaylist(versioned)).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
    })

    mocks.consume.mockResolvedValueOnce("unavailable")
    await expect(deleteUserPlaylist(versioned)).resolves.toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    })
  })

  it("fails closed before scope, limiter, or Admin access when authoring is disabled", async () => {
    mocks.authoringEnabled.mockResolvedValue(false)

    await expect(listMyUserPlaylists()).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
    })
    await expect(getUserPlaylistPolicy()).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
    })

    expect(mocks.consume).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it("strictly rejects malformed or over-posted input without echo or upstream work", async () => {
    const hostile = {
      ...createInput,
      ownerId: "other-user",
      title: "<script>alert(1)</script>",
    }
    await expect(createUserPlaylist(hostile as never)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it("maps owner reads and all mutation results without broadening capability exposure", async () => {
    mocks.query.mockResolvedValueOnce({
      data: { myUserPlaylist: ownerPlaylist },
    })
    const readResult = await getMyUserPlaylist("playlist-1")
    expect(readResult).toMatchObject({
      ok: true,
      data: {
        id: "playlist-1",
        shareState: "SHARED",
        unavailableVideoIds: ["video-2"],
        blocks: [
          { kind: "TEXT", text: "Welcome" },
          {
            kind: "VIDEO_CAROUSEL",
            title: "Stories",
            items: [{ videoId: "video-1" }],
          },
        ],
      },
    })

    mocks.mutate
      .mockResolvedValueOnce({
        data: {
          createUserPlaylist: {
            __typename: "UserPlaylistSuccess",
            playlist: ownerPlaylist,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateUserPlaylist: {
            __typename: "UserPlaylistSuccess",
            playlist: ownerPlaylist,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          deleteUserPlaylist: {
            __typename: "UserPlaylistDeleteSuccess",
            deleted: true,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          unshareUserPlaylist: {
            __typename: "UserPlaylistSuccess",
            playlist: { ...ownerPlaylist, shared: false },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          reshareUserPlaylist: {
            __typename: "UserPlaylistSuccess",
            playlist: ownerPlaylist,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          rotateUserPlaylistCapability: {
            __typename: "UserPlaylistSuccess",
            playlist: ownerPlaylist,
          },
        },
      })

    await expect(createUserPlaylist(createInput)).resolves.toMatchObject({
      ok: true,
      data: { id: "playlist-1" },
    })
    await expect(updateUserPlaylist(updateInput)).resolves.toMatchObject({
      ok: true,
      data: { id: "playlist-1" },
    })
    await expect(deleteUserPlaylist(versioned)).resolves.toEqual({
      ok: true,
      data: { deleted: true },
    })
    const unshareResult = await unshareUserPlaylist(versioned)
    expect(unshareResult).toMatchObject({
      ok: true,
      data: { shareState: "UNSHARED" },
    })
    await expect(reshareUserPlaylist(versioned)).resolves.toMatchObject({
      ok: true,
      data: { id: "playlist-1" },
    })
    await expect(
      rotateUserPlaylistCapability(versioned),
    ).resolves.toMatchObject({ ok: true, data: { id: "playlist-1" } })

    const ownerResults = [readResult, unshareResult]
    expect(JSON.stringify(ownerResults)).not.toContain("cap-")
  })

  it("reveals a capability only through the separately scoped no-cache query", async () => {
    mocks.query.mockResolvedValue({
      data: { myUserPlaylistCapability: { capability: "cap-secret" } },
    })

    await expect(revealUserPlaylistCapability("playlist-1")).resolves.toEqual({
      ok: true,
      data: { capability: "cap-secret" },
    })
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "reveal",
        fetchPolicy: "no-cache",
        context: { fetchOptions: { cache: "no-store" } },
      }),
    )
  })

  it("maps Admin business errors and transport failures to fixed action codes", async () => {
    mocks.mutate.mockResolvedValueOnce({
      data: {
        updateUserPlaylist: {
          __typename: "UserPlaylistError",
          code: "CONFLICT",
          message: "hostile detail must not be echoed",
        },
      },
    })
    await expect(updateUserPlaylist(updateInput)).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
    })

    mocks.query.mockRejectedValueOnce(new Error("internal upstream hostname"))
    await expect(getMyUserPlaylist("playlist-1")).resolves.toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    })
  })

  it("returns an authoritative version-and-link policy only when fully configured", async () => {
    await expect(getUserPlaylistPolicy()).resolves.toEqual({
      ok: true,
      data: {
        terms: {
          version: "2026-08-21",
          url: "https://www.jesusfilm.org/terms/",
        },
        privacy: {
          version: "2026-08-21",
          url: "https://www.jesusfilm.org/privacy/",
        },
        communityGuidelines: {
          version: "2026-08-21",
          url: "https://www.jesusfilm.org/community-guidelines/",
        },
      },
    })
  })
})
