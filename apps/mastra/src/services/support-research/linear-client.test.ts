import { describe, expect, it, vi } from "vitest"

import type { SupportResearchConfig } from "../../config/env"
import { LinearClient } from "./linear-client"
import type { SupportActionDraft } from "./schema"

const config: Pick<SupportResearchConfig, "timeoutMs" | "maxResponseBytes"> & {
  linear: SupportResearchConfig["linear"]
} = {
  timeoutMs: 5_000,
  maxResponseBytes: 100_000,
  linear: {
    apiKey: "linear-key",
    apiUrl: "https://api.linear.app/graphql",
    teamId: "team-id",
    projectId: "project-id",
  },
}

const draft: SupportActionDraft = {
  idempotencyKey: "support-research:needs-validation:abc",
  fingerprint: "a".repeat(64),
  type: "needs_validation",
  title: "[Needs validation] Playback control fails",
  description:
    "Generated report\n<!-- support-research-key:support-research:needs-validation:abc -->",
  labelId: "label-id",
  sourceIds: ["10"],
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

describe("LinearClient", () => {
  it("finds a recent issue by its hidden idempotency marker", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: {
          team: {
            issues: {
              nodes: [
                {
                  id: "issue-id",
                  url: "https://linear.app/team/issue/FGE-1",
                  description: draft.description,
                },
              ],
            },
          },
        },
      }),
    )
    const client = new LinearClient(config, fetchImpl)

    await expect(
      client.findIssueByMarker(
        "<!-- support-research-key:support-research:needs-validation:abc -->",
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: "issue-id",
        url: "https://linear.app/team/issue/FGE-1",
      },
    })
  })

  it("searches subsequent issue pages for an idempotency marker", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          data: {
            team: {
              issues: {
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "page-one" },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: {
            team: {
              issues: {
                nodes: [
                  {
                    id: "issue-id",
                    url: "https://linear.app/team/issue/FGE-9",
                    description: draft.description,
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      )
    const client = new LinearClient(config, fetchImpl)

    await expect(
      client.findIssueByMarker(
        "<!-- support-research-key:support-research:needs-validation:abc -->",
      ),
    ).resolves.toMatchObject({ ok: true, value: { id: "issue-id" } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(
      String(fetchImpl.mock.calls[1]?.[1]?.body),
    ) as { variables: { after: string } }
    expect(secondBody.variables.after).toBe("page-one")
  })

  it("creates an unprioritized project issue with configured labels", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-id",
              url: "https://linear.app/team/issue/FGE-2",
              description: draft.description,
            },
          },
        },
      }),
    )
    const client = new LinearClient(config, fetchImpl)

    await expect(client.createIssue(draft)).resolves.toMatchObject({
      ok: true,
      value: { id: "issue-id" },
    })
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      variables: { input: Record<string, unknown> }
    }
    expect(request.variables.input).toMatchObject({
      teamId: "team-id",
      projectId: "project-id",
      labelIds: ["label-id"],
    })
    expect(request.variables.input).not.toHaveProperty("priority")
    expect(request.variables.input).not.toHaveProperty("assigneeId")
  })

  it("treats GraphQL rate limits as retryable even on HTTP 200", async () => {
    const client = new LinearClient(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          errors: [
            { message: "rate limited", extensions: { code: "RATELIMITED" } },
          ],
        }),
      ),
    )

    await expect(client.createIssue(draft)).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      ambiguous: false,
    })
  })

  it("marks a mutation timeout ambiguous for reconciliation", async () => {
    const timeout = Object.assign(new Error("hidden request"), {
      name: "TimeoutError",
    })
    const client = new LinearClient(
      config,
      vi.fn<typeof fetch>().mockRejectedValue(timeout),
    )

    await expect(client.createIssue(draft)).resolves.toEqual({
      ok: false,
      reason: "timeout",
      retryable: true,
      ambiguous: true,
    })
  })

  it("rejects a configured credential target outside Linear", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const client = new LinearClient(
      {
        ...config,
        linear: { ...config.linear, apiUrl: "https://evil.test/graphql" },
      },
      fetchImpl,
    )

    await expect(client.createIssue(draft)).resolves.toMatchObject({
      ok: false,
      reason: "invalid_config",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
