import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  importDigest,
  physicalCallRow,
  physicalCallSchema,
  sharedImportSubmissionSchema,
  sharedManifestSchema,
  sharedSourceSchema,
  validatePhysicalCall,
  validateSharedManifest,
  validateSharedSource,
  type SharedImportManifest,
  type SharedImportSource,
} from "./shared-reading-import-contract"

const hash = "a".repeat(64)
function manifest(): SharedImportManifest {
  return sharedManifestSchema.parse({
    version: "shared-reading-v1",
    scope: "private_pilot",
    modelId: "gpt-6-astra",
    inputCutoff: "2026-10-19T00:00:00Z",
    corpusFileSha256: hash,
    corpusDigest: hash,
    referenceDigest: hash,
    eligibleVideoIds: ["source", "target", "alternate"],
    sources: [
      {
        sourceVideoId: "source",
        payloadDigest: hash,
        fewerThanFiveReason: "Only one adequately supported connection.",
      },
    ],
    calls: [{ origin: hash, payloadDigest: hash, rowDigest: hash }],
    provenance: {},
  })
}
function source(): SharedImportSource {
  const witness = (videoId: string) => ({
    videoId,
    coreId: videoId + "-core",
    slug: videoId,
    metadata: {
      title: videoId,
      description: "Literal <script>never execute</script> text",
      keywords: [],
      bibleCitations: [],
    },
    chunks: [
      {
        id: "subtitle-" + videoId,
        transcriptId: videoId + "-edition",
        language: "en",
        text: videoId + " exact original quoted words",
      },
    ],
  })
  return sharedSourceSchema.parse({
    sourceVideoId: "source",
    fewerThanFiveReason: "Only one adequately supported connection.",
    recommendations: [
      {
        sourceVideoId: "source",
        targetVideoId: "target",
        rank: 1,
        connection:
          "A meaningful directional connection, not an eligibility gate.",
        watchingValue:
          "The target supplies concrete context absent from the source.",
        sourceEvidence: {
          basis: "transcript",
          passages: [
            {
              chunkId: "subtitle-source",
              excerpt: "source exact original quoted words",
            },
          ],
        },
        targetEvidence: {
          basis: "transcript",
          passages: [
            {
              chunkId: "subtitle-target",
              excerpt: "target exact original quoted words",
            },
          ],
        },
      },
    ],
    witnesses: [witness("source"), witness("target")],
    provenance: {},
  })
}

describe("independent shared-reading import boundaries", () => {
  it("keeps commitments stable through JSON object-key reordering but detects value/array changes", () => {
    expect(importDigest({ a: [1, 2], nested: { z: "exact", b: true } })).toBe(
      importDigest({ nested: { b: true, z: "exact" }, a: [1, 2] }),
    )
    expect(importDigest({ a: [1, 2] })).not.toBe(importDigest({ a: [2, 1] }))
    expect(importDigest({ quote: "exact" })).not.toBe(
      importDigest({ quote: "altered" }),
    )
  })
  it("preserves long exact text, private subtitle IDs and explicit metadata values", () => {
    const s = source()
    s.witnesses[1].chunks = []
    s.recommendations[0].connection = "Specific explanation. ".repeat(90)
    s.recommendations[0].targetEvidence = {
      basis: "metadata",
      fields: [
        { field: "description", value: s.witnesses[1].metadata.description! },
      ],
    }
    const input = {
      action: "shared_reading_source",
      generationId: "private",
      inputDigest: hash,
      source: s,
    }
    expect(sharedImportSubmissionSchema.parse(input)).toEqual(input)
    expect(() => validateSharedSource(s, manifest())).not.toThrow()
  })
  it("allows distinct related chapters and independent reverse direction", () => {
    const s = source(),
      m = manifest()
    s.witnesses[1].metadata.title = "Source — a distinct chapter"
    expect(() => validateSharedSource(s, m)).not.toThrow()
    const reverse = structuredClone(s)
    reverse.sourceVideoId = "target"
    reverse.recommendations[0] = {
      ...s.recommendations[0],
      sourceVideoId: "target",
      targetVideoId: "source",
      sourceEvidence: s.recommendations[0].targetEvidence,
      targetEvidence: s.recommendations[0].sourceEvidence,
    }
    m.sources.push({ ...m.sources[0], sourceVideoId: "target" })
    expect(() => validateSharedSource(reverse, m)).not.toThrow()
  })
  it.each(["id", "core", "slug"])("rejects self/equal %s identity", (kind) => {
    const s = source()
    if (kind === "id") s.recommendations[0].targetVideoId = "source"
    if (kind === "core") s.witnesses[1].coreId = s.witnesses[0].coreId
    if (kind === "slug") s.witnesses[1].slug = s.witnesses[0].slug
    expect(() => validateSharedSource(s, manifest())).toThrow()
  })
  it.each(["core", "slug"])(
    "rejects two distinct target IDs equal by %s",
    (kind) => {
      const s = source(),
        alternate = structuredClone(s.witnesses[1])
      alternate.videoId = "alternate"
      alternate.chunks[0].id = "subtitle-alternate"
      alternate.chunks[0].transcriptId = "alternate-edition"
      if (kind === "core") alternate.slug = "alternate"
      else alternate.coreId = "alternate-core"
      s.witnesses.push(alternate)
      s.recommendations.push({
        ...structuredClone(s.recommendations[0]),
        targetVideoId: "alternate",
        targetEvidence: {
          basis: "transcript",
          passages: [
            {
              chunkId: "subtitle-alternate",
              excerpt: alternate.chunks[0].text,
            },
          ],
        },
        rank: 2,
      })
      expect(() => validateSharedSource(s, manifest())).toThrow()
    },
  )
  it.each(["owner", "quote", "metadata", "rank"])(
    "rejects corrupt %s association",
    (kind) => {
      const s = source(),
        rec = s.recommendations[0]
      if (kind === "owner") rec.targetEvidence = rec.sourceEvidence
      if (kind === "quote")
        rec.targetEvidence = {
          basis: "transcript",
          passages: [
            {
              chunkId: "subtitle-target",
              excerpt: "Invented quote absent from original",
            },
          ],
        }
      if (kind === "metadata")
        rec.targetEvidence = {
          basis: "metadata",
          fields: [{ field: "title", value: "Incorrect title" }],
        }
      if (kind === "rank") rec.rank = 2
      expect(() => validateSharedSource(s, manifest())).toThrow()
    },
  )
  it("requires a substantive shortfall for a completed zero-choice source", () => {
    const s = source()
    s.recommendations = []
    expect(() => validateSharedSource(s, manifest())).not.toThrow()
    s.fewerThanFiveReason = null
    expect(() => validateSharedSource(s, manifest())).toThrow()
  })
  it("does not upgrade a pilot subset into full catalog or duplicate origins", () => {
    const m = manifest()
    expect(() => validateSharedManifest(m)).not.toThrow()
    m.scope = "full_catalog"
    expect(() => validateSharedManifest(m)).toThrow()
    m.sources = m.eligibleVideoIds.map((sourceVideoId) => ({
      ...m.sources[0],
      sourceVideoId,
    }))
    expect(() => validateSharedManifest(m)).not.toThrow()
    m.calls.push(m.calls[0])
    expect(() => validateSharedManifest(m)).toThrow()
  })
  it("distinguishes known failed usage from unknown and mismatched counters", () => {
    const receipt = {
      origin: hash,
      requestDigest: hash,
      modelId: "gpt-6-astra",
      reserved: true,
      consumptionUnknown: false,
      finishedAt: "2026-10-19T00:01:00Z",
      status: "failed",
      responseDigest: null,
      usage: {
        inputTokens: 123,
        outputTokens: 4,
        cachedInputTokens: 10,
        reasoningTokens: 2,
      },
    }
    const call = physicalCallSchema.parse({
      origin: hash,
      sourceVideoId: "source",
      sourceVideoIds: ["source"],
      stage: "shared_read",
      status: "failed",
      modelId: "gpt-6-astra",
      requestDigest: hash,
      responseDigest: null,
      receiptDigest: createHash("sha256")
        .update(JSON.stringify(receipt))
        .digest("hex"),
      ...receipt.usage,
      startedAt: "2026-10-19T00:00:00Z",
      finishedAt: "2026-10-19T00:01:00Z",
      originalRunDirectory: "/frozen/run",
      originalAttemptPath: "calls/read/a0000",
      originalManifestDigest: hash,
      reservationDigest: hash,
      receiptJson: JSON.stringify(receipt),
    })
    expect(() => validatePhysicalCall(call, manifest())).not.toThrow()
    // An eligible recommendation target need not participate as a declared source.
    expect(() => validateSharedSource(source(), manifest())).not.toThrow()
    expect(() =>
      validatePhysicalCall(
        { ...call, sourceVideoIds: ["source", "target"] },
        manifest(),
      ),
    ).toThrow()
    expect(() =>
      validatePhysicalCall(
        {
          ...call,
          receiptJson: JSON.stringify({ ...receipt, consumptionUnknown: true }),
          receiptDigest: createHash("sha256")
            .update(JSON.stringify({ ...receipt, consumptionUnknown: true }))
            .digest("hex"),
        },
        manifest(),
      ),
    ).toThrow()
    expect(() =>
      validatePhysicalCall(
        { ...call, receiptJson: call.receiptJson + " " },
        manifest(),
      ),
    ).toThrow()
    expect(() =>
      validatePhysicalCall({ ...call, inputTokens: 0 }, manifest()),
    ).toThrow()
    expect(() =>
      validatePhysicalCall({ ...call, cachedInputTokens: 124 }, manifest()),
    ).toThrow()
    expect(() =>
      physicalCallSchema.parse({ ...call, inputTokens: null }),
    ).toThrow()
  })
  it("maps known failed consumption to the existing SQL outcome constraint without losing its private response", () => {
    const receipt = {
      origin: hash,
      requestDigest: hash,
      modelId: "gpt-6-astra",
      reserved: true,
      consumptionUnknown: false,
      finishedAt: "2026-10-19T00:01:00Z",
      status: "failed",
      responseDigest: null,
      usage: {
        inputTokens: 123,
        outputTokens: 4,
        cachedInputTokens: 10,
        reasoningTokens: 2,
      },
    }
    const call = physicalCallSchema.parse({
      origin: hash,
      sourceVideoId: "source",
      sourceVideoIds: ["source"],
      stage: "shared_read",
      status: "failed",
      modelId: "gpt-6-astra",
      requestDigest: hash,
      responseDigest: null,
      receiptDigest: createHash("sha256")
        .update(JSON.stringify(receipt))
        .digest("hex"),
      ...receipt.usage,
      startedAt: "2026-10-19T00:00:00Z",
      finishedAt: "2026-10-19T00:01:00Z",
      originalRunDirectory: "/frozen/run",
      originalAttemptPath: "calls/read/a0000",
      originalManifestDigest: hash,
      reservationDigest: hash,
      receiptJson: JSON.stringify(receipt),
    })
    const failedReceipt = JSON.stringify({
      ...receipt,
      responseDigest: hash,
      code: "semantic_validation_failed",
    })
    call.receiptJson = failedReceipt
    call.receiptDigest = createHash("sha256")
      .update(failedReceipt)
      .digest("hex")
    call.responseDigest = hash
    expect(() => validatePhysicalCall(call, manifest())).not.toThrow()
    // 0135_precomputed_durable_build: failed => output_digest NULL and error_code NOT NULL.
    expect(physicalCallRow(call)).toMatchObject({
      status: "failed",
      outputDigest: null,
      errorCode: expect.stringMatching(/\S/u),
      inputTokens: 123,
      outputTokens: 4,
    })
    expect(JSON.parse(call.receiptJson).responseDigest).toBe(hash)
  })
})
