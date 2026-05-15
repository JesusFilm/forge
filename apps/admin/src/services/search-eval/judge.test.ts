import { describe, expect, it, vi } from "vitest"

import { JudgeError, createJudge } from "./judge"
import type { SearchResult } from "./types"

const sampleResult: SearchResult = {
  type: "video",
  id: "v_1",
  slug: "easter",
  title: "Easter",
  imageUrl: null,
  snippet: "About Easter",
  startSeconds: 0,
  playbackId: null,
  score: 0.5,
  label: null,
  durationSeconds: null,
  childCount: null,
}

const sampleInput = {
  query: "easter",
  locale: "en",
  listA: [sampleResult],
  listB: [{ ...sampleResult, id: "v_2", title: "Easter Story" }],
}

function buildOpenRouterResponse(
  text: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
    {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    },
  )
}

const mute = { warn: vi.fn(), info: vi.fn() }

describe("createJudge", () => {
  describe("happy path", () => {
    it("returns a parsed verdict + tokens + rationale", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        buildOpenRouterResponse(
          JSON.stringify({
            verdict: "clearly-A-better",
            rationale: "List A's first hit is the canonical match.",
          }),
        ),
      )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      const result = await judge.judgePair(sampleInput)
      expect(result.verdict).toBe("clearly-A-better")
      expect(result.rationale).toContain("canonical")
      expect(result.tokens).toEqual({ input: 100, output: 50 })
      expect(result.attempts).toBe(1)
    })

    it("uses the configured model id", async () => {
      let capturedBody: string | undefined
      const fetchImpl = vi.fn(async (_url, init) => {
        capturedBody = (init as { body?: string }).body
        return buildOpenRouterResponse(
          JSON.stringify({ verdict: "tie", rationale: "tied." }),
        )
      })
      const judge = createJudge({
        apiKey: "test-key",
        model: "anthropic/claude-haiku-4-5",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      await judge.judgePair(sampleInput)
      expect(capturedBody).toContain('"model":"anthropic/claude-haiku-4-5"')
    })
  })

  describe("retry behavior", () => {
    it("retries on 5xx then succeeds", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("err", {
            status: 502,
            headers: { "content-type": "text/plain" },
          }),
        )
        .mockResolvedValueOnce(
          buildOpenRouterResponse(
            JSON.stringify({ verdict: "tie", rationale: "tied." }),
          ),
        )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      const result = await judge.judgePair(sampleInput)
      expect(result.attempts).toBe(2)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it("honors Retry-After header on 429", async () => {
      const sleepCalls: number[] = []
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("rate", {
            status: 429,
            headers: {
              "content-type": "text/plain",
              "retry-after": "5",
            },
          }),
        )
        .mockResolvedValueOnce(
          buildOpenRouterResponse(
            JSON.stringify({
              verdict: "slightly-A-better",
              rationale: "ok.",
            }),
          ),
        )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async (ms) => {
          sleepCalls.push(ms)
        },
        logger: mute,
      })

      await judge.judgePair(sampleInput)
      expect(sleepCalls[0]).toBe(5_000)
    })

    it("caps Retry-After at 30s", async () => {
      const sleepCalls: number[] = []
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("rate", {
            status: 429,
            headers: { "retry-after": "120" },
          }),
        )
        .mockResolvedValueOnce(
          buildOpenRouterResponse(
            JSON.stringify({ verdict: "tie", rationale: "ok." }),
          ),
        )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async (ms) => {
          sleepCalls.push(ms)
        },
        logger: mute,
      })

      await judge.judgePair(sampleInput)
      expect(sleepCalls[0]).toBe(30_000)
    })

    it("throws retry_exhausted after max attempts of 5xx", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response("err", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }),
      )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      await expect(judge.judgePair(sampleInput)).rejects.toMatchObject({
        code: "retry_exhausted",
      })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it("throws rate_limited on a final 429", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response("rate", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxAttempts: 1,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      await expect(judge.judgePair(sampleInput)).rejects.toMatchObject({
        code: "rate_limited",
      })
    })
  })

  describe("validation", () => {
    it("throws validation on verdict outside enum", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          buildOpenRouterResponse(
            JSON.stringify({ verdict: "definitely-A", rationale: "ok." }),
          ),
        )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      await expect(judge.judgePair(sampleInput)).rejects.toMatchObject({
        code: "validation",
      })
    })

    it("throws validation when rationale is missing", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          buildOpenRouterResponse(JSON.stringify({ verdict: "tie" })),
        )

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      await expect(judge.judgePair(sampleInput)).rejects.toMatchObject({
        code: "validation",
      })
    })

    it("throws validation on non-JSON inner content", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(buildOpenRouterResponse("not-json-content"))

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      await expect(judge.judgePair(sampleInput)).rejects.toMatchObject({
        code: "validation",
      })
    })
  })

  describe("timeout", () => {
    it("retries on TimeoutError then surfaces timeout if still failing", async () => {
      const timeoutErr = new DOMException("timeout", "TimeoutError")
      const fetchImpl = vi.fn().mockRejectedValue(timeoutErr)

      const judge = createJudge({
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: mute,
      })

      await expect(judge.judgePair(sampleInput)).rejects.toMatchObject({
        code: "timeout",
      })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })
  })

  describe("missing credentials", () => {
    it("throws JudgeError on construction when no api key", () => {
      expect(() =>
        createJudge({ apiKey: undefined, sleep: () => Promise.resolve() }),
      ).toThrowError(JudgeError)
    })
  })
})
