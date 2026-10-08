import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { buildCandidateRetrieval } from "./candidate-retrieval"
import { gaCaptureDigest } from "./ga-watch-capture-artifact"
import {
  manualGenerationInputDigest,
  preflightManualCatalog,
  runManualSubscriptionCatalog,
  type ManualSubscriptionCatalogInput,
  type ManualSubscriptionCatalogPorts,
} from "./manual-subscription-catalog"
import { planEdgeMemberPage } from "./edge-batch-executor"
import type { HistoricalSnapshot } from "./historical-analytics"
import type { SourceCatalog, Video } from "./source-generation"

const cutoff = "2026-10-06T20:48:05.001Z"

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

function catalog(videos: Video[]): SourceCatalog {
  return {
    async video({ videoId }) {
      const found = videos.find((item) => item.id === videoId)
      if (!found) throw new Error("missing video")
      return found
    },
    async catalog() {
      return { videos, nextCursor: null }
    },
    async chunks() {
      return { chunks: [], nextCursor: null }
    },
  }
}

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

async function pilotFixture(
  copyState: "bound" | "copying" = "bound",
  videoIds = ["source-one", "target-one", "target-two"],
) {
  const videos = videoIds.map(video)
  const source = catalog(videos)
  const retrieval = await buildCandidateRetrieval(source, videos, cutoff)
  const reviewed = {
    sourceVideoIds: videos.map((item) => item.id),
    sourceSetDigest: digest(videos.map((item) => item.id)),
    selectedCorpusDigest: retrieval.selectedCorpusDigest,
    candidatePoolDigest: retrieval.candidatePoolDigest,
  }
  const generationInputDigest = manualGenerationInputDigest({
    inputCutoff: cutoff,
    videos,
    selectedCorpusDigest: reviewed.selectedCorpusDigest,
    candidatePoolDigest: reviewed.candidatePoolDigest,
  })
  const destination = {
    generationId: "destination-one",
    generationInputDigest,
    sourceSetDigest: reviewed.sourceSetDigest,
    inputCutoff: cutoff,
    selectedCorpusDigest: reviewed.selectedCorpusDigest,
    candidatePoolDigest: reviewed.candidatePoolDigest,
    routeMappingDigest: "1".repeat(64),
    sourcePatternTableDigest: "2".repeat(64),
    querySpecDigest: "3".repeat(64),
    propertyId: "320198532" as const,
    propertyTimeZone: "America/New_York" as const,
    qualificationPolicy: "referrer_navigation_v1" as const,
    requestedStart: "2022-08-08",
    requestedEnd: "2022-10-31",
    usableStart: "2022-08-08",
    usableEnd: "2022-10-31",
    requestedCoverageDigest: "4".repeat(64),
    usableCoverageDigest: "5".repeat(64),
  }
  const { qualificationPolicy: _policy, ...originBase } = destination
  expect(_policy).toBe("referrer_navigation_v1")
  const origin = {
    ...originBase,
    generationId: "origin-one",
    generationInputDigest: "6".repeat(64),
    candidatePoolDigest: "7".repeat(64),
    baseQualificationDigest: "8".repeat(64),
    artifactSha256: "9".repeat(64),
    artifactBytes: 123,
    headerSha256: "a".repeat(64),
    physicalHttpAttempts: 8,
    physicalSucceededCalls: 8,
  }
  const copy = {
    artifactSha256: origin.artifactSha256,
    artifactBytes: origin.artifactBytes,
    headerSha256: origin.headerSha256,
  }
  const bindingBase = {
    version: "ga_capture_import_v1" as const,
    destination,
    origin,
    copy,
  }
  const binding = {
    ...bindingBase,
    bindingDigest: gaCaptureDigest(bindingBase),
  }
  const attemptId = "11111111-1111-4111-8111-111111111111"
  const input: ManualSubscriptionCatalogInput = {
    invocation: "start",
    generationId: destination.generationId,
    generationInputDigest,
    attemptId,
    inputCutoff: cutoff,
    initiatingAccountRef: "operator-account-123",
    reviewed,
    destination,
    originGenerationId: origin.generationId,
    work: {
      mode: "pilot",
      sources: [{ sourceVideoId: "source-one", exclusiveEndRank: 1 }],
    },
  }
  const actions: string[] = []
  const ingestInputs: unknown[] = []
  const edgeFinishes: unknown[] = []
  const checkpoints = new Map<string, { revision: number; value: unknown }>()
  const histories = new Map<string, unknown>()
  const profileCoverage = new Map<string, string>()
  const profileKeys = new Map<string, string>()
  const snapshot: HistoricalSnapshot = {
    provenance: {
      provider: "ga_data_api",
      status: "complete",
      queryId: "watch-query",
      rangeStart: "2022-08-08",
      rangeEnd: "2022-10-31",
      cutoff,
      identity: "current_catalog_watch_path",
      botFiltering: "unknown",
      measurement: "qualified_engagement",
      overlap: "unknown",
      qualification: {} as never,
      navigationCoverage: {
        candidateEvents: 1,
        qualifiedEvents: 1,
        homeEvents: 0,
        selfEvents: 0,
        crossHostEvents: 0,
        malformedEvents: 0,
        unmappedEvents: 0,
        ambiguousEvents: 0,
      },
      rowCount: 1,
      catalogCandidates: 2,
      inspectedCandidates: 1,
      unmappedCandidates: 0,
      mappedRows: 1,
      unmappedRows: 0,
      pageCount: 1,
      queryExecutionCount: 0,
      queryUsageDigest: "b".repeat(64),
      resultDigest: "c".repeat(64),
      unmappedDigest: null,
      bytesProcessed: null,
      costQualification: "unavailable",
      captureMode: "imported_capture_derived_v1",
      importBindingDigest: binding.bindingDigest,
      artifactSha256: copy.artifactSha256,
      derivedSubsetDigest: "d".repeat(64),
      pageCountKind: "virtual_validation",
    },
    queryUsage: new Map(),
    definitionsForModel: {
      provider: "ga_data_api",
      queryId: "watch-query",
      rangeStart: "2022-08-08",
      rangeEnd: "2022-10-31",
      identity: "current_catalog_watch_path",
      botFiltering: "unknown",
      measurement: "qualified_engagement",
      overlap: "unknown",
      qualification: {} as never,
      engagement: "Views",
      transitions: "No consecutive playback",
      navigation: "Referrer navigation",
    },
    signal: () => null,
    transition: () => null,
    navigation: () => null,
  }
  const ports: ManualSubscriptionCatalogPorts = {
    catalog: source,
    async ingest(raw) {
      ingestInputs.push(raw)
      const request = raw as {
        action: string
        generationId?: string
        sourceVideoId?: string
        history?: Record<string, unknown>
        checkpoint?: { historySummary?: unknown }
        expectedRevision?: number
      }
      actions.push(request.action)
      switch (request.action) {
        case "start":
        case "capacity":
          return { generationId: destination.generationId, state: "incomplete" }
        case "complete":
          return { generationId: destination.generationId, state: "complete" }
        case "manifest":
        case "attempt_close":
        case "resume_attempt":
          return { generationId: destination.generationId }
        case "checkpoint": {
          const existing = checkpoints.get(request.sourceVideoId ?? "")
          if (
            !request.sourceVideoId ||
            !request.checkpoint?.historySummary ||
            request.expectedRevision !== (existing?.revision ?? 0)
          )
            throw new Error("checkpoint rejected")
          const revision = (existing?.revision ?? 0) + 1
          checkpoints.set(request.sourceVideoId, {
            revision,
            value: request.checkpoint,
          })
          return {
            generationId: destination.generationId,
            checkpointRevision: revision,
            replay: false,
          }
        }
        case "source_history": {
          const summary = request.history && {
            resultDigest: request.history.resultDigest,
            rowCount: request.history.rowCount,
            mappedRows: request.history.mappedRows,
            unmappedRows: request.history.unmappedRows,
            pageCount: request.history.pageCount,
            queryExecutionCount: request.history.queryExecutionCount,
            navigationCoverage: request.history.navigationCoverage,
            captureMode: request.history.captureMode,
            importBindingDigest: request.history.importBindingDigest,
            artifactSha256: request.history.artifactSha256,
            derivedSubsetDigest: request.history.derivedSubsetDigest,
            pageCountKind: request.history.pageCountKind,
          }
          const current = checkpoints.get(request.sourceVideoId ?? "")
          if (
            !current ||
            JSON.stringify(
              (current.value as { historySummary: unknown }).historySummary,
            ) !== JSON.stringify(summary)
          )
            throw new Error(
              "Source history differs from durable page checkpoint",
            )
          histories.set(request.sourceVideoId!, request.history)
          return { generationId: destination.generationId }
        }
        case "capacity_probe":
          return {
            observedDbBytes: 100,
            clusterSystemId: "42",
            availableBytes: null,
          }
        case "claim":
          return {
            generationId: destination.generationId,
            sourceState: "claimed",
            leaseToken: "22222222-2222-4222-8222-222222222222",
            checkpointRevision:
              checkpoints.get(request.sourceVideoId ?? "")?.revision ?? 0,
            checkpoint:
              checkpoints.get(request.sourceVideoId ?? "")?.value ?? null,
            historicalProvenance:
              histories.get(request.sourceVideoId ?? "") ?? null,
          }
        case "heartbeat":
          return { sourceState: "claimed" }
        case "status":
          return {
            generationId: destination.generationId,
            usage: {
              attempts: [
                {
                  attemptId: input.attemptId,
                  profileCallCount: 0,
                  profileInputTokens: 0,
                  profileOutputTokens: 0,
                  edgeBatchCallCount: edgeFinishes.length,
                  edgeBatchInputTokens: edgeFinishes.length * 42,
                  edgeBatchOutputTokens: edgeFinishes.length * 12,
                },
              ],
            },
          }
        default:
          throw new Error(`unexpected Admin action ${request.action}`)
      }
    },
    model: {
      async generateReserved(request, reserve) {
        actions.push("model_admission")
        const decision = await reserve()
        if (decision.kind !== "dispatch")
          return { kind: "skipped", reservation: decision.reservation }
        actions.push("model_dispatch")
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: {
            output: request.schema.parse({
              results: [{ sourceVideoId: "source-one", edges: [] }],
            }),
            usage: { inputTokens: 42, outputTokens: 12 },
          },
        }
      },
    },
    async readAttestation() {
      actions.push("account")
      return {
        identity: {
          observedAt: new Date().toISOString(),
          accountRef: "operator-account-123",
          authMethod: "chatgpt",
        },
        allowance: {
          observedAt: new Date().toISOString(),
          accountRef: "operator-account-123",
          billingBasis: "included_subscription",
          weeklyRemainingPercent: 70,
          fiveHour: { kind: "limited", remainingPercent: 60 },
        },
        modelId: "gpt-6-astra",
        plan: "plus",
        admission: "admitted",
      }
    },
    profilePersistence: {
      async register(request) {
        actions.push("profile_register")
        profileCoverage.set(request.cacheKey, request.coverageDigest)
        profileKeys.set(request.videoId, request.cacheKey)
        return {
          generationId: request.generationId,
          cacheKey: request.cacheKey,
          kind: request.kind,
          state: "ready",
          replay: false,
        }
      },
      async status(request) {
        return {
          generationId: request.generationId,
          cacheKey: request.cacheKey,
          profile: {
            state: "ready",
            kind: "metadata_only",
            profileJson: null,
            finalCallId: null,
            coverageDigest: profileCoverage.get(request.cacheKey) ?? "",
          },
          calls: [],
        }
      },
      async callStart(): Promise<never> {
        throw new Error("metadata profile must not use a model")
      },
      async callFinish(): Promise<never> {
        throw new Error("metadata profile must not use a model")
      },
      async finalize(): Promise<never> {
        throw new Error("metadata profile must not use a model")
      },
    },
    edgePersistence: {
      async status(request) {
        return {
          generationId: request.generationId,
          sourceVideoId: request.sourceVideoId,
          sourceState: "claimed",
          checkpointRevision:
            checkpoints.get(request.sourceVideoId)?.revision ?? 0,
          sourceCandidateCount: null,
          sourceCandidateDigest: null,
          calls: [],
          nextCursor: null,
        }
      },
      async start(request) {
        actions.push("edge_start")
        return {
          generationId: request.generationId,
          callId: request.callId,
          state: "pending",
          replay: false,
          members: request.members.map((member) => ({
            sourceVideoId: member.sourceVideoId,
            applicationState: "pending" as const,
            appliedRevision: null,
            checkpointRevision: member.checkpointRevision,
          })),
        }
      },
      async finish(request) {
        actions.push("edge_finish")
        edgeFinishes.push(request)
        return {
          generationId: request.generationId,
          callId: request.callId,
          state: "succeeded",
          receiptStored: true,
          replay: false,
          members: [
            {
              sourceVideoId: "source-one",
              applicationState: "applied_empty",
              appliedRevision: 2,
              checkpointRevision: 2,
            },
          ],
        }
      },
      async closeEmpty(request) {
        actions.push("edge_close_empty")
        return {
          generationId: request.generationId,
          sourceVideoId: request.sourceVideoId,
          sourceState: "complete_empty",
          acceptedCount: 0,
          checkpointRevision: 2,
          replay: false,
        }
      },
      async finalizeSource(): Promise<never> {
        throw new Error("partial pilot must not finalize")
      },
    },
    importClient: {
      async probeOrigin() {
        actions.push("origin_probe")
        return {
          version: "ga_capture_import_v1",
          origin,
          originProofDigest: "e".repeat(64),
        }
      },
      async prepare() {
        actions.push("import_prepare")
        return {
          version: "ga_capture_import_v1",
          state: "prepared",
          preparedDigest: "f".repeat(64),
          destination,
          replay: false,
        }
      },
      async copyBind() {
        actions.push("import_copy_bind")
        return copyState === "bound"
          ? {
              version: "ga_capture_import_v1",
              state: "bound",
              preparedDigest: "f".repeat(64),
              importBinding: binding,
              qualificationDigest: "0".repeat(64),
              replay: false,
            }
          : {
              version: "ga_capture_import_v1",
              state: "copying",
              preparedDigest: "f".repeat(64),
              stagingDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
              replay: true,
            }
      },
      async status() {
        actions.push("import_status")
        return {
          version: "ga_capture_import_v1",
          state: "bound",
          preparedDigest: "f".repeat(64),
          importBinding: binding,
          qualificationDigest: "0".repeat(64),
        }
      },
    } as unknown as ManualSubscriptionCatalogPorts["importClient"],
    async loadImport() {
      actions.push("import_load")
      return {
        reader: {
          evidenceKind: "referrer_navigation_v1",
          async describe(): Promise<never> {
            throw new Error("not used")
          },
          async readPage(): Promise<never> {
            throw new Error("not used")
          },
          async readNavigationSnapshot() {
            return snapshot
          },
        },
        definition: {
          provider: "ga_data_api",
          queryId: "watch-query",
          rangeStart: "2022-08-08",
          rangeEnd: "2022-10-31",
        } as never,
        importBinding: binding,
        qualificationDigest: "0".repeat(64),
        artifactBytes: copy.artifactBytes,
        async dispose() {
          actions.push("import_dispose")
        },
      }
    },
    async measureCapacity(probe) {
      actions.push("capacity_measure")
      return {
        measuredAt: new Date().toISOString(),
        clusterSystemId: probe.clusterSystemId,
        observedDbBytes: probe.observedDbBytes,
        availableBytes: 1_000_000_000,
        reserveBytes: 100_000_000,
        projectedBytes: 100_000_000,
        sampleSourceCount: 1,
        sampleBytes: 100,
        source: "operator_verified_pgdata_df",
      }
    },
  }
  return {
    input,
    ports,
    actions,
    ingestInputs,
    edgeFinishes,
    profileKeys,
    retrieval,
  }
}

describe("manual subscription catalog preflight", () => {
  it("rejects a changed frozen candidate pool before any build action", async () => {
    const videos = [video("source-one"), video("target-one")]
    const source = catalog(videos)
    const retrieval = await buildCandidateRetrieval(source, videos, cutoff)
    await expect(
      preflightManualCatalog(source, cutoff, {
        sourceVideoIds: videos.map((item) => item.id),
        sourceSetDigest: digest(videos.map((item) => item.id)),
        selectedCorpusDigest: retrieval.selectedCorpusDigest,
        candidatePoolDigest: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "catalog_mismatch" })
  })

  it("does not start a destination or reserve a model call when the reviewed pool differs", async () => {
    const videos = [video("source-one"), video("target-one")]
    const source = catalog(videos)
    const retrieval = await buildCandidateRetrieval(source, videos, cutoff)
    const ingest = vi.fn(async (): Promise<never> => {
      throw new Error("no Admin mutation expected")
    })
    const model = vi.fn(async (): Promise<never> => {
      throw new Error("no model reservation expected")
    })
    await expect(
      runManualSubscriptionCatalog(
        {
          invocation: "start",
          generationId: "destination-one",
          generationInputDigest: "a".repeat(64),
          attemptId: "11111111-1111-4111-8111-111111111111",
          inputCutoff: cutoff,
          initiatingAccountRef: "operator-account-123",
          reviewed: {
            sourceVideoIds: videos.map((item) => item.id),
            sourceSetDigest: digest(videos.map((item) => item.id)),
            selectedCorpusDigest: retrieval.selectedCorpusDigest,
            candidatePoolDigest: "0".repeat(64),
          },
          destination: {
            generationId: "destination-one",
            generationInputDigest: "a".repeat(64),
            inputCutoff: cutoff,
            sourceSetDigest: digest(videos.map((item) => item.id)),
            selectedCorpusDigest: retrieval.selectedCorpusDigest,
            candidatePoolDigest: "0".repeat(64),
          } as never,
          originGenerationId: "origin-one",
          work: {
            mode: "pilot",
            sources: [{ sourceVideoId: "source-one", exclusiveEndRank: 1 }],
          },
        },
        {
          catalog: source,
          ingest,
          model: { generateReserved: model },
        } as unknown as ManualSubscriptionCatalogPorts,
      ),
    ).rejects.toMatchObject({ code: "catalog_mismatch" })
    expect(ingest).not.toHaveBeenCalled()
    expect(model).not.toHaveBeenCalled()
  })

  it("binds a verified import before one pilot edge reservation and leaves partial source open", async () => {
    const fixture = await pilotFixture()
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(result).toMatchObject({
      state: "stopped",
      reason: "pilot_boundary",
      completedSourceCount: 0,
      processedPageCount: 1,
      knownUsage: {
        profileCallCount: 0,
        edgeBatchCallCount: 1,
        edgeBatchInputTokens: 42,
        edgeBatchOutputTokens: 12,
      },
    })
    const beforeModel = fixture.actions.slice(
      0,
      fixture.actions.indexOf("model_admission"),
    )
    expect(beforeModel).toEqual(
      expect.arrayContaining([
        "origin_probe",
        "start",
        "manifest",
        "capacity_probe",
        "capacity_measure",
        "capacity",
        "import_prepare",
        "import_copy_bind",
        "import_load",
        "import_status",
        "profile_register",
        "claim",
        "source_history",
        "heartbeat",
      ]),
    )
    expect(fixture.actions.indexOf("origin_probe")).toBeLessThan(
      fixture.actions.indexOf("start"),
    )
    expect(fixture.actions.indexOf("import_copy_bind")).toBeLessThan(
      fixture.actions.indexOf("model_admission"),
    )
    expect(fixture.actions.indexOf("checkpoint")).toBeLessThan(
      fixture.actions.indexOf("source_history"),
    )
    expect(fixture.ingestInputs).toContainEqual(
      expect.objectContaining({
        action: "checkpoint",
        attemptId: fixture.input.attemptId,
        expectedRevision: 0,
        checkpoint: expect.objectContaining({
          stage: "subscription_imported_history_ready",
          historySummary: expect.objectContaining({
            captureMode: "imported_capture_derived_v1",
          }),
        }),
      }),
    )
    expect(fixture.actions.indexOf("edge_start")).toBeLessThan(
      fixture.actions.indexOf("model_dispatch"),
    )
    expect(fixture.actions).not.toContain("complete")
    expect(fixture.edgeFinishes).toHaveLength(1)
    expect(fixture.ingestInputs[0]).toMatchObject({
      action: "start",
      protocolVersion: 4,
      inputMode: "historical_analytics",
      inputSnapshotMode: "observed_fenced",
    })
  })

  it("stops an unresolved import copy before any profile or edge model work", async () => {
    const fixture = await pilotFixture("copying")
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(result).toMatchObject({
      state: "stopped",
      reason: "import_unavailable",
    })
    expect(fixture.actions).not.toContain("profile_register")
    expect(fixture.actions).not.toContain("edge_start")
    expect(fixture.actions).not.toContain("model_admission")
  })

  it("reuses matching imported history on resume without rewriting its checkpoint", async () => {
    const fixture = await pilotFixture()
    const first = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(first.reason).toBe("pilot_boundary")
    const initialCheckpointCount = fixture.actions.filter(
      (action) => action === "checkpoint",
    ).length
    const initialHistoryCount = fixture.actions.filter(
      (action) => action === "source_history",
    ).length
    fixture.input.invocation = "resume"
    fixture.input.attemptId = "44444444-4444-4444-8444-444444444444"
    const originalStatus = fixture.ports.edgePersistence.status
    fixture.ports.edgePersistence.status = async (input) => ({
      ...(await originalStatus(input)),
      calls: [
        {
          callId: "33333333-3333-4333-8333-333333333333",
          attemptId: fixture.input.attemptId,
          status: "pending",
          applicationState: "pending",
          pageIndex: 0,
          candidatePageDigest: "0".repeat(64),
          candidates: [],
          appliedRevision: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          memberSourceVideoIds: ["source-one"],
        },
      ],
    })
    const resumed = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(resumed.reason).toBe("usage_uncertain")
    expect(
      fixture.actions.filter((action) => action === "checkpoint"),
    ).toHaveLength(initialCheckpointCount)
    expect(
      fixture.actions.filter((action) => action === "source_history"),
    ).toHaveLength(initialHistoryCount)
  })

  it("accepts Admin's minimal already-complete claim without reopening source work", async () => {
    const fixture = await pilotFixture()
    const ingest = fixture.ports.ingest
    fixture.ports.ingest = async (raw) => {
      if ((raw as { action?: string }).action === "claim")
        return {
          generationId: fixture.input.generationId,
          sourceState: "complete_edges",
          leaseToken: null,
          replay: true,
        }
      return ingest(raw)
    }
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(result).toMatchObject({
      state: "stopped",
      reason: "pilot_boundary",
      completedSourceCount: 1,
    })
    expect(fixture.actions).not.toContain("checkpoint")
    expect(fixture.actions).not.toContain("model_admission")
  })

  it("refuses a changed imported history checkpoint on resume", async () => {
    const fixture = await pilotFixture()
    await runManualSubscriptionCatalog(fixture.input, fixture.ports)
    const checkpointCount = fixture.actions.filter(
      (action) => action === "checkpoint",
    ).length
    const historyCount = fixture.actions.filter(
      (action) => action === "source_history",
    ).length
    fixture.input.invocation = "resume"
    fixture.input.attemptId = "55555555-5555-4555-8555-555555555555"
    const ingest = fixture.ports.ingest
    fixture.ports.ingest = async (raw) => {
      const reply = await ingest(raw)
      if ((raw as { action?: string }).action !== "claim") return reply
      const claimed = reply as {
        checkpoint: { historySummary: { resultDigest: string } }
      }
      return {
        ...claimed,
        checkpoint: {
          ...claimed.checkpoint,
          historySummary: {
            ...claimed.checkpoint.historySummary,
            resultDigest: "0".repeat(64),
          },
        },
      }
    }
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(result.reason).toBe("source_failed")
    expect(
      fixture.actions.filter((action) => action === "checkpoint"),
    ).toHaveLength(checkpointCount)
    expect(
      fixture.actions.filter((action) => action === "source_history"),
    ).toHaveLength(historyCount)
  })

  it("rejects a stale local account attestation before destination mutation", async () => {
    const fixture = await pilotFixture()
    const current = fixture.ports.readAttestation
    fixture.ports.readAttestation = async () => ({
      ...(await current()),
      identity: {
        ...(await current()).identity,
        observedAt: new Date(Date.now() - 61_000).toISOString(),
      },
    })
    await expect(
      runManualSubscriptionCatalog(fixture.input, fixture.ports),
    ).rejects.toMatchObject({ code: "admission_refused" })
    expect(fixture.actions).not.toContain("start")
    expect(fixture.actions).not.toContain("model_admission")
  })

  it("rejects incompatible origin coverage before destination mutation", async () => {
    const fixture = await pilotFixture()
    const probe = fixture.ports.importClient.probeOrigin
    fixture.ports.importClient.probeOrigin = async (input) => {
      const response = await probe(input)
      return {
        ...response,
        origin: { ...response.origin, usableStart: "2022-08-09" },
      }
    }
    await expect(
      runManualSubscriptionCatalog(fixture.input, fixture.ports),
    ).rejects.toMatchObject({ code: "import_unavailable" })
    expect(fixture.actions).not.toContain("start")
    expect(fixture.actions).not.toContain("model_admission")
  })

  it("stops before import and inference when fresh physical capacity is unavailable", async () => {
    const fixture = await pilotFixture()
    fixture.ports.measureCapacity = async () => {
      throw new Error("synthetic PGDATA sample unavailable")
    }
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(result).toMatchObject({
      state: "stopped",
      reason: "capacity_stopped",
    })
    expect(fixture.actions).not.toContain("import_prepare")
    expect(fixture.actions).not.toContain("model_admission")
  })

  it("blocks an unresolved prior edge reservation without redispatch", async () => {
    const fixture = await pilotFixture()
    const status = fixture.ports.edgePersistence.status
    fixture.ports.edgePersistence.status = async (input) => ({
      ...(await status(input)),
      calls: [
        {
          callId: "33333333-3333-4333-8333-333333333333",
          attemptId: fixture.input.attemptId,
          status: "pending",
          applicationState: "pending",
          pageIndex: 0,
          candidatePageDigest: "0".repeat(64),
          candidates: [],
          appliedRevision: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          memberSourceVideoIds: ["source-one"],
        },
      ],
    })
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(fixture.actions).toContain("source_history")
    expect(result).toMatchObject({
      state: "stopped",
      reason: "usage_uncertain",
      processedPageCount: 0,
    })
    expect(fixture.actions).not.toContain("edge_start")
    expect(fixture.actions).not.toContain("model_admission")
  })

  it("continues after a verified prior page at its durable revision", async () => {
    const fixture = await pilotFixture()
    fixture.input.work = {
      mode: "pilot",
      sources: [{ sourceVideoId: "source-one", exclusiveEndRank: 2 }],
    }
    const candidateIds =
      fixture.retrieval.candidateIdsBySource.get("source-one")!
    const originalStatus = fixture.ports.edgePersistence.status
    fixture.ports.edgePersistence.status = async (input) => {
      const current = await originalStatus(input)
      const prior = planEdgeMemberPage({
        sourceVideoId: "source-one",
        orderedCandidateIds: candidateIds,
        profileKeysByVideoId: fixture.profileKeys,
        pageIndex: 0,
        startRank: 0,
        pageSize: 1,
      })
      return {
        ...current,
        checkpointRevision: 1,
        sourceCandidateCount: prior.sourceCandidateCount,
        sourceCandidateDigest: prior.sourceCandidateDigest,
        calls: [
          {
            callId: "33333333-3333-4333-8333-333333333333",
            attemptId: fixture.input.attemptId,
            status: "succeeded",
            applicationState: "applied_empty",
            pageIndex: 0,
            candidatePageDigest: prior.candidatePageDigest,
            candidates: prior.candidates,
            appliedRevision: 1,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            memberSourceVideoIds: ["source-one"],
          },
        ],
      }
    }
    let observedRevision: number | undefined
    fixture.ports.edgePersistence.start = async (request) => {
      observedRevision = request.members[0]?.checkpointRevision
      throw new Error("synthetic stop after inspecting reservation")
    }
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(result.reason).toBe("admin_unavailable")
    expect(observedRevision).toBe(1)
    expect(fixture.actions).not.toContain("model_dispatch")
  })

  it("completes an explicit full single-video catalog without inference", async () => {
    const fixture = await pilotFixture("bound", ["source-one"])
    fixture.input.work = { mode: "full" }
    const result = await runManualSubscriptionCatalog(
      fixture.input,
      fixture.ports,
    )
    expect(result).toMatchObject({
      state: "completed",
      completedSourceCount: 1,
      processedPageCount: 0,
      knownUsage: { profileCallCount: 0, edgeBatchCallCount: 0 },
    })
    expect(fixture.actions).toContain("edge_close_empty")
    expect(fixture.actions).toContain("complete")
    expect(fixture.actions).not.toContain("model_admission")
  })
})
