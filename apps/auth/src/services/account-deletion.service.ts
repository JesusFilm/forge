import {
  revokeAppleRefreshToken,
  type AppleNativeClientConfig,
} from "./apple-native.service"

/**
 * Account-deletion side effects (KTD12), strict: every side effect runs
 * BEFORE the user row is deleted. Any failure aborts deletion of the Auth
 * user row. Earlier external side effects may already have committed; this
 * is not a distributed
 * transaction. The user is asked to retry or contact support.
 *
 * Strict over best-effort (user-directed, 2026-08-04): both an Apple outage
 * and an account deletion are rare, so the combined odds are very low — and
 * the alternative is worse in a way the user cannot see or fix. Completing a
 * deletion whose side effects failed leaves a live Apple grant Apple's own
 * guidance requires revoking, or watch history orphaned in admin under a
 * user id that no longer exists anywhere. Neither is recoverable by the
 * person who asked to be deleted.
 *
 * Ordering is deliberate: revoke Apple first, erase second. The reverse
 * loses watch history on an aborted deletion.
 *
 * Absent erasure config is NOT a failure — the env vars are `.optional()`,
 * so an unprovisioned environment must still be able to delete accounts
 * (it logs a skip). Only a configured-but-failing admin aborts.
 *
 * A configured admin must also ACKNOWLEDGE learning-progress erasure
 * (feat-731): a 2xx without `learningProgressErased: true` comes from an
 * admin that predates it and left that data in place, so it aborts like any
 * other failed erasure rather than reporting a full deletion. Deploy admin
 * first. An ambiguous failure can leave learning writes fenced for a live
 * account. Never compensate automatically: a late erasure or stale write may
 * still be in flight. See apps/auth/docs/watch-learning-erasure-recovery.md.
 */

const ADMIN_ERASURE_TIMEOUT_MS = 5000

/** Aborts the deletion; the account row is untouched when this is thrown. */
export class AccountDeletionSideEffectError extends Error {
  constructor(
    readonly reason: string,
    readonly adminErasureMayHaveCommitted = false,
  ) {
    super(`account deletion aborted: ${reason}`)
    this.name = "AccountDeletionSideEffectError"
  }
}

export type AdminErasureConfig = {
  baseUrl: string
  apiKey: string
}

export type AccountDeletionDeps = {
  findAppleAccount: (
    userId: string,
  ) => Promise<{ refreshToken: string | null } | null>
  getAppleConfig: () => AppleNativeClientConfig | null
  getAdminErasureConfig: () => AdminErasureConfig | null
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

export function buildAccountDeletionHooks(deps: AccountDeletionDeps) {
  const log = deps.log ?? ((line: string) => console.warn(line))

  return {
    async beforeDelete(user: { id: string }) {
      await revokeAppleCredential(user.id)
      await eraseAdminWatchData(user.id)
    },
  }

  async function revokeAppleCredential(userId: string) {
    const appleConfig = deps.getAppleConfig()
    // A failed row read throws: deletion aborts with the account intact.
    const appleAccount = await deps.findAppleAccount(userId)
    if (!appleAccount?.refreshToken || !appleConfig) return

    const result = await revokeAppleRefreshToken(
      appleConfig,
      appleAccount.refreshToken,
    )
    if (!result.ok) {
      log(
        `[auth] event=account_deletion_apple_revocation_failed reason=${result.reason} userId=${userId}`,
      )
      throw new AccountDeletionSideEffectError(
        `apple_revocation_failed:${result.reason}`,
      )
    }
  }

  async function eraseAdminWatchData(userId: string) {
    const erasure = deps.getAdminErasureConfig()
    if (!erasure) {
      log(
        `[auth] event=account_deletion_admin_erasure_skipped reason=not_configured userId=${userId}`,
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
          // apps/web clears history through this same route with an
          // identical body. The reason makes account deletion erase learning
          // progress and record its permanent stale-write fence.
          body: JSON.stringify({ userId, reason: "account-deleted" }),
          signal: AbortSignal.timeout(ADMIN_ERASURE_TIMEOUT_MS),
        },
      )
    } catch {
      log(
        `[auth] event=account_deletion_admin_erasure_failed reason=network_error adminErasureMayHaveCommitted=true userId=${userId}`,
      )
      throw new AccountDeletionSideEffectError(
        "admin_erasure_unreachable",
        true,
      )
    }

    if (!response.ok) {
      log(
        `[auth] event=account_deletion_admin_erasure_failed status=${response.status} adminErasureMayHaveCommitted=true userId=${userId}`,
      )
      throw new AccountDeletionSideEffectError(
        `admin_erasure_rejected:${response.status}`,
        true,
      )
    }

    if (!(await acknowledgesLearningErasure(response))) {
      log(
        `[auth] event=account_deletion_admin_erasure_failed reason=learning_progress_unacknowledged adminErasureMayHaveCommitted=true userId=${userId}`,
      )
      throw new AccountDeletionSideEffectError(
        "admin_erasure_incomplete:learning_progress",
        true,
      )
    }
  }
}

async function acknowledgesLearningErasure(response: Response) {
  try {
    const body = (await response.json()) as {
      learningProgressErased?: unknown
    } | null
    return body?.learningProgressErased === true
  } catch {
    return false
  }
}
