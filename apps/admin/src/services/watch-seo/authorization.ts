import type { PrismaClient } from "@prisma/client"

import { resolveAdminUserForSubject } from "@/auth/admin-subject-binding"
import {
  isValidWatchSeoServiceKey,
  isWatchSeoServiceKeyConfigured,
} from "@/auth/watch-seo-service-key"
import {
  verifyWatchSeoUserToken,
  type WatchSeoUserTokenFailure,
} from "@/auth/watch-seo-user-token"
import { WATCH_SEO_USER_TOKEN_HEADER } from "./contract"

/**
 * Internal denial vocabulary. It is logged server-side as an enum and NEVER
 * placed on the wire: every denial answers identically so a caller cannot
 * distinguish a bad key from a bad token from a non-Admin.
 */
export type WatchSeoDenialReason =
  | "config_absent"
  | "service_key_invalid"
  | "user_not_found"
  | "subject_binding_conflict"
  | "role_not_admin"
  | "lookup_failed"
  | "subject_rate_limited"
  | WatchSeoUserTokenFailure

export type WatchSeoAuthorization =
  | { ok: true; adminUserId: string }
  | { ok: false; reason: WatchSeoDenialReason }

type UserLookup = Pick<PrismaClient, "user" | "adminAuthSubjectBinding">

/**
 * Dual authorization for the Watch SEO surface:
 *   1. a dedicated service key (this is Web's adapter calling), THEN
 *   2. a strictly verified Web user token (this is a signed-in person), THEN
 *   3. a live Admin database read: the user the token `sub` is bound to by the
 *      verified Admin OAuth callback (or, for an unbound legacy user, the user
 *      whose id IS the subject), and that user's current role === ADMIN.
 *
 * The service key is checked first and short-circuits so an unauthenticated
 * caller can never make Admin spend an Auth introspection round trip. Identity
 * is subject-only: no email match, no Manager membership, no cached role.
 */
export async function authorizeWatchSeoRequest(
  request: Request,
  db: UserLookup,
  deps: {
    verifyUserToken?: typeof verifyWatchSeoUserToken
    admitSubject?: (subject: string) => Promise<boolean>
  } = {},
): Promise<WatchSeoAuthorization> {
  if (!isWatchSeoServiceKeyConfigured()) {
    return { ok: false, reason: "config_absent" }
  }
  if (!isValidWatchSeoServiceKey(request.headers.get("authorization"))) {
    return { ok: false, reason: "service_key_invalid" }
  }

  const token = await (deps.verifyUserToken ?? verifyWatchSeoUserToken)(
    request.headers.get(WATCH_SEO_USER_TOKEN_HEADER),
  )
  if (!token.ok) return { ok: false, reason: token.reason }
  if (deps.admitSubject && !(await deps.admitSubject(token.subject))) {
    return { ok: false, reason: "subject_rate_limited" }
  }

  let resolved: Awaited<ReturnType<typeof resolveAdminUserForSubject>>
  try {
    resolved = await resolveAdminUserForSubject(db, token.subject)
  } catch {
    return { ok: false, reason: "lookup_failed" }
  }
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  if (resolved.user.role !== "ADMIN") {
    return { ok: false, reason: "role_not_admin" }
  }
  return { ok: true, adminUserId: resolved.user.id }
}
