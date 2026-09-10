import { beforeEach, expect, it, vi } from "vitest"
import { runStudioNarration } from "@/services/studio-production/runner"
import { POST } from "./route"
import { narrationQuote } from "@/services/studio-production/narration"
const fixture = vi.hoisted(() => ({
  tasks: [] as Array<() => Promise<void>>,
  execute: vi.fn(),
  call: vi.fn(),
}))
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => fixture.tasks.push(task),
}))
vi.mock("@/lib/studio-request", () => ({
  authenticateStudioRequest: async () => ({ approvedByUserId: "operator" }),
  readStudioBody: async (request: Request) =>
    new Uint8Array(await request.arrayBuffer()),
}))
vi.mock("@/backend/studio-interactive", () => ({
  createStudioInteractiveClient: () => fixture.call,
  StudioTransportError: class extends Error {},
}))
vi.mock("@/services/studio-production/narration", () => ({
  executeNarration: (...args: unknown[]) => fixture.execute(...args),
  narrationQuote: vi.fn(),
}))
vi.mock("@/services/studio-production/transport", () => ({
  studioProductionClient: () => ({ call: fixture.call }),
}))
beforeEach(() => {
  fixture.tasks.length = 0
  vi.resetAllMocks()
})
it("a concurrent resume observing a running provider cannot fail the winner or prevent attachment", async () => {
  let state = "READY",
    attached = 0,
    paid = 0
  let release!: () => void, started!: () => void
  const paused = new Promise<void>((resolve) => {
    release = resolve
  })
  const providerStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  fixture.call.mockImplementation(async (action: string) => {
    if (action === "context") return { run: { experimentId: null } }
    if (action === "fail") state = "FAILED"
    return {}
  })
  fixture.execute.mockImplementation(() =>
    runStudioNarration({
      segments: [
        {
          itemId: "bridge",
          matches: [],
          identity: {
            text: "The pause helps us listen.",
            role: "bridge",
            language: "en",
            provider: "elevenlabs",
            model: "eleven_multilingual_v2",
            voiceId: "voice",
            settings: {},
            pronunciation: null,
          },
        },
      ],
      reserveMicros: () => 100,
      port: {
        cached: async () => null,
        claim: async () => {
          if (state !== "READY") return { execute: false, state }
          state = "RUNNING"
          return { execute: true, state }
        },
        narrate: async () => {
          paid++
          started()
          await paused
          return {
            bytes: Buffer.from("audio"),
            requestId: "one",
            credits: null,
            actualCostMicros: null,
          }
        },
        retain: async () => ({
          asset: { assetId: "a", versionId: "v", digest: "a".repeat(64) },
          durationMs: 1000,
        }),
        finish: async () => {},
        attach: async () => {
          expect(state).toBe("RUNNING")
          attached++
          state = "COMPLETED"
        },
      },
    }),
  )
  const request = () =>
    new Request("http://localhost/api/shorts/production", {
      method: "POST",
      body: JSON.stringify({ kind: "resume", runId: "run" }),
    })
  expect((await POST(request())).status).toBe(200)
  expect((await POST(request())).status).toBe(200)
  const winner = fixture.tasks[0]!()
  await providerStarted
  await fixture.tasks[1]!()
  const failedByLoser = fixture.call.mock.calls.some(
    ([action]) => action === "fail",
  )
  release()
  await winner
  expect(failedByLoser).toBe(false)
  expect(fixture.call.mock.calls.map(([action]) => action)).toEqual([
    "context",
    "context",
  ])
  expect({ state, paid, attached }).toEqual({
    state: "COMPLETED",
    paid: 1,
    attached: 1,
  })
})

it.each(["RUNNING", "AMBIGUOUS", "FAILED"])(
  "restart observing %s is read-only and never replays provider work",
  async (state) => {
    fixture.call.mockResolvedValue({ run: { experimentId: null } })
    const narrate = vi.fn(),
      attach = vi.fn(),
      finish = vi.fn()
    fixture.execute.mockImplementation(() =>
      runStudioNarration({
        segments: [
          {
            itemId: "settle",
            matches: [],
            identity: {
              text: "Pause.",
              role: "settle",
              language: "en",
              provider: "elevenlabs",
              model: "eleven_multilingual_v2",
              voiceId: "voice",
              settings: {},
              pronunciation: null,
            },
          },
        ],
        reserveMicros: () => 100,
        port: {
          cached: async () => null,
          claim: async () => ({ execute: false, state }),
          narrate,
          attach,
          finish,
          retain: vi.fn(),
        },
      }),
    )
    expect(
      (
        await POST(
          new Request("http://localhost/api/shorts/production", {
            method: "POST",
            body: JSON.stringify({ kind: "resume", runId: "run" }),
          }),
        )
      ).status,
    ).toBe(200)
    await fixture.tasks[0]!()
    expect(fixture.call.mock.calls.map(([action]) => action)).toEqual([
      "context",
    ])
    expect(narrate).not.toHaveBeenCalled()
    expect(attach).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
  },
)

it("admits confirmed narration with unknown pricing while retaining its known subtotal", async () => {
  vi.mocked(narrationQuote).mockResolvedValue({
    plan: {
      projectId: "project",
      revision: 1,
      segments: [
        {
          itemId: "speech",
          identity: {
            text: "Peace",
            role: "reflection",
            language: "en",
            provider: "elevenlabs",
            model: "eleven_multilingual_v2",
            voiceId: "voice",
            settings: {},
            pronunciation: null,
          },
          matches: [],
          pronunciationLocators: [],
        },
      ],
    },
    estimateMicros: null,
    reservationMicros: 249,
    basis: "Pricing unavailable",
    expiresAt: null,
    unavailable: "Provider charges apply",
  })
  fixture.call.mockImplementation(async (action) =>
    action === "request"
      ? {
          projectId: "project",
          revision: 1,
          outcome: "ACCEPTED",
          attemptId: "attempt",
        }
      : { id: "run" },
  )
  const request = (maxCostMicros: number) =>
    new Request("http://localhost/api/shorts/production", {
      method: "POST",
      body: JSON.stringify({
        kind: "narrate",
        input: {
          projectId: "project",
          expectedRevision: 1,
          idempotencyKey: "narration",
        },
        confirmed: true,
        maxCostMicros,
      }),
    })
  expect((await POST(request(248))).status).toBe(400)
  expect(fixture.call).not.toHaveBeenCalled()
  expect((await POST(request(249))).status).toBe(200)
  expect(fixture.call).toHaveBeenCalledWith("production-admit", {
    attemptId: "attempt",
    maxCostMicros: 249,
  })
  await fixture.tasks[0]!()
  expect(fixture.execute).toHaveBeenCalledWith(
    "operator",
    expect.any(Function),
    "run",
  )
})
