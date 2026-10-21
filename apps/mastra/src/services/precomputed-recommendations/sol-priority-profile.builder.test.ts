import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { z } from "zod"

import {
  runContentProfile as runContentProfileActual,
  type CompactProfile,
  type ProfilePersistencePort,
  type ProfileState,
} from "./content-profile-executor"
import type { StructuredModel } from "./astra-provider"
import { CodexSubscriptionAstraError } from "./codex-subscription-astra"
import type { ReservationAwareStructuredModel } from "./codex-subscription-astra"
import type { Chunk, SourceCatalog, Video } from "./source-generation"

// Existing executor fixtures supply deterministic model output. Adapt them at
// the reservation seam so their receipt and replay assertions remain intact.
function runContentProfile(
  input: Omit<Parameters<typeof runContentProfileActual>[0], "model"> & {
    model: StructuredModel
  },
) {
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
  return runContentProfileActual({ ...input, model })
}

const identity = {
  generationId: "generation-one",
  generationInputDigest: "a".repeat(64),
  attemptId: "11111111-1111-4111-8111-111111111111",
  inputCutoff: "2026-10-06T20:48:05.001Z",
  modelId: "gpt-6.1-sol",
  backend: "codex_chatgpt_subscription",
  promptVersion: "complete-profile-v2",
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
function recordingProfilePersistence() {
  let coverageDigest = ""
  let state: ProfileState = "planned"
  let finalCallId: string | null = null
  let profileJson: CompactProfile | null = null
  const calls: Awaited<ReturnType<ProfilePersistencePort["status"]>>["calls"] =
    []
  const receipts: Parameters<ProfilePersistencePort["callFinish"]>[0][] = []
  const persistence: ProfilePersistencePort = {
    async register(input) {
      coverageDigest = input.coverageDigest
      return {
        generationId: input.generationId,
        cacheKey: input.cacheKey,
        kind: input.kind,
        state,
        replay: false,
      }
    },
    async status(input) {
      return {
        generationId: input.generationId,
        cacheKey: input.cacheKey,
        profile: {
          state,
          kind: "transcript",
          profileJson,
          finalCallId,
          coverageDigest,
        },
        calls,
      }
    },
    async callStart(input) {
      state = "in_progress"
      return {
        generationId: input.generationId,
        cacheKey: input.cacheKey,
        callId: input.callId,
        state: "pending",
        replay: false,
      }
    },
    async callFinish(input) {
      receipts.push(input)
      if (input.node && input.outputDigest)
        calls.push({
          callId: input.callId,
          nodeKey: input.nodeKey,
          stage: input.stage,
          inputDigest: input.inputDigest,
          status: input.status,
          nodeApplied: true,
          node: input.node,
          outputDigest: input.outputDigest,
        })
      return {
        generationId: input.generationId,
        cacheKey: input.cacheKey,
        callId: input.callId,
        state: input.status,
        receiptStored: true,
        nodeApplied: input.status === "succeeded",
        replay: false,
      }
    },
    async finalize(input) {
      state = "ready"
      finalCallId = input.finalCallId
      profileJson = calls.find((call) => call.callId === finalCallId)!.node!
        .profile
      return {
        generationId: input.generationId,
        cacheKey: input.cacheKey,
        state,
        profileJson,
        finalCallId,
        replay: false,
      }
    },
  }
  return { persistence, receipts }
}

describe("priority-anchor revision keeps exact full-coverage protocol", () => {
  it.each(["ordinary", "rich", "empty", "unknown"])(
    "rehydrates priority v7 reducer references losslessly with full profile replay (%s)",
    async (mode) => {
      const chunks = Array.from(
        { length: mode === "rich" ? 17 : 2 },
        (_, index) => ({
          ...oneChunk,
          id: `reference-chunk-${String(index).padStart(2, "0")}`,
          chunkIndex: index,
          text: `Unique opening ${index}: ${"a".repeat(1000)}`,
        }),
      )
      const selected = transcriptVideo()
      selected.transcriptSelection!.selected[0]!.totalChunks = chunks.length
      const recorded = recordingProfilePersistence()
      let expectedAnchors: CompactProfile["anchors"] = []
      let dispatches = 0
      let reductions = 0
      let seenText = ""
      const fields =
        mode === "rich"
          ? {
              ...supportedProfile,
              summaryEnglish: "s".repeat(600),
              themes: Array(12).fill("t".repeat(80)),
              people: Array(12).fill("p".repeat(80)),
              places: Array(12).fill("l".repeat(80)),
              citations: Array(12).fill("c".repeat(80)),
            }
          : supportedProfile
      const args: Parameters<typeof runContentProfile>[0] = {
        ...identity,
        promptVersion: "complete-profile-v7-priority-anchors",
        maxPartBytes: 2000,
        video: selected,
        catalog: transcriptCatalog(chunks),
        persistence: recorded.persistence,
        model: {
          async generate(request) {
            dispatches++
            expect(request.system).toContain("first two distinct anchors")
            expect(request.system).toContain(
              "Do not invent a resolution, force two anchors",
            )
            expect(request.system).toContain("remaining anchors")
            expect(request.maxOutputTokens).toBe(2048)
            const schema = JSON.stringify(
              z.toJSONSchema(request.schema, {
                target: "draft-07",
                unrepresentable: "throw",
              }),
            )
            expect(schema).not.toContain('"oneOf"')
            expect(Buffer.byteLength(schema)).toBeLessThanOrEqual(128000)
            expect(
              Buffer.byteLength(request.system) +
                Buffer.byteLength(request.prompt) +
                Buffer.byteLength(schema),
            ).toBeLessThanOrEqual(65536)
            const data = JSON.parse(request.prompt) as {
              fragments?: Array<{
                chunkId: string
                fragmentIndex: number
                text: string
                spans?: Array<{ citationId: string | null; text: string }>
              }>
              children?: Array<{
                profile: Omit<CompactProfile, "anchors"> & {
                  anchors: Array<
                    CompactProfile["anchors"][number] & { anchorRef?: string }
                  >
                }
              }>
            }
            const fragment = data.fragments?.[0]
            if (data.fragments)
              seenText += data.fragments
                .flatMap(
                  (item) => item.spans?.map((span) => span.text) ?? [item.text],
                )
                .join("")
            if (data.children) reductions++
            const anchors =
              mode === "empty"
                ? []
                : fragment
                  ? Array.from({ length: 8 }, (_, index) => ({
                      ...(fragment.spans
                        ? {
                            citationId: fragment.spans.find(
                              (span) => span.citationId,
                            )!.citationId,
                          }
                        : {
                            chunkId: fragment.chunkId,
                            fragmentIndex: fragment.fragmentIndex,
                            excerpt: fragment.text.slice(0, 64),
                          }),
                      claimEnglish:
                        mode === "rich"
                          ? `${index}: ${"界".repeat(176)}`
                          : `The selected transcript supports claim ${index}.`,
                    }))
                  : data.children!.at(-1)!.profile.anchors.map((anchor) => ({
                      anchorRef:
                        mode === "unknown"
                          ? "foreign-child-reference"
                          : (anchor.anchorRef ?? "missing-reference"),
                    }))
            if (data.children)
              expectedAnchors = data.children
                .at(-1)!
                .profile.anchors.map((anchor) => {
                  const { anchorRef, ...original } = anchor
                  expect(anchorRef).toBeDefined()
                  return original
                })
            const usage = { inputTokens: 100, outputTokens: 20 }
            try {
              return {
                output: request.schema.parse({ ...fields, anchors }),
                usage,
              }
            } catch {
              throw new CodexSubscriptionAstraError("provider_invalid_output", {
                usage,
              })
            }
          },
        },
      }
      if (mode === "unknown") {
        await expect(runContentProfile(args)).rejects.toMatchObject({
          code: "provider_invalid_output",
          usage: { inputTokens: 100, outputTokens: 20 },
        })
        expect(recorded.receipts.at(-1)).toMatchObject({
          stage: "reduce",
          status: "rejected",
          errorCode: "profile_adapter_output_invalid",
        })
        return
      }
      const result = await runContentProfile(args)
      expect(result.state).toBe("ready")
      expect(result.profile).toEqual({ ...fields, anchors: expectedAnchors })
      expect(expectedAnchors).toHaveLength(mode === "empty" ? 0 : 8)
      expect(seenText).toBe(chunks.map((chunk) => chunk.text).join(""))
      expect(recorded.receipts.length).toBeLessThanOrEqual(127)
      if (mode === "rich") expect(reductions).toBeGreaterThan(1)
      expect(JSON.stringify(result.profile!.anchors)).toBe(
        JSON.stringify(expectedAnchors),
      )
      expect(
        recorded.receipts.every(
          (receipt) =>
            receipt.node &&
            Buffer.byteLength(JSON.stringify(receipt.node)) <= 16384,
        ),
      ).toBe(true)
      const beforeReplay = dispatches
      expect((await runContentProfile(args)).profile).toEqual(result.profile)
      expect(dispatches).toBe(beforeReplay)
    },
  )
})
