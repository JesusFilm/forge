import { StudioRenderPoolBindingError } from "./studio-render-pool-errors"
import { studioHash } from "@forge/studio-server"
import { z } from "zod"
import {
  studioAttemptResultSchema,
  studioDigestSchema,
  studioDocumentSchema,
  studioIdSchema,
} from "@forge/studio-contracts"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import {
  StudioRenderPoolAuth,
  studioAssignedLeaseSchema,
} from "./studio-render-pool-auth"
import { StudioRenderRetentionError } from "./studio-render-runner"
import { claimStudioPoolRender } from "./studio-render-pool-claim"

export const studioRenderSnapshotSchema = z.object({
  projectId: studioIdSchema,
  revision: z.number().int().positive(),
  inputHash: studioDigestSchema,
  document: studioDocumentSchema,
  executionProfile: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .refine(
      (value) =>
        Object.keys(value).length ===
          Object.keys(STUDIO_RENDER_PROFILE).length &&
        Object.entries(STUDIO_RENDER_PROFILE).every(
          ([key, expected]) => value[key] === expected,
        ),
      "Unsupported immutable render profile",
    ),
})
export type StudioRenderSnapshot = z.infer<typeof studioRenderSnapshotSchema>
type Assignment = z.infer<typeof studioAssignedLeaseSchema>
type GatewayPort = {
  allowNewClaims?(): boolean
  call(command: string, input: unknown, signal: AbortSignal): Promise<unknown>
  prepare(snapshot: StudioRenderSnapshot, signal: AbortSignal): Promise<unknown>
  retain(
    snapshot: StudioRenderSnapshot,
    assignment: Assignment,
    output: Buffer,
    proof: unknown,
    signal: AbortSignal,
  ): Promise<z.infer<typeof studioAttemptResultSchema>>
}

/** Trusted gateway only. No caller-controlled canonical command, worker identity,
 * asset registration or source selector is exposed to the outbound worker. */
export class StudioRenderPoolGateway {
  constructor(
    private readonly auth: StudioRenderPoolAuth,
    private readonly port: GatewayPort,
  ) {}
  async claim(header: string | null, raw: unknown, signal: AbortSignal) {
    const worker = this.auth.worker(header)
    signal.throwIfAborted()
    const result = await claimStudioPoolRender(
      (command, input) => this.port.call(command, input, signal),
      worker,
      raw,
      signal,
      this.port.allowNewClaims?.() ?? true,
    )
    if (!result.assignment) return { ...result, capability: null }
    const snapshot = await this.snapshot(result.assignment, signal)
    signal.throwIfAborted()
    return {
      ...result,
      capability: this.auth.issue(result.assignment, snapshot.inputHash),
    }
  }
  async owns(token: string | null, signal: AbortSignal) {
    const capability = this.auth.lease(token)
    await this.bound(capability, signal)
    return this.current(capability.assignment, signal)
  }
  async input(token: string | null, signal: AbortSignal) {
    const capability = this.auth.lease(token)
    const snapshot = await this.bound(capability, signal)
    if (!(await this.current(capability.assignment, signal)))
      throw new StudioRenderPoolBindingError(
        "Render lease is no longer current",
      )
    const prepared = await this.port.prepare(snapshot, signal)
    // Source materialization can wait on remote storage. Never deliver bytes
    // after cancellation/reassignment committed during those waits.
    if (!(await this.current(capability.assignment, signal)))
      throw new StudioRenderPoolBindingError(
        "Render lease is no longer current",
      )
    return {
      assignment: capability.assignment,
      inputHash: snapshot.inputHash,
      prepared,
    }
  }
  async retain(token: string | null, raw: unknown, signal: AbortSignal) {
    const capability = this.auth.lease(token)
    const snapshot = await this.bound(capability, signal)
    const request = z
      .discriminatedUnion("status", [
        z
          .object({
            status: z.literal("SUCCEEDED"),
            output: z
              .string()
              .min(4)
              .max(Math.ceil(STUDIO_RENDER_PROFILE.outputBytes / 3) * 4),
            proof: z.unknown(),
          })
          .strict(),
        z.object({ status: z.enum(["FAILED", "CANCELLED"]) }).strict(),
      ])
      .parse(raw)
    let status = request.status
    let result: z.infer<typeof studioAttemptResultSchema> = {
      assets: [],
      costMicros: null,
      diagnostic:
        status === "CANCELLED"
          ? "Render execution cancelled or lease expired"
          : "Render execution failed",
    }
    if (request.status === "SUCCEEDED") {
      const output = Buffer.from(request.output, "base64")
      if (
        output.length > STUDIO_RENDER_PROFILE.outputBytes ||
        output.toString("base64") !== request.output
      )
        throw new StudioRenderPoolBindingError("Render output encoding refused")
      try {
        result = await this.port.retain(
          snapshot,
          capability.assignment,
          output,
          request.proof,
          signal,
        )
      } catch (error) {
        // Registered assets already have a canonical exact-lease edge. An
        // exhausted transfer signal must not discard their terminal envelope.
        if (!(error instanceof StudioRenderRetentionError)) throw error
        result = error.result
        status = "FAILED"
      }
    }
    return {
      settlement: this.auth.sealSettlement(
        capability.assignment,
        capability.inputHash,
        {
          attemptId: capability.assignment.attemptId,
          leaseId: capability.assignment.leaseId,
          status,
          result,
        },
      ),
    }
  }
  private async validatedSettlement(
    token: string | null,
    raw: unknown,
    signal: AbortSignal,
  ) {
    const capability = this.auth.lease(token)
    const request = z
      .object({ settlement: z.string().max(1048576) })
      .strict()
      .parse(raw)
    const sealed = this.auth.settlement(request.settlement)
    if (
      sealed.inputHash !== capability.inputHash ||
      Object.entries(capability.assignment).some(
        ([key, value]) => sealed.assignment[key as keyof Assignment] !== value,
      )
    )
      throw new StudioRenderPoolBindingError(
        "Render settlement binding changed",
      )
    await this.bound(capability, signal)
    return { capability, sealed }
  }
  async finish(token: string | null, raw: unknown, signal: AbortSignal) {
    const { sealed } = await this.validatedSettlement(token, raw, signal)
    // Late results and accepted retries remain canonical history.
    return this.port.call("finish", sealed.record, signal)
  }
  async receipt(token: string | null, raw: unknown, signal: AbortSignal) {
    const { capability, sealed } = await this.validatedSettlement(
      token,
      raw,
      signal,
    )
    const context = z
      .object({
        executions: z.array(
          z.object({
            leaseId: z.uuid(),
            requestHash: studioDigestSchema,
            admitted: z.boolean(),
          }),
        ),
      })
      .parse(
        await this.port.call(
          "context",
          capability.assignment.attemptId,
          signal,
        ),
      )
    signal.throwIfAborted()
    const receipt = context.executions.find(
      (value) => value.leaseId === capability.assignment.leaseId,
    )
    if (!receipt) return null
    if (receipt.requestHash !== studioHash(sealed.record))
      throw new StudioRenderPoolBindingError("Render receipt binding changed")
    return { admitted: receipt.admitted }
  }
  private async bound(
    capability: ReturnType<StudioRenderPoolAuth["lease"]>,
    signal: AbortSignal,
  ) {
    const a = capability.assignment
    const issued = studioAssignedLeaseSchema
      .extend({ expiresAt: z.coerce.date() })
      .parse(
        await this.port.call(
          "assigned",
          { poolId: a.poolId, workerId: a.workerId, dispatchId: a.dispatchId },
          signal,
        ),
      )
    if (
      issued.attemptId !== a.attemptId ||
      issued.leaseId !== a.leaseId ||
      issued.poolId !== a.poolId ||
      issued.workerId !== a.workerId ||
      issued.dispatchId !== a.dispatchId ||
      issued.expiresAt.getTime() !== a.expiresAt
    )
      throw new StudioRenderPoolBindingError(
        "Render assignment binding changed",
      )
    const snapshot = await this.snapshot(a, signal)
    if (snapshot.inputHash !== capability.inputHash)
      throw new StudioRenderPoolBindingError("Render input binding changed")
    signal.throwIfAborted()
    return snapshot
  }
  private async snapshot(a: Assignment, signal: AbortSignal) {
    return z
      .object({ snapshot: studioRenderSnapshotSchema })
      .parse(await this.port.call("context", a.attemptId, signal)).snapshot
  }
  private async current(a: Assignment, signal: AbortSignal) {
    // bound() already proved this dispatch has an immutable issued lease. Its
    // canonical replay predicate additionally checks attempt, revision and
    // publication/admission state; the older job-only owns predicate does not.
    const eligibility = z
      .object({ execute: z.boolean(), leaseId: z.uuid().nullable() })
      .parse(
        await this.port.call(
          "claim-assigned",
          {
            poolId: a.poolId,
            workerId: a.workerId,
            dispatchId: a.dispatchId,
            attemptId: a.attemptId,
          },
          signal,
        ),
      )
    if (eligibility.leaseId !== a.leaseId)
      throw new StudioRenderPoolBindingError(
        "Render assignment binding changed",
      )
    signal.throwIfAborted()
    return eligibility.execute && a.expiresAt > Date.now()
  }
}
