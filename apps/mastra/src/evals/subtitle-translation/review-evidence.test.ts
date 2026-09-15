import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildSubtitleReviewEvidence,
  diffSubtitleText,
} from "./review-evidence"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("subtitle review evidence", () => {
  it("joins a human cue and two generated cues into one connected segment", () => {
    const evidence = buildSubtitleReviewEvidence({
      locale: "es",
      source: [{ start: 0, end: 4, text: "Good news for everyone." }],
      reference: [{ start: 0, end: 4, text: "Buenas noticias para todos." }],
      candidate: [
        { start: 0, end: 2, text: "Buenas noticias" },
        { start: 2, end: 4, text: "para todos." },
      ],
    })

    expect(evidence.segments).toHaveLength(1)
    expect(evidence.segments[0]).toMatchObject({
      id: "segment-0001",
      start: 0,
      end: 4,
      timing: {
        referenceStart: 0,
        referenceEnd: 4,
        candidateStart: 0,
        candidateEnd: 4,
        startDeltaSeconds: 0,
        endDeltaSeconds: 0,
      },
    })
    expect(evidence.segments[0]?.reference).toHaveLength(1)
    expect(evidence.segments[0]?.candidate).toHaveLength(2)
  })

  it("uses source cues as context without letting them merge comparison segments", () => {
    const evidence = buildSubtitleReviewEvidence({
      locale: "es",
      source: [{ start: 0, end: 10, text: "Long source context" }],
      reference: [
        { start: 0, end: 2, text: "Uno" },
        { start: 4, end: 6, text: "Dos" },
      ],
      candidate: [
        { start: 0, end: 2, text: "Uno" },
        { start: 4, end: 6, text: "Dos" },
      ],
    })

    expect(evidence.segments).toHaveLength(2)
    expect(
      evidence.segments.every((segment) => segment.source.length === 1),
    ).toBe(true)
  })

  it.each([
    ["CJK", "你好世界", "你好，世界", "zh"],
    ["combining marks", "Cafe\u0301", "Café", "fr"],
    ["emoji", "Family 👨‍👩‍👧‍👦", "Family 👩‍👩‍👧‍👧", "en"],
    ["RTL", "שלום עולם", "שלום לכולם", "he"],
  ])(
    "keeps %s diffs stable and reconstructable",
    (_label, left, right, locale) => {
      const operations = diffSubtitleText(left, right, locale)

      expect(
        operations
          .filter((operation) => operation.kind !== "insert")
          .map((operation) => operation.text)
          .join(""),
      ).toBe(left)
      expect(
        operations
          .filter((operation) => operation.kind !== "delete")
          .map((operation) => operation.text)
          .join(""),
      ).toBe(right)
      expect(operations.every((operation) => operation.text.length > 0)).toBe(
        true,
      )
    },
  )

  it("does not split a joined emoji grapheme", () => {
    const family = "👨‍👩‍👧‍👦"
    const operations = diffSubtitleText(family, "👩‍👩‍👧‍👧", "en")

    expect(operations).toContainEqual({ kind: "delete", text: family })
  })

  it("keeps Unicode whole when Intl.Segmenter is unavailable", () => {
    vi.spyOn(Intl, "Segmenter").mockImplementation(() => {
      throw new Error("segmenter unavailable")
    })
    const family = "Cafe\u0301 👨‍👩‍👧‍👦"

    expect(diffSubtitleText(family, "Café 👩‍👩‍👧‍👧", "en")).toContainEqual({
      kind: "delete",
      text: family,
    })
  })
})
