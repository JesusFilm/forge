import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

import type { ConsumerLifecycleEvent } from "@/services/consumer-lifecycle.service"

const MAX_CLOCK_SKEW_MS = 5 * 60_000
const MAX_BODY_BYTES = 8_192
const SIGNATURE_PREFIX = "v1="

const lifecycleBodySchema = z
  .object({
    ownerSubject: z.string().min(1).max(255).regex(/^\S+$/),
    state: z.enum([
      "ACTIVE",
      "SUSPENDING",
      "SUSPENDED",
      "DISABLED",
      "DELETING",
      "DELETED",
    ]),
    version: z.string().regex(/^(0|[1-9][0-9]*)$/),
    sourceEventId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    activeLeaseExpiresAt: z.string().datetime().nullable(),
  })
  .strict()

export class ConsumerLifecycleSignatureError extends Error {
  constructor() {
    super("Invalid consumer lifecycle request.")
    this.name = "ConsumerLifecycleSignatureError"
  }
}

export async function verifyConsumerLifecycleRequest(
  request: Request,
  options: { secret: string; now?: () => Date },
): Promise<ConsumerLifecycleEvent> {
  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new ConsumerLifecycleSignatureError()
  }
  const timestamp = request.headers.get("x-forge-lifecycle-timestamp")
  const presented = request.headers.get("x-forge-lifecycle-signature")
  if (!timestamp || !presented?.startsWith(SIGNATURE_PREFIX)) {
    throw new ConsumerLifecycleSignatureError()
  }
  const timestampMs = Number(timestamp)
  const now = options.now?.() ?? new Date()
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(now.getTime() - timestampMs) > MAX_CLOCK_SKEW_MS
  ) {
    throw new ConsumerLifecycleSignatureError()
  }

  const body = await request.text()
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new ConsumerLifecycleSignatureError()
  }
  const expected = createHmac("sha256", options.secret)
    .update(`${timestamp}.${body}`)
    .digest()
  let actual: Buffer
  try {
    actual = Buffer.from(presented.slice(SIGNATURE_PREFIX.length), "hex")
  } catch {
    throw new ConsumerLifecycleSignatureError()
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ConsumerLifecycleSignatureError()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new ConsumerLifecycleSignatureError()
  }
  const result = lifecycleBodySchema.safeParse(parsed)
  if (!result.success) throw new ConsumerLifecycleSignatureError()
  const activeLeaseExpiresAt = result.data.activeLeaseExpiresAt
    ? new Date(result.data.activeLeaseExpiresAt)
    : null
  if ((result.data.state === "ACTIVE") !== (activeLeaseExpiresAt !== null)) {
    throw new ConsumerLifecycleSignatureError()
  }

  return {
    ownerSubject: result.data.ownerSubject,
    state: result.data.state,
    version: BigInt(result.data.version),
    sourceEventId: result.data.sourceEventId,
    activeLeaseExpiresAt,
  }
}
