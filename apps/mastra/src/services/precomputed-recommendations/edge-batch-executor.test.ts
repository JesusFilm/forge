import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"

import {
  finalizeEdgeSource,
  planEdgeMemberPage,
  runEdgeBatch as runEdgeBatchActual,
  type EdgeBatchInput,
} from "./edge-batch-executor"
import type { Video } from "./source-generation"
import type { HistoricalSnapshot } from "./historical-analytics"
import type { StructuredModel } from "./astra-provider"
import type { ReservationAwareStructuredModel } from "./codex-subscription-astra"

type FixtureInput = Omit<EdgeBatchInput, "model"> & { model: StructuredModel }

function runEdgeBatch(input: FixtureInput) {
  const model: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const decision = await reserve()
      if (decision.kind === "skip")
        return { kind: "skipped", reservation: decision.reservation }
      return {
        kind: "dispatched",
        reservation: decision.reservation,
        response: await input.model.generate(request),
      }
    },
  }
  return runEdgeBatchActual({ ...input, model })
}

function video(id: string): Video {
  return {
    id,
    coreId: id,
    slug: id,
    locale: "en",
    title: `Title for ${id}`,
    description: `Description for ${id}`,
    descriptionTruncated: false,
    keywords: [],
    keywordsTruncated: false,
    bibleCitations: [],
    bibleCitationsTruncated: false,
    parentVideoIds: [],
    childVideoIds: [],
    transcriptLanguages: [],
    transcriptSelection: {
      policy: "english-per-edition-with-complete-fallback-v1",
      availableTranscriptCount: 0,
      incompleteTranscriptCount: 0,
      skippedEditionCount: 0,
      selected: [],
    },
  }
}

function readyProfile(id: string) {
  return {
    state: "ready" as const,
    kind: "metadata_only" as const,
    cacheKey: createHash("sha256").update(id).digest("hex"),
    profile: null,
  }
}

const identity = {
  generationId: "generation-one",
  generationInputDigest: "a".repeat(64),
  attemptId: "11111111-1111-4111-8111-111111111111",
  callId: "22222222-2222-4222-8222-222222222222",
  inputCutoff: "2026-10-06T20:48:05.001Z",
  selectedCorpusDigest: "b".repeat(64),
  candidatePoolDigest: "c".repeat(64),
  captureRefDigest: null,
  modelId: "gpt-6-astra" as const,
  backend: "codex_chatgpt_subscription" as const,
  promptVersion: "shared-edge-v1",
  schemaVersion: "shared-edge-schema-v1",
}

describe("shared edge batch candidate pages", () => {
  it("keeps all frozen candidates across contiguous eight-slot pages", () => {
    const orderedCandidateIds = Array.from(
      { length: 9 },
      (_, index) => `target-${index}`,
    )
    const profileKeysByVideoId = new Map(
      orderedCandidateIds.map((id) => [id, readyProfile(id).cacheKey]),
    )
    const first = planEdgeMemberPage({
      sourceVideoId: "source-one",
      orderedCandidateIds,
      profileKeysByVideoId,
      pageIndex: 0,
      startRank: 0,
      pageSize: 8,
    })
    const second = planEdgeMemberPage({
      sourceVideoId: "source-one",
      orderedCandidateIds,
      profileKeysByVideoId,
      pageIndex: 1,
      startRank: 8,
      pageSize: 1,
    })
    expect(first.sourceCandidateCount).toBe(9)
    expect(second.sourceCandidateDigest).toBe(first.sourceCandidateDigest)
    expect(first.candidates.map((candidate) => candidate.poolRank)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    expect(second.candidates).toEqual([
      {
        targetVideoId: "target-8",
        targetProfileKey: readyProfile("target-8").cacheKey,
        poolRank: 8,
      },
    ])
    expect(second.candidatePageDigest).not.toBe(first.candidatePageDigest)
    expect(() =>
      planEdgeMemberPage({
        sourceVideoId: "source-one",
        orderedCandidateIds,
        profileKeysByVideoId,
        pageIndex: 2,
        startRank: 9,
        pageSize: 1,
      }),
    ).toThrowError("candidate_page_invalid")
  })

  it("closes a genuinely zero-candidate source without a model call", async () => {
    const actions: string[] = []
    const result = await runEdgeBatch({
      ...identity,
      members: [
        {
          source: video("source-one"),
          sourceProfile: {
            state: "ready",
            kind: "metadata_only",
            cacheKey: readyProfile("source-one").cacheKey,
            profile: null,
          },
          orderedCandidateIds: [],
          pageIndex: 0,
          startRank: 0,
          pageSize: 0,
          leaseToken: "33333333-3333-4333-8333-333333333333",
          checkpointRevision: 0,
          targetsByVideoId: new Map(),
        },
      ],
      catalog: {
        async video() {
          throw new Error("no catalog video read expected")
        },
        async catalog() {
          throw new Error("no catalog scan expected")
        },
        async chunks() {
          throw new Error("no transcript read expected")
        },
      },
      model: {
        async generate(): Promise<never> {
          actions.push("model")
          throw new Error("zero-candidate source cannot invoke a model")
        },
      },
      persistence: {
        async status() {
          throw new Error("no batch status needed")
        },
        async start() {
          throw new Error("no batch reservation expected")
        },
        async finish() {
          throw new Error("no batch receipt expected")
        },
        async closeEmpty(input) {
          actions.push(input.action)
          expect(input.sourceCandidateCount).toBe(0)
          expect(input.sourceCandidateDigest).toMatch(/^[a-f0-9]{64}$/u)
          return {
            generationId: input.generationId,
            sourceVideoId: input.sourceVideoId,
            sourceState: "complete_empty" as const,
            acceptedCount: 0,
            checkpointRevision: 1,
            replay: false,
          }
        },
        async finalizeSource() {
          throw new Error("zero-candidate source cannot finalize pages")
        },
      },
    })
    expect(result).toMatchObject({ state: "no_call" })
    expect(actions).toEqual(["edge_source_close_empty"])
  })

  it("persists one shared usage receipt for two members with multiple and empty results", async () => {
    const actions: string[] = []
    const targets = (ids: string[]) =>
      new Map(
        ids.map((id) => [id, { video: video(id), profile: readyProfile(id) }]),
      )
    const result = await runEdgeBatch({
      ...identity,
      members: [
        {
          source: video("source-one"),
          sourceProfile: readyProfile("source-one"),
          orderedCandidateIds: ["target-one", "target-two"],
          pageIndex: 0,
          startRank: 0,
          pageSize: 2,
          leaseToken: "33333333-3333-4333-8333-333333333333",
          checkpointRevision: 0,
          targetsByVideoId: targets(["target-one", "target-two"]),
        },
        {
          source: video("source-two"),
          sourceProfile: readyProfile("source-two"),
          orderedCandidateIds: ["target-three"],
          pageIndex: 0,
          startRank: 0,
          pageSize: 1,
          leaseToken: "44444444-4444-4444-8444-444444444444",
          checkpointRevision: 0,
          targetsByVideoId: targets(["target-three"]),
        },
      ],
      catalog: {
        async video() {
          throw new Error("no catalog video read expected")
        },
        async catalog() {
          throw new Error("no catalog scan expected")
        },
        async chunks() {
          throw new Error("metadata evidence needs no transcript read")
        },
      },
      model: {
        async generate(input) {
          actions.push("model")
          expect(input.system).toContain("no six-card quota")
          return {
            output: input.schema.parse({
              results: [
                {
                  sourceVideoId: "source-one",
                  edges: [
                    {
                      targetVideoId: "target-one",
                      kind: "direct",
                      relationship: "Shared question",
                      reasonEnglish: "Both videos explore a shared question.",
                      addedViewingValueEnglish: null,
                      strength: 91,
                      evidence: { basis: "metadata", fields: ["title"] },
                    },
                    {
                      targetVideoId: "target-two",
                      kind: "alternative",
                      relationship: "Useful next step",
                      reasonEnglish: "The next video extends the same idea.",
                      addedViewingValueEnglish: null,
                      strength: 67,
                      evidence: { basis: "metadata", fields: ["description"] },
                    },
                  ],
                },
                { sourceVideoId: "source-two", edges: [] },
              ],
            }),
            usage: { inputTokens: 600, outputTokens: 95 },
          }
        },
      },
      persistence: {
        async status(input) {
          expect(Object.keys(input).sort()).toEqual(
            [
              "action",
              "generationId",
              "generationInputDigest",
              "sourceVideoId",
            ].sort(),
          )
          actions.push(`status:${input.sourceVideoId}`)
          return {
            generationId: input.generationId,
            sourceVideoId: input.sourceVideoId,
            sourceState: "claimed",
            checkpointRevision: 0,
            sourceCandidateCount: null,
            sourceCandidateDigest: null,
            calls: [],
            nextCursor: null,
          }
        },
        async start(input) {
          actions.push(input.action)
          expect(input.members.map((member) => member.sourceVideoId)).toEqual([
            "source-one",
            "source-two",
          ])
          expect(
            input.members.map((member) => member.candidates.length),
          ).toEqual([2, 1])
          expect(input.spanOffers).toEqual([])
          return {
            generationId: input.generationId,
            callId: input.callId,
            state: "pending" as const,
            replay: false,
            members: input.members.map((member) => ({
              sourceVideoId: member.sourceVideoId,
              applicationState: "pending" as const,
              appliedRevision: null,
              checkpointRevision: member.checkpointRevision,
            })),
          }
        },
        async finish(input) {
          actions.push(input.action)
          expect(input.status).toBe("succeeded")
          expect(input.usage).toEqual({ inputTokens: 600, outputTokens: 95 })
          expect(input.results?.map((result) => result.choices.length)).toEqual(
            [2, 0],
          )
          expect(input.results?.[0]?.choices[0]).toMatchObject({
            kind: "direct",
            targetVideoId: "target-one",
            evidence: { basis: "metadata", fields: ["title"] },
          })
          expect(input.results?.[0]?.choices[0]).not.toHaveProperty(
            "addedViewingValueEnglish",
          )
          return {
            generationId: input.generationId,
            callId: input.callId,
            state: "succeeded" as const,
            receiptStored: true as const,
            replay: false,
            members: [
              {
                sourceVideoId: "source-one",
                applicationState: "applied_edges" as const,
                appliedRevision: 1,
                checkpointRevision: 1,
              },
              {
                sourceVideoId: "source-two",
                applicationState: "applied_empty" as const,
                appliedRevision: 1,
                checkpointRevision: 1,
              },
            ],
          }
        },
        async closeEmpty() {
          throw new Error("nonempty page cannot close zero")
        },
        async finalizeSource() {
          throw new Error("batch call does not finalize source")
        },
      },
    })
    expect(result).toMatchObject({ state: "succeeded", replay: false })
    expect(actions).toEqual([
      "status:source-one",
      "status:source-two",
      "edge_batch_start",
      "model",
      "edge_batch_finish",
    ])
  })

  it("offers a verified non-English span transiently and persists only its canonical excerpt", async () => {
    const excerpt = "Jesús habló de una vida nueva."
    const target = {
      ...video("target-es"),
      locale: "es",
      transcriptLanguages: ["es"],
      transcriptSelection: {
        policy: "english-per-edition-with-complete-fallback-v1" as const,
        availableTranscriptCount: 1,
        incompleteTranscriptCount: 0,
        skippedEditionCount: 0,
        selected: [
          {
            transcriptId: "transcript-es",
            videoEditionId: "edition-es",
            language: "es",
            totalChunks: 1,
          },
        ],
      },
    }
    const targetProfile = {
      state: "ready" as const,
      kind: "transcript" as const,
      cacheKey: readyProfile("target-es").cacheKey,
      profile: {
        version: "complete_profile_v1" as const,
        summaryEnglish: "Jesus describes a new life to a listener.",
        themes: ["new life"],
        people: ["Jesus"],
        places: [],
        citations: [],
        anchors: [
          {
            videoId: "target-es",
            chunkId: "chunk-es",
            transcriptId: "transcript-es",
            language: "es",
            chunkIndex: 0,
            startChar: 0,
            endChar: excerpt.length,
            textSha256: createHash("sha256").update(excerpt).digest("hex"),
            claimEnglish: "Jesus speaks of a new life.",
          },
        ],
      },
    }
    const result = await runEdgeBatch({
      ...identity,
      members: [
        {
          source: video("source-one"),
          sourceProfile: readyProfile("source-one"),
          orderedCandidateIds: ["target-es"],
          pageIndex: 0,
          startRank: 0,
          pageSize: 1,
          leaseToken: "33333333-3333-4333-8333-333333333333",
          checkpointRevision: 0,
          targetsByVideoId: new Map([
            ["target-es", { video: target, profile: targetProfile }],
          ]),
        },
      ],
      catalog: {
        async video() {
          throw new Error("no video read expected")
        },
        async catalog() {
          throw new Error("no scan expected")
        },
        async chunks(input) {
          expect(input.videoId).toBe("target-es")
          return {
            chunks: [
              {
                id: "chunk-es",
                transcriptId: "transcript-es",
                language: "es",
                chunkIndex: 0,
                text: excerpt,
              },
            ],
            nextCursor: null,
          }
        },
      },
      model: {
        async generate(input) {
          const prompt = JSON.parse(input.prompt)
          expect(prompt.spanOffers).toHaveLength(1)
          expect(prompt.spanOffers[0].excerpt).toBe(excerpt)
          expect(prompt.spanOffers[0].language).toBe("es")
          return {
            output: input.schema.parse({
              results: [
                {
                  sourceVideoId: "source-one",
                  edges: [
                    {
                      targetVideoId: "target-es",
                      kind: "direct",
                      relationship: "Shared renewal theme",
                      reasonEnglish:
                        "This Spanish passage explores renewal in a related story.",
                      addedViewingValueEnglish: null,
                      strength: 85,
                      evidence: {
                        basis: "transcript",
                        spanIds: [prompt.spanOffers[0].spanId],
                      },
                    },
                  ],
                },
              ],
            }),
            usage: { inputTokens: 400, outputTokens: 60 },
          }
        },
      },
      persistence: {
        async status(input) {
          return {
            generationId: input.generationId,
            sourceVideoId: input.sourceVideoId,
            sourceState: "claimed",
            checkpointRevision: 0,
            sourceCandidateCount: null,
            sourceCandidateDigest: null,
            calls: [],
            nextCursor: null,
          }
        },
        async start(input) {
          expect(input.spanOffers).toHaveLength(1)
          expect(JSON.stringify(input)).not.toContain(excerpt)
          expect(input.spanOffers[0]).toMatchObject({
            videoId: "target-es",
            chunkId: "chunk-es",
          })
          return {
            generationId: input.generationId,
            callId: input.callId,
            state: "pending" as const,
            replay: false,
            members: [
              {
                sourceVideoId: "source-one",
                applicationState: "pending" as const,
                appliedRevision: null,
                checkpointRevision: 0,
              },
            ],
          }
        },
        async finish(input) {
          expect(input.status).toBe("succeeded")
          expect(input.results?.[0]?.choices[0]?.evidence).toMatchObject({
            basis: "transcript",
            passages: [{ chunkId: "chunk-es", excerpt }],
          })
          return {
            generationId: input.generationId,
            callId: input.callId,
            state: "succeeded" as const,
            receiptStored: true as const,
            replay: false,
            members: [
              {
                sourceVideoId: "source-one",
                applicationState: "applied_edges" as const,
                appliedRevision: 1,
                checkpointRevision: 1,
              },
            ],
          }
        },
        async closeEmpty() {
          throw new Error("nonempty")
        },
        async finalizeSource() {
          throw new Error("batch call does not finalize source")
        },
      },
    })
    expect(result.state).toBe("succeeded")
  })

  it("preflights two rich eight-target pages within the bounded span budget", async () => {
    const excerpt = "A meaningful line of dialogue."
    const transcriptVideo = (id: string): Video => ({
      ...video(id),
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
            totalChunks: 5,
          },
        ],
      },
    })
    const transcriptProfile = (id: string) => ({
      state: "ready" as const,
      kind: "transcript" as const,
      cacheKey: readyProfile(id).cacheKey,
      profile: {
        version: "complete_profile_v1" as const,
        summaryEnglish: `A complete summary for ${id}.`,
        themes: ["shared theme"],
        people: [],
        places: [],
        citations: [],
        anchors: Array.from({ length: 5 }, (_, index) => ({
          videoId: id,
          chunkId: `${id}-chunk-${index}`,
          transcriptId: `${id}-transcript`,
          language: "en",
          chunkIndex: index,
          startChar: 0,
          endChar: excerpt.length,
          textSha256: createHash("sha256").update(excerpt).digest("hex"),
          claimEnglish: "A meaningful point in this dialogue.",
        })),
      },
    })
    const member = (sourceId: string, leaseToken: string) => {
      const orderedCandidateIds = Array.from(
        { length: 8 },
        (_, index) => `${sourceId}-target-${index}`,
      )
      return {
        source: transcriptVideo(sourceId),
        sourceProfile: transcriptProfile(sourceId),
        orderedCandidateIds,
        pageIndex: 0,
        startRank: 0,
        pageSize: 8,
        leaseToken,
        checkpointRevision: 0,
        targetsByVideoId: new Map(
          orderedCandidateIds.map((id) => [
            id,
            { video: transcriptVideo(id), profile: transcriptProfile(id) },
          ]),
        ),
      }
    }
    const result = await runEdgeBatch({
      ...identity,
      members: [
        member("source-a", "33333333-3333-4333-8333-333333333333"),
        member("source-b", "44444444-4444-4444-8444-444444444444"),
      ],
      catalog: {
        async video() {
          throw new Error("no video read expected")
        },
        async catalog() {
          throw new Error("no catalog scan expected")
        },
        async chunks(input) {
          return {
            chunks: Array.from({ length: 5 }, (_, index) => ({
              id: `${input.videoId}-chunk-${index}`,
              transcriptId: `${input.videoId}-transcript`,
              language: "en",
              chunkIndex: index,
              text: excerpt,
            })),
            nextCursor: null,
          }
        },
      },
      model: {
        async generate(request) {
          const prompt = JSON.parse(request.prompt)
          expect(prompt.members).toHaveLength(2)
          expect(prompt.members[0].candidates).toHaveLength(8)
          expect(prompt.members[1].candidates).toHaveLength(8)
          expect(prompt.members[0].source.profile.anchors).toHaveLength(5)
          expect(prompt.spanOffers).toHaveLength(64)
          expect(prompt.spanOfferCoverage).toHaveLength(16)
          expect(prompt.spanOfferCoverage[0]).toMatchObject({
            policy: "balanced_verified_anchors_v1",
            sourceAvailable: 5,
            targetAvailable: 5,
            offered: 4,
          })
          return {
            output: request.schema.parse({
              results: [
                { sourceVideoId: "source-a", edges: [] },
                { sourceVideoId: "source-b", edges: [] },
              ],
            }),
            usage: { inputTokens: 5_000, outputTokens: 30 },
          }
        },
      },
      persistence: {
        async status(request) {
          return {
            generationId: request.generationId,
            sourceVideoId: request.sourceVideoId,
            sourceState: "claimed",
            checkpointRevision: 0,
            sourceCandidateCount: null,
            sourceCandidateDigest: null,
            calls: [],
            nextCursor: null,
          }
        },
        async start(request) {
          expect(request.members).toHaveLength(2)
          expect(request.spanOffers).toHaveLength(64)
          return {
            generationId: request.generationId,
            callId: request.callId,
            state: "pending" as const,
            replay: false,
            members: request.members.map((item) => ({
              sourceVideoId: item.sourceVideoId,
              applicationState: "pending" as const,
              appliedRevision: null,
              checkpointRevision: 0,
            })),
          }
        },
        async finish(request) {
          expect(request.status).toBe("succeeded")
          return {
            generationId: request.generationId,
            callId: request.callId,
            state: "succeeded" as const,
            receiptStored: true as const,
            replay: false,
            members: request.results!.map((item) => ({
              sourceVideoId: item.sourceVideoId,
              applicationState: "applied_empty" as const,
              appliedRevision: 1,
              checkpointRevision: 1,
            })),
          }
        },
        async closeEmpty() {
          throw new Error("nonempty")
        },
        async finalizeSource() {
          throw new Error("no finalization")
        },
      },
    })
    expect(result.state).toBe("succeeded")
  })
})

describe("source page finalization", () => {
  it("requires every frozen page to have an applied receipt before finalizing", async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `target-${index}`)
    const keys = new Map(ids.map((id) => [id, readyProfile(id).cacheKey]))
    const first = planEdgeMemberPage({
      sourceVideoId: "source-one",
      orderedCandidateIds: ids,
      profileKeysByVideoId: keys,
      pageIndex: 0,
      startRank: 0,
      pageSize: 3,
    })
    const second = planEdgeMemberPage({
      sourceVideoId: "source-one",
      orderedCandidateIds: ids,
      profileKeysByVideoId: keys,
      pageIndex: 1,
      startRank: 3,
      pageSize: 6,
    })
    let calls = [first, second]
    let finalized = 0
    const port = {
      async status(input: { afterCallId?: string }) {
        expect(Object.keys(input).sort()).toEqual(
          [
            "action",
            "generationId",
            "generationInputDigest",
            "sourceVideoId",
            ...(input.afterCallId ? ["afterCallId"] : []),
          ].sort(),
        )
        const pageCalls = input.afterCallId ? calls.slice(1) : calls.slice(0, 1)
        return {
          generationId: identity.generationId,
          sourceVideoId: "source-one",
          sourceState: "claimed",
          checkpointRevision: 2,
          sourceCandidateCount: 9,
          sourceCandidateDigest: first.sourceCandidateDigest,
          calls: pageCalls.map((page) => ({
            callId: `call-${page.pageIndex}`,
            attemptId: identity.attemptId,
            status: "succeeded" as const,
            applicationState: "applied_edges" as const,
            pageIndex: page.pageIndex,
            candidatePageDigest: page.candidatePageDigest,
            candidates: page.candidates,
            appliedRevision: page.pageIndex + 1,
            startedAt: identity.inputCutoff,
            finishedAt: identity.inputCutoff,
            memberSourceVideoIds: ["source-one"],
          })),
          nextCursor: !input.afterCallId && calls.length > 1 ? "call-0" : null,
        }
      },
      async finalizeSource(input: {
        sourceCandidateCount: number
        sourceCandidateDigest: string
        expectedRevision: number
      }) {
        finalized++
        expect(input).toMatchObject({
          sourceCandidateCount: 9,
          sourceCandidateDigest: first.sourceCandidateDigest,
          expectedRevision: 2,
        })
        return {
          generationId: identity.generationId,
          sourceVideoId: "source-one",
          sourceState: "complete_edges" as const,
          acceptedCount: 2,
          checkpointRevision: 3,
          replay: false,
        }
      },
    }
    const source = {
      generationId: identity.generationId,
      generationInputDigest: identity.generationInputDigest,
      attemptId: identity.attemptId,
      sourceVideoId: "source-one",
      leaseToken: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 2,
      sourceProfileKey: readyProfile("source-one").cacheKey,
      orderedCandidateIds: ids,
      profileKeysByVideoId: keys,
      persistence: port,
    }
    expect(await finalizeEdgeSource(source)).toMatchObject({
      sourceState: "complete_edges",
      acceptedCount: 2,
    })
    expect(finalized).toBe(1)
    calls = [first]
    await expect(finalizeEdgeSource(source)).rejects.toThrowError(
      "candidate_page_invalid",
    )
    expect(finalized).toBe(1)
  })

  it("retries an already finalized source through Admin's idempotent receipt", async () => {
    const ids = ["target-one"]
    const keys = new Map([[ids[0]!, readyProfile(ids[0]!).cacheKey]])
    const page = planEdgeMemberPage({
      sourceVideoId: "source-one",
      orderedCandidateIds: ids,
      profileKeysByVideoId: keys,
      pageIndex: 0,
      startRank: 0,
      pageSize: 1,
    })
    let finalized = 0
    const result = await finalizeEdgeSource({
      generationId: identity.generationId,
      generationInputDigest: identity.generationInputDigest,
      attemptId: identity.attemptId,
      sourceVideoId: "source-one",
      leaseToken: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 1,
      sourceProfileKey: readyProfile("source-one").cacheKey,
      orderedCandidateIds: ids,
      profileKeysByVideoId: keys,
      persistence: {
        async status() {
          return {
            generationId: identity.generationId,
            sourceVideoId: "source-one",
            sourceState: "complete_edges",
            checkpointRevision: 2,
            sourceCandidateCount: 1,
            sourceCandidateDigest: page.sourceCandidateDigest,
            calls: [
              {
                callId: identity.callId,
                attemptId: identity.attemptId,
                status: "succeeded" as const,
                applicationState: "applied_edges" as const,
                pageIndex: 0,
                candidatePageDigest: page.candidatePageDigest,
                candidates: page.candidates,
                appliedRevision: 1,
                startedAt: identity.inputCutoff,
                finishedAt: identity.inputCutoff,
                memberSourceVideoIds: ["source-one"],
              },
            ],
            nextCursor: null,
          }
        },
        async finalizeSource() {
          finalized++
          return {
            generationId: identity.generationId,
            sourceVideoId: "source-one",
            sourceState: "complete_edges" as const,
            acceptedCount: 1,
            checkpointRevision: 2,
            replay: true,
          }
        },
      },
    })
    expect(result.replay).toBe(true)
    expect(finalized).toBe(1)
  })
})

function oneMemberBatch(output: unknown) {
  const finishes: Array<{ status: string; usage: unknown; results?: unknown }> =
    []
  let modelCalls = 0
  const source = video("source-one")
  const target = video("target-one")
  const input: FixtureInput = {
    ...identity,
    members: [
      {
        source,
        sourceProfile: readyProfile(source.id),
        orderedCandidateIds: [target.id],
        pageIndex: 0,
        startRank: 0,
        pageSize: 1,
        leaseToken: "33333333-3333-4333-8333-333333333333",
        checkpointRevision: 0,
        targetsByVideoId: new Map([
          [target.id, { video: target, profile: readyProfile(target.id) }],
        ]),
      },
    ],
    catalog: {
      async video() {
        throw new Error("no video read expected")
      },
      async catalog() {
        throw new Error("no catalog scan expected")
      },
      async chunks() {
        throw new Error("no transcript read expected")
      },
    },
    model: {
      async generate() {
        modelCalls++
        return {
          output: output as never,
          usage: { inputTokens: 100, outputTokens: 20 },
        }
      },
    },
    persistence: {
      async status() {
        return {
          generationId: identity.generationId,
          sourceVideoId: source.id,
          sourceState: "claimed",
          checkpointRevision: 0,
          sourceCandidateCount: null,
          sourceCandidateDigest: null,
          calls: [],
          nextCursor: null,
        }
      },
      async start(request) {
        return {
          generationId: request.generationId,
          callId: request.callId,
          state: "pending",
          replay: false,
          members: [
            {
              sourceVideoId: source.id,
              applicationState: "pending",
              appliedRevision: null,
              checkpointRevision: 0,
            },
          ],
        }
      },
      async finish(request) {
        finishes.push(request)
        return {
          generationId: request.generationId,
          callId: request.callId,
          state: request.status,
          receiptStored: true,
          replay: false,
          members: [
            {
              sourceVideoId: source.id,
              applicationState: "rejected_unapplied",
              appliedRevision: null,
              checkpointRevision: 0,
            },
          ],
        }
      },
      async closeEmpty() {
        throw new Error("nonempty")
      },
      async finalizeSource() {
        throw new Error("no finalization")
      },
    },
  }
  return { input, finishes, modelCalls: () => modelCalls }
}

const validEdge = {
  targetVideoId: "target-one",
  kind: "direct",
  relationship: "A shared topic",
  reasonEnglish: "Both videos discuss the same relevant idea.",
  addedViewingValueEnglish: null,
  strength: 80,
  evidence: { basis: "metadata", fields: ["title"] },
}

describe("shared edge batch rejection and replay", () => {
  it("downsized pages keep the complete frozen candidate identity", async () => {
    const harness = oneMemberBatch({
      results: [{ sourceVideoId: "source-one", edges: [] }],
    })
    const ids = Array.from({ length: 8 }, (_, index) => `target-${index}`)
    const member = harness.input.members[0]!
    member.orderedCandidateIds = ids
    member.pageSize = 8
    member.targetsByVideoId = new Map(
      ids.map((id) => [
        id,
        {
          video: { ...video(id), description: "Long description ".repeat(600) },
          profile: readyProfile(id),
        },
      ]),
    )
    let offered = 0
    let firstPageDigest = ""
    let startedAt = ""
    let sourceDigest = ""
    let firstCandidates: Array<{
      targetVideoId: string
      targetProfileKey: string
      poolRank: number
    }> = []
    const sizes: number[] = []
    const originalStart = harness.input.persistence.start
    harness.input.persistence.start = async (request) => {
      offered = request.members[0]!.candidates.length
      sizes.push(offered)
      if (sizes.length === 1) {
        firstPageDigest = request.members[0]!.candidatePageDigest
        firstCandidates = request.members[0]!.candidates
        startedAt = request.startedAt
        sourceDigest = request.members[0]!.sourceCandidateDigest
      }
      expect(request.members[0]).toMatchObject({
        sourceCandidateCount: 8,
        sourceCandidateDigest: createHash("sha256")
          .update(JSON.stringify(ids))
          .digest("hex"),
      })
      expect(
        request.members[0]!.candidates.map((candidate) => candidate.poolRank),
      ).toEqual(
        Array.from(
          { length: offered },
          (_, index) => request.members[0]!.candidates[0]!.poolRank + index,
        ),
      )
      return originalStart(request)
    }
    const firstResult = await runEdgeBatch(harness.input)
    expect(firstResult.state).toBe("succeeded")
    expect(firstResult.pages[0]?.candidates).toHaveLength(offered)
    expect(offered).toBeGreaterThan(0)
    expect(offered).toBeLessThan(8)
    const firstOffered = offered
    member.pageIndex = 1
    member.startRank = firstOffered
    member.pageSize = 8 - firstOffered
    member.checkpointRevision = 1
    harness.input.callId = "55555555-5555-4555-8555-555555555555"
    harness.input.persistence.status = async () => ({
      generationId: identity.generationId,
      sourceVideoId: "source-one",
      sourceState: "claimed",
      checkpointRevision: 1,
      sourceCandidateCount: 8,
      sourceCandidateDigest: sourceDigest,
      calls: [
        {
          callId: identity.callId,
          attemptId: identity.attemptId,
          status: "succeeded",
          applicationState: "applied_empty",
          pageIndex: 0,
          candidatePageDigest: firstPageDigest,
          candidates: firstCandidates,
          appliedRevision: 1,
          startedAt,
          finishedAt: identity.inputCutoff,
          memberSourceVideoIds: ["source-one"],
        },
      ],
      nextCursor: null,
    })
    const secondResult = await runEdgeBatch(harness.input)
    expect(secondResult.state).toBe("succeeded")
    expect(secondResult.pages[0]?.candidates).toHaveLength(8 - firstOffered)
    expect(sizes).toEqual([firstOffered, 8 - firstOffered])
  })

  it("refuses a still-oversized single pair before any reservation", async () => {
    const harness = oneMemberBatch({
      results: [{ sourceVideoId: "source-one", edges: [] }],
    })
    const member = harness.input.members[0]!
    member.targetsByVideoId = new Map([
      [
        "target-one",
        {
          video: { ...video("target-one"), description: "x".repeat(70_000) },
          profile: readyProfile("target-one"),
        },
      ],
    ])
    harness.input.persistence.start = async () => {
      throw new Error("no reservation permitted")
    }
    await expect(runEdgeBatch(harness.input)).rejects.toThrowError(
      "input_invalid",
    )
    expect(harness.modelCalls()).toBe(0)
    expect(harness.finishes).toEqual([])
  })

  it("passes qualified historical aggregates without individual analytics rows", async () => {
    const harness = oneMemberBatch({
      results: [{ sourceVideoId: "source-one", edges: [] }],
    })
    harness.input.captureRefDigest = "d".repeat(64)
    harness.input.historical = {
      definitionsForModel: {
        provider: "ga_data_api",
        queryId: "watch-referrer-navigation-v1",
        engagement: "Observed Watch video starts, exposures unavailable",
        transitions: "Unavailable: no verified session sequence",
        navigation: "Same-event page referrer, not consecutive playback",
      },
      signal(videoId: string) {
        return {
          videoKey: videoId,
          views: 12,
          engagedViews: null,
          exposures: null,
        }
      },
      transition() {
        return null
      },
      navigation() {
        return 4
      },
    } as unknown as HistoricalSnapshot
    harness.input.model = {
      async generate(request) {
        const prompt = JSON.parse(request.prompt)
        expect(prompt.members[0].historical).toMatchObject({
          sourceEngagement: { videoKey: "source-one", exposures: null },
          candidates: [
            {
              targetVideoId: "target-one",
              consecutivePlayback: null,
              referrerNavigation: 4,
            },
          ],
        })
        expect(request.prompt).not.toContain("queryUsage")
        return {
          output: request.schema.parse({
            results: [{ sourceVideoId: "source-one", edges: [] }],
          }),
          usage: { inputTokens: 100, outputTokens: 20 },
        }
      },
    }
    expect((await runEdgeBatch(harness.input)).state).toBe("succeeded")
    expect(harness.finishes[0]).toMatchObject({ status: "succeeded" })
  })

  it("keeps the full-source historical digest stable across different pages", async () => {
    const harness = oneMemberBatch({
      results: [{ sourceVideoId: "source-one", edges: [] }],
    })
    const member = harness.input.members[0]!
    member.orderedCandidateIds = ["target-one", "target-two"]
    member.targetsByVideoId = new Map(
      member.orderedCandidateIds.map((id) => [
        id,
        { video: video(id), profile: readyProfile(id) },
      ]),
    )
    harness.input.captureRefDigest = "d".repeat(64)
    let targetTwoViews = 20
    harness.input.historical = {
      definitionsForModel: {
        provider: "ga_data_api",
        queryId: "watch-referrer-navigation-v1",
        engagement: "Observed starts, no exposure denominator",
        transitions: "Unavailable",
      },
      signal(videoId: string) {
        return {
          videoKey: videoId,
          views: videoId === "target-two" ? targetTwoViews : 10,
          engagedViews: null,
          exposures: null,
        }
      },
      transition() {
        return null
      },
    } as unknown as HistoricalSnapshot
    const reservations: Array<{
      sourceCandidateDigest: string
      historicalRefDigest: string
      inputDigest: string
    }> = []
    const originalStart = harness.input.persistence.start
    harness.input.persistence.start = async (request) => {
      reservations.push({
        sourceCandidateDigest: request.members[0]!.sourceCandidateDigest,
        historicalRefDigest: request.members[0]!.historicalRefDigest,
        inputDigest: request.inputDigest,
      })
      return originalStart(request)
    }
    await runEdgeBatch(harness.input)
    member.pageIndex = 1
    member.startRank = 1
    member.checkpointRevision = 1
    harness.input.callId = "55555555-5555-4555-8555-555555555555"
    await runEdgeBatch(harness.input)
    expect(reservations[1]!.sourceCandidateDigest).toBe(
      reservations[0]!.sourceCandidateDigest,
    )
    expect(reservations[1]!.historicalRefDigest).toBe(
      reservations[0]!.historicalRefDigest,
    )
    expect(reservations[1]!.inputDigest).not.toBe(reservations[0]!.inputDigest)
    targetTwoViews = 21
    harness.input.callId = "66666666-6666-4666-8666-666666666666"
    await runEdgeBatch(harness.input)
    expect(reservations[2]!.historicalRefDigest).not.toBe(
      reservations[0]!.historicalRefDigest,
    )
  })

  it.each([
    ["missing source", { results: [] }],
    [
      "duplicate target",
      {
        results: [
          { sourceVideoId: "source-one", edges: [validEdge, validEdge] },
        ],
      },
    ],
    [
      "unoffered target",
      {
        results: [
          {
            sourceVideoId: "source-one",
            edges: [{ ...validEdge, targetVideoId: "target-other" }],
          },
        ],
      },
    ],
    [
      "invented metadata field",
      {
        results: [
          {
            sourceVideoId: "source-one",
            edges: [
              {
                ...validEdge,
                evidence: { basis: "metadata", fields: ["themes"] },
              },
            ],
          },
        ],
      },
    ],
    [
      "unoffered span",
      {
        results: [
          {
            sourceVideoId: "source-one",
            edges: [
              {
                ...validEdge,
                evidence: { basis: "transcript", spanIds: ["f".repeat(32)] },
              },
            ],
          },
        ],
      },
    ],
    [
      "oversized output",
      {
        results: [
          {
            sourceVideoId: "source-one",
            edges: [{ ...validEdge, reasonEnglish: "x".repeat(33_000) }],
          },
        ],
      },
    ],
  ])(
    "records known usage and rejects %s atomically",
    async (_label, output) => {
      const harness = oneMemberBatch(output)
      await expect(runEdgeBatch(harness.input)).rejects.toThrow()
      expect(harness.modelCalls()).toBe(1)
      expect(harness.finishes).toEqual([
        expect.objectContaining({
          status: "rejected",
          usage: { inputTokens: 100, outputTokens: 20 },
        }),
      ])
      expect(harness.finishes[0]).not.toHaveProperty("results")
    },
  )

  it("leaves a reserved call pending if model consumption is unknown", async () => {
    const harness = oneMemberBatch(null)
    harness.input.model = {
      async generate() {
        throw new Error("model transport disappeared")
      },
    }
    await expect(runEdgeBatch(harness.input)).rejects.toThrowError(
      "usage_unknown",
    )
    expect(harness.finishes).toEqual([])
  })

  it("requires added viewing value for a parent or chapter link", async () => {
    const harness = oneMemberBatch({
      results: [{ sourceVideoId: "source-one", edges: [validEdge] }],
    })
    harness.input.members[0]!.source.childVideoIds.push("target-one")
    await expect(runEdgeBatch(harness.input)).rejects.toThrowError(
      "edge_invalid",
    )
    expect(harness.finishes[0]).toMatchObject({ status: "rejected" })
  })

  it("records a provider failure only when its usage is known", async () => {
    const harness = oneMemberBatch(null)
    harness.input.model = {
      async generate() {
        throw Object.assign(new Error("provider unavailable"), {
          usage: { inputTokens: 100, outputTokens: 0 },
        })
      },
    }
    await expect(runEdgeBatch(harness.input)).rejects.toThrowError(
      "provider unavailable",
    )
    expect(harness.finishes[0]).toMatchObject({
      status: "failed",
      usage: { inputTokens: 100, outputTokens: 0 },
    })
  })

  it("propagates pre-dispatch refusal without reserving a batch", async () => {
    const harness = oneMemberBatch(null)
    let reservations = 0
    harness.input.persistence.start = async (): Promise<never> => {
      reservations++
      throw new Error("batch must not be reserved")
    }
    await expect(
      runEdgeBatchActual({
        ...harness.input,
        model: {
          async generateReserved(): Promise<never> {
            throw Object.assign(new Error("allowance insufficient"), {
              code: "allowance_insufficient",
            })
          },
        },
      }),
    ).rejects.toMatchObject({ code: "allowance_insufficient" })
    expect(reservations).toBe(0)
    expect(harness.finishes).toEqual([])
  })

  it("writes exactly one known-usage failure receipt after a reserved call", async () => {
    const harness = oneMemberBatch(null)
    let reservations = 0
    const originalStart = harness.input.persistence.start
    harness.input.persistence.start = async (request) => {
      reservations++
      return originalStart(request)
    }
    await expect(
      runEdgeBatchActual({
        ...harness.input,
        model: {
          async generateReserved(_request, reserve): Promise<never> {
            const decision = await reserve()
            expect(decision.kind).toBe("dispatch")
            throw Object.assign(new Error("account changed after call"), {
              code: "identity_mismatch",
              usage: { inputTokens: 100, outputTokens: 20 },
              consumptionUnknown: false,
            })
          },
        },
      }),
    ).rejects.toMatchObject({ code: "identity_mismatch" })
    expect(reservations).toBe(1)
    expect(harness.finishes).toEqual([
      expect.objectContaining({
        status: "failed",
        usage: { inputTokens: 100, outputTokens: 20 },
      }),
    ])
  })

  it("does not reserve behind an unresolved call from source status", async () => {
    const harness = oneMemberBatch(null)
    harness.input.persistence.status = async () => ({
      generationId: identity.generationId,
      sourceVideoId: "source-one",
      sourceState: "claimed",
      checkpointRevision: 0,
      sourceCandidateCount: null,
      sourceCandidateDigest: null,
      calls: [
        {
          callId: "previous-call",
          attemptId: identity.attemptId,
          status: "pending",
          applicationState: "pending",
          pageIndex: 0,
          candidatePageDigest: "a".repeat(64),
          candidates: [
            {
              targetVideoId: "target-one",
              targetProfileKey: readyProfile("target-one").cacheKey,
              poolRank: 0,
            },
          ],
          appliedRevision: null,
          startedAt: identity.inputCutoff,
          finishedAt: null,
          memberSourceVideoIds: ["source-one"],
        },
      ],
      nextCursor: null,
    })
    await expect(runEdgeBatch(harness.input)).rejects.toThrowError(
      "usage_unknown",
    )
    expect(harness.modelCalls()).toBe(0)
  })

  it("does not redispatch a replayed pending reservation", async () => {
    const harness = oneMemberBatch(null)
    harness.input.persistence.start = async (request) => ({
      generationId: request.generationId,
      callId: request.callId,
      state: "pending",
      replay: true,
      members: [
        {
          sourceVideoId: "source-one",
          applicationState: "pending",
          appliedRevision: null,
          checkpointRevision: 0,
        },
      ],
    })
    await expect(runEdgeBatch(harness.input)).rejects.toThrowError(
      "usage_unknown",
    )
    expect(harness.modelCalls()).toBe(0)
    expect(harness.finishes).toEqual([])
  })

  it("refuses an Admin reservation response for a different member", async () => {
    const harness = oneMemberBatch(null)
    harness.input.persistence.start = async (request) => ({
      generationId: request.generationId,
      callId: request.callId,
      state: "pending",
      replay: false,
      members: [
        {
          sourceVideoId: "some-other-source",
          applicationState: "pending",
          appliedRevision: null,
          checkpointRevision: 0,
        },
      ],
    })
    await expect(runEdgeBatch(harness.input)).rejects.toThrowError(
      "batch_unavailable",
    )
    expect(harness.modelCalls()).toBe(0)
    expect(harness.finishes).toEqual([])
  })

  it("reuses the persisted start timestamp for an exact terminal replay", async () => {
    const harness = oneMemberBatch(null)
    const page = planEdgeMemberPage({
      sourceVideoId: "source-one",
      orderedCandidateIds: ["target-one"],
      profileKeysByVideoId: new Map([
        ["target-one", readyProfile("target-one").cacheKey],
      ]),
      pageIndex: 0,
      startRank: 0,
      pageSize: 1,
    })
    harness.input.persistence.status = async () => ({
      generationId: identity.generationId,
      sourceVideoId: "source-one",
      sourceState: "claimed",
      checkpointRevision: 1,
      sourceCandidateCount: 1,
      sourceCandidateDigest: page.sourceCandidateDigest,
      calls: [
        {
          callId: identity.callId,
          attemptId: identity.attemptId,
          status: "succeeded",
          applicationState: "applied_empty",
          pageIndex: 0,
          candidatePageDigest: page.candidatePageDigest,
          candidates: page.candidates,
          appliedRevision: 1,
          startedAt: identity.inputCutoff,
          finishedAt: identity.inputCutoff,
          memberSourceVideoIds: ["source-one"],
        },
      ],
      nextCursor: null,
    })
    harness.input.persistence.start = async (request) => {
      expect(request.startedAt).toBe(identity.inputCutoff)
      return {
        generationId: request.generationId,
        callId: request.callId,
        state: "succeeded",
        replay: true,
        members: [
          {
            sourceVideoId: "source-one",
            applicationState: "applied_empty",
            appliedRevision: 1,
            checkpointRevision: 1,
          },
        ],
      }
    }
    expect(await runEdgeBatch(harness.input)).toMatchObject({
      state: "succeeded",
      replay: true,
    })
    expect(harness.modelCalls()).toBe(0)
    expect(harness.finishes).toEqual([])
  })
})
