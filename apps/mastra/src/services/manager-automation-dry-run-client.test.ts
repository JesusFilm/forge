import { afterEach, describe, expect, it, vi } from "vitest"
import { callManagerDryRunEndpoint } from "./manager-automation-dry-run-client"

const input = {
  automationDocumentId: "automation /1",
  requestedBy: { kind: "manager_user" as const, id: "metadata-not-authority" },
  idempotencyKey: "request-1",
}
const success = {
  ok: true,
  automationDocumentId: input.automationDocumentId,
  managerAutomationRunDocumentId: "run-1",
  runMode: "dry_run",
  enqueuedCount: 0,
  status: "partial",
  summary: "Partial report.",
  reportUrl: "/dashboard/agents?automationId=automation%20%2F1&runId=run-1",
}
const dependencies = {
  managerBaseUrl: "https://manager.test",
  managerAgenticApiKey: "secret-dry-run-key",
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe("bounded dry-run-only Manager transport", () => {
  it("encodes identities, sends only attribution/key and scopes its bearer to the dry-run endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(success))
    expect(
      await callManagerDryRunEndpoint(input, { ...dependencies, fetcher }),
    ).toEqual(success)
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://manager.test/api/automations/automation%20%2F1/agentic-dry-run",
    )
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
      headers: {
        authorization: "Bearer secret-dry-run-key",
        "idempotency-key": "request-1",
      },
    })
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      requestedBy: input.requestedBy,
      idempotencyKey: input.idempotencyKey,
    })
  })
  it.each([
    "http://manager.test",
    "https://user:password@manager.test",
    "https://manager.test/base",
    "https://manager.test?key=x",
    "https://manager.test/#hash",
    "bad-url",
  ])(
    "refuses unsafe origin %s before sending credentials",
    async (managerBaseUrl) => {
      const fetcher = vi.fn<typeof fetch>()
      expect(
        await callManagerDryRunEndpoint(input, {
          ...dependencies,
          managerBaseUrl,
          fetcher,
        }),
      ).toMatchObject({ ok: false, code: "config_missing" })
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
  it("keeps missing/partial configuration optional and reports unavailable without fetching", async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(
      await callManagerDryRunEndpoint(input, {
        managerBaseUrl: "",
        managerAgenticApiKey: "",
        fetcher,
      }),
    ).toMatchObject({ code: "config_missing" })
    expect(
      await callManagerDryRunEndpoint(input, {
        managerBaseUrl: "https://manager.test",
        managerAgenticApiKey: "",
        fetcher,
      }),
    ).toMatchObject({ code: "config_missing" })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("rejects live input even when its typed executor is called directly", async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(
      await callManagerDryRunEndpoint(
        { ...input, ...{ runMode: "live" } },
        { ...dependencies, fetcher },
      ),
    ).toMatchObject({ code: "invalid_automation" })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    [302, "text/html", "<html>redirect</html>"],
    [502, "text/html", "<html>secret gateway error</html>"],
    [200, "application/json", "not-json secret"],
    [200, "application/json", JSON.stringify({ ...success, runMode: "live" })],
    [200, "application/json", JSON.stringify({ ...success, enqueuedCount: 1 })],
    [
      200,
      "application/json",
      JSON.stringify({ ...success, status: "running" }),
    ],
    [
      200,
      "application/json",
      JSON.stringify({ ...success, automationDocumentId: "wrong-automation" }),
    ],
    [
      200,
      "application/json",
      JSON.stringify({ ...success, reportUrl: "https://evil.test" }),
    ],
    [500, "application/json", JSON.stringify(success)],
    [
      200,
      "application/json",
      JSON.stringify({
        ok: false,
        code: "manager_unavailable",
        message: "secret",
      }),
    ],
  ] as const)(
    "rejects invalid upstream envelope (%s, %s)",
    async (status, contentType, body) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(body, {
          status,
          headers: { "content-type": contentType },
        }),
      )
      const result = await callManagerDryRunEndpoint(input, {
        ...dependencies,
        fetcher,
      })
      expect(result).toMatchObject({ ok: false, code: "manager_unavailable" })
      expect(JSON.stringify(result)).not.toContain("secret")
    },
  )
  it("preserves inflight conflict without relaying raw upstream diagnostics", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { ok: false, code: "run_in_progress", message: "secret DB URL" },
          { status: 409 },
        ),
      )
    expect(
      await callManagerDryRunEndpoint(input, { ...dependencies, fetcher }),
    ).toEqual({
      ok: false,
      code: "run_in_progress",
      message: "Manager automation dry run is unavailable.",
    })
  })
  it.each([200, 502])(
    "caps and cancels chunked response bodies on HTTP %s",
    async (status) => {
      const cancel = vi.fn()
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(16_385))
            },
            cancel,
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
      )
      expect(
        await callManagerDryRunEndpoint(input, { ...dependencies, fetcher }),
      ).toMatchObject({ code: "manager_unavailable" })
      expect(cancel).toHaveBeenCalled()
    },
  )
  it("times out a stalled response body and cancels its stream", async () => {
    vi.useFakeTimers()
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      setTimeout(() => timeout.abort(), ms)
      return timeout.signal
    })
    const cancel = vi.fn()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "application/json" },
      }),
    )
    const result = callManagerDryRunEndpoint(input, {
      ...dependencies,
      requestTimeoutMs: 10,
      fetcher,
    })
    await vi.advanceTimersByTimeAsync(11)
    expect(await result).toMatchObject({ code: "manager_unavailable" })
    expect(cancel).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
  it("redacts fetch exceptions", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("secret credential"))
    expect(
      await callManagerDryRunEndpoint(input, { ...dependencies, fetcher }),
    ).toEqual({
      ok: false,
      code: "manager_unavailable",
      message: "Manager automation dry run is unavailable.",
    })
  })
})
