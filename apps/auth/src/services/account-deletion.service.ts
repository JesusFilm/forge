import {
  revokeAppleRefreshToken,
  type AppleNativeClientConfig,
} from "./apple-native.service"
import {
  ConsumerLifecycleDeliveryError,
  SignedConsumerLifecycleSender,
  type ConsumerLifecycleDelivery,
} from "./consumer-lifecycle-outbox.service"

const ADMIN_ERASURE_TIMEOUT_MS = 5000

/** Aborts the deletion while the durable lifecycle remains fail-closed. */
export class AccountDeletionSideEffectError extends Error {
  constructor(readonly reason: string) {
    super(`account deletion aborted: ${reason}`)
    this.name = "AccountDeletionSideEffectError"
  }
}

export type AdminErasureConfig = {
  baseUrl: string
  apiKey: string
}

export type UserPlaylistDeletionConfig = {
  lifecycle: {
    endpoint: string
    secret: string
  }
  erasure: {
    endpoint: string
    apiKey: string
  }
}

export type AccountDeletionLifecycleEvent = ConsumerLifecycleDelivery & {
  status?: "PENDING" | "LEASED" | "DELIVERED" | "DEAD"
}

export type AccountDeletionDeps = {
  /**
   * Atomically enters DELETING and revokes sessions, delegated token families,
   * first-party token records, and user grants. An identical retry must return
   * the original version/event rather than emit a second transition.
   */
  beginDeleting: (userId: string) => Promise<AccountDeletionLifecycleEvent>
  markLifecycleDelivered?: (eventId: string) => Promise<void>
  findAppleAccount: (
    userId: string,
  ) => Promise<{ refreshToken: string | null } | null>
  getAppleConfig: () => AppleNativeClientConfig | null
  getAdminWatchErasureConfig: () => AdminErasureConfig | null
  getUserPlaylistDeletionConfig: () => UserPlaylistDeletionConfig | null
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

type PlaylistErasureAck = {
  receiptId: string
  idempotencyKey: string
  lifecycleVersion: string
  erasedCount: number
}

function isMatchingAck(
  value: unknown,
  expected: { idempotencyKey: string; lifecycleVersion: bigint },
): value is PlaylistErasureAck {
  if (typeof value !== "object" || value === null) return false
  const ack = value as Record<string, unknown>
  return (
    typeof ack.receiptId === "string" &&
    ack.receiptId.length > 0 &&
    ack.idempotencyKey === expected.idempotencyKey &&
    ack.lifecycleVersion === expected.lifecycleVersion.toString() &&
    typeof ack.erasedCount === "number" &&
    Number.isInteger(ack.erasedCount) &&
    ack.erasedCount >= 0
  )
}

/**
 * Executes one idempotent deletion-saga attempt. The Better Auth hook invokes
 * this synchronously before identity deletion; the retry command invokes the
 * same function for subjects already durably left in DELETING.
 *
 * Ordering is load-bearing: local authority is revoked first, Apple's refresh
 * credential is revoked before either Admin erasure, the matching DELETING
 * projection is acknowledged before playlist erasure, and identity deletion
 * is left to the caller only after this function returns successfully.
 */
export async function runAccountDeletionSaga(
  userId: string,
  deps: AccountDeletionDeps,
): Promise<void> {
  const log = deps.log ?? ((line: string) => console.warn(line))
  const event = await deps.beginDeleting(userId)
  if (event.ownerSubject !== userId || event.state !== "DELETING") {
    throw new AccountDeletionSideEffectError("invalid_deleting_transition")
  }

  await revokeAppleCredential(userId, deps, log)
  await eraseAdminPlaylistData(event, deps, log)
  await eraseAdminWatchData(userId, deps, log)
}

export function buildAccountDeletionHooks(deps: AccountDeletionDeps) {
  return {
    async beforeDelete(user: { id: string }) {
      await runAccountDeletionSaga(user.id, deps)
    },
  }
}

export interface AccountDeletionRetryStore {
  listDeleting(limit: number): Promise<Array<{ id: string; version: bigint }>>
  finalizeDeleting(input: { id: string; version: bigint }): Promise<void>
}

/** Scheduler-facing continuation for hooks that failed after entering DELETING. */
export class AccountDeletionRetryService {
  constructor(
    private readonly deps: AccountDeletionDeps,
    private readonly store: AccountDeletionRetryStore,
  ) {}

  async retryBatch(requestedLimit = 25): Promise<{
    attempted: number
    finalized: number
    failed: number
  }> {
    const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
    const pending = await this.store.listDeleting(limit)
    let finalized = 0
    let failed = 0
    for (const identity of pending) {
      try {
        await runAccountDeletionSaga(identity.id, this.deps)
        await this.store.finalizeDeleting(identity)
        finalized += 1
      } catch {
        // The durable DELETING state remains the retry queue and fail-closed
        // authorization source. A later scheduled attempt resumes it.
        failed += 1
      }
    }
    return { attempted: pending.length, finalized, failed }
  }
}

async function revokeAppleCredential(
  userId: string,
  deps: AccountDeletionDeps,
  log: (line: string) => void,
): Promise<void> {
  const appleConfig = deps.getAppleConfig()
  const appleAccount = await deps.findAppleAccount(userId)
  if (!appleAccount?.refreshToken || !appleConfig) return

  const result = await revokeAppleRefreshToken(
    appleConfig,
    appleAccount.refreshToken,
  )
  if (!result.ok) {
    log(
      `[auth] event=account_deletion_apple_revocation_failed reason=${result.reason}`,
    )
    throw new AccountDeletionSideEffectError(
      `apple_revocation_failed:${result.reason}`,
    )
  }
}

async function eraseAdminPlaylistData(
  event: AccountDeletionLifecycleEvent,
  deps: AccountDeletionDeps,
  log: (line: string) => void,
): Promise<void> {
  let config: UserPlaylistDeletionConfig | null
  try {
    config = deps.getUserPlaylistDeletionConfig()
  } catch {
    throw new AccountDeletionSideEffectError(
      "playlist_deletion_configuration_invalid",
    )
  }
  if (!config) {
    log(
      "[auth] event=account_deletion_playlist_erasure_failed reason=not_configured",
    )
    throw new AccountDeletionSideEffectError(
      "playlist_deletion_configuration_missing",
    )
  }

  if (event.status !== "DELIVERED") {
    try {
      await new SignedConsumerLifecycleSender({
        ...config.lifecycle,
        fetchImpl: deps.fetchImpl,
      }).send(event)
      await deps.markLifecycleDelivered?.(event.id)
    } catch (error) {
      const reason =
        error instanceof ConsumerLifecycleDeliveryError ? error.code : "unknown"
      log(
        `[auth] event=account_deletion_playlist_lifecycle_failed reason=${reason}`,
      )
      throw new AccountDeletionSideEffectError(
        `playlist_lifecycle_delivery_failed:${reason}`,
      )
    }
  }

  const idempotencyKey = `account-delete:${event.id}`
  const fetchImpl = deps.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(config.erasure.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${config.erasure.apiKey}`,
      },
      body: JSON.stringify({
        ownerSubject: event.ownerSubject,
        lifecycleVersion: event.version.toString(),
        idempotencyKey,
      }),
      signal: AbortSignal.timeout(ADMIN_ERASURE_TIMEOUT_MS),
    })
  } catch {
    log(
      "[auth] event=account_deletion_playlist_erasure_failed reason=network_error",
    )
    throw new AccountDeletionSideEffectError("playlist_erasure_unreachable")
  }

  if (!response.ok) {
    log(
      `[auth] event=account_deletion_playlist_erasure_failed status=${response.status}`,
    )
    throw new AccountDeletionSideEffectError(
      `playlist_erasure_rejected:${response.status}`,
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new AccountDeletionSideEffectError("playlist_erasure_invalid_ack")
  }
  if (
    !isMatchingAck(body, { idempotencyKey, lifecycleVersion: event.version })
  ) {
    throw new AccountDeletionSideEffectError("playlist_erasure_invalid_ack")
  }
}

async function eraseAdminWatchData(
  userId: string,
  deps: AccountDeletionDeps,
  log: (line: string) => void,
): Promise<void> {
  const erasure = deps.getAdminWatchErasureConfig()
  if (!erasure) {
    log(
      "[auth] event=account_deletion_admin_erasure_skipped reason=not_configured",
    )
    return
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(
      `${erasure.baseUrl.replace(/\/$/, "")}/api/internal/watch-progress`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${erasure.apiKey}`,
        },
        body: JSON.stringify({ userId, reason: "account-deleted" }),
        signal: AbortSignal.timeout(ADMIN_ERASURE_TIMEOUT_MS),
      },
    )
  } catch {
    log(
      "[auth] event=account_deletion_admin_erasure_failed reason=network_error",
    )
    throw new AccountDeletionSideEffectError("admin_erasure_unreachable")
  }

  if (!response.ok) {
    log(
      `[auth] event=account_deletion_admin_erasure_failed status=${response.status}`,
    )
    throw new AccountDeletionSideEffectError(
      `admin_erasure_rejected:${response.status}`,
    )
  }
}
