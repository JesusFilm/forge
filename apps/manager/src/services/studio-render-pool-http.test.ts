import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
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
    mux: vi.fn(),
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
    mux: vi.fn(),
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

function ownershipFixture(
  owns: (token: string | null, signal: AbortSignal) => Promise<boolean>,
  signal?: AbortSignal,
) {
  const auth = new StudioRenderPoolAuth(config)
  const token = auth.issue(
    {
      poolId: config.poolId,
      workerId: config.workerId,
      dispatchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attemptId: "attempt",
      leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expiresAt: Date.now() + 60000,
    },
    "a".repeat(64),
  )
  const handler = createStudioPoolHandler(auth, {
    claim: vi.fn(),
    mux: vi.fn(),
    input: vi.fn(),
    owns,
    retain: vi.fn(),
    finish: vi.fn(),
    receipt: vi.fn(),
  })
  return handler(
    new Request("https://fixture.invalid/owns", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "{}",
      signal,
    }),
    "owns",
  )
}
it("allows a valid six-second ownership read within the worker's ten-second allowance", async () => {
  const owns = vi.fn(async (_token: string | null, signal: AbortSignal) => {
    await new Promise((resolve) => setTimeout(resolve, 6000))
    signal.throwIfAborted()
    return true
  })
  const response = await ownershipFixture(owns)
  expect(response.status).toBe(200)
  expect(await response.json()).toBe(true)
  expect(owns).toHaveBeenCalledTimes(1)
}, 12000)
it("still expires an unconfirmed ownership read without retrying it", async () => {
  const owns = vi.fn(
    (_token: string | null, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        signal.addEventListener("abort", () => resolve(false), { once: true })
      }),
  )
  const response = await ownershipFixture(owns)
  expect(response.status).toBe(409)
  expect(owns).toHaveBeenCalledTimes(1)
  expect(owns.mock.calls[0][1].aborted).toBe(true)
}, 12000)
it("cancels an ownership read immediately when its caller disconnects", async () => {
  const controller = new AbortController()
  const owns = vi.fn(
    (_token: string | null, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        signal.addEventListener("abort", () => resolve(false), { once: true })
      }),
  )
  const pending = ownershipFixture(owns, controller.signal)
  await vi.waitFor(() => expect(owns).toHaveBeenCalledTimes(1))
  controller.abort()
  expect((await pending).status).toBe(409)
  expect(owns.mock.calls[0][1].aborted).toBe(true)
})

it("allows input work past 90 seconds and expires within the fixed outer preparation budget", async () => {
  vi.useFakeTimers()
  const timers: ReturnType<typeof setTimeout>[] = []
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController()
    timers.push(setTimeout(() => controller.abort(new Error("deadline")), ms))
    return controller.signal
  })
  try {
    const auth = new StudioRenderPoolAuth(config)
    const token = auth.issue(
      {
        poolId: "pool",
        workerId: "worker",
        dispatchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        attemptId: "attempt",
        leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expiresAt: Date.now() + STUDIO_RENDER_PROFILE.leaseMs,
      },
      "a".repeat(64),
    )
    const input = vi.fn(
      (_token: string | null, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    )
    const handler = createStudioPoolHandler(auth, {
      claim: vi.fn(),
      input,
      owns: vi.fn(),
      retain: vi.fn(),
      finish: vi.fn(),
      receipt: vi.fn(),
      mux: vi.fn(),
    })
    const pending = handler(
      new Request("https://fixture.invalid/input", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "{}",
      }),
      "input",
    )
    await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(90001)
    expect(input.mock.calls[0][1].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(
      STUDIO_RENDER_PROFILE.preparationMs - 5000 - 90001,
    )
    expect((await pending).status).toBe(409)
    expect(input.mock.calls[0][1].aborted).toBe(true)
  } finally {
    for (const timer of timers) clearTimeout(timer)
    timeout.mockRestore()
    vi.useRealTimers()
  }
})

it("authenticates and bounds part requests before dispatching them", async () => {
  const auth = new StudioRenderPoolAuth(config)
  const token = auth.issue(
    {
      poolId: config.poolId,
      workerId: config.workerId,
      dispatchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attemptId: "attempt",
      leaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expiresAt: Date.now() + 60000,
    },
    "a".repeat(64),
  )
  const retainPart = vi.fn(async () => ({
    part: { assetId: "asset", versionId: "version", digest: "a".repeat(64) },
  }))
  const handler = createStudioPoolHandler(auth, {
    claim: vi.fn(),
    mux: vi.fn(),
    input: vi.fn(),
    owns: vi.fn(),
    retain: vi.fn(),
    retainPart,
    finish: vi.fn(),
    receipt: vi.fn(),
  })
  const send = (bearer: string, contentLength?: string) =>
    handler(
      new Request("https://fixture.invalid/retain-part", {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(contentLength ? { "content-length": contentLength } : {}),
        },
        body: JSON.stringify({ index: 0 }),
      }),
      "retain-part",
    )
  expect((await send("generic")).status).toBe(401)
  expect(retainPart).not.toHaveBeenCalled()
  expect((await send(token, "30000000")).status).toBe(413)
  expect(retainPart).not.toHaveBeenCalled()
  expect((await send(token)).status).toBe(200)
  expect(retainPart).toHaveBeenCalledWith(
    token,
    { index: 0 },
    expect.any(AbortSignal),
  )
})
