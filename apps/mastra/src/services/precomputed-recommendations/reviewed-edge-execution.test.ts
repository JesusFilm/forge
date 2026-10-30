import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { runEdgeBatch, type EdgeBatchInput } from "./edge-batch-executor"
import { decodeEdgePrompt } from "./edge-prompt-renderer"
import { REVIEWED_EDGE_RECOVERIES } from "./reviewed-edge-recoveries"
import type { Video } from "./source-generation"

// Page/rank metadata sealed by the production incident evidence, independently
// of the producer manifest. No transcripts, profiles or account data are copied.
const pages = [
  [
    { pageIndex: 0, startRank: 0 },
    { pageIndex: 0, startRank: 0 },
  ],
  [{ pageIndex: 10, startRank: 54 }],
  [
    { pageIndex: 8, startRank: 43 },
    { pageIndex: 8, startRank: 35 },
  ],
  [{ pageIndex: 8, startRank: 40 }],
  [{ pageIndex: 4, startRank: 15 }],
  [
    { pageIndex: 6, startRank: 24 },
    { pageIndex: 6, startRank: 20 },
  ],
  [{ pageIndex: 8, startRank: 25 }],
  [
    { pageIndex: 8, startRank: 28 },
    { pageIndex: 8, startRank: 25 },
  ],
]

const excerpt = "Forgiveness can restore trust between people. "
  .repeat(5)
  .trim()

function video(id: string): Video {
  return {
    id,
    coreId: id,
    slug: id,
    locale: "en",
    title: `Title ${id}`,
    description: "A film about forgiveness and reconciliation.",
    descriptionTruncated: false,
    keywords: [],
    keywordsTruncated: false,
    bibleCitations: [],
    bibleCitationsTruncated: false,
    parentVideoIds: [],
    childVideoIds: [],
    transcriptLanguages: ["en"],
    transcriptSelection: {
      policy: "english-per-edition-with-complete-fallback-v1",
      availableTranscriptCount: 1,
      incompleteTranscriptCount: 0,
      skippedEditionCount: 0,
      selected: [
        {
          transcriptId: `${id}-transcript`,
          videoEditionId: `${id}-edition`,
          language: "en",
          totalChunks: 1,
        },
      ],
    },
  }
}

function profile(id: string) {
  return {
    state: "ready" as const,
    kind: "transcript" as const,
    cacheKey: createHash("sha256").update(id).digest("hex"),
    profile: {
      version: "complete_profile_v1" as const,
      summaryEnglish:
        "This complete fixture profile describes forgiveness and reconciliation.",
      themes: ["forgiveness"],
      people: [],
      places: [],
      citations: [],
      anchors: [
        {
          videoId: id,
          chunkId: `${id}-chunk`,
          transcriptId: `${id}-transcript`,
          language: "en",
          chunkIndex: 0,
          startChar: 0,
          endChar: excerpt.length,
          textSha256: createHash("sha256").update(excerpt).digest("hex"),
          claimEnglish: "Forgiveness can restore a damaged relationship.",
        },
      ],
    },
  }
}

function fixture(index: number) {
  const scope = REVIEWED_EDGE_RECOVERIES[index]!
  const model = vi.fn(async () => {})
  const start = vi.fn(async () => {})
  const input: EdgeBatchInput = {
    generationId: scope.generationId,
    generationInputDigest: scope.generationInputDigest,
    attemptId: "11111111-1111-4111-8111-111111111111",
    callId: "22222222-2222-4222-8222-222222222222",
    inputCutoff: "2026-10-13T10:12:46.679Z",
    selectedCorpusDigest: "a".repeat(64),
    candidatePoolDigest: "b".repeat(64),
    captureRefDigest: null,
    modelId: "gpt-6-astra",
    backend: "codex_chatgpt_subscription",
    promptVersion: "shared-edge-v1",
    schemaVersion: "shared-edge-schema-v1",
    recovery: {
      originalCallId: scope.originalCallId,
      replacementCallId: "22222222-2222-4222-8222-222222222222",
    },
    members: scope.sources.map((source, memberIndex) => {
      const page = pages[index]![memberIndex]!
      const ids = Array.from(
        { length: source.exclusiveEndRank + 1 },
        (_, rank) => `target-${rank}`,
      )
      return {
        source: video(source.sourceVideoId),
        sourceProfile: profile(source.sourceVideoId),
        orderedCandidateIds: ids,
        ...page,
        pageSize: source.exclusiveEndRank - page.startRank,
        checkpointRevision: page.pageIndex + 1,
        leaseToken: "33333333-3333-4333-8333-333333333333",
        targetsByVideoId: new Map(
          ids.map((id) => [id, { video: video(id), profile: profile(id) }]),
        ),
      }
    }),
    catalog: {
      async video() {
        throw new Error("Unexpected video read")
      },
      async catalog() {
        throw new Error("Unexpected catalog read")
      },
      async chunks({ videoId }) {
        return {
          chunks: [
            {
              id: `${videoId}-chunk`,
              transcriptId: `${videoId}-transcript`,
              language: "en",
              chunkIndex: 0,
              text: excerpt,
            },
          ],
          nextCursor: null,
        }
      },
    },
    model: {
      async generateReserved(request, reserve) {
        const decision = await reserve()
        if (decision.kind === "skip")
          return { kind: "skipped", reservation: decision.reservation }
        await model()
        const wire = JSON.parse(request.prompt)
        expect(wire.encoding).toBe(
          index === 0 ? undefined : "shared-edge-v1-dictionary-1",
        )
        const prompt = decodeEdgePrompt(wire)
        expect(
          prompt.members.map((member) =>
            member.candidates.map((candidate) => candidate.poolRank),
          ),
        ).toEqual(
          input.members.map((member) =>
            Array.from(
              { length: member.pageSize },
              (_, offset) => member.startRank + offset,
            ),
          ),
        )
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: {
            output: request.schema.parse({
              results: input.members.map((member) => ({
                sourceVideoId: member.source.id,
                edges: [],
              })),
            }),
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        }
      },
    },
    persistence: {
      async status(request) {
        return {
          generationId: request.generationId,
          sourceVideoId: request.sourceVideoId,
          sourceState: "claimed",
          checkpointRevision: input.members.find(
            (member) => member.source.id === request.sourceVideoId,
          )!.checkpointRevision,
          sourceCandidateCount: null,
          sourceCandidateDigest: null,
          calls: [],
          nextCursor: null,
        }
      },
      async start(request) {
        await start()
        expect(
          request.members.map((member) => ({
            sourceVideoId: member.sourceVideoId,
            pageIndex: member.pageIndex,
            firstRank: member.candidates[0]!.poolRank,
            count: member.candidates.length,
          })),
        ).toEqual(
          input.members.map((member) => ({
            sourceVideoId: member.source.id,
            pageIndex: member.pageIndex,
            firstRank: member.startRank,
            count: member.pageSize,
          })),
        )
        return {
          generationId: request.generationId,
          callId: request.callId,
          state: "pending",
          replay: false,
          members: request.members.map((member) => ({
            sourceVideoId: member.sourceVideoId,
            applicationState: "pending",
            appliedRevision: null,
            checkpointRevision: member.checkpointRevision,
          })),
        }
      },
      async finish(request) {
        expect(request.status).toBe("succeeded")
        expect(request.usage).toEqual({ inputTokens: 100, outputTokens: 20 })
        return {
          generationId: request.generationId,
          callId: request.callId,
          state: "succeeded",
          replay: false,
          receiptStored: true,
          members: input.members.map((member) => ({
            sourceVideoId: member.source.id,
            applicationState: "applied_empty",
            appliedRevision: member.checkpointRevision + 1,
            checkpointRevision: member.checkpointRevision + 1,
          })),
        }
      },
      async closeEmpty() {
        throw new Error("Recovery page is nonempty")
      },
      async finalizeSource() {
        throw new Error("Recovery does not finalize")
      },
    },
  }
  return { input, model, start }
}

describe("reviewed recovery execution", () => {
  it.each(
    REVIEWED_EDGE_RECOVERIES.map((scope, index) => ({
      callId: scope.originalCallId,
      index,
    })),
  )("executes the exact reviewed page for $callId", async ({ index }) => {
    const f = fixture(index)
    expect((await runEdgeBatch(f.input)).state).toBe("succeeded")
    expect(f.model).toHaveBeenCalledTimes(1)
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it.each([
    "generation",
    "digest",
    "source",
    "page",
    "rank",
    "count",
    "replacement",
    "original",
  ] as const)("rejects changed %s before reservation", async (field) => {
    const f = fixture(1)
    if (field === "generation") f.input.generationId = "unreviewed-generation"
    if (field === "digest") f.input.generationInputDigest = "c".repeat(64)
    if (field === "source") f.input.members[0]!.source.id = "unreviewed-source"
    if (field === "page") f.input.members[0]!.pageIndex++
    if (field === "rank") f.input.members[0]!.startRank--
    if (field === "count") f.input.members[0]!.pageSize--
    if (field === "replacement")
      f.input.callId = "44444444-4444-4444-8444-444444444444"
    if (field === "original")
      f.input.recovery!.originalCallId = "44444444-4444-4444-8444-444444444444"
    await expect(runEdgeBatch(f.input)).rejects.toMatchObject({
      code: "input_invalid",
    })
    expect(f.start).not.toHaveBeenCalled()
    expect(f.model).not.toHaveBeenCalled()
  })
})
