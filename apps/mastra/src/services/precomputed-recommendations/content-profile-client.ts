import { z } from "zod"
import {
  ContentProfileExecutionError,
  compactProfileSchema,
  profileNodeSchema,
  type ProfilePersistencePort,
} from "./content-profile-executor"
import type { SourceIngest } from "./source-generation"

const profileState = z.enum([
  "planned",
  "in_progress",
  "blocked_unknown",
  "ready",
  "rejected",
  "invalid",
  "failed",
])
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const identity = z
  .object({
    generationId: z.string().min(1).max(191),
    cacheKey: digest,
  })
  .strict()
const kind = z.enum(["transcript", "metadata_only"])
const terminalCallState = z.enum(["succeeded", "rejected", "failed"])
const callState = z.enum(["pending", ...terminalCallState.options])
const profile = compactProfileSchema.refine(
  (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 4_096,
)
const node = profileNodeSchema.refine(
  (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 2_048,
)
const registrationReply = identity.extend({
  kind,
  state: profileState,
  replay: z.boolean(),
})
const statusReply = identity.extend({
  profile: z
    .object({
      state: profileState,
      kind,
      profileJson: profile.nullable(),
      finalCallId: z.uuid().nullable(),
      coverageDigest: digest,
    })
    .strict(),
  calls: z
    .array(
      z
        .object({
          callId: z.uuid(),
          nodeKey: digest,
          stage: z.enum(["map", "reduce"]),
          inputDigest: digest,
          status: callState,
          nodeApplied: z.boolean(),
          outputDigest: digest.nullable(),
          node: node.nullable(),
        })
        .strict(),
    )
    .max(127),
})
const callStartReply = identity.extend({
  callId: z.uuid(),
  state: callState,
  replay: z.boolean(),
  outputDigest: digest.nullable().optional(),
  node: node.nullable().optional(),
})
const callFinishReply = identity.extend({
  callId: z.uuid(),
  state: terminalCallState,
  receiptStored: z.literal(true),
  nodeApplied: z.boolean(),
  replay: z.boolean(),
})
const finalizeReply = identity.extend({
  state: profileState,
  profileJson: profile.nullable(),
  finalCallId: z.uuid().nullable(),
  replay: z.boolean(),
})

function fitsJson(value: unknown, maxBytes: number): boolean {
  try {
    const text = JSON.stringify(value)
    return text !== undefined && Buffer.byteLength(text, "utf8") <= maxBytes
  } catch {
    return false
  }
}

/** Uses the existing authenticated transport; never retries a mutation. */
export function createContentProfilePersistence(
  ingest: SourceIngest,
): ProfilePersistencePort {
  async function request<T extends z.infer<typeof identity>>(
    schema: z.ZodType<T>,
    input: z.infer<typeof identity> & { callId?: string },
  ): Promise<T> {
    if (!fitsJson(input, 65_536))
      throw new ContentProfileExecutionError("profile_invalid")
    const raw = await ingest(input)
    // 127 bounded nodes plus their identities fit within this response ceiling.
    if (!fitsJson(raw, 512 * 1024))
      throw new ContentProfileExecutionError("profile_conflict")
    const reply = schema.safeParse(raw)
    if (
      !reply.success ||
      reply.data.generationId !== input.generationId ||
      reply.data.cacheKey !== input.cacheKey ||
      (input.callId !== undefined &&
        (!("callId" in reply.data) || reply.data.callId !== input.callId))
    )
      throw new ContentProfileExecutionError("profile_conflict")
    return reply.data
  }
  return {
    async register(input) {
      const reply = await request(registrationReply, input)
      if (reply.kind !== input.kind)
        throw new ContentProfileExecutionError("profile_conflict")
      return reply
    },
    status: (input) => request(statusReply, input),
    callStart: (input) => request(callStartReply, input),
    callFinish: (input) => request(callFinishReply, input),
    finalize: (input) => request(finalizeReply, input),
  }
}
