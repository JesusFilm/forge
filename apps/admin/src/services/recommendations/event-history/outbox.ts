import { Prisma } from "@prisma/client"
import {
  MAX_EVENT_ENVELOPE_BYTES,
  parseRecommendationEventEnvelope,
  type RecommendationEventEnvelope,
} from "./envelope"

export class RecommendationOutboxCapacityError extends Error {
  constructor() {
    super("Recommendation event outbox capacity exhausted")
  }
}

export class RecommendationOutboxConflictError extends Error {
  constructor() {
    super("Recommendation event identity conflicts with pending payload")
  }
}

export type OutboxLimits = { maxEvents: number; maxBytes: number }
export type ClaimedRecommendationEvent = {
  id: string
  token: string
  attempts: number
  envelope: RecommendationEventEnvelope
}

function positiveBound(value: number, name: string, ceiling: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
    throw new Error(`Invalid ${name}`)
}

function validDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new Error("Invalid outbox date")
}

// Caller supplies its own transaction so the operational admission and forwarding
// payload commit or roll back together. No network operation occurs here.
export async function enqueueRecommendationEvent(
  tx: Prisma.TransactionClient,
  envelope: RecommendationEventEnvelope,
  limits: OutboxLimits,
): Promise<"enqueued" | "duplicate"> {
  positiveBound(limits.maxEvents, "outbox event cap", 1_000_000_000)
  positiveBound(limits.maxBytes, "outbox byte cap", Number.MAX_SAFE_INTEGER)
  const valid = parseRecommendationEventEnvelope(JSON.stringify(envelope))
  const bytes = Buffer.byteLength(JSON.stringify(valid))
  if (bytes > MAX_EVENT_ENVELOPE_BYTES)
    throw new Error("Event envelope exceeds byte limit")
  if (new Date(valid.expiresAt).getTime() <= Date.now())
    throw new Error("Event already expired")
  await tx.$executeRaw`
    INSERT INTO recommendation_event_outbox_capacity (id, max_events, max_bytes)
    VALUES (1, ${limits.maxEvents}, ${BigInt(limits.maxBytes)}) ON CONFLICT (id) DO NOTHING
  `
  const [capacity] = await tx.$queryRaw<
    Array<{
      pending_events: number
      pending_bytes: bigint
      max_events: number
      max_bytes: bigint
    }>
  >`SELECT pending_events, pending_bytes, max_events, max_bytes
       FROM recommendation_event_outbox_capacity WHERE id = 1 FOR UPDATE`
  if (
    capacity.max_events !== limits.maxEvents ||
    capacity.max_bytes !== BigInt(limits.maxBytes)
  )
    throw new Error("Outbox capacity configuration differs from existing store")
  const [existing] = await tx.$queryRaw<Array<{ envelope: unknown }>>`
    SELECT envelope FROM recommendation_event_outbox
    WHERE family = ${valid.family} AND logical_id = ${valid.logicalId} AND revision = ${valid.revision}
  `
  if (existing) {
    const old = parseRecommendationEventEnvelope(
      JSON.stringify(existing.envelope),
    )
    if (
      old.payloadDigest === valid.payloadDigest &&
      old.occurredAt === valid.occurredAt &&
      old.acceptedAt === valid.acceptedAt &&
      old.expiresAt === valid.expiresAt
    )
      return "duplicate"
    throw new RecommendationOutboxConflictError()
  }
  if (
    capacity.pending_events >= limits.maxEvents ||
    capacity.pending_bytes + BigInt(bytes) > BigInt(limits.maxBytes)
  )
    throw new RecommendationOutboxCapacityError()
  await tx.$executeRaw`
    INSERT INTO recommendation_event_outbox
      (family, logical_id, revision, payload_digest, envelope, envelope_bytes, expires_at, due_at)
    VALUES (${valid.family}, ${valid.logicalId}, ${valid.revision}, ${valid.payloadDigest},
      ${JSON.stringify(valid)}::jsonb, ${bytes}, ${new Date(valid.expiresAt)}, ${new Date(valid.acceptedAt)})
  `
  await tx.$executeRaw`
    UPDATE recommendation_event_outbox_capacity
    SET pending_events = pending_events + 1, pending_bytes = pending_bytes + ${BigInt(bytes)}
    WHERE id = 1
  `
  return "enqueued"
}

export async function getRecommendationOutboxUsage(
  tx: Prisma.TransactionClient,
): Promise<{ events: number; bytes: number }> {
  const [row] = await tx.$queryRaw<
    Array<{ pending_events: number; pending_bytes: bigint }>
  >`
    SELECT pending_events, pending_bytes FROM recommendation_event_outbox_capacity WHERE id = 1
  `
  return {
    events: row?.pending_events ?? 0,
    bytes: Number(row?.pending_bytes ?? 0n),
  }
}

export async function claimRecommendationEvents(
  tx: Prisma.TransactionClient,
  options: { now: Date; limit: number; leaseMs: number },
): Promise<ClaimedRecommendationEvent[]> {
  validDate(options.now)
  positiveBound(options.limit, "claim limit", 100)
  positiveBound(options.leaseMs, "lease duration", 300_000)
  const until = new Date(options.now.getTime() + options.leaseMs)
  const rows = await tx.$queryRaw<
    Array<{
      id: string
      lease_token: string
      attempts: number
      envelope: unknown
      due_at: Date
      created_at: Date
    }>
  >`
    WITH due AS (
      SELECT id FROM recommendation_event_outbox
      WHERE due_at <= ${options.now} AND expires_at > ${options.now}
        AND (lease_token IS NULL OR leased_until <= ${options.now})
      ORDER BY due_at, created_at, id
      LIMIT ${options.limit} FOR UPDATE SKIP LOCKED
    )
    UPDATE recommendation_event_outbox AS event
    SET lease_token = gen_random_uuid(), leased_until = ${until}, attempts = attempts + 1
    FROM due WHERE event.id = due.id
    RETURNING event.id, event.lease_token, event.attempts, event.envelope, event.due_at, event.created_at
  `
  return rows
    .sort(
      (a, b) =>
        a.due_at.getTime() - b.due_at.getTime() ||
        a.created_at.getTime() - b.created_at.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((row) => ({
      id: row.id,
      token: row.lease_token,
      attempts: row.attempts,
      envelope: parseRecommendationEventEnvelope(JSON.stringify(row.envelope)),
    }))
}

export async function acknowledgeRecommendationEvents(
  tx: Prisma.TransactionClient,
  claims: readonly { id: string; token: string }[],
): Promise<number> {
  if (claims.length === 0) return 0
  positiveBound(claims.length, "acknowledgement batch", 100)
  await lockCapacity(tx)
  const pairs = Prisma.join(
    claims.map(({ id, token }) => Prisma.sql`(${id}::uuid, ${token}::uuid)`),
  )
  const rows = await tx.$queryRaw<Array<{ envelope_bytes: number }>>(Prisma.sql`
    DELETE FROM recommendation_event_outbox AS event
    USING (VALUES ${pairs}) AS claimed(id, token)
    WHERE event.id = claimed.id AND event.lease_token = claimed.token
    RETURNING event.envelope_bytes
  `)
  if (rows.length) await decrementCapacity(tx, rows)
  return rows.length
}

export async function deferRecommendationEvent(
  tx: Prisma.TransactionClient,
  id: string,
  token: string,
  dueAt: Date,
): Promise<boolean> {
  validDate(dueAt)
  const count = await tx.$executeRaw`
    UPDATE recommendation_event_outbox SET due_at = ${dueAt}, lease_token = NULL, leased_until = NULL
    WHERE id = ${id}::uuid AND lease_token = ${token}::uuid
  `
  return count === 1
}

export async function disposeExpiredRecommendationEvents(
  tx: Prisma.TransactionClient,
  options: { now: Date; limit: number },
): Promise<number> {
  validDate(options.now)
  positiveBound(options.limit, "expiry batch", 1000)
  await lockCapacity(tx)
  const rows = await tx.$queryRaw<Array<{ envelope_bytes: number }>>`
    WITH expired AS (
      SELECT id FROM recommendation_event_outbox WHERE expires_at <= ${options.now}
      ORDER BY expires_at, id LIMIT ${options.limit} FOR UPDATE SKIP LOCKED
    )
    DELETE FROM recommendation_event_outbox AS event USING expired
    WHERE event.id = expired.id RETURNING event.envelope_bytes
  `
  if (rows.length) await decrementCapacity(tx, rows)
  return rows.length
}

async function decrementCapacity(
  tx: Prisma.TransactionClient,
  rows: readonly { envelope_bytes: number }[],
): Promise<void> {
  const bytes = rows.reduce((sum, row) => sum + BigInt(row.envelope_bytes), 0n)
  await tx.$executeRaw`
    UPDATE recommendation_event_outbox_capacity
    SET pending_events = pending_events - ${rows.length}, pending_bytes = pending_bytes - ${bytes}
    WHERE id = 1
  `
}

async function lockCapacity(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM recommendation_event_outbox_capacity WHERE id = 1 FOR UPDATE`
}
