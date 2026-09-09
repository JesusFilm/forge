import { expect, it, vi } from "vitest"
vi.mock("@/config/env", () => ({ env: {} }))
import { StudioRenderPoolAuth } from "./studio-render-pool-auth"
import { createStudioPoolHandler } from "./studio-render-pool-http"
const config = {
  poolId: "pool",
  workerId: "worker",
  workerKey: "w".repeat(40),
  capabilityKey: "c".repeat(40),
}
function request(token = config.workerKey, signal?: AbortSignal) {
  return new Request("https://fixture.invalid/api/shorts/render-pool/claim", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ dispatchId: "a" }),
    signal,
  })
}
it("rejects generic authorization before parsing or invoking the gateway and never exposes upstream errors", async () => {
  const claim = vi.fn(async () => {
    throw new Error("https://secret-token@internal/credential")
  })
  const handler = createStudioPoolHandler(new StudioRenderPoolAuth(config), {
    claim,
    input: vi.fn(),
    owns: vi.fn(),
    retain: vi.fn(),
    finish: vi.fn(),
    receipt: vi.fn(),
  })
  expect((await handler(request("generic"), "claim")).status).toBe(401)
  expect(claim).not.toHaveBeenCalled()
  const response = await handler(request(), "claim")
  expect(response.status).toBe(409)
  expect(await response.text()).not.toContain("secret")
  expect(response.headers.get("cache-control")).toBe("no-store")
})
it("bounds disconnected responses while retaining capacity for noncancellable work until actual settlement", async () => {
  let complete!: () => void
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  const claim = vi.fn(async () => {
    await pending
    return { execute: false, assignment: null, capability: null }
  })
  const handler = createStudioPoolHandler(new StudioRenderPoolAuth(config), {
    claim,
    input: vi.fn(),
    owns: vi.fn(),
    retain: vi.fn(),
    finish: vi.fn(),
    receipt: vi.fn(),
  })
  const controllers = Array.from({ length: 4 }, () => new AbortController())
  const responses = controllers.map((controller) =>
    handler(request(config.workerKey, controller.signal), "claim"),
  )
  await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(4))
  for (const controller of controllers) controller.abort()
  expect(
    (await Promise.all(responses)).every((response) => response.status === 409),
  ).toBe(true)
  expect((await handler(request(), "claim")).status).toBe(503)
  complete()
  await vi.waitFor(async () =>
    expect((await handler(request(), "claim")).status).toBe(200),
  )
})
