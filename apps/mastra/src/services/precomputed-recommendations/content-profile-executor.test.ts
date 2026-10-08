import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"

import {
  profileCoverageDigest,
  runContentProfile,
  type ProfilePersistencePort,
  type ProfileState,
} from "./content-profile-executor"
import { planContentProfile } from "./content-profile-plan"
import type { StructuredModel } from "./astra-provider"
import type { Chunk, SourceCatalog, Video } from "./source-generation"

const identity = {
  generationId: "generation-one",
  generationInputDigest: "a".repeat(64),
  attemptId: "11111111-1111-4111-8111-111111111111",
  inputCutoff: "2026-10-06T20:48:05.001Z",
  modelId: "gpt-6-astra",
  backend: "codex_chatgpt_subscription",
  promptVersion: "complete-profile-v1",
  schemaVersion: "complete-profile-schema-v1",
  maxPartBytes: 24_576,
} as const

function video(): Video {
  return {
    id: "video-one",
    coreId: "core-one",
    slug: "video-one",
    locale: "en",
    title: "A complete story",
    description: "A story about hope.",
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

const emptyCatalog: SourceCatalog = {
  async video() {
    return video()
  },
  async catalog() {
    return { videos: [], nextCursor: null }
  },
  async chunks() {
    return { chunks: [], nextCursor: null }
  },
}

function transcriptVideo(): Video {
  return {
    ...video(),
    transcriptLanguages: ["en"],
    transcriptSelection: {
      ...video().transcriptSelection!,
      availableTranscriptCount: 1,
      selected: [
        {
          transcriptId: "transcript-one",
          videoEditionId: "edition-one",
          language: "en",
          totalChunks: 1,
        },
      ],
    },
  }
}

const passage = "Nicodemus asked Jesus about new birth."
const oneChunk: Chunk = {
  id: "chunk-one",
  transcriptId: "transcript-one",
  language: "en",
  chunkIndex: 0,
  text: passage,
}

function transcriptCatalog(chunks: Chunk[] = [oneChunk]): SourceCatalog {
  return {
    ...emptyCatalog,
    async chunks() {
      return { chunks, nextCursor: null }
    },
  }
}

const supportedProfile = {
  version: "complete_profile_v1" as const,
  summaryEnglish: "Nicodemus asks Jesus about the meaning of new birth.",
  themes: ["new birth"],
  people: ["Nicodemus", "Jesus"],
  places: [],
  citations: [],
  anchors: [
    {
      videoId: "video-one",
      chunkId: "chunk-one",
      transcriptId: "transcript-one",
      language: "en",
      chunkIndex: 0,
      startChar: 0,
      endChar: passage.length,
      textSha256: createHash("sha256").update(passage).digest("hex"),
      claimEnglish: "Nicodemus asks about new birth.",
    },
  ],
}

describe("complete content profile execution", () => {
  it("readies a metadata-only profile without calling Astra or inventing transcript evidence", async () => {
    const actions: string[] = []
    let coverageDigest = ""
    const result = await runContentProfile({
      ...identity,
      video: video(),
      catalog: emptyCatalog,
      model: {
        async generate() {
          actions.push("model")
          throw new Error("metadata-only work must not call Astra")
        },
      },
      persistence: {
        async register(input) {
          actions.push(input.action)
          coverageDigest = input.coverageDigest
          expect(input.kind).toBe("metadata_only")
          expect(input.selectedChunkCount).toBe(0)
          expect(input.partDigests).toEqual([])
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            kind: "metadata_only" as const,
            state: "ready" as const,
            replay: false,
          }
        },
        async status(input) {
          actions.push(input.action)
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            profile: {
              state: "ready" as const,
              kind: "metadata_only" as const,
              profileJson: null,
              finalCallId: null,
              coverageDigest,
            },
            calls: [],
          }
        },
        async callStart() {
          throw new Error("no call reservation expected")
        },
        async callFinish() {
          throw new Error("no call receipt expected")
        },
        async finalize() {
          throw new Error("no finalization expected")
        },
      },
    })
    expect(result.kind).toBe("metadata_only")
    expect(result.state).toBe("ready")
    expect(result.profile).toBeNull()
    expect(actions).toEqual(["profile_register", "profile_status"])
  })

  it("stops on Admin's terminal invalid metadata-only registration without inference", async () => {
    const actions: string[] = []
    await expect(
      runContentProfile({
        ...identity,
        video: { ...video(), title: "", description: "" },
        catalog: emptyCatalog,
        model: {
          async generate(): Promise<never> {
            actions.push("model")
            throw new Error("invalid metadata cannot enter inference")
          },
        },
        persistence: {
          async register(input) {
            actions.push(input.action)
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              kind: "metadata_only" as const,
              state: "invalid" as const,
              replay: false,
            }
          },
          async status() {
            throw new Error("terminal invalid metadata needs no status")
          },
          async callStart() {
            throw new Error("terminal invalid metadata needs no call")
          },
          async callFinish() {
            throw new Error("terminal invalid metadata needs no receipt")
          },
          async finalize() {
            throw new Error("terminal invalid metadata cannot finalize")
          },
        },
      }),
    ).rejects.toMatchObject({ code: "profile_invalid" })
    expect(actions).toEqual(["profile_register"])
  })

  it("persists a verified one-part map receipt before finalizing the profile", async () => {
    const actions: string[] = []
    let coverageDigest = ""
    let completedCallId = ""
    const result = await runContentProfile({
      ...identity,
      video: transcriptVideo(),
      catalog: transcriptCatalog(),
      model: {
        async generate(input) {
          actions.push("model")
          expect(input.prompt).toContain(passage)
          return {
            output: input.schema.parse(supportedProfile),
            usage: {
              inputTokens: 120,
              outputTokens: 32,
              cachedInputTokens: 0,
            },
          }
        },
      },
      persistence: {
        async register(input) {
          actions.push(input.action)
          coverageDigest = input.coverageDigest
          expect(input.kind).toBe("transcript")
          expect(input.partDigests).toHaveLength(1)
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            kind: "transcript" as const,
            state: "planned" as const,
            replay: false,
          }
        },
        async status(input) {
          actions.push(input.action)
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            profile: {
              state: "planned" as const,
              kind: "transcript" as const,
              profileJson: null,
              finalCallId: null,
              coverageDigest,
            },
            calls: [],
          }
        },
        async callStart(input) {
          actions.push(input.action)
          completedCallId = input.callId
          expect(input.stage).toBe("map")
          expect(input.partIndex).toBe(0)
          expect(input.stagePromptVersion).toBe("complete-profile-v1:map")
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            callId: input.callId,
            state: "pending" as const,
            replay: false,
          }
        },
        async callFinish(input) {
          actions.push(input.action)
          expect(input.status).toBe("succeeded")
          expect(input.usage).toEqual({
            inputTokens: 120,
            outputTokens: 32,
            cachedInputTokens: 0,
          })
          expect(input.node).toMatchObject({
            coveredPartStart: 0,
            coveredPartEnd: 1,
            childNodeDigests: [],
            profile: supportedProfile,
          })
          expect(Object.keys(input.node!)).toEqual([
            "profile",
            "coveredPartStart",
            "coveredPartEnd",
            "childNodeDigests",
          ])
          expect(Object.keys(input.node!.profile)).toEqual([
            "version",
            "summaryEnglish",
            "themes",
            "people",
            "places",
            "citations",
            "anchors",
          ])
          expect(Object.keys(input.node!.profile.anchors[0]!)).toEqual([
            "videoId",
            "chunkId",
            "transcriptId",
            "language",
            "chunkIndex",
            "startChar",
            "endChar",
            "textSha256",
            "claimEnglish",
          ])
          expect(JSON.stringify(input)).not.toContain(passage)
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            callId: input.callId,
            state: "succeeded" as const,
            receiptStored: true as const,
            nodeApplied: true,
            replay: false,
          }
        },
        async finalize(input) {
          actions.push(input.action)
          expect(input.finalCallId).toBe(completedCallId)
          expect(input.coverageDigest).toBe(coverageDigest)
          expect(input.expectedNodeDigests).toHaveLength(1)
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            state: "ready" as const,
            profileJson: supportedProfile,
            finalCallId: input.finalCallId,
            replay: false,
          }
        },
      },
    })
    expect(result.state).toBe("ready")
    expect(result.profile).toEqual(supportedProfile)
    expect(actions).toEqual([
      "profile_register",
      "profile_status",
      "profile_call_start",
      "model",
      "profile_call_finish",
      "profile_finalize",
    ])
  })

  it("records observed usage for an unsupported anchor without finalizing", async () => {
    let coverageDigest = ""
    const receipts: Array<{ status: string; inputTokens: number }> = []
    const badProfile = {
      ...supportedProfile,
      anchors: [
        {
          ...supportedProfile.anchors[0],
          textSha256: "f".repeat(64),
        },
      ],
    }
    await expect(
      runContentProfile({
        ...identity,
        video: transcriptVideo(),
        catalog: transcriptCatalog(),
        model: {
          async generate(input) {
            return {
              output: input.schema.parse(badProfile),
              usage: { inputTokens: 80, outputTokens: 20 },
            }
          },
        },
        persistence: {
          async register(input) {
            coverageDigest = input.coverageDigest
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              kind: "transcript" as const,
              state: "planned" as const,
              replay: false,
            }
          },
          async status(input) {
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              profile: {
                state: "planned" as const,
                kind: "transcript" as const,
                profileJson: null,
                finalCallId: null,
                coverageDigest,
              },
              calls: [],
            }
          },
          async callStart(input) {
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              callId: input.callId,
              state: "pending" as const,
              replay: false,
            }
          },
          async callFinish(input) {
            receipts.push({
              status: input.status,
              inputTokens: input.usage.inputTokens,
            })
            expect(input.node).toBeUndefined()
            expect(input.errorCode).toBe("profile_invalid")
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              callId: input.callId,
              state: "rejected" as const,
              receiptStored: true as const,
              nodeApplied: false,
              replay: false,
            }
          },
          async finalize() {
            throw new Error("unsupported profile must not finalize")
          },
        },
      }),
    ).rejects.toMatchObject({ code: "profile_invalid" })
    expect(receipts).toEqual([{ status: "rejected", inputTokens: 80 }])
  })

  it("rejects a gap in planned transcript coverage before a model reservation", () => {
    const plan = planContentProfile({
      video: transcriptVideo(),
      chunks: [oneChunk],
      maxPartBytes: identity.maxPartBytes,
      modelId: identity.modelId,
      backend: identity.backend,
      promptVersion: identity.promptVersion,
      schemaVersion: identity.schemaVersion,
    })
    plan.parts[0]!.input.fragments[0]!.startChar = 1
    expect(() => profileCoverageDigest(plan, [oneChunk])).toThrowError(
      "profile_invalid",
    )
  })

  it("keeps an unknown-usage reservation pending and never dispatches it again", async () => {
    let coverageDigest = ""
    let cacheKey = ""
    let pendingCall:
      | Awaited<ReturnType<ProfilePersistencePort["status"]>>["calls"][number]
      | undefined
    let invocations = 0
    const persistence: ProfilePersistencePort = {
      async register(input) {
        coverageDigest = input.coverageDigest
        cacheKey = input.cacheKey
        return {
          generationId: input.generationId,
          cacheKey,
          kind: "transcript",
          state: pendingCall ? "blocked_unknown" : "planned",
          replay: Boolean(pendingCall),
        }
      },
      async status(input) {
        return {
          generationId: input.generationId,
          cacheKey,
          profile: {
            state: pendingCall ? "blocked_unknown" : "planned",
            kind: "transcript",
            profileJson: null,
            finalCallId: null,
            coverageDigest,
          },
          calls: pendingCall ? [pendingCall] : [],
        }
      },
      async callStart(input) {
        pendingCall = {
          callId: input.callId,
          nodeKey: input.nodeKey,
          stage: input.stage,
          inputDigest: input.inputDigest,
          status: "pending",
          outputDigest: null,
          node: null,
        }
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          callId: input.callId,
          state: "pending",
          replay: false,
        }
      },
      async callFinish() {
        throw new Error("unknown usage cannot be journaled as known usage")
      },
      async finalize() {
        throw new Error("pending call cannot finalize")
      },
    }
    const args = {
      ...identity,
      video: transcriptVideo(),
      catalog: transcriptCatalog(),
      persistence,
      model: {
        async generate(): Promise<never> {
          invocations++
          throw new Error("process exited without a usage event")
        },
      },
    }
    await expect(runContentProfile(args)).rejects.toMatchObject({
      code: "usage_unknown",
    })
    await expect(runContentProfile(args)).rejects.toMatchObject({
      code: "usage_unknown",
    })
    expect(invocations).toBe(1)
  })

  it("reduces more than eight map parts with a complete postorder proof and reuses every receipt", async () => {
    const chunks = Array.from(
      { length: 17 },
      (_, index): Chunk => ({
        id: `chunk-${String(index).padStart(2, "0")}`,
        transcriptId: "transcript-one",
        language: "en",
        chunkIndex: index,
        text: `Part ${index}: ${"A complete selected transcript sentence. ".repeat(7)}`,
      }),
    )
    const longVideo = transcriptVideo()
    longVideo.transcriptSelection!.selected[0]!.totalChunks = chunks.length
    const smallerInput = { ...identity, maxPartBytes: 1_100 }
    const plan = planContentProfile({
      video: longVideo,
      chunks,
      maxPartBytes: smallerInput.maxPartBytes,
      modelId: smallerInput.modelId,
      backend: smallerInput.backend,
      promptVersion: smallerInput.promptVersion,
      schemaVersion: smallerInput.schemaVersion,
    })
    expect(plan.parts.length).toBeGreaterThan(8)
    let profileState: ProfileState = "planned"
    let coverageDigest = ""
    let finalCallId: string | null = null
    let finalProfile: typeof supportedProfile | null = null
    const calls: Awaited<
      ReturnType<ProfilePersistencePort["status"]>
    >["calls"] = []
    const callStarts: Array<{
      callId: string
      stage: "map" | "reduce"
      childCallIds?: string[]
    }> = []
    let modelCalls = 0
    const persistence: ProfilePersistencePort = {
      async register(input) {
        coverageDigest = input.coverageDigest
        expect(input.partDigests).toHaveLength(plan.parts.length)
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          kind: "transcript",
          state: profileState,
          replay: profileState !== "planned",
        }
      },
      async status(input) {
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          profile: {
            state: profileState,
            kind: "transcript",
            profileJson: finalProfile,
            finalCallId,
            coverageDigest,
          },
          calls,
        }
      },
      async callStart(input) {
        profileState = "in_progress"
        callStarts.push({
          callId: input.callId,
          stage: input.stage,
          childCallIds: input.childCallIds,
        })
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          callId: input.callId,
          state: "pending",
          replay: false,
        }
      },
      async callFinish(input) {
        expect(input.status).toBe("succeeded")
        expect(input.node).toBeDefined()
        expect(input.outputDigest).toBeDefined()
        calls.push({
          callId: input.callId,
          nodeKey: input.nodeKey,
          stage: input.stage,
          inputDigest: input.inputDigest,
          status: "succeeded",
          outputDigest: input.outputDigest!,
          node: input.node!,
        })
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          callId: input.callId,
          state: "succeeded",
          receiptStored: true,
          nodeApplied: true,
          replay: false,
        }
      },
      async finalize(input) {
        expect(input.coverageDigest).toBe(coverageDigest)
        expect(input.expectedNodeDigests).toHaveLength(calls.length)
        const byCall = new Map(calls.map((call) => [call.callId, call]))
        const childIds = new Map(
          callStarts.map((call) => [call.callId, call.childCallIds ?? []]),
        )
        const postorder = (callId: string): string[] => [
          ...childIds.get(callId)!.flatMap(postorder),
          byCall.get(callId)!.outputDigest!,
        ]
        expect(input.expectedNodeDigests).toEqual(postorder(input.finalCallId))
        expect(
          calls.find((call) => call.callId === input.finalCallId)?.node,
        ).toMatchObject({
          coveredPartStart: 0,
          coveredPartEnd: plan.parts.length,
        })
        profileState = "ready"
        finalCallId = input.finalCallId
        finalProfile = calls.find((call) => call.callId === finalCallId)!.node!
          .profile as typeof supportedProfile
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          state: "ready",
          profileJson: finalProfile,
          finalCallId,
          replay: false,
        }
      },
    }
    const model: StructuredModel = {
      async generate(input) {
        modelCalls++
        return {
          output: input.schema.parse({ ...supportedProfile, anchors: [] }),
          usage: { inputTokens: 100, outputTokens: 20 },
        }
      },
    }
    const args = {
      ...smallerInput,
      video: longVideo,
      catalog: transcriptCatalog(chunks),
      persistence,
      model,
    }
    const first = await runContentProfile(args)
    expect(first.state).toBe("ready")
    expect(
      callStarts.filter((call) => call.stage === "reduce").length,
    ).toBeGreaterThan(1)
    const priorModelCalls = modelCalls
    const firstNode = calls[0]!.node!
    calls[0]!.node = {
      childNodeDigests: firstNode.childNodeDigests,
      coveredPartEnd: firstNode.coveredPartEnd,
      coveredPartStart: firstNode.coveredPartStart,
      profile: {
        anchors: firstNode.profile.anchors,
        citations: firstNode.profile.citations,
        places: firstNode.profile.places,
        people: firstNode.profile.people,
        themes: firstNode.profile.themes,
        summaryEnglish: firstNode.profile.summaryEnglish,
        version: firstNode.profile.version,
      },
    }
    const replay = await runContentProfile(args)
    expect(replay).toEqual(first)
    expect(modelCalls).toBe(priorModelCalls)
    calls[0]!.outputDigest = "f".repeat(64)
    await expect(runContentProfile(args)).rejects.toMatchObject({
      code: "profile_conflict",
    })
    expect(modelCalls).toBe(priorModelCalls)
  })

  it("does not finalize a successful receipt that Admin could not apply", async () => {
    let coverageDigest = ""
    let modelCalls = 0
    let finishCalls = 0
    await expect(
      runContentProfile({
        ...identity,
        video: transcriptVideo(),
        catalog: transcriptCatalog(),
        model: {
          async generate(input) {
            modelCalls++
            return {
              output: input.schema.parse(supportedProfile),
              usage: { inputTokens: 50, outputTokens: 10 },
            }
          },
        },
        persistence: {
          async register(input) {
            coverageDigest = input.coverageDigest
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              kind: "transcript" as const,
              state: "planned" as const,
              replay: false,
            }
          },
          async status(input) {
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              profile: {
                state: "planned" as const,
                kind: "transcript" as const,
                profileJson: null,
                finalCallId: null,
                coverageDigest,
              },
              calls: [],
            }
          },
          async callStart(input) {
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              callId: input.callId,
              state: "pending" as const,
              replay: false,
            }
          },
          async callFinish(input) {
            finishCalls++
            expect(input.status).toBe("succeeded")
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              callId: input.callId,
              state: "succeeded" as const,
              receiptStored: true as const,
              nodeApplied: false,
              replay: false,
            }
          },
          async finalize() {
            throw new Error("closed attempt must not finalize")
          },
        },
      }),
    ).rejects.toMatchObject({ code: "profile_unavailable" })
    expect(modelCalls).toBe(1)
    expect(finishCalls).toBe(1)
  })

  it("records a known provider failure with observed usage and never invents a charge", async () => {
    let coverageDigest = ""
    const receipts: Array<{
      status: string
      usage: {
        inputTokens: number
        outputTokens: number
        cachedInputTokens?: number
      }
      errorCode?: string
    }> = []
    await expect(
      runContentProfile({
        ...identity,
        video: transcriptVideo(),
        catalog: transcriptCatalog(),
        model: {
          async generate(): Promise<never> {
            throw Object.assign(
              new Error("provider stopped after completion"),
              {
                usage: { inputTokens: 96, outputTokens: 0 },
              },
            )
          },
        },
        persistence: {
          async register(input) {
            coverageDigest = input.coverageDigest
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              kind: "transcript" as const,
              state: "planned" as const,
              replay: false,
            }
          },
          async status(input) {
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              profile: {
                state: "planned" as const,
                kind: "transcript" as const,
                profileJson: null,
                finalCallId: null,
                coverageDigest,
              },
              calls: [],
            }
          },
          async callStart(input) {
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              callId: input.callId,
              state: "pending" as const,
              replay: false,
            }
          },
          async callFinish(input) {
            receipts.push({
              status: input.status,
              usage: input.usage,
              errorCode: input.errorCode,
            })
            expect(input).not.toHaveProperty("costUsd")
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              callId: input.callId,
              state: "failed" as const,
              receiptStored: true as const,
              nodeApplied: false,
              replay: false,
            }
          },
          async finalize() {
            throw new Error("failed call must not finalize")
          },
        },
      }),
    ).rejects.toThrow("provider stopped after completion")
    expect(receipts).toEqual([
      {
        status: "failed",
        usage: { inputTokens: 96, outputTokens: 0 },
        errorCode: "provider_unavailable",
      },
    ])
  })

  it("never dispatches the model when call reservation is refused", async () => {
    let coverageDigest = ""
    let modelCalls = 0
    await expect(
      runContentProfile({
        ...identity,
        video: transcriptVideo(),
        catalog: transcriptCatalog(),
        model: {
          async generate(): Promise<never> {
            modelCalls++
            throw new Error("model must not start")
          },
        },
        persistence: {
          async register(input) {
            coverageDigest = input.coverageDigest
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              kind: "transcript" as const,
              state: "planned" as const,
              replay: false,
            }
          },
          async status(input) {
            return {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              profile: {
                state: "planned" as const,
                kind: "transcript" as const,
                profileJson: null,
                finalCallId: null,
                coverageDigest,
              },
              calls: [],
            }
          },
          async callStart(): Promise<never> {
            throw new Error("capacity gate refused")
          },
          async callFinish() {
            throw new Error("no dispatch means no receipt")
          },
          async finalize() {
            throw new Error("no dispatch means no finalization")
          },
        },
      }),
    ).rejects.toThrow("capacity gate refused")
    expect(modelCalls).toBe(0)
  })
})
