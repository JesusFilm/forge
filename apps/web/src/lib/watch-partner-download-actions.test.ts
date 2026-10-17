import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/admin-client", () => ({ default: { query: vi.fn() } }))

import client from "@/lib/admin-client"
import { loadWatchPartnerDownloadCollection } from "./watch-partner-download-actions"

const query = vi.mocked(client.query)

beforeEach(() => vi.clearAllMocks())

describe("Partner collection metadata", () => {
  it("preserves canonical relation order and exposes metadata without media URLs", async () => {
    query.mockResolvedValueOnce({
      data: {
        videoBySlug: {
          slug: "rivka",
          locales: [{ title: "Rivka" }],
          children: [
            {
              order: 1,
              child: {
                documentId: "b",
                slug: "second",
                locales: [{ title: "Second" }],
                hls: "private-stream",
              },
            },
            {
              order: 1,
              child: {
                documentId: "a",
                slug: "first",
                locales: [{ title: "First" }],
              },
            },
          ],
        },
      },
    } as never)
    const result = await loadWatchPartnerDownloadCollection({
      collectionSlug: "rivka",
      locale: "en",
      languageSlug: "english",
    })
    expect(result).toEqual({
      ok: true,
      collection: {
        slug: "rivka",
        title: "Rivka",
        episodes: [
          { documentId: "b", slug: "second", title: "Second", order: 1 },
          { documentId: "a", slug: "first", title: "First", order: 1 },
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain("private-stream")
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { slug: "rivka", locale: "en", languageSlug: "english" },
        fetchPolicy: "no-cache",
      }),
    )
  })

  it("does not query malformed collection or language identities", async () => {
    expect(
      await loadWatchPartnerDownloadCollection({
        collectionSlug: "//bad",
        languageSlug: "english",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "invalid-input" })
    expect(
      await loadWatchPartnerDownloadCollection({
        collectionSlug: "rivka",
        languageSlug: "../bad",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "invalid-input" })
    expect(query).not.toHaveBeenCalled()
  })

  it("distinguishes missing collection supply from an upstream failure", async () => {
    query.mockResolvedValueOnce({ data: { videoBySlug: null } } as never)
    expect(
      await loadWatchPartnerDownloadCollection({
        collectionSlug: "rivka",
        languageSlug: "english",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "unavailable" })
    query.mockRejectedValueOnce(new Error("upstream detail"))
    expect(
      await loadWatchPartnerDownloadCollection({
        collectionSlug: "rivka",
        languageSlug: "english",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "failed" })
  })

  it("reports a GraphQL error result as an upstream failure, not missing coverage", async () => {
    query.mockResolvedValueOnce({
      data: undefined,
      error: new Error("admin down"),
    } as never)
    expect(
      await loadWatchPartnerDownloadCollection({
        collectionSlug: "rivka",
        languageSlug: "english",
        locale: "en",
      }),
    ).toEqual({ ok: false, reason: "failed" })
  })
})
