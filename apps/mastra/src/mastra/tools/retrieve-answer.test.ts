import { describe, expect, it } from "vitest"

import {
  STUB_ANSWER,
  executeRetrieveAnswer,
  retrieveAnswerInputSchema,
  retrieveAnswerOutputSchema,
} from "./retrieve-answer"

describe("retrieve-answer stub tool", () => {
  it("returns the deterministic stub shape with empty sources", () => {
    const result = executeRetrieveAnswer({ query: "who is Jesus?" })
    expect(result).toEqual({ answer: STUB_ANSWER, sources: [] })
    expect(result.answer.length).toBeGreaterThan(0)
    expect(result.sources).toHaveLength(0)
  })

  it("accepts an optional locale without changing the stub shape", () => {
    const result = executeRetrieveAnswer({
      query: "who is Jesus?",
      locale: "es",
    })
    expect(result).toEqual({ answer: STUB_ANSWER, sources: [] })
  })

  it("validates user-facing input", () => {
    expect(retrieveAnswerInputSchema.safeParse({ query: "" }).success).toBe(
      false,
    )
    expect(
      retrieveAnswerInputSchema.safeParse({ query: "x", locale: "en" }).success,
    ).toBe(true)
    // `.strict()` rejects unknown keys.
    expect(
      retrieveAnswerInputSchema.safeParse({ query: "x", extra: true }).success,
    ).toBe(false)
  })

  it("throws on invalid input via its own guard (not just createTool's)", () => {
    // Covers the `.parse()` guard inside executeRetrieveAnswer for direct
    // callers outside the createTool dispatch path.
    expect(() => executeRetrieveAnswer({ query: "" })).toThrow()
  })

  it("produces output that conforms to the output schema", () => {
    expect(
      retrieveAnswerOutputSchema.safeParse(
        executeRetrieveAnswer({ query: "x" }),
      ).success,
    ).toBe(true)
  })

  it("keeps the stub answer inside the safety posture (no invented content)", () => {
    // Sensitive-audience guard: the stub text must stay an obvious placeholder
    // so it cannot be silently edited into invented-scripture / doctrinal text.
    expect(STUB_ANSWER).toContain("[stub]")
    expect(executeRetrieveAnswer({ query: "x" }).answer).toContain("[stub]")
  })
})
