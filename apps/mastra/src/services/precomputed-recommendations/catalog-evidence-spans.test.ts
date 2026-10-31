import { describe, expect, it } from "vitest"

import {
  buildTranscriptSpanOffer,
  materializeSpanJudgment,
  spanJudgmentSchema,
} from "./catalog-evidence-spans"
import { assertEvidence, type Chunk, type Video } from "./source-generation"

const context = {
  generationInputDigest: "a".repeat(64),
  inputCutoff: "2026-10-06T00:00:00.000Z",
  sourceVideoId: "source",
  candidateVideoId: "target",
  catalogIndex: 40,
  candidateIndex: 7,
  afterChunkId: "previous-chunk",
}
const candidate = {
  id: "target",
  coreId: "target-core",
  slug: "target",
  locale: "am",
  title: "A distinct story",
  description: "A second perspective",
  descriptionTruncated: false,
  keywords: [],
  keywordsTruncated: false,
  bibleCitations: [],
  bibleCitationsTruncated: false,
  parentVideoIds: [],
  childVideoIds: [],
  transcriptLanguages: ["am"],
} satisfies Video
const chunk = (id: string, text: string, language = "am"): Chunk => ({
  id,
  transcriptId: `${id}-transcript`,
  language,
  chunkIndex: 0,
  text,
})
const transcriptChoice = (spanIds: string[]) =>
  spanJudgmentSchema.parse({
    connections: [
      {
        kind: "direct",
        relationship: "shared story",
        reasonEnglish: "Both videos explore the same act of courage.",
        addedViewingValueEnglish: null,
        evidence: { basis: "transcript", spanIds },
        strength: 75,
      },
    ],
  })

function wellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

describe("catalog transcript support spans", () => {
  it("offers exact contiguous support without dropping Unicode or a short tail", () => {
    // The first pair straddles the 224-unit overlap start; the second
    // straddles the 240-unit window end.
    const text = `${"A".repeat(222)}🙂${"b".repeat(15)}🙂${"c".repeat(20)} ሰላም ${"z".repeat(5)}`
    expect(text.charCodeAt(223)).toBeGreaterThanOrEqual(0xdc00)
    expect(text.charCodeAt(240)).toBeGreaterThanOrEqual(0xdc00)
    const offered = buildTranscriptSpanOffer(
      [chunk("amharic-chunk", text)],
      context,
    )
    const spans = offered.promptChunks[0]!.spans
    expect(spans.length).toBeGreaterThan(1)
    for (const span of spans) {
      expect(span.text).toBe(text.slice(span.start, span.end))
      expect(span.text).toBe(span.text.trim())
      expect(span.text.length).toBeGreaterThanOrEqual(8)
      expect(span.text.length).toBeLessThanOrEqual(240)
      expect(wellFormedUtf16(span.text)).toBe(true)
      expect(/^[a-f0-9]{32}$/u.test(span.id)).toBe(true)
      expect(offered.resolve(span.id)).toEqual({
        chunkId: "amharic-chunk",
        excerpt: span.text,
      })
    }
    for (let index = 0; index < text.length; index += 1) {
      if (text[index]!.trim() === "") continue
      expect(
        spans.some((span) => span.start <= index && index < span.end),
      ).toBe(true)
    }
    expect(spans.some((span) => span.text.includes("ሰላም"))).toBe(true)
    expect(spans.some((span) => span.text.endsWith("zzzzz"))).toBe(true)
    expect(spans.some((span) => span.end === 239)).toBe(true)
    expect(spans.some((span) => span.start === 222)).toBe(true)
  })

  it("materializes only offered IDs into exact evidence before the strict validator", () => {
    const chunks = [
      chunk("first", "የተለየ ታሪክ እና ትርጉም"),
      chunk("second", "A complete English supporting passage.", "en"),
    ]
    const offered = buildTranscriptSpanOffer(chunks, context)
    const ids = offered.promptChunks.flatMap((item) =>
      item.spans.map((span) => span.id),
    )
    const resolved = materializeSpanJudgment(transcriptChoice(ids), offered)
    expect(resolved).not.toBeNull()
    const passage = resolved!.connections[0]!.evidence
    expect(passage).toMatchObject({
      basis: "transcript",
      passages: [
        { chunkId: "first", excerpt: chunks[0]!.text },
        { chunkId: "second", excerpt: chunks[1]!.text },
      ],
    })
    expect(() =>
      assertEvidence(resolved!.connections[0]!, chunks, candidate),
    ).not.toThrow()
    expect(JSON.stringify(resolved)).not.toContain("spanIds")
  })

  it("rejects foreign or unknown IDs and preserves metadata-only behavior", () => {
    const chunks = [chunk("first", "A complete supporting passage.")]
    const offered = buildTranscriptSpanOffer(chunks, context)
    const originalId = offered.promptChunks[0]!.spans[0]!.id
    for (const changed of [
      { candidateVideoId: "another-target" },
      { sourceVideoId: "another-source" },
      { afterChunkId: "another-page" },
      { inputCutoff: "2026-10-07T00:00:00.000Z" },
      { generationInputDigest: "b".repeat(64) },
    ]) {
      const foreign = buildTranscriptSpanOffer(chunks, {
        ...context,
        ...changed,
      })
      expect(foreign.resolve(originalId)).toBeUndefined()
      expect(
        materializeSpanJudgment(transcriptChoice([originalId]), foreign),
      ).toBeNull()
    }
    expect(offered.resolve("f".repeat(32))).toBeUndefined()
    const differentTranscript = buildTranscriptSpanOffer(
      [{ ...chunks[0]!, transcriptId: "other-transcript" }],
      context,
    )
    expect(differentTranscript.resolve(originalId)).toBeUndefined()
    const metadata = spanJudgmentSchema.parse({
      connections: [
        {
          kind: "alternative",
          relationship: "shared theme",
          reasonEnglish: "The title offers a useful contrasting story.",
          addedViewingValueEnglish: null,
          evidence: { basis: "metadata", fields: ["title"] },
          strength: 50,
        },
      ],
    })
    expect(
      materializeSpanJudgment(metadata, offered)?.connections[0]?.evidence,
    ).toEqual({
      basis: "metadata",
      fields: ["title"],
    })
  })

  it("keeps too-short complete chunks visible without inventing a support ID", () => {
    const offered = buildTranscriptSpanOffer([chunk("short", "ሰላም")], context)
    expect(offered.promptChunks[0]).toMatchObject({
      language: "am",
      unquotableSegments: ["ሰላም"],
      spans: [],
    })
    expect(
      materializeSpanJudgment(transcriptChoice(["f".repeat(32)]), offered),
    ).toBeNull()
  })
})
