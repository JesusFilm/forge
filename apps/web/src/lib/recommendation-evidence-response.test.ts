import { beforeEach, describe, expect, it, vi } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
const observe = vi.hoisted(() => vi.fn())
vi.mock("./recommendation-evidence-observability", () => ({
  observeRecommendationEvidence: observe,
}))
import { observeEvidenceResponse } from "./recommendation-evidence-response"
import { RecommendationRuntimeError } from "./recommendation-errors"
import { RecommendationRouteError } from "./recommendation-route-policy"

describe("evidence HTTP observations", () => {
  beforeEach(() => vi.clearAllMocks())
  const request = () =>
    new Request("http://localhost/api/recommendations/playback", {
      headers: { "user-agent": "Mozilla/5.0" },
    })
  it("reports terminal binding rejection without leaking request or error identity", () => {
    observeEvidenceResponse(
      request(),
      "claim",
      409,
      new RecommendationRuntimeError("playback_binding_invalid"),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "claim",
        outcome: "rejected",
        reason: "invalid_binding",
        retryDisposition: "terminal",
        httpStatus: 409,
      }),
    )
    observeEvidenceResponse(
      request(),
      "facts",
      503,
      new Error("secret-capability-and-history"),
    )
    expect(JSON.stringify(observe.mock.calls)).not.toContain(
      "secret-capability",
    )
  })
  it("distinguishes ambiguous upstream acknowledgement from definitive rejection", () => {
    observeEvidenceResponse(
      request(),
      "facts",
      503,
      new DOMException("private upstream URL", "TimeoutError"),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "ambiguous",
        timeoutStage: "upstream",
        retryDisposition: "retryable",
      }),
    )
  })
  it("records recognized crawler rejection before the playback action is known", () => {
    observeEvidenceResponse(
      new Request("http://localhost", {
        headers: { "user-agent": "Applebot" },
      }),
      "playback",
      403,
      new RecommendationRouteError(403, "machine_evidence_rejected"),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "playback",
        crawler: "recognized",
        reason: "crawler_rejected",
        retryDisposition: "terminal",
      }),
    )
  })
  it("does not report a missing user agent as human", () => {
    observeEvidenceResponse(new Request("http://localhost"), "context", 200)
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ crawler: "unknown" }),
    )
  })
  it.each(["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET", "ENOTFOUND"])(
    "records bounded upstream network code %s without changing retry semantics",
    (code) => {
      observeEvidenceResponse(
        request(),
        "facts",
        503,
        new TypeError("private upstream URL", {
          cause: Object.assign(new Error("private address"), { code }),
        }),
      )
      expect(observe).toHaveBeenLastCalledWith(
        expect.objectContaining({
          outcome: "failed",
          reason: "upstream_unavailable",
          timeoutStage: "none",
          retryDisposition: "retryable",
          networkErrorCode: code,
        }),
      )
      expect(JSON.stringify(observe.mock.calls)).not.toMatch(/private/)
    },
  )
  it("bounds cyclic causes and rejects arbitrary codes and throwing properties", () => {
    const cycle: { cause?: unknown; code: string } = {
      code: "secret-capability",
    }
    cycle.cause = cycle
    const throwing = {
      get code() {
        throw new Error("private URL")
      },
    }
    for (const error of [cycle, throwing, new Error("private message")]) {
      expect(() =>
        observeEvidenceResponse(request(), "facts", 503, error),
      ).not.toThrow()
      expect(observe).toHaveBeenLastCalledWith(
        expect.objectContaining({ networkErrorCode: "unknown" }),
      )
    }
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/private|secret/)
  })
  it("does not add network dimensions to successful or rejected responses", () => {
    for (const status of [200, 409]) {
      observeEvidenceResponse(request(), "facts", status, {
        code: "ECONNRESET",
      })
      expect(observe.mock.lastCall?.[0]).not.toHaveProperty("networkErrorCode")
    }
  })
  it("reads four cause objects at most", () => {
    const fourth = { cause: { cause: { cause: { code: "ECONNRESET" } } } }
    observeEvidenceResponse(request(), "facts", 503, fourth)
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ networkErrorCode: "ECONNRESET" }),
    )
    observeEvidenceResponse(request(), "facts", 503, { cause: fourth })
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({ networkErrorCode: "unknown" }),
    )
  })
  it.each(["reset", "refused"])(
    "identifies a real local %s connection failure",
    async (mode) => {
      const server = createServer((req) => req.socket.destroy())
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const address = server.address()
      if (!address || typeof address === "string")
        throw new Error("Missing owned port")
      try {
        if (mode === "refused")
          await new Promise<void>((resolve) => server.close(() => resolve()))
        const error = await fetch(`http://127.0.0.1:${address.port}`, {
          signal: AbortSignal.timeout(3_000),
        }).then(
          () => {
            throw new Error("Expected a failed connection")
          },
          (error) => error,
        )
        observeEvidenceResponse(request(), "facts", 503, error)
        expect(observe).toHaveBeenLastCalledWith(
          expect.objectContaining({
            networkErrorCode:
              mode === "refused" ? "ECONNREFUSED" : "UND_ERR_SOCKET",
          }),
        )
      } finally {
        server.closeAllConnections()
        if (server.listening)
          await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
  )
  it("distinguishes receipt conflict and exact replay without forwarding receipt identifiers", () => {
    observeEvidenceResponse(request(), "facts", 200, undefined, [
      { status: "conflict" },
    ])
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outcome: "conflict",
        reason: "payload_conflict",
        retryDisposition: "terminal",
      }),
    )
    observeEvidenceResponse(request(), "facts", 200, undefined, [
      { status: "replay" },
    ])
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outcome: "replay",
        retryDisposition: "idempotent_replay",
      }),
    )
  })
})
