import { afterEach, expect, it, vi } from "vitest"
import { studioServiceRequest } from "./transport"

vi.mock("@/config/env", () => ({
  env: {
    MASTRA_BASE_URL: "http://native.invalid",
    ADMIN_GRAPHQL_URL: "http://admin.invalid",
    STUDIO_INTERACTIVE_PRIVATE_KEY: "test-only",
    STUDIO_INTERACTIVE_KEY_ID: "test-only",
    STUDIO_ENVIRONMENT: "test",
  },
}))
vi.mock("@forge/studio-server", async (original) => ({
  ...(await original<typeof import("@forge/studio-server")>()),
  signStudioRequest: vi.fn().mockResolvedValue("test-signature"),
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it("allows the shared native run and terminal reserve but preserves earlier caller cancellation", async () => {
  const deadline = new AbortController()
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(deadline.signal)
  let observed: AbortSignal | null | undefined
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL, init: RequestInit) => {
      observed = init.signal
      return new Response("stream")
    }),
  )
  const caller = new AbortController()
  await studioServiceRequest(
    "mastra",
    {
      sub: "operator",
      authority: "interactive",
      clientId: "shorts-manager",
      scopes: ["shorts:chat"],
    },
    { action: "run" },
    caller.signal,
  )
  expect(timeout).toHaveBeenCalledExactlyOnceWith(190000)
  expect(observed?.aborted).toBe(false)
  const reason = new Error("Operator cancelled")
  caller.abort(reason)
  expect(observed?.reason).toBe(reason)
  deadline.abort(new Error("Later transport timeout"))
  expect(observed?.reason).toBe(reason)
})
