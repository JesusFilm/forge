import { describe, expect, it, vi } from "vitest"

import {
  fetchLangfusePrompt,
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
