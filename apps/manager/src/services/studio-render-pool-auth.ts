import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import {
  studioAttemptResultSchema,
  studioDigestSchema,
  studioIdSchema,
} from "@forge/studio-contracts"
import {
  STUDIO_RENDER_PROFILE,
  studioRenderAssignmentSchema,
} from "@forge/studio-contracts/render"

export const studioAssignedLeaseSchema = studioRenderAssignmentSchema
  .extend({
    attemptId: studioIdSchema,
    leaseId: z.uuid(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
const capabilitySchema = z
  .object({
    audience: z.literal("shorts-render-pool/1"),
    assignment: studioAssignedLeaseSchema,
    inputHash: studioDigestSchema,
    capabilityExpiresAt: z.number().int().positive(),
  })
  .strict()
export const studioPoolSettlementRecordSchema = z
  .object({
    attemptId: studioIdSchema,
    leaseId: z.uuid(),
    status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
    result: studioAttemptResultSchema,
  })
  .strict()
const settlementSchema = z
  .object({
    audience: z.literal("shorts-render-settlement/1"),
    assignment: studioAssignedLeaseSchema,
    inputHash: studioDigestSchema,
    record: studioPoolSettlementRecordSchema,
  })
  .strict()
const configSchema = studioRenderAssignmentSchema
  .omit({ dispatchId: true })
  .extend({
    workerKey: z.string().min(32).max(4096).regex(/^\S+$/),
    capabilityKey: z.string().min(32).max(4096).regex(/^\S+$/),
  })
  .strict()
export class StudioRenderPoolAuthorizationError extends Error {
  constructor() {
    super("Render pool authorization refused")
  }
}

/** Worker key is installed on the trusted host; capability key stays only in
 * Manager. Neither key nor any issued token enters an authored container.
 * This module grants transport access, never canonical eligibility. */
export class StudioRenderPoolAuth {
  private readonly config: z.infer<typeof configSchema>
  constructor(raw: z.infer<typeof configSchema>) {
    this.config = configSchema.parse(raw)
    if (this.config.workerKey === this.config.capabilityKey)
      throw new StudioRenderPoolAuthorizationError()
  }
  worker(header: string | null) {
    const digest = (value: string) =>
      createHash("sha256").update(value).digest()
    if (
      !timingSafeEqual(
        digest(header ?? ""),
        digest(`Bearer ${this.config.workerKey}`),
      )
    )
      throw new StudioRenderPoolAuthorizationError()
    return { poolId: this.config.poolId, workerId: this.config.workerId }
  }
  issue(
    raw: z.infer<typeof studioAssignedLeaseSchema>,
    inputHash: string,
    now = Date.now(),
  ) {
    const assignment = studioAssignedLeaseSchema.parse(raw)
    this.assertWorker(assignment)
    const payload = capabilitySchema.parse({
      audience: "shorts-render-pool/1",
      assignment,
      inputHash,
      // An expired receipt can obtain a fresh bounded retention window after
      // authenticating the pool key. The original execution lease never moves.
      capabilityExpiresAt:
        Math.max(assignment.expiresAt, now) + STUDIO_RENDER_PROFILE.retentionMs,
    })
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    return `${body}.${this.mac(body).toString("base64url")}`
  }
  lease(token: string | null, now = Date.now()) {
    try {
      if (
        !token ||
        token.length > 4096 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)
      )
        throw new StudioRenderPoolAuthorizationError()
      const [body, rawSignature] = token.split(".")
      const signature = Buffer.from(rawSignature!, "base64url")
      const expected = this.mac(body!)
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected)
      )
        throw new StudioRenderPoolAuthorizationError()
      const payload = capabilitySchema.parse(
        JSON.parse(Buffer.from(body!, "base64url").toString("utf8")),
      )
      this.assertWorker(payload.assignment)
      if (payload.capabilityExpiresAt <= now)
        throw new StudioRenderPoolAuthorizationError()
      return payload
    } catch {
      throw new StudioRenderPoolAuthorizationError()
    }
  }
  /** Not an execution capability. Its exact payload is persisted by the host
   * before finish; expiry must not prevent replay of a committed receipt. A
   * fresh lease transport capability is still required by the gateway. */
  sealSettlement(
    assignment: z.infer<typeof studioAssignedLeaseSchema>,
    inputHash: string,
    record: z.infer<typeof studioPoolSettlementRecordSchema>,
  ) {
    const payload = settlementSchema.parse({
      audience: "shorts-render-settlement/1",
      assignment,
      inputHash,
      record,
    })
    this.assertSettlement(payload)
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    return `${body}.${this.mac(body).toString("base64url")}`
  }
  settlement(token: string) {
    try {
      if (
        token.length > 1048576 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)
      )
        throw new StudioRenderPoolAuthorizationError()
      const [body, signature] = token.split(".")
      const actual = Buffer.from(signature!, "base64url"),
        expected = this.mac(body!)
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new StudioRenderPoolAuthorizationError()
      const payload = settlementSchema.parse(
        JSON.parse(Buffer.from(body!, "base64url").toString("utf8")),
      )
      this.assertSettlement(payload)
      return payload
    } catch {
      throw new StudioRenderPoolAuthorizationError()
    }
  }
  private assertSettlement(payload: z.infer<typeof settlementSchema>) {
    this.assertWorker(payload.assignment)
    if (
      payload.record.attemptId !== payload.assignment.attemptId ||
      payload.record.leaseId !== payload.assignment.leaseId
    )
      throw new StudioRenderPoolAuthorizationError()
  }
  private mac(body: string) {
    return createHmac("sha256", this.config.capabilityKey).update(body).digest()
  }
  private assertWorker(assignment: { poolId: string; workerId: string }) {
    if (
      assignment.poolId !== this.config.poolId ||
      assignment.workerId !== this.config.workerId
    )
      throw new StudioRenderPoolAuthorizationError()
  }
}
