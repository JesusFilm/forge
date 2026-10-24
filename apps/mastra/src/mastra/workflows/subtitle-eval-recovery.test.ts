import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWorkflow } from "@mastra/core/workflows"

const operatorEnv = vi.hoisted(() => ({
  MANAGER_SUBTITLE_EVAL_RECOVERY_URL: undefined as string | undefined,
  MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY: undefined as string | undefined,
}))
vi.mock("../../config/env", () => ({ env: operatorEnv }))
vi.mock("@mastra/core/workflows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mastra/core/workflows")>()
  return { ...actual, createWorkflow: vi.fn(actual.createWorkflow) }
})

import {
  runSubtitleEvalRecovery,
  SubtitleEvalRecoveryInputSchema,
  subtitleEvalRecoveryWorkflow,
} from "./subtitle-eval-recovery"

const URL_ =
  "https://manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery"
const CONFIG = { url: URL_, apiKey: "dummy-service-bearer" }
// Capture registration before per-test mock restoration clears call history.
const recoveryRegistration = vi
  .mocked(createWorkflow)
  .mock.calls.find(([config]) => config.id === "subtitle-eval-recovery")?.[0]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_URL = undefined
  operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY = undefined
  // Every unit case is offline, even if its intended private stub is miswired.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline test")))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("subtitle eval recovery sweep", () => {
  it("skips quietly when the Lab is not configured", async () => {
    const fetchImpl = vi.fn()
    // Unconfigured is normal until turn-on. Throwing here would fail loudly
    // every five minutes for a Lab nobody has switched on yet.
    await expect(
      runSubtitleEvalRecovery({}, { fetchImpl }),
    ).resolves.toMatchObject({ status: "skipped", reason: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("skips when only one half of the pair is set", async () => {
    const fetchImpl = vi.fn()
    for (const partial of [{ url: URL_ }, { apiKey: "k" }]) {
      await expect(
        runSubtitleEvalRecovery({}, { config: partial, fetchImpl }),
      ).resolves.toMatchObject({ status: "skipped" })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("presents the service bearer and counts the outcomes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        outcomes: [
          { runId: "r1", status: "RECOVERED" },
          { runId: "r2", status: "SKIPPED_OR_RACED" },
          { runId: "r3", status: "UNKNOWN" },
        ],
      }),
    )
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toEqual({
      status: "swept",
      reason: null,
      total: 3,
      raced: 1,
      unknown: 1,
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(URL_)
    expect(init.method).toBe("POST")
    expect(init.redirect).toBe("error")
    expect(init.headers.authorization).toBe("Bearer dummy-service-bearer")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("treats an empty sweep as success, not failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ outcomes: [] }))
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toMatchObject({ status: "swept", total: 0 })
  })

  // A 200 is not evidence that recovery happened, so the failure cases below
  // must be distinguishable from a successful sweep rather than collapsing
  // into one opaque "error".
  it.each([
    ["401", jsonResponse({ error: "Unauthorized" }, 401), "http_401"],
    ["500", jsonResponse({ error: "boom" }, 500), "http_500"],
  ])("reports %s by its own reason", async (_label, response, reason) => {
    const fetchImpl = vi.fn().mockResolvedValue(response)
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toMatchObject({ status: "failed", reason })
  })

  it("reports a transport failure without leaking the error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:443"))
    const result = await runSubtitleEvalRecovery(
      {},
      { config: CONFIG, fetchImpl },
    )
    expect(result).toMatchObject({ status: "failed", reason: "request_failed" })
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED")
  })

  it("reports a malformed body rather than throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 200 }))
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toMatchObject({ status: "failed", reason: "parse_error" })
  })

  it("reports an unexpected shape rather than reporting a false sweep", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ outcomes: [{ nope: true }] }))
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toMatchObject({ status: "failed", reason: "unexpected_shape" })
  })

  it("aborts a response that exceeds the byte cap", async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Larger than the 1 MiB cap, delivered in chunks.
        controller.enqueue(new Uint8Array(256 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }))
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toMatchObject({
      status: "failed",
      reason: "response_too_large",
    })
    // The socket must be aborted, not merely left unread.
    expect(cancelled).toBe(true)
  })

  it.each([
    "http://manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery",
    "https://receiver.invalid/api/scheduled/subtitle-eval-recovery",
    "https://manager.jesusfilm.org.receiver.invalid/api/scheduled/subtitle-eval-recovery",
    "https://manager.jesusfilm.org:8443/api/scheduled/subtitle-eval-recovery",
    "https://manager.jesusfilm.org/api/other",
    "https://manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery/",
    `${URL_}?next=https://receiver.invalid`,
    `${URL_}?`,
    `${URL_}#fragment`,
    `${URL_}#`,
    "https://dummy:dummy@manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery",
    "https://@manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery",
    "http://manager.railway.internal/api/scheduled/subtitle-eval-recovery",
    "http://localhost:3000/api/scheduled/subtitle-eval-recovery",
    "http://127.0.0.1:3000/api/scheduled/subtitle-eval-recovery",
    "http://169.254.169.254/api/scheduled/subtitle-eval-recovery",
    "not a URL",
  ])("rejects unapproved operator destination %s before fetch", async (url) => {
    const fetchImpl = vi.fn()
    const result = await runSubtitleEvalRecovery(
      {},
      {
        config: { ...CONFIG, url },
        fetchImpl,
      },
    )
    expect(result).toEqual({
      status: "failed",
      reason: "config_invalid",
      total: 0,
      raced: 0,
      unknown: 0,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("refuses a redirect without following or exposing transport detail", async () => {
    // Model fetch's redirect:error contract without contacting any endpoint.
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe("error")
      throw new TypeError(
        "redirect to https://receiver.invalid with dummy bearer",
      )
    })
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toEqual({
      status: "failed",
      reason: "request_failed",
      total: 0,
      raced: 0,
      unknown: 0,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([301, 302, 307, 308])(
    "never dispatches a second request for HTTP %s",
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(null, {
          status,
          headers: { location: "https://receiver.invalid/" },
        }),
      )
      await expect(
        runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
      ).resolves.toMatchObject({ status: "failed", reason: `http_${status}` })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(fetchImpl.mock.calls[0][1].redirect).toBe("error")
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it("accepts a valid body exactly at the byte ceiling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ outcomes: [] }).padEnd(1_048_576, " ")),
      )
    await expect(
      runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl }),
    ).resolves.toMatchObject({ status: "swept", total: 0 })
  })

  it("keeps the 240-second default outside caller input", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout")
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ outcomes: [] }))
    await runSubtitleEvalRecovery({}, { config: CONFIG, fetchImpl })
    expect(timeout).toHaveBeenCalledWith(240_000)
  })

  it("keeps test timeouts in the code-only dependency argument", async () => {
    vi.useFakeTimers()
    try {
      const signal = new AbortController()
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockImplementation((ms) => {
          setTimeout(() => signal.abort(), ms)
          return signal.signal
        })
      const fetchImpl = vi.fn<typeof fetch>(
        async (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("dummy timeout")),
            )
          }),
      )
      const pending = runSubtitleEvalRecovery(
        {},
        { config: CONFIG, fetchImpl, timeoutMs: 10 },
      )
      await vi.advanceTimersByTimeAsync(10)
      await expect(pending).resolves.toMatchObject({
        status: "failed",
        reason: "request_failed",
      })
      expect(timeout).toHaveBeenCalledWith(10)
    } finally {
      vi.useRealTimers()
    }
  })

  // The sweep only helps if it actually fires. `schedule` is not retained on
  // the workflow object, so the assertion below pins the documented
  // precondition instead: @mastra/core supports declarative schedules "only on
  // the evented engine". If this workflow ever resolves to another engine the
  // cron silently stops firing, with nothing else to notice it.
  it("runs on the evented engine, which is what makes the schedule fire", () => {
    expect(subtitleEvalRecoveryWorkflow.id).toBe("subtitle-eval-recovery")
    expect(
      (subtitleEvalRecoveryWorkflow as unknown as { engineType?: string })
        .engineType,
    ).toBe("evented")
  })

  it("declares a cron expression Mastra itself accepts", async () => {
    // Construction validates the cron, so an invalid expression would already
    // have thrown on import. This pins the expression we think we wrote.
    const { validateCron } = await import("@mastra/core/workflows")
    expect(() => validateCron("*/5 * * * *", "UTC")).not.toThrow()
  })
})

const overrides = [
  { url: "https://receiver.invalid/api/scheduled/subtitle-eval-recovery" },
  { apiKey: "dummy-caller-key" },
  { fetchImpl: vi.fn() },
  { timeoutMs: 1 },
  {
    dependencies: {
      config: { url: "https://receiver.invalid", apiKey: "dummy" },
    },
  },
  { arbitrary: true },
]

describe("registered recovery workflow boundary", () => {
  function registeredStep() {
    return subtitleEvalRecoveryWorkflow.steps["sweep-stale-subtitle-eval-runs"]
  }

  function executeInput(inputData: unknown) {
    const step = registeredStep()
    // Unit-call the actual registered callback with its sole consumed context
    // field. Do not create a run, persist data, or register/activate a scheduler.
    return step.execute({ inputData } as Parameters<typeof step.execute>[0])
  }

  it("registers the strict schema at both boundaries and the intended schedule", () => {
    expect(recoveryRegistration?.inputSchema).toBe(
      SubtitleEvalRecoveryInputSchema,
    )
    expect(registeredStep().inputSchema).toBe(SubtitleEvalRecoveryInputSchema)
    expect(recoveryRegistration?.schedule).toEqual({
      cron: "*/5 * * * *",
      timezone: "UTC",
    })
    expect(SubtitleEvalRecoveryInputSchema.parse(undefined)).toEqual({})
    expect(SubtitleEvalRecoveryInputSchema.parse({})).toEqual({})
  })

  it.each(overrides)(
    "rejects caller override %j at schema and execute",
    async (input) => {
      operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_URL = URL_
      operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY = "dummy-operator-key"
      expect(SubtitleEvalRecoveryInputSchema.safeParse(input).success).toBe(
        false,
      )
      // Also cover bypassed framework validation/direct step/time-travel input.
      await expect(
        Promise.resolve().then(() => executeInput(input)),
      ).rejects.toThrow()
      await expect(runSubtitleEvalRecovery(input)).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
      if ("fetchImpl" in input) expect(input.fetchImpl).not.toHaveBeenCalled()
    },
  )

  it.each([null, [], "unexpected"])(
    "rejects non-object input %j",
    async (input) => {
      expect(SubtitleEvalRecoveryInputSchema.safeParse(input).success).toBe(
        false,
      )
      await expect(
        Promise.resolve().then(() => executeInput(input)),
      ).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each([{}, undefined])(
    "uses only operator configuration for accepted input %j",
    async (input) => {
      operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_URL = URL_
      operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY = "dummy-operator-key"
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse({ outcomes: [] }))
      vi.stubGlobal("fetch", fetchImpl)
      await expect(executeInput(input)).resolves.toMatchObject({
        status: "swept",
        total: 0,
      })
      expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
        URL_,
        expect.objectContaining({
          method: "POST",
          redirect: "error",
          headers: { authorization: "Bearer dummy-operator-key" },
        }),
      )
    },
  )

  it("fails closed for an unapproved operator destination at execute", async () => {
    operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_URL = "https://receiver.invalid"
    operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY = "dummy-operator-key"
    await expect(executeInput({})).resolves.toMatchObject({
      status: "failed",
      reason: "config_invalid",
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(["url", "apiKey"])(
    "skips registered execution with only %s configured",
    async (field) => {
      if (field === "url") operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_URL = URL_
      else
        operatorEnv.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY =
          "dummy-operator-key"
      await expect(executeInput({})).resolves.toMatchObject({
        status: "skipped",
        reason: "config_missing",
      })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it("skips unconfigured registered execution", async () => {
    await expect(executeInput({})).resolves.toMatchObject({
      status: "skipped",
      reason: "config_missing",
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
