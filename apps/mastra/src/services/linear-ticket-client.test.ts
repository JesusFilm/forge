import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../config/seo"
import {
  createLinearTicket,
  reconcileLinearTicket,
} from "./linear-ticket-client"

const config = getSeoConfig({
  SEO_LINEAR_API_KEY: "linear-key",
  SEO_LINEAR_TEAM_ID: "team-1",
  SEO_LINEAR_PROJECT_ID: "project-1",
  SEO_LINEAR_LABEL_IDS: "label-1",
})
const options = {
  config,
  resolveHost: async () => [{ address: "93.184.216.34" }],
}

describe("Linear SEO ticket client", () => {
  it("reconciles by exact configured team, marker, and payload digest", async () => {
    const marker = "forge-seo:p1:v1:aaaaaaaaaaaa"
    const payloadDigest = "a".repeat(64)
    const result = await reconcileLinearTicket(
      { marker, payloadDigest },
      {
        ...options,
        fetchImpl: vi.fn(async () =>
          Response.json({
            data: {
              issues: {
                nodes: [
                  {
                    id: "issue-1",
                    url: "https://linear.app/team/issue/FGE-1",
                    title: "SEO",
                    description: `${marker}\nPayload digest: ${payloadDigest}`,
                    team: { id: "team-1" },
                  },
                ],
              },
            },
          }),
        ) as unknown as typeof fetch,
      },
    )
    expect(result).toMatchObject({
      ok: true,
      status: "found",
      ticket: { id: "issue-1" },
    })
  })

  it("uses only the server-configured team, project, and labels for creation", async () => {
    let variables: Record<string, unknown> = {}
    const result = await createLinearTicket(
      {
        marker: "forge-seo:p1:v1:aaaaaaaaaaaa",
        payloadDigest: "a".repeat(64),
        brief: {
          title: "Approved title",
          description: "Approved description",
          acceptanceCriteria: ["Pass focused tests"],
          affectedScope: ["apps/web"],
        },
      },
      {
        ...options,
        fetchImpl: vi.fn(async (_url, init) => {
          variables = (
            JSON.parse(String(init?.body)) as {
              variables: Record<string, unknown>
            }
          ).variables
          return Response.json({
            data: {
              issueCreate: {
                success: true,
                issue: {
                  id: "issue-2",
                  url: "https://linear.app/team/issue/FGE-2",
                  title: "Approved title",
                  description: "Approved description",
                  team: { id: "team-1" },
                },
              },
            },
          })
        }) as unknown as typeof fetch,
      },
    )
    expect(result.ok).toBe(true)
    expect(variables).toMatchObject({
      input: {
        teamId: "team-1",
        projectId: "project-1",
        labelIds: ["label-1"],
        title: "Approved title",
      },
    })
  })

  it("returns exact multiple matches as manual-reconciliation candidates", async () => {
    const marker = "forge-seo:p1:v1:aaaaaaaaaaaa"
    const payloadDigest = "a".repeat(64)
    const result = await reconcileLinearTicket(
      { marker, payloadDigest },
      {
        ...options,
        fetchImpl: vi.fn(async () =>
          Response.json({
            data: {
              issues: {
                nodes: ["issue-1", "issue-2"].map((id) => ({
                  id,
                  url: `https://linear.app/team/issue/${id}`,
                  title: "SEO",
                  description: `${marker}\nPayload digest: ${payloadDigest}`,
                  team: { id: "team-1" },
                })),
              },
            },
          }),
        ) as unknown as typeof fetch,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      ambiguous: true,
      candidates: [{ id: "issue-1" }, { id: "issue-2" }],
    })
  })

  it.each([
    ["a server error", () => new Response("unavailable", { status: 503 })],
    [
      "a malformed response",
      () => Response.json({ data: { issueCreate: {} } }),
    ],
  ])("treats %s after create as ambiguous", async (_label, response) => {
    const result = await createLinearTicket(
      {
        marker: "forge-seo:p1:v1:aaaaaaaaaaaa",
        payloadDigest: "a".repeat(64),
        brief: {
          title: "Approved title",
          description: "Approved description",
          acceptanceCriteria: ["Pass focused tests"],
          affectedScope: ["apps/web"],
        },
      },
      {
        ...options,
        fetchImpl: vi.fn(async () => response()) as unknown as typeof fetch,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      ambiguous: true,
      retryable: false,
    })
  })
})
