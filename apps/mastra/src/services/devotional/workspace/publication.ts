import { createHash, randomUUID } from "node:crypto"

import type { SitePublishResult } from "../site-publish-client"
import {
  getDevotionalDatabase,
  type DevotionalDatabase,
  type QueryExecutor,
} from "./database"

type PublicationIntentRow = {
  id: string
  attempt_id: string
  request_hash: string
  receiver_idempotency_key: string
  state: "pending" | "accepted" | "failed" | "ambiguous"
  receiver_reference: string | null
}

export type DurablePublicationResult = SitePublishResult & {
  replayed?: boolean
  ambiguous?: boolean
}

export function devotionalPublicationRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

async function lockIntent(
  client: QueryExecutor,
  attemptId: string,
): Promise<PublicationIntentRow | undefined> {
  const result = await client.query<PublicationIntentRow>(
    `select id, attempt_id, request_hash, receiver_idempotency_key, state,
            receiver_reference
       from devotional_workspace.publication_intents
      where attempt_id = $1
      for update`,
    [attemptId],
  )
  return result.rows[0]
}

async function prepareIntent(options: {
  database: DevotionalDatabase
  attemptId: string
  chapterId: string
  reservationId: string
  requestHash: string
  receiverIdempotencyKey: string
}): Promise<PublicationIntentRow> {
  return options.database.transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `devotional-publication:${options.attemptId}`,
    ])
    const existing = await lockIntent(client, options.attemptId)
    if (existing) {
      if (
        existing.request_hash !== options.requestHash ||
        existing.receiver_idempotency_key !== options.receiverIdempotencyKey
      ) {
        throw new Error("devotional publication idempotency conflict")
      }
      if (existing.state === "accepted" || existing.state === "failed") {
        return existing
      }
      const reservation = await client.query(
        `update devotional_workspace.clip_state
            set reservation_attempt_id = $3, updated_at = now()
          where chapter_id = $1 and reservation_id = $2`,
        [options.chapterId, options.reservationId, options.attemptId],
      )
      if (reservation.rowCount !== 1) {
        throw new Error("publication reservation no longer owns its clip")
      }
      return existing
    }
    const id = randomUUID()
    const inserted = await client.query<PublicationIntentRow>(
      `insert into devotional_workspace.publication_intents
        (id, attempt_id, request_hash, receiver_idempotency_key, state)
       values ($1, $2, $3, $4, 'pending')
       returning id, attempt_id, request_hash, receiver_idempotency_key, state,
                 receiver_reference`,
      [
        id,
        options.attemptId,
        options.requestHash,
        options.receiverIdempotencyKey,
      ],
    )
    if (!inserted.rows[0]) throw new Error("publication intent was not created")
    const reservation = await client.query(
      `update devotional_workspace.clip_state
          set reservation_attempt_id = $3, updated_at = now()
        where chapter_id = $1 and reservation_id = $2
        returning chapter_id`,
      [options.chapterId, options.reservationId, options.attemptId],
    )
    if (reservation.rowCount !== 1) {
      throw new Error("publication reservation no longer owns its clip")
    }
    return inserted.rows[0]
  })
}

async function markAmbiguous(
  database: DevotionalDatabase,
  attemptId: string,
): Promise<void> {
  await database.query(
    `update devotional_workspace.publication_intents
        set state = 'ambiguous', updated_at = now()
      where attempt_id = $1 and state in ('pending', 'ambiguous')`,
    [attemptId],
  )
}

async function failAndRelease(options: {
  database: DevotionalDatabase
  attemptId: string
  chapterId: string
  reservationId: string
}): Promise<void> {
  await options.database.transaction(async (client) => {
    const intent = await lockIntent(client, options.attemptId)
    if (!intent || intent.state === "accepted") return
    await client.query(
      `update devotional_workspace.publication_intents
          set state = 'failed', updated_at = now()
        where id = $1`,
      [intent.id],
    )
    await client.query(
      `update devotional_workspace.clip_state
          set reservation_id = null, reservation_attempt_id = null,
              pending_until = null, updated_at = now()
        where chapter_id = $1 and reservation_id = $2`,
      [options.chapterId, options.reservationId],
    )
  })
}

async function acceptAndRecord(options: {
  database: DevotionalDatabase
  attemptId: string
  chapterId: string
  reservationId: string
  receiverReference: string
  publishedAt?: Date
}): Promise<void> {
  await options.database.transaction(async (client) => {
    const intent = await lockIntent(client, options.attemptId)
    if (!intent) throw new Error("publication intent is unavailable")
    if (intent.state === "accepted") return
    if (intent.state === "failed") {
      throw new Error("failed publication intent cannot be accepted")
    }
    const publishedAt = options.publishedAt ?? new Date()
    const clip = await client.query(
      `update devotional_workspace.clip_state
          set use_count = use_count + 1, last_used_at = $3,
              reservation_id = null, reservation_attempt_id = null,
              pending_until = null, publication_id = $4, updated_at = now()
        where chapter_id = $1 and reservation_id = $2
        returning chapter_id`,
      [options.chapterId, options.reservationId, publishedAt, intent.id],
    )
    if (clip.rowCount !== 1) {
      throw new Error("publication reservation no longer owns its clip")
    }
    await client.query(
      `insert into devotional_workspace.publication_history
        (id, publication_intent_id, chapter_id, receiver_reference, published_at)
       values ($1, $2, $3, $4, $5)
       on conflict (publication_intent_id) do nothing`,
      [
        randomUUID(),
        intent.id,
        options.chapterId,
        options.receiverReference,
        publishedAt,
      ],
    )
    await client.query(
      `update devotional_workspace.publication_intents
          set state = 'accepted', receiver_reference = $2, updated_at = now()
        where id = $1`,
      [intent.id, options.receiverReference],
    )
  })
}

/**
 * Persists the intent before network I/O and commits publication history plus
 * clip usage in one transaction after an acknowledgement. Ambiguous outcomes
 * deliberately retain the reservation and replay the same receiver key.
 */
export async function publishWithDurableIntent(options: {
  database?: DevotionalDatabase
  attemptId: string
  chapterId: string
  reservationId: string
  requestHash: string
  receiverIdempotencyKey: string
  send: () => Promise<SitePublishResult>
}): Promise<DurablePublicationResult> {
  const database = options.database ?? getDevotionalDatabase()
  const intent = await prepareIntent({ ...options, database })
  if (intent.state === "accepted") {
    return { ok: true, published: true, replayed: true }
  }
  if (intent.state === "failed") {
    return {
      ok: false,
      reason: "upstream_failed",
      retryable: false,
      replayed: true,
    }
  }

  let result: SitePublishResult
  try {
    result = await options.send()
  } catch {
    await markAmbiguous(database, options.attemptId)
    return {
      ok: false,
      reason: "upstream_failed",
      retryable: true,
      ambiguous: true,
    }
  }

  if (result.ok && result.published) {
    await acceptAndRecord({
      database,
      attemptId: options.attemptId,
      chapterId: options.chapterId,
      reservationId: options.reservationId,
      receiverReference: options.receiverIdempotencyKey,
    })
    return result
  }

  if (!result.ok && result.reason === "upstream_failed" && result.retryable) {
    await markAmbiguous(database, options.attemptId)
    return { ...result, ambiguous: true }
  }

  await failAndRelease({ ...options, database })
  return result
}

export const _internals = {
  acceptAndRecord,
  failAndRelease,
  lockIntent,
  markAmbiguous,
  prepareIntent,
}
