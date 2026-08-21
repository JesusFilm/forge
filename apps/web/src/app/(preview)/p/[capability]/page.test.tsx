import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const { headersMock, loadMock, notFoundMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  loadMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("next/headers", () => ({ headers: headersMock }))
vi.mock("next/navigation", () => ({ notFound: notFoundMock }))
vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }))
vi.mock("@/i18n/client-messages", () => ({
  loadClientMessages: vi.fn().mockResolvedValue({}),
  PUBLIC_USER_PLAYLIST_CLIENT_MESSAGE_NAMESPACES: ["PublicUserPlaylist"],
}))
vi.mock("@/lib/user-playlist", () => ({ loadPublicUserPlaylist: loadMock }))
vi.mock("@/components/user-playlists/PublicUserPlaylistPage", () => ({
  PublicUserPlaylistPage: ({
    data,
  }: {
    data: { playlist: { title: string } }
  }) => <main>{data.playlist.title}</main>,
}))

import {
  PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER,
  sealPublicUserPlaylistCapability,
} from "@/lib/user-playlist-public-boundary"
import PublicPlaylistRoute from "./page"

const CAPABILITY = "z".repeat(43)
const SECRET = "s".repeat(32)
const NOW = new Date("2026-08-21T12:00:00.000Z")

function requestHeaders(envelope: string | null): Headers {
  const value = new Headers()
  if (envelope) value.set(PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER, envelope)
  return value
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("public playlist rewritten RSC page", () => {
  it("resolves from the encrypted request header without exposing the capability or envelope", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.stubEnv("USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET", SECRET)
    const envelope = sealPublicUserPlaylistCapability(CAPABILITY, {
      secret: SECRET,
      now: NOW,
    })!
    headersMock.mockResolvedValue(requestHeaders(envelope))
    loadMock.mockResolvedValue({
      kind: "available",
      data: {
        uiLocale: "en",
        playlist: { title: "Safe public playlist" },
      },
    })

    const html = renderToStaticMarkup(await PublicPlaylistRoute())

    expect(loadMock).toHaveBeenCalledWith(
      expect.objectContaining({ capability: CAPABILITY }),
    )
    expect(html).toContain("Safe public playlist")
    expect(html).not.toContain(CAPABILITY)
    expect(html).not.toContain(envelope)
  })

  it.each(["missing", "forged", "expired"])(
    "fails closed for a %s internal envelope",
    async (kind) => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      vi.stubEnv("USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET", SECRET)
      const valid = sealPublicUserPlaylistCapability(CAPABILITY, {
        secret: SECRET,
        now: new Date(NOW.getTime() - (kind === "expired" ? 30_001 : 0)),
      })!
      headersMock.mockResolvedValue(
        requestHeaders(
          kind === "missing"
            ? null
            : kind === "forged"
              ? `${valid.slice(0, -1)}x`
              : valid,
        ),
      )

      await expect(PublicPlaylistRoute()).rejects.toThrow("NEXT_NOT_FOUND")
      expect(loadMock).not.toHaveBeenCalled()
    },
  )
})
