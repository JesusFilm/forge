import { StudioRenderPoolBindingError } from "./studio-render-pool-errors"
import { z } from "zod"
import { studioIdSchema } from "@forge/studio-contracts"
import { studioRenderAssignmentSchema } from "@forge/studio-contracts/render"

const issuedSchema = studioRenderAssignmentSchema.extend({
  attemptId: studioIdSchema,
  leaseId: z.uuid(),
  expiresAt: z.coerce.date(),
})
const eligibilitySchema = z.object({
  execute: z.boolean(),
  leaseId: z.uuid().nullable(),
  expiresAt: z.number().int().positive().optional(),
})
type CanonicalCall = (command: string, input: unknown) => Promise<unknown>

/** Called only after dedicated worker-token authentication. Pool/worker are
 * trusted server configuration; the worker supplies only its durable UUID.
 * Canonical Admin leases remain the only assignment authority. */
export async function claimStudioPoolRender(
  call: CanonicalCall,
  worker: { poolId: string; workerId: string },
  raw: unknown,
  signal: AbortSignal,
  allowNew = true,
) {
  const input = z.object({ dispatchId: z.uuid() }).strict().parse(raw)
  const binding = studioRenderAssignmentSchema.parse({
    poolId: worker.poolId,
    workerId: worker.workerId,
    dispatchId: input.dispatchId,
  })
  async function prior() {
    const value = await call("assigned", binding)
    return value === null ? null : issuedSchema.parse(value)
  }
  async function resume(issued: z.infer<typeof issuedSchema>) {
    const eligibility = eligibilitySchema.parse(
      await call("claim-assigned", { ...binding, attemptId: issued.attemptId }),
    )
    if (eligibility.leaseId !== issued.leaseId)
      throw new StudioRenderPoolBindingError("Canonical assignment changed")
    return {
      execute: eligibility.execute,
      assignment: {
        ...binding,
        attemptId: issued.attemptId,
        leaseId: issued.leaseId,
        expiresAt: issued.expiresAt.getTime(),
      },
    }
  }
  const existing = await prior()
  if (existing) return resume(existing)
  if (!allowNew) return { execute: false, assignment: null }
  const pending = z
    .array(studioIdSchema)
    .max(100)
    .parse(await call("pending", null))
  for (const attemptId of pending) {
    signal.throwIfAborted()
    try {
      await call("enqueue", attemptId)
      const eligible = eligibilitySchema.parse(
        await call("claim-assigned", { ...binding, attemptId }),
      )
      if (eligible.leaseId) {
        const issued = await prior()
        if (!issued)
          throw new StudioRenderPoolBindingError(
            "Canonical assignment unconfirmed",
          )
        return resume(issued)
      }
    } catch (error) {
      // Another duplicate request may have bound this UUID while we selected a
      // candidate. Recover that receipt instead of selecting fresh work.
      const issued = await prior()
      if (issued) return resume(issued)
      throw error
    }
  }
  return { execute: false, assignment: null }
}
