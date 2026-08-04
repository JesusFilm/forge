import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildStubReply,
  STUB_REPLY_DELAY_MS,
  streamReply,
  toVideo,
} from "./chat-stub"
import { encodeSseFrame } from "./sse"

describe("buildStubReply", () => {
  it("identifies itself as stubbed and echoes the user text", () => {
    const reply = buildStubReply("hello")
    expect(reply).toContain("Stubbed reply")
    expect(reply).toContain("no agent is connected")
    expect(reply).toContain("hello")
  })

  it("embeds quotes and newlines verbatim", () => {
    const text = 'line one\nline two with "quotes"'
    expect(buildStubReply(text)).toContain(text)
  })
})

describe("STUB_REPLY_DELAY_MS", () => {
  it("is a positive finite number", () => {
    expect(Number.isFinite(STUB_REPLY_DELAY_MS)).toBe(true)
    expect(STUB_REPLY_DELAY_MS).toBeGreaterThan(0)
  })
})

// A Response whose body streams the given SSE frames.
function sseResponse(
  frames: Array<{ event: string; data: unknown }>,
  init?: ResponseInit,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(encodeSseFrame(f.event, f.data)))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("streamReply — stub path (flag off)", () => {
  it("resolves a stub reply and never fetches", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn()
    const promise = streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
    const result = await promise
    expect(result).toEqual({
      ok: true,
      text: buildStubReply("hi"),
      sources: [],
      grounded: false,
      engine: "stub",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("resolves cancelled when aborted during the delay", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const promise = streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: false,
      signal: controller.signal,
    })
    controller.abort()
    const result = await promise
    expect(result).toEqual({ ok: false, reason: "cancelled", partialText: "" })
  })
})

describe("streamReply — seeker path (flag on)", () => {
  it("streams tokens then resolves with text + sources + grounded", async () => {
    const tokens: string[] = []
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "token_delta", data: { text: "Hel" } },
        { event: "token_delta", data: { text: "lo" } },
        {
          event: "result",
          data: {
            text: "Hello",
            grounded: true,
            sources: [
              {
                sourceName: "Doc",
                title: "Title",
                url: "https://example.org",
                score: 0.9,
                snippet: "snip",
              },
            ],
          },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      onToken: (t) => tokens.push(t),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(tokens).toEqual(["Hel", "lo"])
    expect(result).toEqual({
      ok: true,
      text: "Hello",
      grounded: true,
      engine: "seeker",
      sources: [
        {
          sourceName: "Doc",
          title: "Title",
          url: "https://example.org",
          score: 0.9,
          snippet: "snip",
        },
      ],
    })
  })

  it("resolves ok:true with empty sources when none cited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "result",
          data: { text: "answer", grounded: true, sources: [] },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: true, sources: [], grounded: true })
  })

  it("keeps partial text on a mid-stream error frame", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "token_delta", data: { text: "par" } },
        { event: "token_delta", data: { text: "tial" } },
        { event: "error", data: { reason: "generation_failed" } },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "generation_failed",
      partialText: "partial",
    })
  })

  it("maps a fetch rejection to network_error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"))
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      partialText: "",
    })
  })

  it("maps a proxy 400 (rejected body) to invalid_request, not network_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "text and conversationId are required" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "invalid_request",
      partialText: "",
    })
  })

  it("honors first-terminal-wins (ignores a frame after the terminal)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "result",
          data: { text: "first", grounded: false, sources: [] },
        },
        { event: "error", data: { reason: "timeout" } },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: true, text: "first" })
  })

  it("filters malformed/untrusted sources from the result frame", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "result",
          data: {
            text: "answer",
            grounded: true,
            sources: [
              null,
              "not-an-object",
              { sourceName: "NoUrl" }, // missing url → dropped
              { url: "https://x.example" }, // missing sourceName → dropped
              {
                sourceName: "Good",
                url: "https://good.example",
                title: 42, // wrong type → null
                score: "high", // wrong type → 0
              },
            ],
          },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({
      ok: true,
      sources: [
        {
          sourceName: "Good",
          url: "https://good.example",
          title: null,
          score: 0,
          snippet: "",
        },
      ],
    })
  })

  // Ruling 3 (feat-281): the seam reports a gate denial HONESTLY — no stub
  // fabrication here. The session owns the stub-vs-failure decision (the gate
  // fires pre-upstream, so no partial text ever precedes this frame).
  it("maps a terminal gate_denied frame to the honest failure — never a stub reply", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sseResponse([{ event: "error", data: { reason: "gate_denied" } }]),
      )
    const result = await streamReply({
      text: "hi there",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "gate_denied",
      partialText: "",
    })
  })

  it("gate_denied is terminal — a later result frame is ignored (first-terminal-wins)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "error", data: { reason: "gate_denied" } },
        {
          event: "result",
          data: { text: "late", grounded: true, sources: [] },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "gate_denied",
      partialText: "",
    })
  })

  it("surfaces parse_error when the stream ends with no terminal frame", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sseResponse([{ event: "token_delta", data: { text: "x" } }]),
      )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      partialText: "x",
    })
  })
})

// ---------------------------------------------------------------------------
// feat-328 — the featured-video projection
// ---------------------------------------------------------------------------

// The wire shape the mastra route emits (plan P3/D9), fully populated. Tests
// below vary ONE field at a time from this baseline.
function wireVideo(overrides: Record<string, unknown> = {}) {
  return {
    videoId: "vid_1",
    title: "Jesus Calms the Storm",
    slug: "jesus",
    playbackId: "abcdEFGH1234",
    durationSeconds: 754,
    languageSlug: "english",
    ...overrides,
  }
}

describe("toVideo — acceptance", () => {
  it("projects a fully valid wire video with a client-built watch URL", () => {
    expect(toVideo(wireVideo())).toEqual({
      videoId: "vid_1",
      title: "Jesus Calms the Storm",
      playbackId: "abcdEFGH1234",
      durationSeconds: 754,
      watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
    })
  })

  it("builds the language-explicit path for a non-default language", () => {
    expect(toVideo(wireVideo({ languageSlug: "french" }))?.watchUrl).toBe(
      "https://www.jesusfilm.org/watch/jesus.html/french.html",
    )
  })

  it("delegates the language-home collision rule to watch-url-policy", () => {
    // A content slug that IS a public language home stays language-explicit —
    // proof the path comes from buildCanonicalWatchVideoPath, not string-building.
    expect(toVideo(wireVideo({ slug: "english" }))?.watchUrl).toBe(
      "https://www.jesusfilm.org/watch/english.html/english.html",
    )
  })

  it("projects a very long title VERBATIM — length never rejects a row", () => {
    // The operator ruling behind the render-layer bound: truncation happens at
    // display, never here. This is the layer where rejection could occur.
    const long = "x".repeat(10000)
    const projected = toVideo(wireVideo({ title: long }))
    expect(projected).not.toBeUndefined()
    expect(projected?.title).toBe(long)
  })

  it("accepts a slug at the pattern's 81-char upper boundary", () => {
    // Reject side is pinned at 82; without this, {0,80} -> {0,79} stays green.
    expect(
      toVideo(wireVideo({ slug: `a${"b".repeat(80)}` })),
    ).not.toBeUndefined()
  })

  it("accepts a cuid-shaped videoId at the pattern's 64-char boundary", () => {
    expect(toVideo(wireVideo({ videoId: "a".repeat(64) }))).not.toBeUndefined()
    expect(
      toVideo(wireVideo({ videoId: "cm3x9k2p40001abcd_ef-gh" })),
    ).not.toBeUndefined()
  })

  it("accepts the playbackId pattern's boundaries (8 and 64 chars)", () => {
    expect(
      toVideo(wireVideo({ playbackId: "a".repeat(8) })),
    ).not.toBeUndefined()
    expect(
      toVideo(wireVideo({ playbackId: "a".repeat(64) })),
    ).not.toBeUndefined()
    expect(toVideo(wireVideo({ playbackId: "A-b_0" + "x".repeat(3) }))).toEqual(
      expect.objectContaining({ playbackId: "A-b_0xxx" }),
    )
  })
})

describe("toVideo — rejection vectors", () => {
  const rejected: Array<[string, unknown]> = [
    ["a non-object", "not-an-object"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a missing videoId", wireVideo({ videoId: undefined })],
    ["an empty videoId", wireVideo({ videoId: "" })],
    ["a non-string videoId", wireVideo({ videoId: 7 })],
    // videoId gate mirrors mastra's VIDEO_ID_PATTERN (seeker-video-gates.ts).
    ["a whitespace-only videoId", wireVideo({ videoId: "   " })],
    ["a videoId with a slash", wireVideo({ videoId: "vid/1" })],
    ["a videoId with a space", wireVideo({ videoId: "vid 1" })],
    ["an over-long videoId", wireVideo({ videoId: "a".repeat(65) })],
    ["a missing title", wireVideo({ title: undefined })],
    ["an empty title", wireVideo({ title: "   " })],
    ["a missing playbackId", wireVideo({ playbackId: undefined })],
    ["a too-short playbackId", wireVideo({ playbackId: "abc1234" })],
    ["a too-long playbackId", wireVideo({ playbackId: "a".repeat(65) })],
    ["a playbackId with a slash", wireVideo({ playbackId: "abcd/EFGH1234" })],
    ["a playbackId with a dot", wireVideo({ playbackId: "abcd.EFGH1234" })],
    ["a playbackId with a space", wireVideo({ playbackId: "abcd EFGH1234" })],
    ["a missing slug", wireVideo({ slug: undefined })],
    ["an empty slug", wireVideo({ slug: "" })],
    ["an UPPERCASE slug", wireVideo({ slug: "Jesus" })],
    ["a slug with a slash", wireVideo({ slug: "jesus/evil" })],
    ["a slug with a dot-segment", wireVideo({ slug: "../secret" })],
    ["a slug with a percent escape", wireVideo({ slug: "jesus%2f" })],
    ["a slug with a query char", wireVideo({ slug: "jesus?x=1" })],
    ["a slug with a fragment char", wireVideo({ slug: "jesus#x" })],
    ["a slug with whitespace", wireVideo({ slug: "jesus film" })],
    ["a slug starting with a dash", wireVideo({ slug: "-jesus" })],
    ["a slug starting with an underscore", wireVideo({ slug: "_jesus" })],
    ["an over-long slug", wireVideo({ slug: "a".repeat(82) })],
  ]

  // toVideo now warns on every rejection; keep the ~30 cases below off stderr
  // so the real `[chat-video]` line stays greppable in CI output.
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(toVideo(value)).toBeUndefined()
    })
  }
})

describe("toVideo — projection_rejected diagnostic (feat-328)", () => {
  // Enum-only, plain-string. The frame rides a special-category conversation,
  // so a wire VALUE reaching a log line would be a leak, not just noise.
  function captureWarnings(run: () => void): string[] {
    const lines: string[] = []
    const spy = vi
      .spyOn(console, "warn")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "))
      })
    try {
      run()
    } finally {
      spy.mockRestore()
    }
    return lines
  }

  const branches: Array<[string, unknown, string]> = [
    ["a non-object", "not-an-object", "shape"],
    ["an array", [], "shape"],
    ["a bad videoId", wireVideo({ videoId: "vid/1" }), "video_id"],
    ["an empty title", wireVideo({ title: "   " }), "title"],
    ["a bad playbackId", wireVideo({ playbackId: "short" }), "playback_id"],
    ["a bad slug", wireVideo({ slug: "EVIL/../x" }), "slug"],
  ]

  for (const [label, payload, token] of branches) {
    it(`emits reason=${token} for ${label}`, () => {
      const lines = captureWarnings(() => {
        expect(toVideo(payload)).toBeUndefined()
      })
      expect(lines).toEqual([
        `[chat-video] event=projection_rejected reason=${token}`,
      ])
    })
  }

  it("keeps the reason vocabulary CLOSED and fully covered", () => {
    // Pairwise distinctness is already implied by the exact-line assertions
    // above. What is NOT: a sixth gate added later with a new or duplicate
    // token. Pin the emitted set against the source's own call-site count.
    const emitted = new Set(
      branches.map(([, payload]) => {
        const [line] = captureWarnings(() => toVideo(payload))
        return line.replace(/^.*reason=/, "")
      }),
    )
    expect(emitted).toEqual(
      new Set(["shape", "video_id", "title", "playback_id", "slug"]),
    )
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/chat-stub.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "")
    // Every rejectVideo( call site is represented above (the definition line
    // is the +1), so a new gate with no branch entry turns this red.
    expect(source.match(/rejectVideo\(/g)).toHaveLength(emitted.size + 1)
  })

  it("stays SILENT when no video was declared (the common turn)", () => {
    const lines = captureWarnings(() => {
      expect(toVideo(undefined)).toBeUndefined()
      expect(toVideo(null)).toBeUndefined()
    })
    expect(lines).toEqual([])
  })

  it("stays silent on a VALID projection", () => {
    const lines = captureWarnings(() => {
      expect(toVideo(wireVideo())).not.toBeUndefined()
    })
    expect(lines).toEqual([])
  })

  it("never emits a wire VALUE — checked at EVERY branch independently", () => {
    // One field poisoned per case from an otherwise-valid baseline, so each
    // iteration reaches its OWN gate. The earlier all-fields-poisoned fixture
    // only ever tripped video_id, proving one branch and implying four.
    const MARK = "ZZMARKERZZ"
    const perBranch: Array<[string, unknown]> = [
      ["video_id", wireVideo({ videoId: `${MARK}/!` })],
      ["title", wireVideo({ title: "   ", languageSlug: `${MARK}-lang` })],
      ["playback_id", wireVideo({ playbackId: `${MARK}!!` })],
      ["slug", wireVideo({ slug: `${MARK}-SLUG` })],
    ]
    for (const [token, payload] of perBranch) {
      const lines = captureWarnings(() => toVideo(payload))
      expect(lines).toEqual([
        `[chat-video] event=projection_rejected reason=${token}`,
      ])
      expect(lines.join("\n")).not.toContain(MARK)
    }
  })
})

describe("toVideo — no URL is ever trusted from the wire (plan D9)", () => {
  it("ignores a hostile wire watchUrl and builds its own", () => {
    const projected = toVideo(
      wireVideo({
        watchUrl: "https://evil.example/pwned",
        url: "https://evil.example/pwned",
        href: "javascript:alert(1)",
      }),
    )
    expect(projected?.watchUrl).toBe(
      "https://www.jesusfilm.org/watch/jesus.html",
    )
    expect(JSON.stringify(projected)).not.toContain("evil.example")
    expect(JSON.stringify(projected)).not.toContain("javascript:")
  })

  it("drops every wire field outside the projected shape", () => {
    const projected = toVideo(
      wireVideo({ slug: "jesus", posterUrl: "https://evil.example/p.jpg" }),
    )
    expect(Object.keys(projected ?? {}).sort()).toEqual([
      "durationSeconds",
      "playbackId",
      "title",
      "videoId",
      "watchUrl",
    ])
  })
})

describe("toVideo — languageSlug fallback (asymmetric by design)", () => {
  // Chat falls back to the default-language watch URL; the mastra projection
  // drops the row instead. Only the CONTENT slug is a rejection vector here.
  const fallsBack: Array<[string, unknown]> = [
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["non-string", 7],
    ["UPPERCASE", "English"],
    ["path-bearing", "english/../fr"],
    ["over-long", "a".repeat(82)],
  ]

  for (const [label, languageSlug] of fallsBack) {
    it(`falls back to the default language when languageSlug is ${label}`, () => {
      const projected = toVideo(wireVideo({ languageSlug }))
      expect(projected?.watchUrl).toBe(
        "https://www.jesusfilm.org/watch/jesus.html",
      )
    })
  }
})

describe("toVideo — durationSeconds", () => {
  it("keeps a positive finite duration", () => {
    expect(toVideo(wireVideo({ durationSeconds: 1 }))?.durationSeconds).toBe(1)
  })

  const nulled: Array<[string, unknown]> = [
    ["null", null],
    ["absent", undefined],
    ["a string", "754"],
    ["zero", 0],
    ["negative", -5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ]

  for (const [label, durationSeconds] of nulled) {
    it(`nulls a duration that is ${label}`, () => {
      const projected = toVideo(wireVideo({ durationSeconds }))
      expect(projected).not.toBeUndefined()
      expect(projected?.durationSeconds).toBeNull()
    })
  }
})

describe("streamReply — video on the terminal result frame (plan D3)", () => {
  it("carries a projected video from the terminal result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "token_delta", data: { text: "Watch this" } },
        {
          event: "result",
          data: {
            text: "Watch this",
            grounded: true,
            sources: [],
            video: wireVideo(),
          },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({
      ok: true,
      video: {
        videoId: "vid_1",
        playbackId: "abcdEFGH1234",
        watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
      },
    })
  })

  it("leaves video absent when the result frame carries none", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          { event: "result", data: { text: "answer", grounded: true } },
        ]),
      )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.video).toBeUndefined()
  })

  it("leaves video absent when the wire video fails the gates", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "result",
          data: { text: "answer", video: wireVideo({ slug: "EVIL/../x" }) },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.video).toBeUndefined()
  })

  it("never attaches a video to an error terminal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "token_delta", data: { text: "par" } },
        {
          event: "error",
          data: { reason: "generation_failed", video: wireVideo() },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "generation_failed",
      partialText: "par",
    })
    expect("video" in result).toBe(false)
  })

  it("never produces a video on the stub path (regression)", async () => {
    vi.useFakeTimers()
    const promise = streamReply({
      text: "show me a video about the storm",
      conversationId: "c1",
      seekerEnabled: false,
    })
    await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
    const result = await promise
    expect(result.ok).toBe(true)
    expect(result.ok && result.video).toBeUndefined()
    expect("video" in result).toBe(false)
  })
})
