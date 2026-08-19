import { describe, expect, it, vi } from "vitest"

import { TriageLinearClient } from "./linear-client"
import type { TriageActionDraft } from "./schema"
import { triageMarker } from "./ticket-draft"

const DRAFT: TriageActionDraft = {
  idempotencyKey: "datadog-triage:issue:ISSUE-1:0",
  service: "forge-mobile",
  signalKind: "issue",
  signalId: "ISSUE-1",
  epoch: 0,
  title: "[Mobile] [P2] Player crashes on resume",
  description: `body\n${triageMarker("datadog-triage:issue:ISSUE-1:0")}`,
  labelId: "label-bug",
}

const CONFIG = {
  timeoutMs: 1_000,
  maxResponseBytes: 1_048_576,
  linear: {
    apiKey: "lin_api_key",
    apiUrl: "https://api.linear.app/graphql",
    teamId: "team-fge",
    projectId: "project-mobile-triage",
    bugLabelId: "label-bug",
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function stubFetch(...responses: Array<Response | (() => never)>) {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.shift()
    if (typeof next === "function") next()
    return next as Response
  }) as unknown as typeof fetch
}

function issuesPage(
  nodes: Array<{ id: string; url: string; description?: string }>,
  pageInfo?: { hasNextPage: boolean; endCursor: string | null },
) {
  return {
    data: { team: { issues: { nodes, pageInfo: pageInfo ?? undefined } } },
  }
}

describe("TriageLinearClient.findIssueByMarker", () => {
  it("finds the issue whose description carries the marker", async () => {
    const marker = triageMarker(DRAFT.idempotencyKey)
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(
        jsonResponse(
          issuesPage([
            { id: "a", url: "https://linear.app/forge/issue/FGE-1" },
            {
              id: "b",
              url: "https://linear.app/forge/issue/FGE-2",
              description: `text ${marker}`,
            },
          ]),
        ),
      ),
    )

    expect(await client.findIssueByMarker(marker)).toEqual({
      ok: true,
      value: { id: "b", url: "https://linear.app/forge/issue/FGE-2" },
    })
  })

  it("walks to the next page when the marker is not on the first", async () => {
    const marker = triageMarker(DRAFT.idempotencyKey)
    const fetchImpl = stubFetch(
      jsonResponse(
        issuesPage([{ id: "a", url: "https://linear.app/forge/issue/FGE-1" }], {
          hasNextPage: true,
          endCursor: "cursor-1",
        }),
      ),
      jsonResponse(
        issuesPage([
          {
            id: "b",
            url: "https://linear.app/forge/issue/FGE-2",
            description: marker,
          },
        ]),
      ),
    )
    const client = new TriageLinearClient(CONFIG, fetchImpl)

    const result = await client.findIssueByMarker(marker)

    expect(result).toMatchObject({ ok: true, value: { id: "b" } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("stops after five pages rather than walking the whole team backlog", async () => {
    const page = () =>
      jsonResponse(
        issuesPage([{ id: "a", url: "https://linear.app/forge/issue/FGE-1" }], {
          hasNextPage: true,
          endCursor: "cursor",
        }),
      )
    const fetchImpl = stubFetch(page(), page(), page(), page(), page(), page())
    const client = new TriageLinearClient(CONFIG, fetchImpl)

    const result = await client.findIssueByMarker("missing")

    expect(result).toEqual({ ok: true, value: undefined })
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it("reports a missing team id before any request", async () => {
    const fetchImpl = stubFetch()
    const client = new TriageLinearClient(
      { ...CONFIG, linear: { ...CONFIG.linear, teamId: undefined } },
      fetchImpl,
    )

    expect(await client.findIssueByMarker("marker")).toMatchObject({
      ok: false,
      reason: "config_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("TriageLinearClient.createIssue", () => {
  it("sends the scoped team, project, and label and no priority or assignee", async () => {
    const fetchImpl = stubFetch(
      jsonResponse({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-1",
              url: "https://linear.app/forge/issue/FGE-1",
            },
          },
        },
      }),
    )
    const client = new TriageLinearClient(CONFIG, fetchImpl)

    const result = await client.createIssue(DRAFT)

    expect(result).toEqual({
      ok: true,
      value: { id: "issue-1", url: "https://linear.app/forge/issue/FGE-1" },
    })
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit]
    const variables = JSON.parse(String(init.body)).variables
    expect(variables.input).toEqual({
      teamId: "team-fge",
      projectId: "project-mobile-triage",
      title: DRAFT.title,
      description: DRAFT.description,
      labelIds: ["label-bug"],
    })
    expect(variables.input).not.toHaveProperty("priority")
    expect(variables.input).not.toHaveProperty("assigneeId")
  })

  it("refuses to create without a project id", async () => {
    const fetchImpl = stubFetch()
    const client = new TriageLinearClient(
      { ...CONFIG, linear: { ...CONFIG.linear, projectId: undefined } },
      fetchImpl,
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason: "config_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("refuses an endpoint that is not Linear's GraphQL URL", async () => {
    const fetchImpl = stubFetch()
    const client = new TriageLinearClient(
      {
        ...CONFIG,
        linear: { ...CONFIG.linear, apiUrl: "https://evil.example/graphql" },
      },
      fetchImpl,
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason: "invalid_config",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("marks a lost create response ambiguous so the retry reconciles it", async () => {
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(() => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" })
      }),
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: true,
      ambiguous: true,
    })
  })

  it("does not mark a lost SEARCH response ambiguous — a read cannot half-apply", async () => {
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(() => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" })
      }),
    )

    expect(await client.findIssueByMarker("marker")).toMatchObject({
      ok: false,
      reason: "timeout",
      ambiguous: false,
    })
  })

  it("maps a GraphQL RATELIMITED extension to a retryable rate limit", async () => {
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(
        jsonResponse({ errors: [{ extensions: { code: "RATELIMITED" } }] }),
      ),
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
    })
  })

  it("maps a non-rate-limit GraphQL error to a non-retryable failure", async () => {
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(jsonResponse({ errors: [{ message: "bad label" }] })),
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason: "graphql_error",
      retryable: false,
    })
  })

  it("treats an unsuccessful issueCreate as a non-retryable failure", async () => {
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(
        jsonResponse({
          data: { issueCreate: { success: false, issue: null } },
        }),
      ),
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason: "graphql_error",
      retryable: false,
    })
  })

  it.each([
    [401, "auth_failed", false],
    [429, "rate_limited", true],
    [500, "network_error", true],
    [400, "rejected", false],
  ])("maps HTTP %i to %s", async (status, reason, retryable) => {
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(new Response("", { status })),
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason,
      retryable,
    })
  })

  it("marks a malformed create response ambiguous", async () => {
    const client = new TriageLinearClient(
      CONFIG,
      stubFetch(
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    expect(await client.createIssue(DRAFT)).toMatchObject({
      ok: false,
      reason: "parse_error",
      ambiguous: true,
    })
  })

  it("refuses redirects so the key never follows one off-host", async () => {
    const fetchImpl = stubFetch(
      jsonResponse({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-1",
              url: "https://linear.app/forge/issue/FGE-1",
            },
          },
        },
      }),
    )
    const client = new TriageLinearClient(CONFIG, fetchImpl)

    await client.createIssue(DRAFT)

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit]
    expect(init.redirect).toBe("error")
  })
})
