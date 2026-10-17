import { StudioRenderPoolBindingError } from "./studio-render-pool-errors"
import { studioHash } from "@forge/studio-server"
import { z } from "zod"
import {
  studioAttemptResultSchema,
  studioDigestSchema,
  studioDocumentSchema,
  studioIdSchema,
  studioAssetReferenceSchema,
  type StudioAssetReference,
} from "@forge/studio-contracts"
import {
  STUDIO_RENDER_PROFILE,
  studioRenderExecutionProfileSchema,
  studioRenderOutputPartSchema,
  STUDIO_RENDER_OUTPUT_PART_BYTES,
  STUDIO_RENDER_OUTPUT_MAX_PARTS,
} from "@forge/studio-contracts/render"
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
  executionProfile: studioRenderExecutionProfileSchema,
})
export type StudioRenderSnapshot = z.infer<typeof studioRenderSnapshotSchema>
type Assignment = z.infer<typeof studioAssignedLeaseSchema>
type GatewayPort = {
  upload(
    attemptId: string,
    leaseId: string,
    signal: AbortSignal,
  ): Promise<unknown>
  allowNewClaims?(): boolean
  call(command: string, input: unknown, signal: AbortSignal): Promise<unknown>
  prepare(
    snapshot: StudioRenderSnapshot,
    signal: AbortSignal,
    assignment: Assignment,
  ): Promise<unknown>
  retain(
    snapshot: StudioRenderSnapshot,
    assignment: Assignment,
    output: Buffer,
    proof: unknown,
    signal: AbortSignal,
  ): Promise<z.infer<typeof studioAttemptResultSchema>>
  retainPart?(
    snapshot: StudioRenderSnapshot,
    assignment: Assignment,
    part: z.infer<typeof studioRenderOutputPartSchema>,
    output: Buffer,
    signal: AbortSignal,
  ): Promise<StudioAssetReference>
  retainParts?(
    assignment: Assignment,
    parts: StudioAssetReference[],
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
    if (snapshot.executionProfile.id !== STUDIO_RENDER_PROFILE.id)
      throw new StudioRenderPoolBindingError("Legacy render execution refused")
    const prepared = await this.port.prepare(
      snapshot,
      signal,
      capability.assignment,
    )
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
  async retainPart(token: string | null, raw: unknown, signal: AbortSignal) {
    const capability = this.auth.lease(token)
    const snapshot = await this.bound(capability, signal)
    if (
      snapshot.executionProfile.id !== STUDIO_RENDER_PROFILE.id ||
      !this.port.retainPart
    )
      throw new StudioRenderPoolBindingError("Part retention unavailable")
    const { output: encoded, ...metadata } = z
      .object({
        ...studioRenderOutputPartSchema.shape,
        output: z
          .string()
          .min(4)
          .max(Math.ceil(STUDIO_RENDER_OUTPUT_PART_BYTES / 3) * 4),
      })
      .strict()
      .parse(raw)
    const part = studioRenderOutputPartSchema.parse(metadata)
    const remaining = part.retentionDeadlineMs - Date.now()
    if (remaining <= 0 || remaining > STUDIO_RENDER_PROFILE.retentionTransferMs)
      throw new StudioRenderPoolBindingError("Output part deadline refused")
    const output = Buffer.from(encoded, "base64")
    if (
      output.length !== part.byteSize ||
      output.toString("base64") !== encoded
    )
      throw new StudioRenderPoolBindingError("Output part encoding refused")
    signal.throwIfAborted()
    return {
      part: await this.port.retainPart(
        snapshot,
        capability.assignment,
        part,
        output,
        signal,
      ),
    }
  }
  async retain(token: string | null, raw: unknown, signal: AbortSignal) {
    const capability = this.auth.lease(token)
    const snapshot = await this.bound(capability, signal)
    const request = z
      .union([
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
        z
          .object({
            status: z.literal("SUCCEEDED"),
            parts: z
              .array(studioAssetReferenceSchema)
              .min(1)
              .max(STUDIO_RENDER_OUTPUT_MAX_PARTS),
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
      if (snapshot.executionProfile.id !== STUDIO_RENDER_PROFILE.id)
        throw new StudioRenderPoolBindingError(
          "Legacy render execution refused",
        )
      try {
        if ("parts" in request) {
          if (
            !this.port.retainParts ||
            new Set(request.parts.map((part) => part.versionId)).size !==
              request.parts.length
          )
            throw new StudioRenderPoolBindingError("Output parts refused")
          result = await this.port.retainParts(
            capability.assignment,
            request.parts,
            request.proof,
            signal,
          )
          // Admin preserves partial registrations as a normal RPC result. Only
          // a complete manifest can be sealed as a successful execution.
          if (!result.manifest) status = "FAILED"
        } else {
          const output = Buffer.from(request.output, "base64")
          if (
            output.length > STUDIO_RENDER_PROFILE.outputBytes ||
            output.toString("base64") !== request.output
          )
            throw new StudioRenderPoolBindingError(
              "Render output encoding refused",
            )
          result = await this.port.retain(
            snapshot,
            capability.assignment,
            output,
            request.proof,
            signal,
          )
        }
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
  async mux(token: string | null, raw: unknown, signal: AbortSignal) {
    const { capability, sealed } = await this.validatedSettlement(
      token,
      raw,
      signal,
    )
    const receipt = await this.receipt(token, raw, signal)
    if (
      !receipt ||
      !("admitted" in receipt) ||
      !receipt.admitted ||
      sealed.record.status !== "SUCCEEDED"
    )
      return { state: "skipped" }
    if (capability.assignment.expiresAt <= Date.now())
      throw new StudioRenderPoolBindingError("Mux upload lease expired")
    return this.port.upload(
      capability.assignment.attemptId,
      capability.assignment.leaseId,
      signal,
    )
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
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.keys(raw).length === 0
    ) {
      const capability = this.auth.lease(token)
      await this.bound(capability, signal)
      const context = z
        .object({
          executions: z.array(
            z.object({
              attemptId: studioIdSchema,
              leaseId: z.uuid(),
              status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
              result: studioAttemptResultSchema,
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
      const execution = context.executions.find(
        (value) => value.leaseId === capability.assignment.leaseId,
      )
      if (!execution) return null
      const record = {
        attemptId: execution.attemptId,
        leaseId: execution.leaseId,
        status: execution.status,
        result: execution.result,
      }
      if (
        record.attemptId !== capability.assignment.attemptId ||
        studioHash(record) !== execution.requestHash
      )
        throw new StudioRenderPoolBindingError(
          "Canonical execution binding changed",
        )
      signal.throwIfAborted()
      return {
        settlement: this.auth.sealSettlement(
          capability.assignment,
          capability.inputHash,
          record,
        ),
        receipt: { admitted: execution.admitted },
      }
    }
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
