import { describe, expect, it, vi } from "vitest"
import { AdminGraphqlClient } from "@/backend/admin-client"
import { buildSeoDemoWorkspace } from "./seo-contract"

describe("AdminGraphqlClient SEO contracts", () => {
  it("parses the bounded workspace and sends the existing Manager bearer pattern", async () => {
    const workspace = buildSeoDemoWorkspace()
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { managerSeoWorkspace: workspace } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    )
    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example.test/api/graphql",
      apiKey: "manager-service-bearer",
      fetchImpl: fetchImpl as typeof fetch,
    })

    const parsed = await client.getSeoWorkspace(50)
    expect(parsed.proposals[0]).toMatchObject({
      id: "seo-proposal-rollback-es",
    })
    expect(parsed.experiments[0]).toMatchObject({ status: "HARMFUL" })
    expect(parsed.lessons[0]).toMatchObject({ status: "PENDING" })
    expect(parsed.ticketReconciliations[0]).toMatchObject({
      status: "MANUAL_RECONCILE",
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://admin.example.test/api/graphql")
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer manager-service-bearer",
      }),
    })
    const body = JSON.parse(String((init as RequestInit).body)) as {
      query: string
      variables: unknown
    }
    expect(body.query).toContain("managerSeoWorkspace")
    expect(body.query).toContain("ticketReconciliations")
    expect(body.variables).toEqual({ limit: 50 })
  })

  it("rejects malformed Admin SEO payloads rather than rendering them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              managerSeoWorkspace: {
                generatedAt: "2026-08-01T00:00:00.000Z",
                proposals: [{ id: "missing-required-fields" }],
                experiments: [],
                lessons: [],
                ticketReconciliations: [],
              },
            },
          }),
          { status: 200 },
        ),
    )
    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example.test/api/graphql",
      fetchImpl: fetchImpl as typeof fetch,
    })
    await expect(client.getSeoWorkspace()).rejects.toThrow(
      "invalid SEO workspace payload",
    )
  })

  it("accepts engineering proposals without an Admin content target", async () => {
    const workspace = buildSeoDemoWorkspace()
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              managerSeoWorkspace: {
                ...workspace,
                proposals: [{ ...workspace.proposals[0], targetId: null }],
              },
            },
          }),
          { status: 200 },
        ),
    )
    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example.test/api/graphql",
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(client.getSeoWorkspace()).resolves.toMatchObject({
      proposals: [expect.objectContaining({ targetId: null })],
    })
  })

  it("selects and parses Admin's object-shaped proposal decision, materialization, and editorial diff", async () => {
    const workspace = buildSeoDemoWorkspace()
    const rawWorkspace = {
      ...workspace,
      proposals: [
        {
          ...workspace.proposals[1],
          editorialDiff: {
            searchTitle: {
              before: "JESUS",
              after: "Watch JESUS — Full Movie About the Life of Jesus",
            },
            description: {
              before: "Watch JESUS online.",
              after: "Watch the full JESUS film free online.",
            },
          },
          decision: {
            id: "decision-1",
            action: "APPROVE",
            actorId: "manager-user-7",
            overlapAcknowledged: false,
            overlapCount: 0,
            reason: null,
            decidedAt: "2026-08-01T10:00:00.000Z",
          },
          materialization: {
            status: "DRAFT_CREATED",
            draftRevisionId: "revision-1",
            editorPath: "/dashboard/videos/video-jesus-en/search-social",
            ticketOutboxId: null,
          },
        },
      ],
    }
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { managerSeoWorkspace: rawWorkspace } }),
          { status: 200 },
        ),
    )
    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example.test/api/graphql",
      fetchImpl: fetchImpl as typeof fetch,
    })

    const parsed = await client.getSeoWorkspace()

    expect(parsed.proposals[0]).toMatchObject({
      editorialDiff: [
        {
          field: "searchTitle",
          before: "JESUS",
          after: "Watch JESUS — Full Movie About the Life of Jesus",
        },
        {
          field: "description",
          before: "Watch JESUS online.",
          after: "Watch the full JESUS film free online.",
        },
      ],
      decision: {
        status: "APPROVE",
        actor: "manager-user-7",
        decidedAt: "2026-08-01T10:00:00.000Z",
      },
      materialization: {
        status: "DRAFT_CREATED",
        draftRevisionId: "revision-1",
        editorPath: "/dashboard/videos/video-jesus-en/search-social",
      },
    })
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as RequestInit).body),
    ) as { query: string }
    expect(body.query).toContain("decision {\n    id\n    action\n    actorId")
    expect(body.query).toContain(
      "materialization {\n    status\n    draftRevisionId\n    editorPath",
    )
  })

  it("passes an immutable approval assertion through the exact Admin mutation input", async () => {
    const result = {
      status: "APPROVED",
      proposalId: "proposal-1",
      version: 2,
      decisionId: "decision-1",
      draftRevisionId: "revision-1",
      editorPath: "/dashboard/videos/video-1/search-social",
      ticketOutboxId: null,
      message: "Draft created.",
    }
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { approveManagerSeoProposal: result } }),
          { status: 200 },
        ),
    )
    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example.test/api/graphql",
      fetchImpl: fetchImpl as typeof fetch,
    })
    await expect(
      client.approveSeoProposal({
        proposalId: "proposal-1",
        version: 2,
        payloadDigest: "sha256:proposal-1-v2",
        assertion: "signed-assertion",
        overlapAcknowledged: true,
      }),
    ).resolves.toMatchObject({
      status: "APPROVED",
      draftRevisionId: "revision-1",
    })
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as RequestInit).body),
    ) as { query: string; variables: Record<string, unknown> }
    expect(body.query).toContain("approveManagerSeoProposal")
    expect(body.query).toContain("ManagerSeoApproveInput")
    expect(body.variables).toEqual({
      input: {
        proposalId: "proposal-1",
        version: 2,
        payloadDigest: "sha256:proposal-1-v2",
        assertion: "signed-assertion",
        overlapAcknowledged: true,
      },
    })
  })
})
