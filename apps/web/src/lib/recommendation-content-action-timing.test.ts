import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { recommendationFetchWithRetry } from "./recommendation-browser"
import { COMMAND_TIMEOUT_MS } from "./recommendation-redis-admission"
import {
  RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
  RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS,
  RECOMMENDATION_SURFACE_EXPOSURE_UPSTREAM_TIMEOUT_MS,
} from "./recommendation-timeouts"

const { mutate, admit } = vi.hoisted(() => ({
  mutate: vi.fn(),
  admit: vi.fn(),
}))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))
vi.mock("@/lib/recommendation-mutation-admission", () => ({
  assertRecommendationMutationAdmission: admit,
}))

const { POST } = await import("@/app/api/recommendations/content-actions/route")
const { recordWatchShareAction } =
  await import("./recommendation-content-actions")
const { recordWatchSurfaceExposure } = await import("./recommendations")

// Production content-action admission is a worker with a hard budget of
// COMMAND_TIMEOUT_MS (connect) + COMMAND_TIMEOUT_MS (commands); see
// recommendation-admission-worker-client.ts. The route cannot answer before it.
const ADMISSION_BUDGET_MS = COMMAND_TIMEOUT_MS * 2
// Session minting, body parse and transit on top of admission + upstream.
const TRANSIT_RESERVE_MS = 100
// The browser deadline this ticket replaced. Kept only to document the inversion.
const PREVIOUS_BROWSER_DEADLINE_MS = 700

const ENDPOINT = "/watch/api/recommendations/content-actions"
const receipt = {
  actionId: "action-1",
  eventId: "share-1",
  status: "accepted",
  matched: false,
  late: false,
}

type Attempt = {
  startedAt: number
  settledAt?: number
  outcome?: "ack-200" | "route-503" | "browser-abort"
}

describe("content-action timeout budgets", () => {
  let attempts: Attempt[]
  let admissionDelayMs: number
  let adminDelayMs: number | "never"
  let timeoutArgs: number[]
  let t0: number

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    attempts = []
    timeoutArgs = []
    admissionDelayMs = 0
    adminDelayMs = 0
    t0 = Date.now()
    // TEST DOUBLE of the deadline mechanism, not the real one: fake timers
    // cannot intercept AbortSignal.timeout, so route it through the fake
    // setTimeout. It records the budget the code under test passes. The real
    // mechanism (AbortSignal.timeout plus the browser's own timers) is covered
    // by the active-Chromium run in /tmp/watch-fge-188-report.md.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeoutArgs.push(ms)
      const controller = new AbortController()
      setTimeout(
        () => controller.abort(new DOMException("timeout", "TimeoutError")),
        ms,
      )
      return controller.signal
    })
    admit.mockImplementation(
      () =>
        new Promise<void>((resolve) => setTimeout(resolve, admissionDelayMs)),
    )
    mutate.mockImplementation(
      ({ context }: { context: { fetchOptions: { signal: AbortSignal } } }) =>
        new Promise((resolve, reject) => {
          const { signal } = context.fetchOptions
          const timer =
            adminDelayMs === "never"
              ? undefined
              : setTimeout(
                  () =>
                    resolve({
                      data: { recordRecommendationContentAction: receipt },
                    }),
                  adminDelayMs,
                )
          signal.addEventListener("abort", () => {
            clearTimeout(timer)
            reject(signal.reason)
          })
        }),
    )
    // The browser side runs the REAL helper against the REAL route handler.
    // The route keeps running after the browser aborts, as it does in production.
    vi.stubGlobal("window", globalThis)
    vi.stubGlobal(
      "fetch",
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const attempt: Attempt = { startedAt: Date.now() - t0 }
          attempts.push(attempt)
          const signal = init.signal as AbortSignal
          signal.addEventListener("abort", () => {
            attempt.settledAt = Date.now() - t0
            attempt.outcome = "browser-abort"
            reject(new DOMException("aborted", "AbortError"))
          })
          void POST(
            new Request(`https://watch.example${url}`, {
              method: "POST",
              headers: {
                origin: "https://watch.example",
                "sec-fetch-site": "same-origin",
                "content-type": "application/json",
              },
              body: init.body as string,
            }),
          ).then((response) => {
            if (signal.aborted) return
            attempt.settledAt = Date.now() - t0
            attempt.outcome = response.status === 200 ? "ack-200" : "route-503"
            resolve(response)
          })
        }),
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("names the budgets and keeps them ordered: upstream < admission + upstream + reserve <= browser", () => {
    expect(RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS).toBeLessThan(
      RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
    )
    // Read the real admission constants so a future admission-budget change
    // fails here instead of silently reopening the inversion.
    expect(ADMISSION_BUDGET_MS).toBe(500)
    expect(
      RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
    ).toBeGreaterThanOrEqual(
      ADMISSION_BUDGET_MS +
        RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS +
        TRANSIT_RESERVE_MS,
    )
  })

  it("keeps the original upstream budgets and the chosen browser deadline", () => {
    expect(RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS).toBe(900)
    expect(RECOMMENDATION_SURFACE_EXPOSURE_UPSTREAM_TIMEOUT_MS).toBe(900)
    expect(RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS).toBe(1_500)
  })

  it.each([
    { admission: 0, admin: 750 },
    { admission: 0, admin: 850 },
    { admission: 250, admin: 750 },
    { admission: 250, admin: 850 },
    { admission: 450, admin: 800 },
    { admission: 450, admin: 880 },
  ])(
    "acknowledges a late write in one attempt (admission $admission ms + Admin $admin ms)",
    async ({ admission, admin }) => {
      admissionDelayMs = admission
      adminDelayMs = admin

      recordWatchShareAction("media-1", "link_copy")
      await vi.advanceTimersByTimeAsync(
        RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS + 500,
      )

      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ outcome: "ack-200" })
      expect(attempts[0]!.settledAt).toBe(admission + admin)
      expect(attempts[0]!.settledAt).toBeLessThan(
        RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
      )
      expect(admit).toHaveBeenCalledTimes(1)
      expect(mutate).toHaveBeenCalledTimes(1)
      expect(timeoutArgs).toEqual([
        RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS,
      ])
    },
  )

  it("documents the inversion this replaces: a 700 ms deadline aborts and retries a write Admin finishes at 800 ms", async () => {
    adminDelayMs = 800

    void recommendationFetchWithRetry(
      ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: "recommendation-content-action-v1",
          eventId: "share-1",
          occurredAt: "2026-10-10T00:00:00.000Z",
          mediaId: "media-1",
          actionKind: "share",
          actionDetail: "link_copy",
        }),
      },
      PREVIOUS_BROWSER_DEADLINE_MS,
    ).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(3_000)

    expect(attempts.map((attempt) => attempt.outcome)).toEqual([
      "browser-abort",
      "browser-abort",
    ])
    expect(admit).toHaveBeenCalledTimes(2)
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it.each([0, 250, 450])(
    "answers a true upstream timeout before the browser gives up, then retries exactly once (admission %i ms)",
    async (admission) => {
      admissionDelayMs = admission
      adminDelayMs = "never"

      recordWatchShareAction("media-1", "link_copy")
      await vi.advanceTimersByTimeAsync(10_000)

      // Route answers 503 at admission + upstream budget, inside the deadline.
      expect(attempts[0]).toMatchObject({ outcome: "route-503" })
      expect(attempts[0]!.settledAt).toBe(
        admission + RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS,
      )
      expect(attempts[0]!.settledAt).toBeLessThan(
        RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
      )
      // Bounded: two attempts, two admission slots, two Admin calls, no more.
      expect(attempts).toHaveLength(2)
      expect(attempts[1]).toMatchObject({ outcome: "route-503" })
      expect(admit).toHaveBeenCalledTimes(2)
      expect(mutate).toHaveBeenCalledTimes(2)
      expect(timeoutArgs).toEqual([
        RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS,
        RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS,
      ])
    },
  )

  it("bounds a route that never answers at the named browser deadline, with exactly one retry", async () => {
    // SYNTHETIC route hang (admission promise never settles). It exercises the
    // browser-side outer bound only; it is not a claim about production
    // admission, which is itself capped at ADMISSION_BUDGET_MS.
    admit.mockReturnValue(new Promise<void>(() => undefined))

    recordWatchShareAction("media-1", "link_copy")
    await vi.advanceTimersByTimeAsync(
      RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS - 1,
    )
    expect(attempts[0]).not.toHaveProperty("outcome")
    await vi.advanceTimersByTimeAsync(1)
    expect(attempts[0]).toMatchObject({
      outcome: "browser-abort",
      settledAt: RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
    })

    await vi.advanceTimersByTimeAsync(20_000)
    // Second attempt starts after the helper's 100 ms backoff and aborts at its
    // own full deadline: 1,500 + 100 + 1,500 = 3,100 ms in total, then stops.
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toMatchObject({
      startedAt: RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS + 100,
      outcome: "browser-abort",
      settledAt: RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS * 2 + 100,
    })
    expect(admit).toHaveBeenCalledTimes(2)
    expect(mutate).not.toHaveBeenCalled()
  })

  describe("surface exposure", () => {
    const events = [{ eventId: "00000000-0000-4000-8000-000000000001" }]
    const exposureResult = {
      data: {
        recordWatchSurfaceExposure: [{ eventId: "e", status: "accepted" }],
      },
    }
    function exposureAdmin(delayMs: number) {
      mutate.mockImplementation(
        ({ context }: { context: { fetchOptions: { signal: AbortSignal } } }) =>
          new Promise((resolve, reject) => {
            const { signal } = context.fetchOptions
            const timer = setTimeout(() => resolve(exposureResult), delayMs)
            signal.addEventListener("abort", () => {
              clearTimeout(timer)
              reject(signal.reason)
            })
          }),
      )
    }

    it("keeps its own original 900 ms upstream budget, not the content-action value", async () => {
      exposureAdmin(100)
      const pending = recordWatchSurfaceExposure(events)
      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(timeoutArgs).toEqual([
        RECOMMENDATION_SURFACE_EXPOSURE_UPSTREAM_TIMEOUT_MS,
      ])
    })

    it("still acknowledges an Admin answer at 600 ms (the 500 ms coupling would not)", async () => {
      exposureAdmin(600)
      const pending = recordWatchSurfaceExposure(events)
      await vi.advanceTimersByTimeAsync(600)
      await expect(pending).resolves.toEqual(
        exposureResult.data.recordWatchSurfaceExposure,
      )
    })

    it("still gives up at 900 ms", async () => {
      exposureAdmin(5_000)
      const pending = recordWatchSurfaceExposure(events)
      const outcome = pending.then(
        () => "resolved",
        () => "rejected",
      )
      await vi.advanceTimersByTimeAsync(899)
      let settled = false
      void outcome.then(() => (settled = true))
      await Promise.resolve()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(outcome).resolves.toBe("rejected")
    })
  })
})
