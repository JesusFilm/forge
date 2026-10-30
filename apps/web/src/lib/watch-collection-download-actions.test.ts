import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const {
  accountGateEnabledMock,
  createWatchDownloadCapabilityMock,
  headersMock,
  verifyAuthSessionMock,
} = vi.hoisted(() => ({
  accountGateEnabledMock: vi.fn(),
  createWatchDownloadCapabilityMock: vi.fn(),
  headersMock: vi.fn(),
  verifyAuthSessionMock: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

vi.mock("@/lib/admin-client", () => ({
  default: { query: vi.fn() },
}))

vi.mock("@/lib/watch-download-capability", () => ({
  createWatchDownloadCapability: createWatchDownloadCapabilityMock,
}))

vi.mock("@/lib/auth-session", () => ({
  verifyAuthSession: verifyAuthSessionMock,
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchDownloadAccountGateEnabled: accountGateEnabledMock,
  watchDownloadAccountGateFlagContext: {
    custom: { surface: "watch-download" },
  },
}))

import client from "@/lib/admin-client"
import { loadWatchCollectionDownloads } from "./watch-collection-download-actions"

const queryMock = vi.mocked(client.query)
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

describe("loadWatchCollectionDownloads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accountGateEnabledMock.mockResolvedValue(false)
    headersMock.mockResolvedValue(new Headers())
    verifyAuthSessionMock.mockResolvedValue({ authenticated: false })
    createWatchDownloadCapabilityMock.mockImplementation(
      async ({ downloadId }: { downloadId: string }) =>
        `capability-${downloadId}`,
    )
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it("returns normalized safe metadata without raw download URLs", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          documentId: "collection-1",
          downloadableChildDubs: [
            {
              documentId: "dub-1",
              slug: "episode-one/english",
              videoId: "episode-1",
              language: { documentId: "language-1" },
              downloads: [
                {
                  documentId: "download-1",
                  height: 1080,
                  quality: "high",
                  size: "12345",
                  url: "https://cdn.example.test/episode-1.mp4",
                },
                {
                  documentId: "download-without-url",
                  height: 360,
                  quality: "low",
                  size: "2345",
                  url: null,
                },
              ],
            },
          ],
        },
      },
    } as never)

    const result = await loadWatchCollectionDownloads({
      collectionSlug: "lumo-luke",
      languageSlug: "english",
    })

    expect(result).toEqual({
      ok: true,
      dubs: [
        {
          documentId: "dub-1",
          videoId: "episode-1",
          downloads: [
            {
              documentId: "download-1",
              height: 1080,
              quality: "high",
              size: 12345,
              capability: "capability-download-1",
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain("url")
    expect(createWatchDownloadCapabilityMock).toHaveBeenCalledWith({
      downloadId: "download-1",
      variantId: "dub-1",
      videoSlug: "episode-one",
      target: "https://cdn.example.test/episode-1.mp4",
      event: {
        videoId: "episode-1",
        videoDubId: "dub-1",
        languageId: "language-1",
      },
    })
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          videoSlug: "lumo-luke",
          languageSlug: "english",
        },
        fetchPolicy: "no-cache",
      }),
    )
  })

  it("binds minted capabilities to the authenticated subject when gated", async () => {
    accountGateEnabledMock.mockResolvedValueOnce(true)
    verifyAuthSessionMock.mockResolvedValueOnce({
      authenticated: true,
      userId: "user_123",
    })
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          downloadableChildDubs: [
            {
              documentId: "dub-1",
              slug: "episode-one/english",
              videoId: "episode-1",
              language: { documentId: "language-1" },
              downloads: [
                {
                  documentId: "download-1",
                  quality: "high",
                  url: "https://cdn.example.test/episode-1.mp4",
                },
              ],
            },
          ],
        },
      },
    } as never)

    await loadWatchCollectionDownloads({
      collectionSlug: "lumo-luke",
      languageSlug: "english",
    })

    expect(headersMock).toHaveBeenCalledOnce()
    expect(verifyAuthSessionMock).toHaveBeenCalledWith(expect.any(Headers))
    expect(createWatchDownloadCapabilityMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "user_123" }),
    )
  })

  it("mints subjectless capabilities without reading a session when the gate is disabled", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          downloadableChildDubs: [
            {
              documentId: "dub-1",
              slug: "episode-one/english",
              videoId: "episode-1",
              language: { documentId: "language-1" },
              downloads: [
                {
                  documentId: "download-1",
                  quality: "high",
                  url: "https://cdn.example.test/episode-1.mp4",
                },
              ],
            },
          ],
        },
      },
    } as never)

    await loadWatchCollectionDownloads({
      collectionSlug: "lumo-luke",
      languageSlug: "english",
    })

    expect(headersMock).not.toHaveBeenCalled()
    expect(verifyAuthSessionMock).not.toHaveBeenCalled()
    expect(createWatchDownloadCapabilityMock).toHaveBeenCalledOnce()
    expect(createWatchDownloadCapabilityMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.anything() }),
    )
  })

  it("refuses to mint gated capabilities without an authenticated subject", async () => {
    accountGateEnabledMock.mockResolvedValueOnce(true)

    await expect(
      loadWatchCollectionDownloads({
        collectionSlug: "lumo-luke",
        languageSlug: "english",
      }),
    ).resolves.toEqual({ ok: false, reason: "auth-required" })
    expect(queryMock).not.toHaveBeenCalled()
    expect(createWatchDownloadCapabilityMock).not.toHaveBeenCalled()
  })

  it("mints a fresh capability batch on every action call", async () => {
    const response = {
      data: {
        videoBySlug: {
          downloadableChildDubs: [
            {
              documentId: "dub-1",
              slug: "episode-one/english",
              videoId: "episode-1",
              language: { documentId: "language-1" },
              downloads: [
                {
                  documentId: "download-1",
                  quality: "high",
                  url: "https://cdn.example.test/episode-1.mp4",
                },
              ],
            },
          ],
        },
      },
    } as never
    queryMock.mockResolvedValueOnce(response).mockResolvedValueOnce(response)
    createWatchDownloadCapabilityMock
      .mockResolvedValueOnce("fresh-capability-1")
      .mockResolvedValueOnce("fresh-capability-2")

    const first = await loadWatchCollectionDownloads({
      collectionSlug: "lumo-luke",
      languageSlug: "english",
    })
    const second = await loadWatchCollectionDownloads({
      collectionSlug: "lumo-luke",
      languageSlug: "english",
    })

    expect(first.ok && first.dubs[0]?.downloads[0]?.capability).toBe(
      "fresh-capability-1",
    )
    expect(second.ok && second.dubs[0]?.downloads[0]?.capability).toBe(
      "fresh-capability-2",
    )
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it("rejects invalid slugs before querying Admin", async () => {
    await expect(
      loadWatchCollectionDownloads({
        collectionSlug: "bad/collection",
        languageSlug: "english",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid-input" })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it("returns a stable unavailable result when Admin fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("upstream secret"))

    await expect(
      loadWatchCollectionDownloads({
        collectionSlug: "lumo-luke",
        languageSlug: "english",
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
    expect(consoleError).toHaveBeenCalledWith(
      "[watch-collection-download] lookup failed",
      expect.objectContaining({
        collectionSlug: "lumo-luke",
        languageSlug: "english",
      }),
    )
  })

  it("does not log raw targets or capability ciphertext when minting fails", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          downloadableChildDubs: [
            {
              documentId: "dub-1",
              slug: "episode-one/english",
              videoId: "episode-1",
              downloads: [
                {
                  documentId: "download-1",
                  quality: "high",
                  url: "https://cdn.example.test/private-target.mp4",
                },
              ],
            },
          ],
        },
      },
    } as never)
    createWatchDownloadCapabilityMock.mockRejectedValueOnce(
      new Error(
        "https://cdn.example.test/private-target.mp4 opaque-capability-secret",
      ),
    )

    await expect(
      loadWatchCollectionDownloads({
        collectionSlug: "lumo-luke",
        languageSlug: "english",
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })

    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).not.toContain("private-target.mp4")
    expect(logged).not.toContain("opaque-capability-secret")
  })
})
