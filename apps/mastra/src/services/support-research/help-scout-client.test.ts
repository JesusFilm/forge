import { describe, expect, it, vi } from "vitest"

import type { SupportResearchConfig } from "../../config/env"
import { HelpScoutClient } from "./help-scout-client"

const config: Pick<
  SupportResearchConfig,
  "timeoutMs" | "maxResponseBytes" | "maxThreadsPerConversation"
> & { helpScout: SupportResearchConfig["helpScout"] } = {
  timeoutMs: 5_000,
  maxResponseBytes: 100_000,
  maxThreadsPerConversation: 20,
  helpScout: {
    clientId: "client-id",
    clientSecret: "client-secret",
    mailboxIds: ["9"],
    apiUrl: "https://api.helpscout.net/v2",
    authUrl: "https://api.helpscout.net/v2/oauth2/token",
  },
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

describe("HelpScoutClient", () => {
  it("authenticates once, paginates all GETs, and keeps the API read-only", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ access_token: "token-one", expires_in: 172_800 }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 10,
                subject: "Watch issue",
                createdAt: "2026-08-01T01:00:00Z",
                mailboxId: 9,
                _links: {
                  web: {
                    href: "https://secure.helpscout.net/conversation/10",
                  },
                },
              },
            ],
          },
          _links: {
            next: {
              href: "https://api.helpscout.net/v2/conversations?mailbox=9&page=2",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 11,
                subject: "Another issue",
                createdAt: "2026-08-01T02:00:00Z",
                mailboxId: 9,
              },
            ],
          },
          _links: {},
        }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: {
            threads: [
              {
                id: 100,
                type: "customer",
                body: "The Watch page is broken",
                createdAt: "2026-08-01T01:00:00Z",
              },
            ],
          },
          _links: {},
        }),
      )
    const client = new HelpScoutClient(config, fetchImpl)

    const conversations = await client.listNewConversations({
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
      maxConversations: 200,
    })
    const threads = await client.listThreads("10")

    expect(conversations).toMatchObject({
      ok: true,
      value: { conversations: [{ id: "10" }, { id: "11" }] },
    })
    expect(threads).toMatchObject({
      ok: true,
      value: { threads: [{ body: "The Watch page is broken" }] },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    const calls = fetchImpl.mock.calls
    expect(calls[0]?.[1]?.method).toBe("POST")
    expect(String(calls[0]?.[0])).toBe(config.helpScout.authUrl)
    expect(calls.slice(1).every((call) => call[1]?.method === "GET")).toBe(true)
    expect(String(calls[1]?.[0])).toContain("status=all")
    expect(String(calls[1]?.[0])).toContain("sortOrder=asc")
    expect(String(calls[1]?.[0])).toContain("createdAt%3A")
  })

  it("refreshes the token once after a 401", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "expired", expires_in: 100 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json({ access_token: "fresh", expires_in: 100 }))
      .mockResolvedValueOnce(
        json({ _embedded: { conversations: [] }, _links: {} }),
      )
    const client = new HelpScoutClient(config, fetchImpl)

    await expect(
      client.listNewConversations({
        createdAfter: new Date("2026-08-01T00:00:00Z"),
        createdBefore: new Date("2026-08-02T00:00:00Z"),
        maxConversations: 200,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { conversations: [], capped: false, pages: 1 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it("validates same-origin merged conversation redirects", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: {
            location: "https://api.helpscout.net/v2/conversations/99",
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: { threads: [{ id: 1, body: "Merged feedback" }] },
          _links: {},
        }),
      )
    const client = new HelpScoutClient(config, fetchImpl)

    await expect(client.listThreads("10")).resolves.toEqual({
      ok: true,
      value: {
        threads: [
          {
            id: "1",
            body: "Merged feedback",
            type: undefined,
            createdAt: undefined,
          },
        ],
        mergedIntoId: "99",
        capped: false,
        pages: 2,
      },
    })
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain(
      "/v2/conversations/99/threads",
    )
  })

  it("rejects off-origin pagination and merged redirects", async () => {
    const paginationFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        json({
          _embedded: { conversations: [] },
          _links: { next: { href: "https://evil.test/v2/conversations" } },
        }),
      )
    const paginationClient = new HelpScoutClient(config, paginationFetch)

    await expect(
      paginationClient.listNewConversations({
        createdAfter: new Date("2026-08-01T00:00:00Z"),
        createdBefore: new Date("2026-08-02T00:00:00Z"),
        maxConversations: 200,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unsafe_redirect" })

    const redirectFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://evil.test/v2/conversations/99" },
        }),
      )
    const redirectClient = new HelpScoutClient(config, redirectFetch)
    await expect(redirectClient.listThreads("10")).resolves.toMatchObject({
      ok: false,
      reason: "unsafe_redirect",
    })
  })

  it("selects the earliest global sources when several mailboxes hit a cap", async () => {
    const multiMailboxConfig = {
      ...config,
      helpScout: { ...config.helpScout, mailboxIds: ["9", "10"] },
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 90,
                subject: "Later",
                createdAt: "2026-08-01T09:00:00Z",
                mailboxId: 9,
              },
            ],
          },
          _links: {},
        }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 10,
                subject: "Earlier",
                createdAt: "2026-08-01T01:00:00Z",
                mailboxId: 10,
              },
            ],
          },
          _links: {},
        }),
      )
    const client = new HelpScoutClient(multiMailboxConfig, fetchImpl)

    const result = await client.listNewConversations({
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
      maxConversations: 1,
    })

    expect(result).toMatchObject({
      ok: true,
      value: { conversations: [{ id: "10" }], capped: true },
    })
  })

  it("fetches a busy mailbox's next page before advancing past it", async () => {
    const multiMailboxConfig = {
      ...config,
      helpScout: { ...config.helpScout, mailboxIds: ["9", "10"] },
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 91,
                subject: "Busy first",
                createdAt: "2026-08-01T01:00:00Z",
                mailboxId: 9,
              },
            ],
          },
          _links: {
            next: {
              href: "https://api.helpscout.net/v2/conversations?mailbox=9&page=2",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 10,
                subject: "Quiet later",
                createdAt: "2026-08-01T03:00:00Z",
                mailboxId: 10,
              },
            ],
          },
          _links: {},
        }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 92,
                subject: "Busy second",
                createdAt: "2026-08-01T02:00:00Z",
                mailboxId: 9,
              },
            ],
          },
          _links: {},
        }),
      )
    const client = new HelpScoutClient(multiMailboxConfig, fetchImpl)

    const result = await client.listNewConversations({
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
      maxConversations: 2,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        conversations: [{ id: "91" }, { id: "92" }],
        capped: true,
        pages: 3,
      },
    })
  })

  it("does not report a cap when the final page exactly matches the limit", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        json({
          _embedded: {
            conversations: [
              {
                id: 10,
                subject: "Only result",
                createdAt: "2026-08-01T01:00:00Z",
                mailboxId: 9,
                _links: {
                  web: { href: "https://evil.test/conversation/10" },
                },
              },
            ],
          },
          _links: {},
        }),
      )
    const client = new HelpScoutClient(config, fetchImpl)

    const result = await client.listNewConversations({
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
      maxConversations: 1,
    })

    expect(result).toMatchObject({
      ok: true,
      value: { conversations: [{ id: "10" }], capped: false },
    })
    if (result.ok) {
      expect(result.value.conversations[0]?.sourceUrl).toBeUndefined()
    }
  })

  it("stops a cyclic empty conversation pagination sequence", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        json({
          _embedded: { conversations: [] },
          _links: {
            next: {
              href: "https://api.helpscout.net/v2/conversations?mailbox=9&page=2",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          _embedded: { conversations: [] },
          _links: {
            next: {
              href: "https://api.helpscout.net/v2/conversations?mailbox=9&page=2",
            },
          },
        }),
      )
    const client = new HelpScoutClient(config, fetchImpl)

    const result = await client.listNewConversations({
      createdAfter: new Date("2026-08-01T00:00:00Z"),
      createdBefore: new Date("2026-08-02T00:00:00Z"),
      maxConversations: 2,
    })

    expect(result).toEqual({
      ok: true,
      value: { conversations: [], capped: true, pages: 2 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("returns an unsafe redirect failure for malformed merged ids", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 100 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: {
            location: "https://api.helpscout.net/v2/conversations/%E0%A4%A",
          },
        }),
      )
    const client = new HelpScoutClient(config, fetchImpl)

    await expect(client.listThreads("10")).resolves.toMatchObject({
      ok: false,
      reason: "unsafe_redirect",
    })
  })

  it("does not send credentials to a modified auth endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const client = new HelpScoutClient(
      {
        ...config,
        helpScout: {
          ...config.helpScout,
          authUrl:
            "https://api.helpscout.net/v2/oauth2/token?redirect=unexpected",
        },
      },
      fetchImpl,
    )

    await expect(
      client.listNewConversations({
        createdAfter: new Date("2026-08-01T00:00:00Z"),
        createdBefore: new Date("2026-08-02T00:00:00Z"),
        maxConversations: 2,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_config" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
