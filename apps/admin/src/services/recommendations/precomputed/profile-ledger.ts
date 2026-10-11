import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import {
  assertPrecomputedObservedVersion,
  selectedTranscriptSelections,
} from "./catalog"
import { PrecomputedRecommendationError } from "./contract"

const id = z.string().trim().min(1).max(191)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative().max(2_147_483_647)
const failureCode = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/)
const base = z.object({
  generationId: id,
  generationInputDigest: digest,
  attemptId: z.uuid(),
})
const callBase = base.extend({
  callId: z.uuid(),
  cacheKey: digest,
  nodeKey: digest,
  stage: z.enum(["map", "reduce"]),
  stagePromptVersion: z.string().trim().min(1).max(100),
  inputDigest: digest,
  partIndex: z.number().int().min(0).max(63).optional(),
  childCallIds: z.array(z.uuid()).min(2).max(8).optional(),
})
export const profileActionSchema = z.discriminatedUnion("action", [
  base
    .extend({
      action: z.literal("profile_register"),
      cacheKey: digest,
      videoId: id,
      modelId: z.literal("gpt-6-astra"),
      backend: z.literal("codex_chatgpt_subscription"),
      promptVersion: z.string().trim().min(1).max(100),
      schemaVersion: z.string().trim().min(1).max(100),
      metadataDigest: digest,
      chunkDigest: digest,
      selectedTranscriptCount: count,
      selectedChunkCount: count,
      sourceTextBytes: count,
      partDigests: z.array(digest).max(64),
      coverageDigest: digest,
      kind: z.enum(["transcript", "metadata_only"]),
    })
    .strict(),
  callBase
    .extend({
      action: z.literal("profile_call_start"),
      startedAt: z.string().datetime(),
    })
    .strict(),
  callBase
    .extend({
      action: z.literal("profile_call_finish"),
      status: z.enum(["succeeded", "rejected", "failed"]),
      outputDigest: digest.optional(),
      node: z.unknown().optional(),
      usage: z
        .object({
          inputTokens: count.positive(),
          outputTokens: count,
          cachedInputTokens: count.optional(),
        })
        .strict(),
      errorCode: failureCode.optional(),
      finishedAt: z.string().datetime(),
    })
    .strict(),
  base
    .extend({
      action: z.literal("profile_finalize"),
      cacheKey: digest,
      finalCallId: z.uuid(),
      coverageDigest: digest,
      expectedNodeDigests: z.array(digest).min(1).max(127),
    })
    .strict(),
  z
    .object({
      action: z.literal("profile_status"),
      generationId: id,
      generationInputDigest: digest,
      cacheKey: digest,
    })
    .strict(),
])

const exactText = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim())
const nodeId = exactText(1, 191)
const anchorSchema = z
  .object({
    videoId: nodeId,
    chunkId: nodeId,
    transcriptId: nodeId,
    language: exactText(1, 64),
    chunkIndex: count,
    startChar: count,
    endChar: count,
    textSha256: digest,
    claimEnglish: exactText(12, 180),
  })
  .strict()
const profileSchema = z
  .object({
    version: z.literal("complete_profile_v1"),
    summaryEnglish: exactText(12, 600),
    themes: z.array(exactText(1, 80)).max(12),
    people: z.array(exactText(1, 80)).max(12),
    places: z.array(exactText(1, 80)).max(12),
    citations: z.array(exactText(1, 80)).max(12),
    anchors: z.array(anchorSchema).max(8),
  })
  .strict()
const nodeSchema = z
  .object({
    profile: profileSchema,
    coveredPartStart: count,
    coveredPartEnd: count,
    childNodeDigests: z.array(digest).max(8),
  })
  .strict()

type Tx = Prisma.TransactionClient
type Action = z.infer<typeof profileActionSchema>
type Profile = Awaited<
  ReturnType<Tx["recommendationPrecomputedContentProfile"]["findUnique"]>
>
type Call = Awaited<
  ReturnType<Tx["recommendationPrecomputedProfileCall"]["findUnique"]>
>
type Generation = {
  id: string
  status: string
  input_digest: string
  protocol_version: number
  input_mode: string
  input_snapshot_mode: string
  execution_backend: string | null
  model_id: string
  historical_qualification: unknown
  capacity_preflight: unknown
}
type Guards = {
  checkedGeneration: (
    tx: Tx,
    input: { generationId: string; generationInputDigest: string },
    exclusive?: boolean,
  ) => Promise<Generation>
  requireCapacityFresh: (generation: Generation) => void
  capacityIsFresh: (generation: Generation) => boolean
  reserveBudget: (
    tx: Tx,
    generationId: string,
    bytes: number,
  ) => Promise<number>
  hasOpenSubscriptionAttempt: (
    tx: Tx,
    generationId: string,
    attemptId?: string,
  ) => Promise<boolean>
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
function invalid(message: string): never {
  throw new PrecomputedRecommendationError("invalid", message)
}
function conflict(message: string): never {
  throw new PrecomputedRecommendationError("conflict", message)
}
const byteLength = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
const same = (a: unknown, b: unknown) => hash(a) === hash(b)
const json = (value: unknown) => value as Prisma.InputJsonValue

function requireCallShape(
  input: Extract<
    Action,
    { action: "profile_call_start" | "profile_call_finish" }
  >,
) {
  if (
    input.stage === "map"
      ? input.partIndex === undefined || input.childCallIds !== undefined
      : input.partIndex !== undefined ||
        !input.childCallIds ||
        new Set(input.childCallIds).size !== input.childCallIds.length
  )
    invalid("Profile call stage bindings differ")
}
function callBinding(
  call: NonNullable<Call>,
  input: Extract<
    Action,
    { action: "profile_call_start" | "profile_call_finish" }
  >,
) {
  return (
    call.attemptId === input.attemptId &&
    call.cacheKey === input.cacheKey &&
    call.nodeKey === input.nodeKey &&
    call.stage === input.stage &&
    call.stagePromptVersion === input.stagePromptVersion &&
    call.inputDigest === input.inputDigest &&
    call.partIndex === (input.partIndex ?? null) &&
    same(call.childCallIds, input.childCallIds ?? null)
  )
}
async function lockedProfile(tx: Tx, generationId: string, cacheKey: string) {
  const rows = await tx.$queryRaw<Array<{ cache_key: string }>>`
    SELECT cache_key FROM recommendation_precomputed_content_profile
    WHERE generation_id = ${generationId} AND cache_key = ${cacheKey} FOR UPDATE`
  if (!rows[0]) conflict("Profile is not registered")
  return tx.recommendationPrecomputedContentProfile.findUniqueOrThrow({
    where: { generationId_cacheKey: { generationId, cacheKey } },
  })
}
function identity(
  profile: NonNullable<Profile>,
  input: Extract<Action, { action: "profile_register" }>,
) {
  return (
    profile.videoId === input.videoId &&
    profile.modelId === input.modelId &&
    profile.backend === input.backend &&
    profile.promptVersion === input.promptVersion &&
    profile.schemaVersion === input.schemaVersion &&
    profile.metadataDigest === input.metadataDigest &&
    profile.chunkDigest === input.chunkDigest &&
    profile.selectedTranscriptCount === input.selectedTranscriptCount &&
    profile.selectedChunkCount === input.selectedChunkCount &&
    profile.sourceTextBytes === input.sourceTextBytes &&
    same(profile.partDigests, input.partDigests) &&
    profile.coverageDigest === input.coverageDigest &&
    profile.kind === input.kind
  )
}
async function validateAnchors(
  tx: Tx,
  videoId: string,
  cutoff: Date,
  anchors: z.infer<typeof anchorSchema>[],
) {
  try {
    await assertPrecomputedObservedVersion(tx, [videoId], cutoff)
  } catch {
    return false
  }
  if (!anchors.length) return true
  const selected =
    (await selectedTranscriptSelections(tx, [videoId])).get(videoId)
      ?.selected ?? []
  const selectedIds = new Set(selected.map((row) => row.transcriptId))
  if (
    anchors.some(
      (anchor) =>
        anchor.videoId !== videoId || !selectedIds.has(anchor.transcriptId),
    )
  )
    return false
  const chunks = await tx.videoTranscriptChunk.findMany({
    where: {
      id: { in: [...new Set(anchors.map((anchor) => anchor.chunkId))] },
    },
    select: {
      id: true,
      transcriptId: true,
      language: true,
      chunkIndex: true,
      rawSourceText: true,
      text: true,
    },
  })
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  return anchors.every((anchor) => {
    const chunk = byId.get(anchor.chunkId)
    const text = chunk?.rawSourceText ?? chunk?.text
    return (
      chunk &&
      text &&
      chunk.transcriptId === anchor.transcriptId &&
      chunk.language === anchor.language &&
      chunk.chunkIndex === anchor.chunkIndex &&
      anchor.endChar > anchor.startChar &&
      anchor.endChar <= text.length &&
      scalarBoundary(text, anchor.startChar) &&
      scalarBoundary(text, anchor.endChar) &&
      hashText(text.slice(anchor.startChar, anchor.endChar)) ===
        anchor.textSha256
    )
  })
}
function scalarBoundary(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) return true
  const before = value.charCodeAt(offset - 1)
  const after = value.charCodeAt(offset)
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  )
}
function hashText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
function publicCall(call: NonNullable<Call>) {
  return {
    callId: call.callId,
    nodeKey: call.nodeKey,
    stage: call.stage,
    inputDigest: call.inputDigest,
    status: call.status,
    nodeApplied: call.receiptNodeApplied === true,
    outputDigest: call.outputDigest,
    node: call.status === "succeeded" ? nodeSchema.parse(call.nodeJson) : null,
  }
}

export async function submitProfileAction(
  prisma: PrismaClient,
  raw: unknown,
  guards: Guards,
): Promise<Record<string, unknown>> {
  if (byteLength(raw) > 65_536) invalid("Profile action body exceeds 64 KiB")
  const parsed = profileActionSchema.safeParse(raw)
  if (!parsed.success) invalid("Invalid profile action payload")
  const input = parsed.data
  return prisma.$transaction(
    async (tx) => {
      const generation = await guards.checkedGeneration(
        tx,
        input,
        input.action === "profile_register",
      )
      if (
        generation.protocol_version !== 4 ||
        generation.execution_backend !== "codex_chatgpt_subscription" ||
        generation.model_id !== "gpt-6-astra"
      )
        conflict("Generation does not use the profile protocol")
      if (input.action === "profile_status") {
        const profile =
          await tx.recommendationPrecomputedContentProfile.findUnique({
            where: {
              generationId_cacheKey: {
                generationId: input.generationId,
                cacheKey: input.cacheKey,
              },
            },
          })
        if (!profile) conflict("Profile is not registered")
        const calls = await tx.recommendationPrecomputedProfileCall.findMany({
          where: { generationId: input.generationId, cacheKey: input.cacheKey },
          orderBy: [{ startedAt: "asc" }, { callId: "asc" }],
          take: 128,
        })
        if (calls.length > 127)
          conflict("Profile call history exceeds bounded status")
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          profile: {
            state: profile.state,
            kind: profile.kind,
            profileJson: profile.profileJson,
            finalCallId: profile.finalCallId,
            coverageDigest: profile.coverageDigest,
          },
          calls: calls.map(publicCall),
        }
      }
      const active = await guards.hasOpenSubscriptionAttempt(
        tx,
        input.generationId,
        input.attemptId,
      )
      if (input.action !== "profile_call_finish" && !active)
        conflict("Subscription attempt is inactive")
      if (input.action === "profile_register") {
        if (generation.status !== "incomplete") conflict("Generation is closed")
        const expectedKey = hash({
          revision: "complete-selected-profile-plan-v1",
          videoId: input.videoId,
          metadataDigest: input.metadataDigest,
          chunkDigest: input.chunkDigest,
          modelId: input.modelId,
          backend: input.backend,
          promptVersion: input.promptVersion,
          schemaVersion: input.schemaVersion,
          partDigests: input.partDigests,
        })
        if (expectedKey !== input.cacheKey)
          invalid("Profile cache identity differs")
        if (
          input.kind === "metadata_only"
            ? input.selectedTranscriptCount !== 0 ||
              input.selectedChunkCount !== 0 ||
              input.sourceTextBytes !== 0 ||
              input.partDigests.length !== 0
            : input.selectedTranscriptCount === 0 ||
              input.selectedChunkCount === 0 ||
              input.sourceTextBytes === 0 ||
              input.partDigests.length === 0
        )
          invalid("Profile content counts differ from kind")
        const manifest =
          await tx.recommendationPrecomputedBuildSource.findUnique({
            where: {
              generationId_sourceVideoId: {
                generationId: input.generationId,
                sourceVideoId: input.videoId,
              },
            },
          })
        if (!manifest)
          conflict("Video is outside the frozen generation manifest")
        let metadataFailure: string | null = null
        if (input.kind === "metadata_only") {
          const cutoff = (
            await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
              where: { id: input.generationId },
              select: { inputCutoff: true },
            })
          ).inputCutoff
          try {
            await assertPrecomputedObservedVersion(tx, [input.videoId], cutoff)
          } catch {
            metadataFailure = "profile_metadata_unavailable"
          }
          const selected = (
            await selectedTranscriptSelections(tx, [input.videoId])
          ).get(input.videoId)?.selected
          if (selected?.length) metadataFailure = "profile_transcript_available"
          const locale = await tx.videoLocale.findFirst({
            where: {
              videoId: input.videoId,
              status: "PUBLISHED",
              deletedAt: null,
              title: { not: null },
            },
            orderBy: [{ locale: "asc" }, { id: "asc" }],
            select: { title: true, description: true, snippet: true },
          })
          if (!locale?.title?.trim())
            metadataFailure = "profile_metadata_unavailable"
          else if (
            byteLength({
              title: locale.title,
              description: locale.description ?? locale.snippet ?? "",
            }) > 24_576
          )
            metadataFailure = "profile_metadata_oversized"
        }
        const previous =
          await tx.recommendationPrecomputedContentProfile.findUnique({
            where: {
              generationId_cacheKey: {
                generationId: input.generationId,
                cacheKey: input.cacheKey,
              },
            },
          })
        if (previous) {
          if (!identity(previous, input))
            conflict("Profile registration retry differs")
          if (previous.state === "ready" && metadataFailure)
            conflict("Metadata-only catalog changed after registration")
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            kind: previous.kind,
            state: previous.state,
            replay: true,
          }
        }
        guards.requireCapacityFresh(generation)
        await guards.reserveBudget(
          tx,
          input.generationId,
          Math.max(512, byteLength(input) + 256),
        )
        const isMetadata = input.kind === "metadata_only"
        await tx.recommendationPrecomputedContentProfile.create({
          data: {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            videoId: input.videoId,
            modelId: input.modelId,
            backend: input.backend,
            promptVersion: input.promptVersion,
            schemaVersion: input.schemaVersion,
            metadataDigest: input.metadataDigest,
            chunkDigest: input.chunkDigest,
            selectedTranscriptCount: input.selectedTranscriptCount,
            selectedChunkCount: input.selectedChunkCount,
            sourceTextBytes: input.sourceTextBytes,
            partDigests: json(input.partDigests),
            coverageDigest: input.coverageDigest,
            kind: input.kind,
            state: metadataFailure
              ? "invalid"
              : isMetadata
                ? "ready"
                : "planned",
            failureCode: metadataFailure,
            terminalAt: isMetadata ? new Date() : null,
          },
        })
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          kind: input.kind,
          state: metadataFailure ? "invalid" : isMetadata ? "ready" : "planned",
          replay: false,
        }
      }
      if (input.action === "profile_finalize") {
        if (generation.status !== "incomplete") conflict("Generation is closed")
        const finalizationDigest = hash([
          input.finalCallId,
          input.coverageDigest,
          input.expectedNodeDigests,
        ])
        const profile = await lockedProfile(
          tx,
          input.generationId,
          input.cacheKey,
        )
        if (profile.state === "ready") {
          if (
            profile.finalCallId !== input.finalCallId ||
            profile.coverageDigest !== input.coverageDigest ||
            profile.finalizationDigest !== finalizationDigest
          )
            conflict("Profile finalization retry differs")
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            state: "ready",
            profileJson: profile.profileJson,
            finalCallId: profile.finalCallId,
            replay: true,
          }
        }
        guards.requireCapacityFresh(generation)
        if (["invalid", "rejected", "failed"].includes(profile.state))
          conflict("Profile is terminal")
        const allCalls = await tx.recommendationPrecomputedProfileCall.findMany(
          {
            where: {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
            },
          },
        )
        if (allCalls.some((call) => call.status === "pending"))
          conflict("Unknown profile call consumption remains pending")
        const byId = new Map(allCalls.map((call) => [call.callId, call]))
        const seen = new Set<string>()
        const ordered: string[] = []
        let unappliedReceipt = false
        const walk = (
          callId: string,
        ): { start: number; end: number } | null => {
          if (seen.has(callId)) return null
          seen.add(callId)
          const call = byId.get(callId)
          if (call?.status === "succeeded" && call.receiptNodeApplied !== true)
            unappliedReceipt = true
          if (
            !call ||
            call.status !== "succeeded" ||
            call.receiptNodeApplied !== true ||
            !call.outputDigest ||
            !call.nodeJson ||
            call.coveredPartStart === null ||
            call.coveredPartEnd === null
          )
            return null
          const node = nodeSchema.safeParse(call.nodeJson)
          if (!node.success) return null
          const children = (call.childCallIds as string[] | null) ?? []
          if (call.stage === "map") {
            if (
              children.length ||
              call.partIndex === null ||
              call.coveredPartStart !== call.partIndex ||
              call.coveredPartEnd !== call.partIndex + 1 ||
              node.data.childNodeDigests.length
            )
              return null
          } else {
            if (
              children.length < 2 ||
              children.length > 8 ||
              node.data.childNodeDigests.length !== children.length
            )
              return null
            let cursor = call.coveredPartStart
            for (let i = 0; i < children.length; i++) {
              const child = walk(children[i]!)
              const childCall = byId.get(children[i]!)
              if (
                !child ||
                child.start !== cursor ||
                childCall?.outputDigest !== node.data.childNodeDigests[i]
              )
                return null
              cursor = child.end
            }
            if (cursor !== call.coveredPartEnd) return null
          }
          if (
            node.data.coveredPartStart !== call.coveredPartStart ||
            node.data.coveredPartEnd !== call.coveredPartEnd
          )
            return null
          ordered.push(call.outputDigest)
          return { start: call.coveredPartStart, end: call.coveredPartEnd }
        }
        const span = walk(input.finalCallId)
        if (unappliedReceipt)
          conflict("Unapplied profile receipt cannot be finalized")
        const finalCall = byId.get(input.finalCallId)
        const finalNode = nodeSchema.safeParse(finalCall?.nodeJson)
        const valid =
          profile.coverageDigest === input.coverageDigest &&
          span?.start === 0 &&
          span.end === (profile.partDigests as string[]).length &&
          finalNode.success &&
          same(ordered, input.expectedNodeDigests) &&
          byteLength(finalNode.data.profile) <= 4096 &&
          (await validateAnchors(
            tx,
            profile.videoId,
            (
              await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
                where: { id: input.generationId },
                select: { inputCutoff: true },
              })
            ).inputCutoff,
            finalNode.success ? finalNode.data.profile.anchors : [],
          ))
        if (!valid) {
          await tx.recommendationPrecomputedContentProfile.update({
            where: {
              generationId_cacheKey: {
                generationId: input.generationId,
                cacheKey: input.cacheKey,
              },
            },
            data: {
              state: "invalid",
              failureCode: "profile_coverage_invalid",
              terminalAt: new Date(),
            },
          })
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            state: "invalid",
            profileJson: null,
            finalCallId: null,
            replay: false,
          }
        }
        await guards.reserveBudget(
          tx,
          input.generationId,
          byteLength(finalNode.data.profile) + 256,
        )
        await tx.recommendationPrecomputedContentProfile.update({
          where: {
            generationId_cacheKey: {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
            },
          },
          data: {
            state: "ready",
            profileJson: json(finalNode.data.profile),
            finalCallId: input.finalCallId,
            finalizationDigest,
            terminalAt: new Date(),
          },
        })
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          state: "ready",
          profileJson: finalNode.data.profile,
          finalCallId: input.finalCallId,
          replay: false,
        }
      }
      requireCallShape(input)
      const profile = await lockedProfile(
        tx,
        input.generationId,
        input.cacheKey,
      )
      if (
        input.stagePromptVersion !== `${profile.promptVersion}:${input.stage}`
      )
        invalid("Profile stage prompt version differs")
      if (input.action === "profile_call_start") {
        if (generation.status !== "incomplete" || !active)
          conflict("Generation or attempt is closed")
        const existing =
          await tx.recommendationPrecomputedProfileCall.findUnique({
            where: {
              generationId_callId: {
                generationId: input.generationId,
                callId: input.callId,
              },
            },
          })
        if (existing) {
          if (
            !callBinding(existing, input) ||
            existing.startedAt.getTime() !== new Date(input.startedAt).getTime()
          )
            conflict("Profile call reservation retry differs")
          return {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            callId: input.callId,
            state: existing.status,
            outputDigest: existing.outputDigest,
            node: publicCall(existing).node,
            replay: true,
          }
        }
        guards.requireCapacityFresh(generation)
        if (["ready", "rejected", "invalid", "failed"].includes(profile.state))
          conflict("Profile is terminal")
        const existingCalls =
          await tx.recommendationPrecomputedProfileCall.count({
            where: {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
            },
          })
        if (existingCalls >= 127) conflict("Profile call limit reached")
        const pending = await tx.recommendationPrecomputedProfileCall.count({
          where: {
            generationId: input.generationId,
            cacheKey: input.cacheKey,
            status: "pending",
          },
        })
        if (pending)
          conflict("Unresolved profile call blocks a new reservation")
        const partDigests = profile.partDigests as string[]
        let nodeKey: string
        if (input.stage === "map") {
          if (
            input.partIndex === undefined ||
            input.partIndex >= partDigests.length
          )
            invalid("Map part binding differs")
          nodeKey = hash([
            input.cacheKey,
            input.stage,
            input.partIndex,
            input.stagePromptVersion,
          ])
        } else {
          const children =
            await tx.recommendationPrecomputedProfileCall.findMany({
              where: {
                generationId: input.generationId,
                callId: { in: input.childCallIds ?? [] },
                cacheKey: input.cacheKey,
              },
            })
          const byChildId = new Map(
            children.map((child) => [child.callId, child]),
          )
          let next: number | null = null
          const childNodeDigests: string[] = []
          for (const childId of input.childCallIds ?? []) {
            const child = byChildId.get(childId)
            if (
              !child ||
              child.status !== "succeeded" ||
              child.receiptNodeApplied !== true ||
              !child.outputDigest ||
              child.coveredPartStart === null ||
              child.coveredPartEnd === null ||
              (next !== null && child.coveredPartStart !== next)
            )
              conflict("Reduce children are unavailable or not contiguous")
            next = child.coveredPartEnd
            childNodeDigests.push(child.outputDigest)
          }
          nodeKey = hash([
            input.cacheKey,
            input.stage,
            childNodeDigests,
            input.stagePromptVersion,
          ])
        }
        if (nodeKey !== input.nodeKey) invalid("Profile node key differs")
        const completedNode =
          await tx.recommendationPrecomputedProfileCall.findFirst({
            where: {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
              nodeKey,
              status: "succeeded",
              receiptNodeApplied: true,
            },
            select: { callId: true },
          })
        if (completedNode)
          conflict("Profile node already has an accepted receipt")
        await guards.reserveBudget(tx, input.generationId, 3_072)
        await tx.recommendationPrecomputedProfileCall.create({
          data: {
            generationId: input.generationId,
            callId: input.callId,
            attemptId: input.attemptId,
            cacheKey: input.cacheKey,
            nodeKey: input.nodeKey,
            stage: input.stage,
            stagePromptVersion: input.stagePromptVersion,
            inputDigest: input.inputDigest,
            partIndex: input.partIndex ?? null,
            childCallIds: input.childCallIds
              ? json(input.childCallIds)
              : Prisma.DbNull,
            startedAt: new Date(input.startedAt),
            status: "pending",
          },
        })
        await tx.recommendationPrecomputedContentProfile.update({
          where: {
            generationId_cacheKey: {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
            },
          },
          data: { state: "in_progress" },
        })
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          callId: input.callId,
          state: "pending",
          replay: false,
        }
      }
      const call = await tx.recommendationPrecomputedProfileCall.findUnique({
        where: {
          generationId_callId: {
            generationId: input.generationId,
            callId: input.callId,
          },
        },
      })
      if (!call || !callBinding(call, input))
        conflict("Profile call receipt has no matching reservation")
      const receiptDigest = hash(input)
      if (call.status !== "pending") {
        if (call.receiptDigest !== receiptDigest)
          conflict("Profile call terminal receipt differs")
        return {
          generationId: input.generationId,
          cacheKey: input.cacheKey,
          callId: input.callId,
          state: call.status,
          receiptStored: true,
          nodeApplied: call.receiptNodeApplied,
          replay: true,
        }
      }
      if (new Date(input.finishedAt).getTime() < call.startedAt.getTime())
        invalid("Profile call finish predates reservation")
      const generationOpen = generation.status === "incomplete" && active
      const applicationOpen =
        generationOpen && guards.capacityIsFresh(generation)
      let acceptedNode: z.infer<typeof nodeSchema> | null = null
      let reason: string | null = null
      if (input.status === "succeeded") {
        const parsedNode = nodeSchema.safeParse(input.node)
        if (
          input.errorCode !== undefined ||
          !parsedNode.success ||
          byteLength(input.node) > 2048 ||
          input.outputDigest !==
            (parsedNode.success ? hash(parsedNode.data) : "")
        )
          reason = "profile_node_invalid"
        else {
          const node = parsedNode.data
          const children = (call.childCallIds as string[] | null) ?? []
          if (
            node.coveredPartEnd <= node.coveredPartStart ||
            node.coveredPartEnd > (profile.partDigests as string[]).length
          )
            reason = "profile_range_invalid"
          else if (
            call.stage === "map" &&
            (node.coveredPartStart !== call.partIndex ||
              node.coveredPartEnd !== call.partIndex! + 1 ||
              node.childNodeDigests.length)
          )
            reason = "profile_range_invalid"
          else if (call.stage === "reduce") {
            const childRows =
              await tx.recommendationPrecomputedProfileCall.findMany({
                where: {
                  generationId: input.generationId,
                  callId: { in: children },
                  cacheKey: input.cacheKey,
                },
              })
            const byId = new Map(
              childRows.map((child) => [child.callId, child]),
            )
            let cursor = node.coveredPartStart
            for (let i = 0; i < children.length; i++) {
              const child = byId.get(children[i]!)
              if (
                !child ||
                child.status !== "succeeded" ||
                child.receiptNodeApplied !== true ||
                child.coveredPartStart !== cursor ||
                child.outputDigest !== node.childNodeDigests[i]
              ) {
                reason = "profile_range_invalid"
                break
              }
              cursor = child.coveredPartEnd!
            }
            if (cursor !== node.coveredPartEnd) reason = "profile_range_invalid"
          }
          if (!reason) {
            const cutoff = (
              await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
                where: { id: input.generationId },
                select: { inputCutoff: true },
              })
            ).inputCutoff
            if (
              !(await validateAnchors(
                tx,
                profile.videoId,
                cutoff,
                node.profile.anchors,
              ))
            )
              reason = "profile_anchor_invalid"
          }
          if (!reason) acceptedNode = node
        }
      } else if (
        input.outputDigest !== undefined ||
        input.node !== undefined ||
        !input.errorCode
      )
        reason = "profile_receipt_invalid"
      const status = reason ? "rejected" : input.status
      const errorCode = reason ?? input.errorCode ?? null
      const nodeApplied =
        applicationOpen &&
        status === "succeeded" &&
        !["ready", "rejected", "invalid", "failed"].includes(profile.state)
      await tx.recommendationPrecomputedProfileCall.update({
        where: {
          generationId_callId: {
            generationId: input.generationId,
            callId: input.callId,
          },
        },
        data: {
          status,
          outputDigest: acceptedNode ? input.outputDigest : null,
          nodeJson: acceptedNode ? json(acceptedNode) : Prisma.DbNull,
          coveredPartStart: acceptedNode?.coveredPartStart ?? null,
          coveredPartEnd: acceptedNode?.coveredPartEnd ?? null,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          cachedInputTokens: input.usage.cachedInputTokens ?? null,
          errorCode,
          finishedAt: new Date(input.finishedAt),
          receiptDigest,
          receiptNodeApplied: nodeApplied,
        },
      })
      if (
        applicationOpen &&
        status !== "succeeded" &&
        !["ready", "rejected", "invalid", "failed"].includes(profile.state)
      ) {
        await tx.recommendationPrecomputedContentProfile.update({
          where: {
            generationId_cacheKey: {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
            },
          },
          data: {
            state: status === "failed" ? "failed" : "rejected",
            failureCode: errorCode,
            terminalAt: new Date(),
          },
        })
      } else if (
        !applicationOpen &&
        !["ready", "rejected", "invalid", "failed"].includes(profile.state)
      ) {
        await tx.recommendationPrecomputedContentProfile.update({
          where: {
            generationId_cacheKey: {
              generationId: input.generationId,
              cacheKey: input.cacheKey,
            },
          },
          data: { state: "blocked_unknown" },
        })
      }
      return {
        generationId: input.generationId,
        cacheKey: input.cacheKey,
        callId: input.callId,
        state: status,
        receiptStored: true,
        nodeApplied,
        replay: false,
      }
    },
    { timeout: 30_000 },
  )
}
