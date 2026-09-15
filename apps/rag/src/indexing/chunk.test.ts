/**
 * Chunker unit tests — locks the ported jfa behaviour (architecture §2 invariant
 * 4): paragraph-preserving, ~500-token chunks, 50-token overlap, tail chunks
 * < 20 tokens dropped — plus the new span/token bookkeeping. Pure; no I/O.
 */
import { describe, expect, it } from "vitest"
import { chunkText, chunkDocument, estimateTokens } from "./chunk.js"

const para = (n: number): string =>
  Array.from(
    { length: n },
    (_, i) => `sentence number ${i} about knowing God and the gospel.`,
  ).join(" ")

describe("chunkText", () => {
  it("returns [] for empty or whitespace input", () => {
    expect(chunkText("")).toEqual([])
    expect(chunkText("   \n\n  ")).toEqual([])
  })

  it("drops a sub-20-token chunk", () => {
    // "word word word" ≈ 4 tokens < 20 → filtered out.
    expect(chunkText("word word word")).toEqual([])
  })

  it("keeps a single ≥20-token paragraph as one chunk", () => {
    const text = para(4) // comfortably > 20 tokens, < 2000 chars
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(estimateTokens(chunks[0])).toBeGreaterThanOrEqual(20)
  })

  it("splits long text into multiple overlapping chunks", () => {
    const text = [para(60), para(60), para(60)].join("\n\n") // well over maxChars
    const chunks = chunkText(text, { maxTokens: 500, overlapTokens: 50 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(2000 + 200) // ~maxChars, allow a little slack
      expect(estimateTokens(c)).toBeGreaterThanOrEqual(20)
    }
    // Overlap: the second chunk's opening words recur in the first chunk.
    const firstWords = chunks[1].split(/\s+/).slice(0, 5).join(" ")
    expect(chunks[0]).toContain(firstWords)
  })
})

describe("chunkDocument", () => {
  it("assigns one span per chunk with in-range offsets and token counts", () => {
    const content = [para(60), para(60)].join("\n\n")
    const spans = chunkDocument(content)
    const texts = chunkText(content)

    expect(spans.map((s) => s.text)).toEqual(texts)
    let prevStart = -1
    for (const s of spans) {
      expect(s.charStart).toBeGreaterThanOrEqual(0)
      expect(s.charEnd).toBeGreaterThan(s.charStart)
      expect(s.charEnd).toBeLessThanOrEqual(content.length)
      expect(s.charStart).toBeGreaterThanOrEqual(prevStart) // forward, non-decreasing
      expect(s.tokenCount).toBe(estimateTokens(s.text))
      prevStart = s.charStart
    }
    expect(spans.map((s) => s.ord)).toEqual(spans.map((_, i) => i))
  })
})
