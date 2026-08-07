import { describe, expect, it } from "vitest"

import { executeRetrieveAnswer } from "../../mastra/tools/retrieve-answer"

import {
  buildFixtureSearch,
  fixtureResultToClientResult,
  queryDrifted,
  type FixtureSearchCall,
} from "./fixture-rag"
import { RETRIEVE_ANSWER_EMPTY_MESSAGE, type RagFixture } from "./rag"

const OK_FIXTURE: RagFixture = {
  questionId: "q-trinity",
  query:
    "What do Christians actually mean when they say God is three persons but one God? It sounds like a contradiction.",
  capturedAt: "2026-08-03T00:00:00.000Z",
  result: {
    status: "ok",
    sources: [
      {
        text: "The doctrine of the Trinity holds one God in three persons.",
        sourceName: "Trusted Source",
        title: "On the Trinity",
        url: "https://example.org/trinity",
        score: 0.91,
      },
    ],
  },
}

const EMPTY_FIXTURE: RagFixture = {
  questionId: "q-python-pdf",
  query: "How do I parse a PDF in Python?",
  capturedAt: "2026-08-03T00:00:00.000Z",
  result: { status: "empty", sources: [] },
}

describe("fixtureResultToClientResult", () => {
  it("maps an ok fixture to the client success shape", () => {
    const result = fixtureResultToClientResult(OK_FIXTURE.result)
    expect(result).toEqual({
      ok: true,
      results: [
        {
          score: 0.91,
          text: "The doctrine of the Trinity holds one God in three persons.",
          citation: {
            sourceName: "Trusted Source",
            title: "On the Trinity",
            url: "https://example.org/trinity",
          },
        },
      ],
    })
  })

  it("maps an empty fixture to an ok result with zero passages", () => {
    expect(fixtureResultToClientResult(EMPTY_FIXTURE.result)).toEqual({
      ok: true,
      results: [],
    })
  })

  it("refuses a fixture that encodes an outage", () => {
    expect(() =>
      fixtureResultToClientResult({ status: "unavailable", sources: [] }),
    ).toThrow(/unavailable/)
  })
})

describe("queryDrifted", () => {
  it("treats a reformulation sharing vocabulary as NOT drifted", () => {
    expect(
      queryDrifted(
        OK_FIXTURE.query,
        "Christians Trinity three persons one God meaning",
      ),
    ).toBe(false)
  })

  it("flags a query about something else entirely", () => {
    expect(
      queryDrifted(OK_FIXTURE.query, "best hiking trails in new zealand"),
    ).toBe(true)
  })
})

describe("buildFixtureSearch", () => {
  it("records the model's verbatim query and serves the question's fixture", async () => {
    const calls: FixtureSearchCall[] = []
    const search = buildFixtureSearch({
      fixture: OK_FIXTURE,
      questionText: OK_FIXTURE.query,
      onCall: (call) => calls.push(call),
    })

    const result = await search({ query: "trinity three persons one God" })

    expect(result).toEqual(fixtureResultToClientResult(OK_FIXTURE.result))
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].arguments)).toEqual({
      query: "trinity three persons one God",
    })
    expect(calls[0].servedFrom).toBe("fixture-fallback")
    expect(calls[0].queryDrift).toBe(false)
  })

  it("marks a verbatim pass-through query as served from the exact fixture", async () => {
    const calls: FixtureSearchCall[] = []
    const search = buildFixtureSearch({
      fixture: OK_FIXTURE,
      questionText: OK_FIXTURE.query,
      onCall: (call) => calls.push(call),
    })

    await search({ query: OK_FIXTURE.query })

    expect(calls[0].servedFrom).toBe("fixture")
  })

  /**
   * The load-bearing integration: the frozen search function must round-trip
   * through the REAL tool executor — same parse, same clamp, same status
   * mapping — and reproduce the captured tool output exactly. This is what
   * makes "Real Agent, Frozen World" real: only the outermost HTTP client is
   * replaced.
   */
  it("round-trips through the real tool executor to the captured ok output", async () => {
    const search = buildFixtureSearch({
      fixture: OK_FIXTURE,
      questionText: OK_FIXTURE.query,
    })

    const output = await executeRetrieveAnswer(
      { query: "trinity three persons" },
      { search },
    )

    expect(output).toEqual({
      status: "ok",
      sources: OK_FIXTURE.result.sources,
    })
  })

  it("round-trips an empty fixture to the tool's real empty-path message", async () => {
    const search = buildFixtureSearch({
      fixture: EMPTY_FIXTURE,
      questionText: EMPTY_FIXTURE.query,
    })

    const output = await executeRetrieveAnswer(
      { query: "parse pdf python" },
      { search },
    )

    expect(output).toEqual({
      status: "empty",
      sources: [],
      message: RETRIEVE_ANSWER_EMPTY_MESSAGE,
    })
  })
})
