import { z } from "zod"

import {
  EdgeBatchExecutionError,
  type EdgeBatchPersistencePort,
} from "./edge-batch-executor"
import type { SourceIngest } from "./source-generation"

const id = z.string().min(1).max(191)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const count = z.number().int().nonnegative().max(2_147_483_647)
const terminal = z.enum(["succeeded", "rejected", "failed"])
const callState = z.enum(["pending", ...terminal.options])
const applicationState = z.enum([
  "pending",
  "applied_edges",
  "applied_empty",
  "stale_unapplied",
  "rejected_unapplied",
])
const identity = z.object({ generationId: id }).strict()
const member = z
  .object({
    sourceVideoId: id,
    applicationState,
    appliedRevision: count.nullable(),
    checkpointRevision: count,
  })
  .strict()
  .refine((value) => {
    const applied =
      value.applicationState === "applied_edges" ||
      value.applicationState === "applied_empty"
    return applied
      ? value.appliedRevision !== null &&
          value.appliedRevision === value.checkpointRevision
      : value.appliedRevision === null
  })
const members = z
  .array(member)
  .min(1)
  .max(2)
  .refine(
    (value) =>
      new Set(value.map((item) => item.sourceVideoId)).size === value.length,
  )
const candidate = z
  .object({
    targetVideoId: id,
    targetProfileKey: digest,
    poolRank: count.max(127),
  })
  .strict()
const startReply = identity.extend({
  callId: z.uuid(),
  state: callState,
  replay: z.boolean(),
  members,
})
const finishReply = identity.extend({
  callId: z.uuid(),
  state: terminal,
  receiptStored: z.literal(true),
  replay: z.boolean(),
  members,
})
const statusReply = identity.extend({
  sourceVideoId: id,
  sourceState: z.string().min(1).max(64),
  checkpointRevision: count,
  sourceCandidateCount: count.max(128).nullable(),
  sourceCandidateDigest: digest.nullable(),
  calls: z
    .array(
      z
        .object({
          callId: z.uuid(),
          attemptId: z.uuid(),
          status: callState,
          applicationState,
          pageIndex: count.max(127),
          candidatePageDigest: digest,
          candidates: z.array(candidate).min(1).max(8),
          appliedRevision: count.nullable(),
          startedAt: z.string().datetime(),
          finishedAt: z.string().datetime().nullable(),
          memberSourceVideoIds: z.array(id).min(1).max(2),
        })
        .strict(),
    )
    .max(64),
  nextCursor: z.uuid().nullable(),
})
const finalReply = identity
  .extend({
    sourceVideoId: id,
    sourceState: z.enum(["complete_edges", "complete_empty"]),
    acceptedCount: count.max(128),
    checkpointRevision: count,
    replay: z.boolean(),
  })
  .refine(
    (value) =>
      (value.sourceState === "complete_empty") === (value.acceptedCount === 0),
  )
const emptyReply = identity.extend({
  sourceVideoId: id,
  sourceState: z.literal("complete_empty"),
  acceptedCount: z.literal(0),
  checkpointRevision: count,
  replay: z.boolean(),
})

function fitsJson(value: unknown, maximum: number): boolean {
  try {
    const json = JSON.stringify(value)
    return json !== undefined && Buffer.byteLength(json, "utf8") <= maximum
  } catch {
    return false
  }
}

/** Validates the private Admin wire replies and never retries a mutation. */
export function createEdgeBatchPersistence(
  ingest: SourceIngest,
): EdgeBatchPersistencePort {
  async function request<T extends z.infer<typeof identity>>(
    schema: z.ZodType<T>,
    input: z.infer<typeof identity> & {
      callId?: string
      sourceVideoId?: string
    },
  ): Promise<T> {
    if (!fitsJson(input, 65_536))
      throw new EdgeBatchExecutionError("input_invalid")
    const raw = await ingest(input)
    // One status page contains at most 64 calls with eight bounded candidates each.
    if (!fitsJson(raw, 512 * 1024))
      throw new EdgeBatchExecutionError("batch_unavailable")
    const reply = schema.safeParse(raw)
    if (
      !reply.success ||
      reply.data.generationId !== input.generationId ||
      (input.callId !== undefined &&
        (!("callId" in reply.data) || reply.data.callId !== input.callId)) ||
      (input.sourceVideoId !== undefined &&
        (!("sourceVideoId" in reply.data) ||
          reply.data.sourceVideoId !== input.sourceVideoId))
    )
      throw new EdgeBatchExecutionError("batch_unavailable")
    return reply.data
  }
  return {
    async status(input) {
      const reply = await request(statusReply, input)
      if (
        (reply.sourceCandidateCount === null) !==
          (reply.sourceCandidateDigest === null) ||
        reply.calls.some(
          (call) => !call.memberSourceVideoIds.includes(input.sourceVideoId),
        )
      )
        throw new EdgeBatchExecutionError("batch_unavailable")
      return reply
    },
    async start(input) {
      const reply = await request(startReply, input)
      if (
        reply.members.length !== input.members.length ||
        reply.members.some(
          (member, index) =>
            member.sourceVideoId !== input.members[index]!.sourceVideoId,
        )
      )
        throw new EdgeBatchExecutionError("batch_unavailable")
      return reply
    },
    async finish(input) {
      const reply = await request(finishReply, input)
      if (reply.state !== input.status && reply.state !== "rejected")
        throw new EdgeBatchExecutionError("batch_unavailable")
      return reply
    },
    closeEmpty: (input) => request(emptyReply, input),
    finalizeSource: (input) => request(finalReply, input),
  }
}
