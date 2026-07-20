import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  fetchLangfusePrompt,
  getManagedPrompt,
  resetManagedPromptStateForTests,
  type LangfuseConfig,
} from "./langfuse-prompt-client"

const testConfig: LangfuseConfig = {
  baseUrl: "https://langfuse.internal",
  publicKey: "pk-lf-test-public",
  secretKey: "sk-lf-test-secret",
  timeoutMs: 3_000,
  userAgent: "forge-test-langfuse/1.0",
  // Default production ceiling (256 KiB). Every existing fixture is well under
  // it, so these tests double as under-cap regression guards that the
  // byte-capped read is transparent below the limit.
  maxResponseBytes: 262_144,
  promptDefaultLabel: undefined,
  promptCacheTtlMs: 60_000,
  promptFailureCooldownMs: 10_000,
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    }),
  )
}

// Fixtures transcribed field-for-field from Langfuse's documented v2
// GET /api/public/v2/prompts/{promptName} response (langfuse.com API
// reference, Prompts → Get, captured 2026-07-20): `id`, `name`, `prompt`
// (string for text type / ChatMessage array for chat type), `type`,
// `version`, `labels`, `tags`, `config`, `commitMessage`, `resolutionGraph`,
// timestamps, and project/audit fields. The realistic superset is deliberate
// so the `.passthrough()` tolerance below is proven against a documented
// body, not a minimal one — mirroring the RAG client test's fixture
// discipline. The prompt name carries a `/` (Langfuse names may be
// folder-scoped), so the happy path doubles as the URL-encoding proof.
const textPromptFixture = {
  id: "cmdap1x9h0001promptstore1",
  name: "seeker/system-prompt",
  version: 4,
  type: "text",
  prompt:
    "You are the Jesus Film seeker assistant. Ground every answer in the retrieved passages and cite only returned sources.",
  labels: ["production", "latest"],
  tags: ["seeker", "chat"],
  config: { temperature: 0.2 },
  commitMessage: "tighten grounding instruction",
  resolutionGraph: null,
  isActive: null,
  createdAt: "2026-07-01T02:15:00.000Z",
  updatedAt: "2026-07-18T21:40:00.000Z",
  projectId: "cmdaproj00001promptstore1",
  createdBy: "user-4e21",
}

const chatPromptFixture = {
  ...textPromptFixture,
  id: "cmdap1x9h0002promptstore1",
  name: "seeker/chat-prompt",
  type: "chat",
  // Chat-type prompt bodies are ChatMessage arrays in the documented v2 shape.
  prompt: [
    { role: "system", content: "You are the Jesus Film seeker assistant." },
    { role: "user", content: "{{question}}" },
  ],
}

describe("langfuse prompt client", () => {
  it("returns the prompt and issues the exact contract request (encoded name, label param, Basic auth)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      label: "production",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      text: "You are the Jesus Film seeker assistant. Ground every answer in the retrieved passages and cite only returned sources.",
      version: 4,
      labels: ["production", "latest"],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // The `/` in the prompt name must be a path-segment escape (%2F), not a
    // route separator — Langfuse prompt names may be folder-scoped.
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0])
    expect(calledUrl).toBe(
      "https://langfuse.internal/api/public/v2/prompts/seeker%2Fsystem-prompt?label=production",
    )
    expect(calledUrl).toContain("%2F")
    // Basic auth divergence from the Bearer siblings: base64 of the key PAIR,
    // computed independently here so the client can't drift to Bearer.
    const expectedBasic = Buffer.from(
      "pk-lf-test-public:sk-lf-test-secret",
    ).toString("base64")
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({
          authorization: `Basic ${expectedBasic}`,
          "user-agent": "forge-test-langfuse/1.0",
        }),
      }),
    )
  })

  it("omits the label query param when no label is passed (resolution is layer 2's job)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))

    await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://langfuse.internal/api/public/v2/prompts/seeker%2Fsystem-prompt",
    )
  })

  it("short-circuits config_missing (base_url_missing) without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: { ...testConfig, baseUrl: undefined },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "base_url_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("short-circuits config_missing (public_key_missing) without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: { ...testConfig, publicKey: undefined },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "public_key_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("short-circuits config_missing (secret_key_missing) without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: { ...testConfig, secretKey: undefined },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "secret_key_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("classifies 401 as non-retryable auth_failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ message: "Invalid credentials" }, { status: 401 }),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
      upstreamReason: "Invalid credentials",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 403 as non-retryable auth_failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "forbidden" }, { status: 403 }),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 403,
      upstreamReason: "forbidden",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 429 as retryable rate_limited", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "rate limit exceeded" }, { status: 429 }),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status: 429,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 404 (unknown prompt or label) as non-retryable rejected carrying the status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse(
        { message: "Prompt not found", error: "LangfuseNotFoundError" },
        { status: 404 },
      ),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 404,
      upstreamReason: "LangfuseNotFoundError",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 500 as retryable network_error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "internal error" }, { status: 500 }),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      status: 500,
      upstreamReason: "internal error",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps a TimeoutError rejection to reason timeout (name-based, not message)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(
        // Real typed shape: `AbortSignal.timeout` rejects with an error whose
        // NAME is TimeoutError; the message is deliberately unrelated so a
        // message-matching classifier could not pass this test.
        Object.assign(new Error("the operation was aborted"), {
          name: "TimeoutError",
        }),
      ),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps an AbortError rejection to reason timeout (name-based, not message)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps a generic-name error whose MESSAGE says timeout to network_error (proves name-based classification)", async () => {
    // The inverse proof: an error whose message screams timeout but whose name
    // is generic must NOT be classified as timeout. Together with the two
    // tests above this pins classification to the typed `name` surface.
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("connection timeout while fetching")),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps invalid JSON to parse_error carrying no raw body text", async () => {
    const SECRET_MARKER = "DO-NOT-LEAK-THIS-BODY"
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(`not-json ${SECRET_MARKER}`, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
    // Leak control: nothing from the body bled into the typed failure.
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER)
  })

  it("tolerates contract-legal additive response fields (passthrough)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({
        ...textPromptFixture,
        // Hypothetical additive v2 fields the client doesn't consume, beyond
        // the documented superset already present in the fixture.
        folderPath: "seeker",
        usageStats: { observations: 12 },
      }),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      text: "You are the Jesus Film seeker assistant. Ground every answer in the retrieved passages and cite only returned sources.",
      version: 4,
      labels: ["production", "latest"],
    })
  })

  it("resolves the prompts path against a base URL with a trailing slash", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))

    await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: { ...testConfig, baseUrl: "https://langfuse.internal/" },
      fetchImpl,
    })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://langfuse.internal/api/public/v2/prompts/seeker%2Fsystem-prompt",
    )
  })

  it("resolves the prompts path against a base URL carrying a path prefix", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))

    await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: { ...testConfig, baseUrl: "https://gw.internal/langfuse" },
      fetchImpl,
    })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://gw.internal/langfuse/api/public/v2/prompts/seeker%2Fsystem-prompt",
    )
  })

  it("rejects a chat-type prompt with detail chat_type_unsupported, never ok", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(chatPromptFixture))

    const result = await fetchLangfusePrompt({
      name: "seeker/chat-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
      detail: "chat_type_unsupported",
    })
    // Leak control: the chat messages never bleed into the typed failure.
    expect(JSON.stringify(result)).not.toContain("seeker assistant")
  })

  it("rejects a whitespace-only text prompt with detail empty_prompt, never ok", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ ...textPromptFixture, prompt: " \n\t  " }),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
      detail: "empty_prompt",
    })
  })

  it("aborts the stream on over-cap — proves reader.cancel() fires, not just the return value", async () => {
    // The load-bearing byte-cap test: assert the ABORT mechanism fired, not
    // merely that the result is parse_error. The body is an unbounded stream
    // that would emit far more than the cap if fully drained; a regression
    // deleting reader.cancel() (bare `return undefined` after the loop) would
    // still return parse_error but would NOT set this flag — reopening the
    // OOM vector on the shared Mastra process.
    let cancelled = false
    const oneKib = new Uint8Array(1024)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(oneKib)
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: { ...testConfig, maxResponseBytes: 4_096 },
      fetchImpl,
    })

    expect(cancelled).toBe(true)
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
  })

  it("aborts the stream on an over-cap error body too — proves cancel() fires on the error path", async () => {
    // The error-path read (readUpstreamReason) must be byte-bounded by the SAME
    // abort mechanism as the success body, proven independently: if the error
    // read were ever split into a separate uncapped helper, this test fails
    // even though the success-path abort test would still pass. The capped
    // read returns undefined, so no upstreamReason is extracted, while the
    // status-based classification (rejected, 400) is unchanged.
    let cancelled = false
    const oneKib = new Uint8Array(1024)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(oneKib)
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(stream, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await fetchLangfusePrompt({
      name: "seeker/system-prompt",
      config: { ...testConfig, maxResponseBytes: 4_096 },
      fetchImpl,
    })

    expect(cancelled).toBe(true)
    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 400,
    })
    if (!result.ok) expect(result.upstreamReason).toBeUndefined()
  })
})

/**
 * Layer 2 — `getManagedPrompt`. The tests are derived edge-for-edge from the
 * cache state machine in the module's layer-2 header comment: every arrow is
 * one test. All timing goes through an injected `now` clock (the repo's
 * ai-chat-retention idiom — NO fake timers), and every scenario pins the
 * underlying fetch-call count so a caching regression cannot pass silently.
 */
describe("getManagedPrompt (layer 2)", () => {
  const FIXTURE_TEXT = textPromptFixture.prompt
  // Marker string (scenario 14): must never appear in a captured log line.
  const FALLBACK_TEXT = "FALLBACK-TEXT-MARKER: offline seeker instructions."

  function makeClock(start = 1_700_000_000_000) {
    let t = start
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms
      },
    }
  }

  function failureResponse(status = 500): Promise<Response> {
    return jsonResponse({ error: "internal error" }, { status })
  }

  beforeEach(() => {
    // Scenario 15: the reset hook isolates the module-level default cache and
    // the once-per-process config_missing log gate between tests.
    resetManagedPromptStateForTests()
  })

  it("Empty -> Fresh: cold success serves managed text with version and resolved label, passing the label explicitly on the wire", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))

    const result = await getManagedPrompt({
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    })

    expect(result).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // R2 "no implicit latest": the omitted call label resolved to "production"
    // and reached layer 1 EXPLICITLY as a query param — never omitted.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("label=production")
    expect(logs).toEqual([])
  })

  it("serves a fresh hit within TTL with no second fetch (call count pinned at 1)", async () => {
    const clock = makeClock()
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
    }

    await getManagedPrompt(input)
    clock.advance(testConfig.promptCacheTtlMs - 1)
    const second = await getManagedPrompt(input)

    expect(second).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("Fresh -> Expired -> Fresh: TTL elapse triggers one blocking refetch and recaches the new text", async () => {
    const clock = makeClock()
    const updatedFixture = {
      ...textPromptFixture,
      version: 5,
      prompt: "Updated managed instructions.",
    }
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
    }

    await getManagedPrompt(input)
    clock.advance(testConfig.promptCacheTtlMs)
    fetchImpl.mockImplementation(() => jsonResponse(updatedFixture))
    const refreshed = await getManagedPrompt(input)

    expect(refreshed).toEqual({
      text: "Updated managed instructions.",
      source: "langfuse",
      version: 5,
      resolvedLabel: "production",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // Recached: an immediate third call is a fresh hit, not a fetch.
    const third = await getManagedPrompt(input)
    expect(third).toEqual(refreshed)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("Expired -> StaleServing: refetch failure serves stale text, logs exactly one failure event, and starts the cooldown", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    await getManagedPrompt(input)
    clock.advance(testConfig.promptCacheTtlMs)
    fetchImpl.mockImplementation(() => failureResponse())
    const stale = await getManagedPrompt(input)

    expect(stale).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
      stale: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(logs).toEqual([
      "[langfuse] event=prompt_fetch_failed name=seeker/system-prompt label=production reason=network_error status=500",
    ])
    // Cooldown active: an immediate retry neither fetches nor re-logs.
    const again = await getManagedPrompt(input)
    expect(again).toEqual(stale)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(logs).toHaveLength(1)
  })

  it("StaleServing -> StaleServing: within the cooldown window stale is served from state — no fetch attempt, no re-log", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    // Build StaleServing: success, expire, refetch failure.
    await getManagedPrompt(input)
    clock.advance(testConfig.promptCacheTtlMs)
    fetchImpl.mockImplementation(() => failureResponse())
    await getManagedPrompt(input)

    // One tick short of the cooldown boundary: still serving from state.
    clock.advance(testConfig.promptFailureCooldownMs - 1)
    const result = await getManagedPrompt(input)
    expect(result).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
      stale: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(logs).toHaveLength(1)
  })

  it("StaleServing -> Fresh: cooldown lapse + refetch success clears the failure state and serves fresh managed text", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const updatedFixture = {
      ...textPromptFixture,
      version: 5,
      prompt: "Updated managed instructions.",
    }
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    // Build StaleServing: success, expire, refetch failure.
    await getManagedPrompt(input)
    clock.advance(testConfig.promptCacheTtlMs)
    fetchImpl.mockImplementation(() => failureResponse())
    await getManagedPrompt(input)

    clock.advance(testConfig.promptFailureCooldownMs)
    fetchImpl.mockImplementation(() => jsonResponse(updatedFixture))
    const recovered = await getManagedPrompt(input)

    // No stale flag: this is a fresh serve, not a cooldown serve.
    expect(recovered).toEqual({
      text: "Updated managed instructions.",
      source: "langfuse",
      version: 5,
      resolvedLabel: "production",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    // Failure state cleared: an immediate next call is a plain fresh hit.
    const after = await getManagedPrompt(input)
    expect(after).toEqual(recovered)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(logs).toHaveLength(1)
  })

  it("StaleServing -> StaleServing: post-cooldown refetch failure serves stale again, restarts the cooldown, and logs ONE new event (per attempt, never per serve)", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    // Build StaleServing: success, expire, refetch failure (first log).
    await getManagedPrompt(input)
    clock.advance(testConfig.promptCacheTtlMs)
    fetchImpl.mockImplementation(() => failureResponse())
    await getManagedPrompt(input)
    expect(logs).toHaveLength(1)

    // Cooldown lapses; the next attempt fails again → ONE new failure event.
    clock.advance(testConfig.promptFailureCooldownMs)
    const second = await getManagedPrompt(input)
    expect(second).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
      stale: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(logs).toHaveLength(2)

    // Cooldown restarted: subsequent serves are fetch-free and log-free.
    clock.advance(testConfig.promptFailureCooldownMs - 1)
    const third = await getManagedPrompt(input)
    expect(third).toEqual(second)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(logs).toHaveLength(2)
  })

  it("Empty -> NegativeCached: cold failure serves the fallback with the reason; repeats within cooldown neither refetch nor re-log", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("fetch failed")),
    )
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    const first = await getManagedPrompt(input)
    expect(first).toEqual({
      text: FALLBACK_TEXT,
      source: "fallback",
      resolvedLabel: "production",
      reason: "network_error",
    })
    expect(logs).toEqual([
      "[langfuse] event=prompt_fetch_failed name=seeker/system-prompt label=production reason=network_error",
    ])

    clock.advance(testConfig.promptFailureCooldownMs - 1)
    const second = await getManagedPrompt(input)
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(logs).toHaveLength(1)
  })

  it("NegativeCached -> Fresh: cooldown lapse + refetch success replaces the negative cache with a fresh entry", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("fetch failed")),
    )
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    await getManagedPrompt(input)
    clock.advance(testConfig.promptFailureCooldownMs)
    fetchImpl.mockImplementation(() => jsonResponse(textPromptFixture))
    const recovered = await getManagedPrompt(input)

    expect(recovered).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // Failure state cleared: an immediate next call is a plain fresh hit.
    const after = await getManagedPrompt(input)
    expect(after).toEqual(recovered)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(logs).toHaveLength(1)
  })

  it("NegativeCached -> NegativeCached: post-cooldown refetch failure serves the fallback again, restarts the cooldown, and logs a new failure event", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("fetch failed")),
    )
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    await getManagedPrompt(input)
    expect(logs).toHaveLength(1)

    // Cooldown lapses; the next attempt fails again → ONE new failure event.
    clock.advance(testConfig.promptFailureCooldownMs)
    const second = await getManagedPrompt(input)
    expect(second).toEqual({
      text: FALLBACK_TEXT,
      source: "fallback",
      resolvedLabel: "production",
      reason: "network_error",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(logs).toHaveLength(2)

    // Cooldown restarted: subsequent serves are fetch-free and log-free.
    clock.advance(testConfig.promptFailureCooldownMs - 1)
    const third = await getManagedPrompt(input)
    expect(third).toEqual(second)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(logs).toHaveLength(2)
  })

  it("single-flight: two concurrent cold callers share ONE underlying fetch and both resolve to the managed text", async () => {
    const clock = makeClock()
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
    }

    const first = getManagedPrompt(input)
    const second = getManagedPrompt(input)
    // Both callers' synchronous prefixes have run: one fetch, one shared flight.
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    resolveFetch?.(
      new Response(JSON.stringify(textPromptFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
    })
    expect(b).toEqual(a)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("slot-leak guard: a synchronously throwing log sink clears the in-flight slot, resolves to fallback, and never wedges the entry", async () => {
    const clock = makeClock()
    const fetchImpl = vi.fn<typeof fetch>(() => failureResponse())
    const throwingSink = vi.fn((_line: string) => {
      throw new Error("sink exploded")
    })
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: throwingSink,
    }

    // The throw happens INSIDE the refetch wrapper; nothing may propagate.
    const first = await getManagedPrompt(input)
    expect(first).toEqual({
      text: FALLBACK_TEXT,
      source: "fallback",
      resolvedLabel: "production",
      reason: "network_error",
    })
    expect(throwingSink).toHaveBeenCalledTimes(1)

    // Subsequent calls resolve to fallback from cooldown state — no fetch.
    const second = await getManagedPrompt(input)
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // Not wedged: after the cooldown lapses, a successful refetch recovers the
    // entry — proving the in-flight slot was released despite the sync throw.
    clock.advance(testConfig.promptFailureCooldownMs)
    fetchImpl.mockImplementation(() => jsonResponse(textPromptFixture))
    const third = await getManagedPrompt(input)
    expect(third).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('omitted label and explicit "production" share one cache entry; a different label is an independent entry', async () => {
    const clock = makeClock()
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const base = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
    }

    const omitted = await getManagedPrompt(base)
    const explicit = await getManagedPrompt({ ...base, label: "production" })
    expect(omitted.resolvedLabel).toBe("production")
    expect(explicit).toEqual(omitted)
    // One entry, one fetch: resolution happens BEFORE cache keying.
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const editor = await getManagedPrompt({ ...base, label: "editor" })
    expect(editor.resolvedLabel).toBe("editor")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("label=editor")
  })

  it('config.promptDefaultLabel fills an omitted call label (call param > config default > "production")', async () => {
    const clock = makeClock()
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const config: LangfuseConfig = {
      ...testConfig,
      promptDefaultLabel: "staging",
    }
    const base = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config,
      fetchImpl,
      now: clock.now,
    }

    const defaulted = await getManagedPrompt(base)
    expect(defaulted.resolvedLabel).toBe("staging")
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("label=staging")

    // The call param still wins over the config default (its own entry).
    const explicit = await getManagedPrompt({ ...base, label: "editor" })
    expect(explicit.resolvedLabel).toBe("editor")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("config_missing logs once per process across repeated attempts and entries", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const fetchImpl = vi.fn<typeof fetch>()
    const config: LangfuseConfig = { ...testConfig, baseUrl: undefined }
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    const first = await getManagedPrompt(input)
    expect(first).toEqual({
      text: FALLBACK_TEXT,
      source: "fallback",
      resolvedLabel: "production",
      reason: "config_missing",
    })
    expect(logs).toEqual([
      "[langfuse] event=prompt_fetch_failed name=seeker/system-prompt label=production reason=config_missing detail=base_url_missing",
    ])

    // A post-cooldown re-attempt fails again but does NOT re-log...
    clock.advance(testConfig.promptFailureCooldownMs)
    await getManagedPrompt(input)
    // ...and neither does a different prompt entry (per process, not per entry).
    await getManagedPrompt({ ...input, name: "another/prompt" })
    expect(logs).toHaveLength(1)
    // Layer 1 short-circuits config_missing before any fetch.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("failure log lines carry name/label/reason but never fetched prompt text, fallback text, or upstream reason", async () => {
    const clock = makeClock()
    const logs: string[] = []
    const markerFixture = {
      ...textPromptFixture,
      prompt: "PROMPT-TEXT-MARKER managed instructions",
    }
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(markerFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
      logSink: (line: string) => {
        logs.push(line)
      },
    }

    // Cache marker prompt text, expire it, then fail with a marker-carrying
    // upstream error body — the single emitted line must leak none of them.
    await getManagedPrompt(input)
    clock.advance(testConfig.promptCacheTtlMs)
    fetchImpl.mockImplementation(() =>
      jsonResponse({ error: "UPSTREAM-REASON-MARKER" }, { status: 500 }),
    )
    await getManagedPrompt(input)

    expect(logs).toHaveLength(1)
    const joined = logs.join("\n")
    expect(joined).toContain("name=seeker/system-prompt")
    expect(joined).toContain("label=production")
    expect(joined).toContain("reason=network_error")
    expect(joined).not.toContain("PROMPT-TEXT-MARKER")
    expect(joined).not.toContain("FALLBACK-TEXT-MARKER")
    expect(joined).not.toContain("UPSTREAM-REASON-MARKER")
  })

  it("resetManagedPromptStateForTests clears the default cache so tests stay isolated (the beforeEach hook above relies on this)", async () => {
    const clock = makeClock()
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse(textPromptFixture))
    const input = {
      name: "seeker/system-prompt",
      fallback: FALLBACK_TEXT,
      config: testConfig,
      fetchImpl,
      now: clock.now,
    }

    await getManagedPrompt(input)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    resetManagedPromptStateForTests()

    // A within-TTL call refetches: the entry did not survive the reset.
    const second = await getManagedPrompt(input)
    expect(second).toEqual({
      text: FIXTURE_TEXT,
      source: "langfuse",
      version: 4,
      resolvedLabel: "production",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
