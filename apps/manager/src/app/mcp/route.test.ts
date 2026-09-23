import { beforeEach, expect, it, vi } from "vitest"
import { StudioBoundaryError } from "@forge/studio-server"
import { POST } from "./route"
import { authenticateStudioMcp } from "@/services/studio-agent/oauth"
import { studioServiceCall } from "@/services/studio-agent/transport"
vi.mock("@/config/env", () => ({
  env: {
    MANAGER_BASE_URL: "https://studio.example.test",
    ADMIN_GRAPHQL_URL: "https://admin.example.test",
  },
}))
vi.mock("@/services/studio-agent/oauth", () => ({
  authenticateStudioMcp: vi.fn(),
  studioMcpAudience: () => "https://studio.example.test/mcp",
}))
vi.mock("@/services/studio-agent/transport", () => ({
  studioServiceCall: vi.fn(),
}))
vi.mock("@/services/studio-agent/chat", () => ({ studioChat: vi.fn() }))
const caller = {
  sub: "operator",
  authority: "delegated" as const,
  clientId: "codex",
  scopes: ["shorts:read", "shorts:edit"],
}
const rpc = (method: string, params?: unknown) =>
  POST(
    new Request("https://studio.example.test/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
    }),
  )
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateStudioMcp).mockResolvedValue(caller)
})
it("initializes and discovers only consented capabilities", async () => {
  expect((await (await rpc("initialize")).json()).result.capabilities).toEqual({
    tools: {},
  })
  vi.mocked(authenticateStudioMcp).mockResolvedValue({
    ...caller,
    scopes: ["shorts:read"],
  })
  const { result } = await (await rpc("tools/list")).json()
  expect(result.tools.map((t: { name: string }) => t.name)).toContain(
    "shorts.projects",
  )
  expect(result.tools.map((t: { name: string }) => t.name)).not.toContain(
    "shorts.apply",
  )
})
it("pages project discovery without fetching unbounded state", async () => {
  vi.mocked(studioServiceCall).mockResolvedValue([
    { projectId: "one", revision: 2, title: "Draft" },
  ])
  const { result } = await (
    await rpc("tools/call", {
      name: "shorts.projects",
      arguments: { limit: 1 },
    })
  ).json()
  expect(studioServiceCall).toHaveBeenCalledWith("admin", caller, {
    action: "list",
    input: { limit: 1 },
  })
  expect(result.structuredContent.result).toMatchObject({
    nextCursor: "one",
    projects: [
      {
        reviewUrl:
          "https://studio.example.test/dashboard/shorts/one?revision=2",
      },
    ],
  })
  expect(
    (
      await rpc("tools/call", {
        name: "shorts.projects",
        arguments: { limit: 101 },
      })
    ).status,
  ).toBe(400)
})
it("resolves only exact local project links and reads with verified caller", async () => {
  vi.mocked(studioServiceCall).mockResolvedValue({
    projectId: "one",
    revision: 3,
  })
  const response = await rpc("tools/call", {
    name: "shorts.resolveProject",
    arguments: {
      url: "https://studio.example.test/dashboard/shorts/one?revision=2",
    },
  })
  expect(response.status).toBe(200)
  expect(studioServiceCall).toHaveBeenCalledWith("admin", caller, {
    action: "read",
    input: "one",
  })
  for (const url of [
    "https://other.test/dashboard/shorts/one",
    "https://user@studio.example.test/dashboard/shorts/one",
    "https://studio.example.test/dashboard/shorts/one/extra",
  ]) {
    expect(
      (
        await rpc("tools/call", {
          name: "shorts.resolveProject",
          arguments: { url },
        })
      ).status,
    ).toBe(400)
  }
  expect(studioServiceCall).toHaveBeenCalledTimes(1)
})
it("paginates history and makes stale edits recoverable without replacing identity", async () => {
  vi.mocked(studioServiceCall).mockResolvedValue([
    { revision: 2, actor: { id: "human" } },
  ])
  await rpc("tools/call", {
    name: "shorts.history",
    arguments: { projectId: "one", beforeRevision: 3 },
  })
  expect(studioServiceCall).toHaveBeenCalledWith("admin", caller, {
    action: "history",
    input: { projectId: "one", beforeRevision: 3 },
  })
  const args = {
    projectId: "one",
    expectedRevision: 1,
    idempotencyKey: "edit",
    operations: [{ kind: "set-metadata", title: "Changed" }],
  }
  expect(
    (
      await rpc("tools/call", {
        name: "shorts.apply",
        arguments: { ...args, actor: { id: "replacement" } },
      })
    ).status,
  ).toBe(400)
  vi.mocked(studioServiceCall).mockRejectedValue(
    new StudioBoundaryError("CONFLICT", 409),
  )
  const { result } = await (
    await rpc("tools/call", { name: "shorts.apply", arguments: args })
  ).json()
  expect(result.isError).toBe(true)
  expect(result.structuredContent.result).toMatchObject({
    code: "CONFLICT",
    retryable: true,
  })
})
