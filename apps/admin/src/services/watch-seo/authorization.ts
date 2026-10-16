import type { PrismaClient } from "@prisma/client"

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
  | "role_not_admin"
  | "lookup_failed"
  | WatchSeoUserTokenFailure

export type WatchSeoAuthorization =
  | { ok: true; adminUserId: string }
  | { ok: false; reason: WatchSeoDenialReason }

type UserLookup = Pick<PrismaClient, "user">

/**
 * Dual authorization for the Watch SEO surface:
 *   1. a dedicated service key (this is Web's adapter calling), THEN
 *   2. a strictly verified Web user token (this is a signed-in person), THEN
 *   3. a live Admin database read: User.id === token `sub` and role === ADMIN.
 *
 * The service key is checked first and short-circuits so an unauthenticated
 * caller can never make Admin spend an Auth introspection round trip. Identity
 * is subject-only: no email match, no Manager membership, no cached role.
 */
export async function authorizeWatchSeoRequest(
  request: Request,
  db: UserLookup,
  deps: { verifyUserToken?: typeof verifyWatchSeoUserToken } = {},
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

  let user: { id: string; role: string } | null
  try {
    user = await db.user.findUnique({
      where: { id: token.subject },
      select: { id: true, role: true },
    })
  } catch {
    return { ok: false, reason: "lookup_failed" }
  }
  if (!user) return { ok: false, reason: "user_not_found" }
  if (user.role !== "ADMIN") return { ok: false, reason: "role_not_admin" }
  return { ok: true, adminUserId: user.id }
}
