import {
  revokeAppleRefreshToken,
  type AppleNativeClientConfig,
} from "./apple-native.service"

/**
 * Account-deletion side effects (KTD12):
 * - beforeDelete: best-effort Apple token revocation, per Apple's deletion
 *   guidance. Apple being unreachable must not strand a user unable to delete
 *   their account, so revocation failures log and continue; only a failed
 *   account-row read throws (aborting the deletion with the account intact).
 * - afterDelete: erase the account's admin-side watch data through admin's
 *   internal watch-progress route. Degrades to no admin call when the env
 *   config is absent rather than failing the deletion.
 */

const ADMIN_ERASURE_TIMEOUT_MS = 5000

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
      const appleConfig = deps.getAppleConfig()
      // A failed row read throws: deletion aborts with the account intact.
      const appleAccount = await deps.findAppleAccount(user.id)

      if (!appleAccount?.refreshToken || !appleConfig) {
        return
      }

      const result = await revokeAppleRefreshToken(
        appleConfig,
        appleAccount.refreshToken,
      )
      if (!result.ok) {
        log(
          `[auth] event=account_deletion_apple_revocation_failed reason=${result.reason} userId=${user.id}`,
        )
      }
    },

    async afterDelete(user: { id: string }) {
      const erasure = deps.getAdminErasureConfig()
      if (!erasure) {
        log(
          `[auth] event=account_deletion_admin_erasure_skipped reason=not_configured userId=${user.id}`,
        )
        return
      }

      const fetchImpl = deps.fetchImpl ?? fetch
      try {
        const response = await fetchImpl(
          `${erasure.baseUrl.replace(/\/$/, "")}/api/internal/watch-progress`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${erasure.apiKey}`,
            },
            body: JSON.stringify({ userId: user.id }),
            signal: AbortSignal.timeout(ADMIN_ERASURE_TIMEOUT_MS),
          },
        )
        if (!response.ok) {
          log(
            `[auth] event=account_deletion_admin_erasure_failed status=${response.status} userId=${user.id}`,
          )
        }
      } catch {
        log(
          `[auth] event=account_deletion_admin_erasure_failed reason=network_error userId=${user.id}`,
        )
      }
    },
  }
}
