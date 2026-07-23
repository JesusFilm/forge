import { describe, expect, it, vi } from "vitest"

import {
  classifyUpstreamFailure,
  composeUpstreamAbortSignal,
  hostAllowed,
  postMastraUpstream,
  readJsonCapped,
  undefinedOnAbort,
} from "./mastra-upstream"

// Direct unit coverage of the shared transport — the SSRF label-boundary
// matrix (Ruling 2 PR 1) and the PR 2 helpers live HERE, at the functions'
// home, never only transitively; proxy suites keep their own wiring cases.

describe("hostAllowed — scheme floor + loopback", () => {
  it("allows an https base with no allowlist set", () => {
    expect(hostAllowed("https://mastra.internal", undefined)).toBe(true)
  })

  it("rejects an http public host (bearer-in-cleartext guard)", () => {
    expect(hostAllowed("http://evil.com", undefined)).toBe(false)
  })

  it("rejects an unparseable base URL", () => {
    expect(hostAllowed("not a url", undefined)).toBe(false)
  })

  it("allows http for localhost (local dev)", () => {
    expect(hostAllowed("http://localhost:4111", undefined)).toBe(true)
  })

  it("allows http for IPv4 loopback", () => {
    expect(hostAllowed("http://127.0.0.1:4111", undefined)).toBe(true)
  })

  it("allows http for bracketed IPv6 loopback", () => {
    expect(hostAllowed("http://[::1]:4111", undefined)).toBe(true)
  })
})

describe("hostAllowed — railway.internal label boundary", () => {
  it("allows http for a *.railway.internal host (prod private networking)", () => {
    expect(
      hostAllowed("http://example-service.railway.internal", undefined),
    ).toBe(true)
  })

  it("allows http for a *.railway.internal host with a port", () => {
    expect(
      hostAllowed("http://example-service.railway.internal:4111", undefined),
    ).toBe(true)
  })

  it("allows http for an uppercase *.RAILWAY.INTERNAL host (parser lowercases)", () => {
    expect(
      hostAllowed("http://EXAMPLE-SERVICE.RAILWAY.INTERNAL:4111", undefined),
    ).toBe(true)
  })

  it("rejects railway.internal.evil.com (suffix is a full-label match, not a substring)", () => {
    expect(hostAllowed("http://railway.internal.evil.com", undefined)).toBe(
      false,
    )
  })

  it("rejects evilrailway.internal (no dot boundary)", () => {
    expect(hostAllowed("http://evilrailway.internal", undefined)).toBe(false)
  })

  it("rejects bare railway.internal (no leading label)", () => {
    expect(hostAllowed("http://railway.internal", undefined)).toBe(false)
  })

  it("rejects .railway.internal (empty leading label)", () => {
    expect(hostAllowed("http://.railway.internal", undefined)).toBe(false)
  })

  it("rejects foo..railway.internal (empty inner label)", () => {
    expect(hostAllowed("http://foo..railway.internal", undefined)).toBe(false)
  })

  it("rejects a trailing-dot FQDN railway.internal. host (pins fail-closed)", () => {
    expect(
      hostAllowed("http://example-service.railway.internal.:4111", undefined),
    ).toBe(false)
  })
})

describe("hostAllowed — allowlist", () => {
  it("allows an https host in the allowlist", () => {
    expect(hostAllowed("https://mastra.internal", "mastra.internal")).toBe(true)
  })

  it("rejects an https host not in the allowlist", () => {
    expect(hostAllowed("https://mastra.internal", "trusted.internal")).toBe(
      false,
    )
  })

  it("rejects a loopback http host not in a set allowlist", () => {
    expect(hostAllowed("http://localhost:4111", "trusted.internal")).toBe(false)
  })

  it("allows a loopback http host in the allowlist", () => {
    expect(hostAllowed("http://localhost:4111", "localhost")).toBe(true)
  })

  it("rejects a railway.internal http host not in a set allowlist", () => {
    expect(
      hostAllowed(
        "http://example-service.railway.internal:4111",
        "trusted.internal",
      ),
    ).toBe(false)
  })

  it("allows a railway.internal http host in the allowlist", () => {
    expect(
      hostAllowed(
        "http://example-service.railway.internal:4111",
        "example-service.railway.internal",
      ),
    ).toBe(true)
  })

  it("matches allowlist entries after trimming and lowercasing (CSV hygiene)", () => {
    expect(
      hostAllowed("https://mastra.internal", " Mastra.Internal , other.host "),
    ).toBe(true)
  })
})

describe("postMastraUpstream — the shared fetch shape", () => {
  it("builds the URL from path+base and fixes method/bearer/content-type/redirect", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"))
    const controller = new AbortController()
    await postMastraUpstream(fetchImpl as unknown as typeof fetch, {
      baseUrl: "https://mastra.internal",
      apiKey: "svc-key",
      path: "/forge-seeker",
      accept: "text/event-stream",
      body: { prompt: "hi", threadId: "c1" },
      signal: controller.signal,
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe("https://mastra.internal/forge-seeker")
    expect(init.method).toBe("POST")
    expect(init.redirect).toBe("error")
    expect(init.headers.authorization).toBe("Bearer svc-key")
    expect(init.headers["content-type"]).toBe("application/json")
    expect(init.headers.accept).toBe("text/event-stream")
    expect(JSON.parse(init.body)).toEqual({ prompt: "hi", threadId: "c1" })
    // Slot identity: the composed signal reaches fetch unwrapped.
    expect(init.signal).toBe(controller.signal)
  })

  it.each([
    ["absolute path", "https://collector.example/forge-seeker"],
    ["scheme-relative path", "//collector.example/forge-seeker"],
  ])(
    "rejects an %s that escapes the validated base origin, before any fetch",
    (_label, path) => {
      const fetchImpl = vi.fn()
      expect(() =>
        postMastraUpstream(fetchImpl as unknown as typeof fetch, {
          baseUrl: "https://mastra.internal",
          apiKey: "svc-key",
          path,
          accept: "application/json",
          body: {},
          signal: new AbortController().signal,
        }),
      ).toThrow(TypeError)
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it("carries the per-proxy accept header through (JSON read path)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"))
    await postMastraUpstream(fetchImpl as unknown as typeof fetch, {
      baseUrl: "https://mastra.internal",
      apiKey: "lane-key",
      path: "/forge-ai-chat-history-list",
      accept: "application/json",
      body: { resourceId: "user:sub-1", page: 0 },
      signal: new AbortController().signal,
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe(
      "https://mastra.internal/forge-ai-chat-history-list",
    )
    expect(init.headers.accept).toBe("application/json")
  })
})

describe("composeUpstreamAbortSignal", () => {
  it("returns a single present signal as-is (identity, no wrapper)", () => {
    const controller = new AbortController()
    expect(composeUpstreamAbortSignal([undefined, controller.signal])).toBe(
      controller.signal,
    )
  })

  it("aborts the composed signal when any source fires", () => {
    const a = new AbortController()
    const b = new AbortController()
    const c = new AbortController()
    const composed = composeUpstreamAbortSignal([a.signal, b.signal, c.signal])
    expect(composed.aborted).toBe(false)
    c.abort()
    expect(composed.aborted).toBe(true)
  })

  it("is already aborted when a source arrives aborted, skipping undefined slots", () => {
    const fired = new AbortController()
    fired.abort()
    const composed = composeUpstreamAbortSignal([
      undefined,
      fired.signal,
      new AbortController().signal,
    ])
    expect(composed.aborted).toBe(true)
  })

  it("composes a never-aborting signal from an all-absent input (documented edge)", () => {
    // Callers must pass at least one present source (see the JSDoc) — the
    // all-absent result is a signal that never fires, i.e. an unbounded fetch.
    expect(composeUpstreamAbortSignal([undefined, undefined]).aborted).toBe(
      false,
    )
  })
})

describe("classifyUpstreamFailure — precedence (budget → caller → error name)", () => {
  function abortedSignal(): AbortSignal {
    const controller = new AbortController()
    controller.abort()
    return controller.signal
  }
  const idleSignal = () => new AbortController().signal

  it("budget-aborted wins over a caller abort AND the error name", () => {
    expect(
      classifyUpstreamFailure(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
        { budgetSignal: abortedSignal(), requestSignal: abortedSignal() },
      ),
    ).toBe("timeout")
  })

  it("caller-aborted beats the error name (a TimeoutError spelling loses)", () => {
    expect(
      classifyUpstreamFailure(
        Object.assign(new Error("timeout"), { name: "TimeoutError" }),
        { budgetSignal: idleSignal(), requestSignal: abortedSignal() },
      ),
    ).toBe("cancelled")
  })

  it("falls through to the error name: TimeoutError → timeout", () => {
    expect(
      classifyUpstreamFailure(
        Object.assign(new Error("timeout"), { name: "TimeoutError" }),
        { budgetSignal: idleSignal(), requestSignal: idleSignal() },
      ),
    ).toBe("timeout")
  })

  it("classifies any other rejection as network", () => {
    expect(
      classifyUpstreamFailure(new Error("ECONNREFUSED"), {
        budgetSignal: idleSignal(),
      }),
    ).toBe("network")
  })

  it("classifies non-Error rejections (null, string) as network", () => {
    expect(classifyUpstreamFailure(null, { budgetSignal: idleSignal() })).toBe(
      "network",
    )
    expect(
      classifyUpstreamFailure("boom", { budgetSignal: idleSignal() }),
    ).toBe("network")
  })
})

describe("readJsonCapped — byte-capped buffered JSON read", () => {
  it("parses an under-cap JSON body", async () => {
    const response = new Response(
      JSON.stringify({ reason: "model_key_missing" }),
    )
    expect(await readJsonCapped(response, 1024)).toEqual({
      reason: "model_key_missing",
    })
  })

  it("parses a near-cap multi-byte (3-byte-script) body under the cap", async () => {
    // 300 × "あ" ≈ 900 UTF-8 bytes + envelope: a legit non-Latin payload near
    // the cap must not trip it (byte-cap sizing corollary).
    const value = "あ".repeat(300)
    const response = new Response(JSON.stringify({ value }))
    expect(await readJsonCapped(response, 1024)).toEqual({ value })
  })

  it("parses a body of exactly the cap size and cancels one byte past it (exact boundary)", async () => {
    // Same 1024-byte payload against caps 1024 and 1023 — the cap is inclusive.
    const value = "x".repeat(1012)
    const body = JSON.stringify({ value })
    expect(new TextEncoder().encode(body).byteLength).toBe(1024)
    expect(await readJsonCapped(new Response(body), 1024)).toEqual({ value })
    expect(await readJsonCapped(new Response(body), 1023)).toBeUndefined()
  })

  it("reassembles a multi-chunk body that completes under the cap", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of ['{"value":', '"split', ' body"}']) {
          controller.enqueue(encoder.encode(part))
        }
        controller.close()
      },
    })
    expect(await readJsonCapped(new Response(stream), 1024)).toEqual({
      value: "split body",
    })
  })

  it("cancels the stream and resolves undefined past the cap", async () => {
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(512))
      },
      cancel() {
        cancelled = true
      },
    })
    expect(await readJsonCapped(new Response(endless), 1024)).toBeUndefined()
    expect(cancelled).toBe(true)
  })

  it("resolves undefined on malformed JSON", async () => {
    expect(await readJsonCapped(new Response("not json"), 1024)).toBeUndefined()
  })

  it("resolves undefined on a null body", async () => {
    expect(await readJsonCapped(new Response(null), 1024)).toBeUndefined()
  })
})

describe("undefinedOnAbort", () => {
  it("resolves immediately for an already-aborted signal", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(undefinedOnAbort(controller.signal)).resolves.toBeUndefined()
  })

  it("resolves when the signal aborts later", async () => {
    const controller = new AbortController()
    const pending = undefinedOnAbort(controller.signal)
    controller.abort()
    await expect(pending).resolves.toBeUndefined()
  })
})
