import { beforeEach, expect, it, vi } from "vitest"

const fixtures = vi.hoisted(() => ({
  main: { name: "main" },
  render: { name: "studio-render" },
  execute: vi.fn(async (db: unknown) => ({ database: db })),
  delegated: vi.fn(async (db: unknown) => ({ database: db })),
}))
vi.mock("@/db/client", () => ({
  prisma: fixtures.main,
  studioRenderPrisma: fixtures.render,
}))
vi.mock("@/services/studio-authoring/render-rpc", async (original) => ({
  ...(await original<
    typeof import("@/services/studio-authoring/render-rpc")
  >()),
  executeStudioRender: fixtures.execute,
}))
vi.mock("@/services/studio-authoring/delegated", async (original) => ({
  ...(await original<typeof import("@/services/studio-authoring/delegated")>()),
  executeStudioDelegated: fixtures.delegated,
}))
vi.mock("@forge/studio-server", async (original) => ({
  ...(await original<typeof import("@forge/studio-server")>()),
  verifyStudioRequest: vi.fn(async () => ({
    authority: "delegated",
    clientId: "shorts-render",
    sub: "shorts-render-worker",
    scopes: ["shorts:render:execute"],
  })),
}))
import { POST } from "./route"

beforeEach(() => vi.clearAllMocks())

it("routes render RPCs through the isolated pool while other delegated work keeps the main pool", async () => {
  const render = { action: "render-worker", command: "pending", input: null }
  const invoke = (body: unknown) =>
    POST(
      new Request("https://fixture.invalid/api/shorts/delegated", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    )
  expect((await invoke(render)).status).toBe(200)
  expect(fixtures.execute.mock.calls[0]?.[0]).toBe(fixtures.render)
  expect(fixtures.delegated).not.toHaveBeenCalled()

  expect((await invoke({ action: "other" })).status).toBe(200)
  expect(fixtures.delegated.mock.calls[0]?.[0]).toBe(fixtures.main)
})
