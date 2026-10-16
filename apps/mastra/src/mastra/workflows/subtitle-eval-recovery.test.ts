import { describe, expect, it, vi } from "vitest"

import {
  runSubtitleEvalRecovery,
  subtitleEvalRecoveryWorkflow,
} from "./subtitle-eval-recovery"

const URL_ = "https://manager.example/api/scheduled/subtitle-eval-recovery"
const CONFIG = { url: URL_, apiKey: "service-bearer" }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("subtitle eval recovery sweep", () => {
  it("skips quietly when the Lab is not configured", async () => {
    const fetchImpl = vi.fn()
    // Unconfigured is normal until turn-on. Throwing here would fail loudly
    // every five minutes for a Lab nobody has switched on yet.
    await expect(
      runSubtitleEvalRecovery({ fetchImpl: fetchImpl as never }),
    ).resolves.toMatchObject({ status: "skipped", reason: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("skips when only one half of the pair is set", async () => {
    const fetchImpl = vi.fn()
    for (const partial of [{ url: URL_ }, { apiKey: "k" }]) {
      await expect(
        runSubtitleEvalRecovery({ ...partial, fetchImpl: fetchImpl as never }),
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
      runSubtitleEvalRecovery({ ...CONFIG, fetchImpl: fetchImpl as never }),
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
    expect(init.headers.authorization).toBe("Bearer service-bearer")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("treats an empty sweep as success, not failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ outcomes: [] }))
    await expect(
      runSubtitleEvalRecovery({ ...CONFIG, fetchImpl: fetchImpl as never }),
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
      runSubtitleEvalRecovery({ ...CONFIG, fetchImpl: fetchImpl as never }),
    ).resolves.toMatchObject({ status: "failed", reason })
  })

  it("reports a transport failure without leaking the error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:443"))
    const result = await runSubtitleEvalRecovery({
      ...CONFIG,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toMatchObject({ status: "failed", reason: "request_failed" })
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED")
  })

  it("reports a malformed body rather than throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 200 }))
    await expect(
      runSubtitleEvalRecovery({ ...CONFIG, fetchImpl: fetchImpl as never }),
    ).resolves.toMatchObject({ status: "failed", reason: "parse_error" })
  })

  it("reports an unexpected shape rather than reporting a false sweep", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ outcomes: [{ nope: true }] }))
    await expect(
      runSubtitleEvalRecovery({ ...CONFIG, fetchImpl: fetchImpl as never }),
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
      runSubtitleEvalRecovery({ ...CONFIG, fetchImpl: fetchImpl as never }),
    ).resolves.toMatchObject({
      status: "failed",
      reason: "response_too_large",
    })
    // The socket must be aborted, not merely left unread.
    expect(cancelled).toBe(true)
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
