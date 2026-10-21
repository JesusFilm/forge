import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import {
  buildCandidateRetrieval,
  CANDIDATE_RETRIEVAL_REVISION,
} from "./candidate-retrieval"
import {
  manualGenerationInputDigest,
  runManualSubscriptionCatalog,
  type ManualSubscriptionCatalogInput,
  type ManualSubscriptionCatalogPorts,
} from "./manual-subscription-catalog"
import { parseManualCatalogCommand } from "../../scripts/run-manual-subscription-catalog"
import type { Video, SourceCatalog } from "./source-generation"
import type { EdgeBatchPersistencePort } from "./edge-batch-executor"

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex")
const cutoff = "2026-10-19T00:00:00.000Z"
const attemptId = "11111111-1111-4111-8111-111111111111"
const leaseToken = "22222222-2222-4222-8222-222222222222"
function video(id: string): Video {
  return {
    id,
    coreId: id,
    slug: id,
    locale: "en",
    title: `Hope ${id}`,
    description: "A story of hope.",
    descriptionTruncated: false,
    keywords: ["hope"],
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
async function fixture(ids = ["a", "b", "c"]) {
  const videos = ids.map(video)
  const catalog: SourceCatalog = {
    async video({ videoId }) {
      return videos.find((v) => v.id === videoId)!
    },
    async catalog() {
      return { videos, nextCursor: null }
    },
    async chunks() {
      return { chunks: [], nextCursor: null }
    },
  }
  const retrieval = await buildCandidateRetrieval(catalog, videos, cutoff)
  const reviewed = {
    sourceVideoIds: videos.map((v) => v.id),
    sourceSetDigest: hash(videos.map((v) => v.id)),
    selectedCorpusDigest: retrieval.selectedCorpusDigest,
    candidatePoolDigest: retrieval.candidatePoolDigest,
  }
  const digestInput = {
    analyticsPolicy: "disabled_by_operator_v1" as const,
    modelId: "gpt-6.1-sol" as const,
    inputCutoff: cutoff,
    videos,
    ...reviewed,
  }
  const input: ManualSubscriptionCatalogInput = {
    invocation: "start",
    analyticsPolicy: "disabled_by_operator_v1",
    modelId: "gpt-6.1-sol",
    generationId: "sol-content-only",
    generationInputDigest: manualGenerationInputDigest(digestInput),
    attemptId,
    inputCutoff: cutoff,
    initiatingAccountRef: "operator-test",
    reviewed,
    work: {
      mode: "pilot",
      sources: [{ sourceVideoId: "a", exclusiveEndRank: 1 }],
    },
  }
  const requests: Record<string, unknown>[] = []
  const profileCoverage = new Map<string, string>()
  let revision = 0
  let checkpoint: unknown = null
  let historicalProvenance: unknown = null
  const calls: Awaited<
    ReturnType<EdgeBatchPersistencePort["status"]>
  >["calls"] = []
  let pending: Parameters<EdgeBatchPersistencePort["start"]>[0] | undefined
  const forbidden = vi.fn(async (): Promise<never> => {
    throw Error("GA must never be invoked")
  })
  const modelRequests: Array<{ system: string; prompt: string }> = []
  const ports: ManualSubscriptionCatalogPorts = {
    catalog,
    async ingest(raw) {
      const r = raw as Record<string, unknown>
      requests.push(r)
      switch (r.action) {
        case "start":
        case "capacity":
          return { generationId: input.generationId, state: "incomplete" }
        case "complete":
          return { generationId: input.generationId, state: "complete" }
        case "manifest":
        case "resume_attempt":
        case "attempt_close":
          return { generationId: input.generationId }
        case "claim":
          return {
            generationId: input.generationId,
            sourceState: "claimed",
            leaseToken,
            checkpointRevision: revision,
            checkpoint,
            historicalProvenance,
          }
        case "heartbeat":
          return { sourceState: "claimed" }
        case "capacity_probe":
          return {
            observedDbBytes: 100,
            clusterSystemId: "42",
            availableBytes: null,
          }
        case "status":
          return {
            generationId: input.generationId,
            usage: {
              attempts: [
                {
                  attemptId: input.attemptId,
                  profileCallCount: 0,
                  profileInputTokens: 0,
                  profileOutputTokens: 0,
                  edgeBatchCallCount: calls.length,
                  edgeBatchInputTokens: calls.length * 42,
                  edgeBatchOutputTokens: calls.length * 12,
                },
              ],
            },
          }
        default:
          throw Error(`unexpected action ${r.action}`)
      }
    },
    async readAttestation() {
      return {
        identity: {
          observedAt: new Date().toISOString(),
          accountRef: input.initiatingAccountRef,
          authMethod: "chatgpt",
        },
        allowance: {
          observedAt: new Date().toISOString(),
          accountRef: input.initiatingAccountRef,
          billingBasis: "included_subscription",
          weeklyRemainingPercent: 70,
          fiveHour: { kind: "limited", remainingPercent: 60 },
        },
        modelId: "gpt-6.1-sol",
        plan: "plus",
        admission: "admitted",
      }
    },
    async measureCapacity(probe) {
      return {
        ...probe,
        measuredAt: new Date().toISOString(),
        availableBytes: 50_000_000_000,
        reserveBytes: 5_000_000_000,
        projectedBytes: 100_000_000,
        sampleSourceCount: 1,
        sampleBytes: 100_000,
        source: "operator_verified_pgdata_df",
      }
    },
    importClient: {
      probeOrigin: forbidden,
      prepare: forbidden,
      copyBind: forbidden,
      status: forbidden,
    },
    loadImport: forbidden,
    profilePersistence: {
      async register(r) {
        profileCoverage.set(r.cacheKey, r.coverageDigest)
        expect(r.promptVersion).toBe("complete-profile-v7-priority-anchors")
        return {
          generationId: r.generationId,
          cacheKey: r.cacheKey,
          kind: r.kind,
          state: "ready",
          replay: false,
        }
      },
      async status(r) {
        return {
          generationId: r.generationId,
          cacheKey: r.cacheKey,
          profile: {
            state: "ready",
            kind: "metadata_only",
            profileJson: null,
            finalCallId: null,
            coverageDigest: profileCoverage.get(r.cacheKey)!,
          },
          calls: [],
        }
      },
      callStart: forbidden,
      callFinish: forbidden,
      finalize: forbidden,
    },
    model: {
      async generateReserved(r, reserve) {
        modelRequests.push(r)
        const decision = await reserve()
        if (decision.kind !== "dispatch")
          return { kind: "skipped", reservation: decision.reservation }
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: {
            output: r.schema.parse({
              results: [{ sourceVideoId: "a", edges: [] }],
            }),
            usage: { inputTokens: 42, outputTokens: 12 },
          },
        }
      },
    },
    edgePersistence: {
      async status(r) {
        return {
          generationId: r.generationId,
          sourceVideoId: r.sourceVideoId,
          sourceState: "claimed",
          checkpointRevision: revision,
          sourceCandidateCount: null,
          sourceCandidateDigest: null,
          calls,
          nextCursor: null,
        }
      },
      async start(r) {
        pending = r
        expect(r.captureRefDigest).toBeNull()
        expect(
          r.members.every((m) => m.historicalRefDigest === hash(null)),
        ).toBe(true)
        return {
          generationId: r.generationId,
          callId: r.callId,
          state: "pending",
          replay: false,
          members: r.members.map((m) => ({
            sourceVideoId: m.sourceVideoId,
            applicationState: "pending",
            appliedRevision: null,
            checkpointRevision: m.checkpointRevision,
          })),
        }
      },
      async finish(r) {
        const p = pending!
        const m = p.members[0]!
        revision++
        checkpoint = {
          stage: "edge_page_applied_v1",
          cursor: { candidateIndex: m.candidates.length },
        }
        calls.push({
          callId: r.callId,
          attemptId: r.attemptId,
          status: "succeeded",
          applicationState: "applied_empty",
          appliedRevision: revision,
          pageIndex: m.pageIndex,
          candidatePageDigest: m.candidatePageDigest,
          memberSourceVideoIds: ["a"],
          candidates: m.candidates,
          startedAt: p.startedAt,
          finishedAt: new Date().toISOString(),
        })
        return {
          generationId: r.generationId,
          callId: r.callId,
          state: "succeeded",
          receiptStored: true,
          replay: false,
          members: [
            {
              sourceVideoId: "a",
              applicationState: "applied_empty",
              appliedRevision: revision,
              checkpointRevision: revision,
            },
          ],
        }
      },
      async closeEmpty(r) {
        expect(r.sourceCandidateCount).toBe(0)
        expect(r.historicalRefDigest).toBe(hash(null))
        return {
          generationId: r.generationId,
          sourceVideoId: r.sourceVideoId,
          sourceState: "complete_empty",
          acceptedCount: 0,
          checkpointRevision: 0,
          replay: false,
        }
      },
      finalizeSource: forbidden,
    },
  }
  return {
    input,
    ports,
    requests,
    forbidden,
    modelRequests,
    digestInput,
    setHistory: (v: unknown) => {
      historicalProvenance = v
    },
    setCheckpoint: (v: unknown, n: number) => {
      checkpoint = v
      revision = n
    },
  }
}

describe("explicit analytics-disabled Sol legacy runner", () => {
  it("starts at revision 0 and resumes applied revision 1 without GA, duplicate dispatch or a fake history checkpoint", async () => {
    const f = await fixture()
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "")
    try {
      expect(
        await runManualSubscriptionCatalog(f.input, f.ports),
      ).toMatchObject({
        state: "stopped",
        reason: "pilot_boundary",
        processedPageCount: 1,
        knownUsage: { edgeBatchCallCount: 1, edgeBatchInputTokens: 42 },
      })
      f.input.invocation = "resume"
      expect(
        await runManualSubscriptionCatalog(f.input, f.ports),
      ).toMatchObject({
        state: "stopped",
        reason: "pilot_boundary",
        processedPageCount: 0,
      })
      expect(f.modelRequests).toHaveLength(1)
      expect(f.modelRequests[0]!.system).toContain(
        "Analytics are intentionally disabled",
      )
      expect(f.modelRequests[0]!.system).not.toContain("Historical GA referrer")
      expect(f.requests.find((r) => r.action === "start")).toMatchObject({
        inputMode: "content_only",
        inputSnapshotMode: "observed_fenced",
        promptVersion: "subscription-profile-edge-content-only-v1",
      })
      expect(
        f.requests.some((r) =>
          ["source_history", "checkpoint", "history_qualification"].includes(
            String(r.action),
          ),
        ),
      ).toBe(false)
      expect(f.forbidden).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it("completes a legitimate zero-candidate source with no fabricated model or GA calls", async () => {
    const f = await fixture(["a"])
    f.input.work = { mode: "full" }
    expect(await runManualSubscriptionCatalog(f.input, f.ports)).toMatchObject({
      state: "completed",
      completedSourceCount: 1,
      processedPageCount: 0,
      knownUsage: { profileCallCount: 0, edgeBatchCallCount: 0 },
    })
    expect(f.requests.some((r) => r.action === "complete")).toBe(true)
    expect(f.modelRequests).toHaveLength(0)
    expect(f.forbidden).not.toHaveBeenCalled()
  })
  it("keeps the 25 percent floor and refuses cross-mode digest replay before dispatch", async () => {
    const f = await fixture()
    await expect(
      runManualSubscriptionCatalog(f.input, f.ports, {
        minimumRemainingPercent: 0,
      }),
    ).rejects.toMatchObject({ code: "input_invalid" })
    f.input.generationInputDigest = manualGenerationInputDigest({
      ...f.digestInput,
      analyticsPolicy: undefined,
    })
    await expect(
      runManualSubscriptionCatalog(f.input, f.ports),
    ).rejects.toMatchObject({ code: "catalog_mismatch" })
    expect(f.modelRequests).toHaveLength(0)
    expect(f.requests).toHaveLength(0)
  })
  it("runs with GA capabilities entirely absent", async () => {
    const f = await fixture()
    const ports: Parameters<typeof runManualSubscriptionCatalog>[1] = {
      ...f.ports,
    }
    delete ports.importClient
    delete ports.loadImport
    expect(await runManualSubscriptionCatalog(f.input, ports)).toMatchObject({
      reason: "pilot_boundary",
      processedPageCount: 1,
    })
  })
  it("rejects injected source history on resume before any model call", async () => {
    const f = await fixture()
    f.input.invocation = "resume"
    f.setHistory({ provider: "GA" })
    expect(await runManualSubscriptionCatalog(f.input, f.ports)).toMatchObject({
      state: "stopped",
      reason: "source_failed",
    })
    expect(f.modelRequests).toHaveLength(0)
    expect(f.forbidden).not.toHaveBeenCalled()
  })
  it("refuses a fabricated history checkpoint instead of advancing its cursor", async () => {
    const f = await fixture()
    f.input.invocation = "resume"
    f.setCheckpoint(
      {
        stage: "subscription_imported_history_ready",
        cursor: {},
        historySummary: {},
      },
      1,
    )
    expect(await runManualSubscriptionCatalog(f.input, f.ports)).toMatchObject({
      reason: "source_failed",
    })
    expect(f.modelRequests).toHaveLength(0)
  })
  it("preserves the exact historical digest shape and separates all new identities", async () => {
    const f = await fixture()
    const { analyticsPolicy, ...old } = f.digestInput
    expect(analyticsPolicy).toBe("disabled_by_operator_v1")
    const expected = hash({
      version: "manual_subscription_catalog_v1",
      protocolVersion: 4,
      cutoff,
      inputMode: "historical_analytics",
      inputSnapshotMode: "observed_fenced",
      importPolicy: "ga_capture_import_v1",
      modelId: "gpt-6.1-sol",
      backend: "codex_chatgpt_subscription",
      promptVersion: "subscription-profile-edge-v1",
      profilePromptVersion: "complete-profile-v6",
      profileSchemaVersion: "complete-profile-schema-v1",
      edgePromptVersion: "shared-edge-v1",
      edgeSchemaVersion: "shared-edge-schema-v1",
      videos: old.videos,
      sourceSetDigest: old.sourceSetDigest,
      candidateRetrievalRevision: CANDIDATE_RETRIEVAL_REVISION,
      selectedCorpusDigest: old.selectedCorpusDigest,
      candidatePoolDigest: old.candidatePoolDigest,
    })
    expect(manualGenerationInputDigest(old)).toBe(expected)
    expect(f.input.generationInputDigest).not.toBe(expected)
    expect(manualGenerationInputDigest({ ...old, modelId: undefined })).toBe(
      manualGenerationInputDigest({ ...old, modelId: "gpt-6-astra" }),
    )
  })
  it("parses a no-GA CLI config and rejects mixed destinations and wrong models", async () => {
    vi.stubEnv("CI", "")
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "")
    vi.stubEnv("RAILWAY_SERVICE_ID", "")
    const f = await fixture()
    const config = {
      input: f.input,
      codexExecutable: "/private/codex",
      stagingDirectory: "/private/staging",
      capacityProbe: { executable: "/private/probe", args: [] },
    }
    const parse = (input: unknown) =>
      parseManualCatalogCommand({ ...config, input }, [
        "--config",
        "/private/config.json",
        "--execute",
      ])
    expect(parse(f.input).input).toEqual(f.input)
    expect(() => parse({ ...f.input, originGenerationId: "old" })).toThrow()
    expect(() => parse({ ...f.input, destination: {} })).toThrow()
    expect(() => parse({ ...f.input, modelId: "gpt-6-astra" })).toThrow()
    vi.unstubAllEnvs()
  })
})
