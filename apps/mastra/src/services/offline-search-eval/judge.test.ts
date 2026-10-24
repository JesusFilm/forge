import { describe, expect, it, vi } from "vitest"

import {
  OfflineSearchEvalJudgeError,
  createOfflineSearchEvalJudge,
} from "./judge"

describe("offline search eval judge", () => {
  it("requires provider credentials", () => {
    expect(() => createOfflineSearchEvalJudge({ apiKey: "" })).toThrow(
      OfflineSearchEvalJudgeError,
    )
  })

  it("parses structured judge output and token usage", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "tie",
                rationale: "same list",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    )
    const judge = createOfflineSearchEvalJudge({
      apiKey: "key",
      model: "test-model",
      fetchImpl,
    })

    await expect(
      judge.judgePair({
        query: "Jesus",
        locale: "en",
        listA: [],
        listB: [],
      }),
    ).resolves.toEqual({
      verdict: "tie",
      rationale: "same list",
      tokens: { input: 12, output: 3 },
      model: "test-model",
    })

    const firstCall = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    const body = JSON.parse(String(firstCall[1].body))
    expect(body.messages[0].content).toContain("Caller track: public-watch")
    expect(body.messages[0].content).toContain("Public Watch search reviewer")
    expect(body.messages[1].content).toContain("Query: Jesus")
  })

  it("scores one public result list with the absolute Watch rubric", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rating: "useful",
                rationale: "The result satisfies the felt-need query.",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4 },
      }),
    )
    const judge = createOfflineSearchEvalJudge({
      apiKey: "key",
      model: "test-model",
      fetchImpl,
    })

    await expect(
      judge.judgePointwise({
        query: "finding hope when life feels heavy",
        locale: "en",
        intent: "semantic-intent",
        results: [],
      }),
    ).resolves.toEqual({
      rating: "useful",
      rationale: "The result satisfies the felt-need query.",
      tokens: { input: 9, output: 4 },
      model: "test-model",
    })

    const call = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    const body = JSON.parse(String(call[1].body))
    expect(body.messages[0].content).toContain("absolute relevance")
    expect(body.messages[1].content).toContain("Intent: semantic-intent")
    expect(body.response_format.json_schema.name).toBe(
      "offline_search_eval_pointwise_rating",
    )
  })

  it("rejects invalid model output", async () => {
    const judge = createOfflineSearchEvalJudge({
      apiKey: "key",
      fetchImpl: vi.fn(async () =>
        Response.json({
          choices: [
            { message: { content: JSON.stringify({ verdict: "bad" }) } },
          ],
        }),
      ),
    })

    await expect(
      judge.judgePair({ query: "Jesus", locale: "en", listA: [], listB: [] }),
    ).rejects.toMatchObject({ code: "validation" })
  })

  it("retries transient provider failures", async () => {
    const sleep = vi.fn(async () => undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 429 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "tie",
                  rationale: "after retry",
                }),
              },
            },
          ],
        }),
      )
    const judge = createOfflineSearchEvalJudge({
      apiKey: "key",
      fetchImpl,
      sleep,
    })

    await expect(
      judge.judgePair({ query: "Jesus", locale: "en", listA: [], listB: [] }),
    ).resolves.toMatchObject({ verdict: "tie" })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })
})
