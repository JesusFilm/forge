import { describe, expect, it, vi } from "vitest"

import { ingestSupportConversations } from "./ingest-support-conversations"

const config = {
  allowedWatchHosts: ["www.jesusfilm.org"],
  maxConversations: 200,
  maxSanitizedCharacters: 12_000,
}

describe("ingestSupportConversations", () => {
  it("sanitizes sources and advances through the last processed timestamp", async () => {
    const client = {
      listNewConversations: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          capped: false,
          pages: 1,
          conversations: [
            {
              id: "1",
              mailboxId: "9",
              createdAt: "2026-08-01T01:00:00Z",
              subject: "Watch problem",
            },
            {
              id: "2",
              mailboxId: "9",
              createdAt: "2026-08-01T02:00:00Z",
              subject: "Another problem",
            },
          ],
        },
      }),
      listThreads: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            capped: false,
            pages: 1,
            threads: [
              {
                id: "10",
                body: "Email me at person@example.org about https://www.jesusfilm.org/watch/jesus.html",
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            capped: false,
            pages: 1,
            threads: [{ id: "20", body: "Language picker unclear" }],
          },
        }),
    }

    const result = await ingestSupportConversations({
      client,
      config,
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
    })

    expect(result.partial).toBe(false)
    expect(result.cursorProgress.toISOString()).toBe("2026-08-01T02:00:00.000Z")
    expect(result.conversations[0]?.excerpt).not.toContain("person@example.org")
    expect(result.conversations[0]?.watchUrls).toEqual([
      "https://www.jesusfilm.org/watch/jesus.html",
    ])
  })

  it("stops before a retryable source failure without skipping it", async () => {
    const client = {
      listNewConversations: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          capped: false,
          pages: 1,
          conversations: [
            {
              id: "1",
              mailboxId: "9",
              createdAt: "2026-08-01T01:00:00Z",
              subject: "First",
            },
            {
              id: "2",
              mailboxId: "9",
              createdAt: "2026-08-01T02:00:00Z",
              subject: "Second",
            },
          ],
        },
      }),
      listThreads: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            capped: false,
            pages: 1,
            threads: [{ id: "10", body: "First feedback" }],
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          reason: "rate_limited",
          retryable: true,
          status: 429,
        }),
    }

    const result = await ingestSupportConversations({
      client,
      config,
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
    })

    expect(result.partial).toBe(true)
    expect(result.conversations).toHaveLength(1)
    expect(result.cursorProgress.toISOString()).toBe("2026-08-01T01:00:00.000Z")
    expect(result.failure).toMatchObject({ reason: "rate_limited" })
  })

  it("records deleted conversations as terminal exclusions", async () => {
    const client = {
      listNewConversations: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          capped: false,
          pages: 1,
          conversations: [
            {
              id: "1",
              mailboxId: "9",
              createdAt: "2026-08-01T01:00:00Z",
              subject: "Deleted",
            },
          ],
        },
      }),
      listThreads: vi.fn().mockResolvedValue({
        ok: false,
        reason: "not_found",
        retryable: false,
        status: 404,
      }),
    }

    const result = await ingestSupportConversations({
      client,
      config,
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
    })

    expect(result.partial).toBe(false)
    expect(result.exclusions).toEqual([{ sourceId: "1", reason: "not_found" }])
    expect(result.cursorProgress.toISOString()).toBe("2026-08-01T01:00:00.000Z")
  })

  it("surfaces a thread cap as a partial truncated source", async () => {
    const client = {
      listNewConversations: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          capped: false,
          pages: 1,
          conversations: [
            {
              id: "1",
              mailboxId: "9",
              createdAt: "2026-08-01T01:00:00Z",
              subject: "Long conversation",
            },
          ],
        },
      }),
      listThreads: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          capped: true,
          pages: 20,
          threads: [{ id: "10", body: "Bounded feedback" }],
        },
      }),
    }

    const result = await ingestSupportConversations({
      client,
      config,
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
    })

    expect(result).toMatchObject({ partial: true, capped: true, pages: 21 })
    expect(result.conversations[0]?.truncated).toBe(true)
  })
})
