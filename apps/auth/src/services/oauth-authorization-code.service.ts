import { createHash, randomBytes } from "node:crypto"

/**
 * Mints an OAuth authorization code that `@better-auth/oauth-provider`'s own
 * `/oauth2/token` handler will accept.
 *
 * ## Why this module exists
 *
 * The device grant has to end with a real OAuth token — `jfp_at_` prefixed,
 * audience-bound, carrying `customAccessTokenClaims`, introspectable by admin.
 * `@better-auth/oauth-provider@1.6.2` exports no token-minting function
 * (`createUserTokens` and friends are private, and the package's `exports` map
 * does not reach the internal chunk). Re-implementing issuance is the exact
 * `client_id`/scope drift that produced a real IdP account-takeover bug.
 *
 * So instead of minting tokens, we mint an *authorization code* and let the
 * library's already-hardened `handleAuthorizationCodeGrant` do the issuance. It
 * re-validates `client_id`, `redirect_uri`, PKCE, scope, user, and session
 * against the row we wrote — the drift hazard is structurally absent rather
 * than mitigated by a test.
 *
 * ## The coupling, stated plainly
 *
 * Authorization codes are `verification` rows. The library finds ours by
 * `identifier = base64url_unpadded(sha256(code))` and parses `value` as a
 * specific JSON shape. Both are internal conventions of a pinned dependency,
 * not public API. `oauth-authorization-code.service.test.ts` pins the hash
 * against the library's own primitives, and the integration test in
 * `device-grant.integration.test.ts` proves the whole exchange end to end
 * against a real database. If better-auth is upgraded and either goes red, this
 * module — not the callers — is what needs revisiting.
 */

const AUTHORIZATION_CODE_BYTES = 24

export type AuthorizationCodeQuery = {
  client_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
  code_challenge_method: string
}

export type MintedAuthorizationCode = {
  code: string
  identifier: string
  value: string
  expiresAt: Date
}

/**
 * Mirrors `storeToken(storageMethod = "hashed", …)` -> `defaultHasher` in
 * `@better-auth/oauth-provider`, which is
 * `base64Url.encode(sha256(value), { padding: false })`. Node's "base64url"
 * digest encoding is unpadded, so these agree byte for byte — pinned by test.
 */
export function authorizationCodeIdentifier(code: string): string {
  return createHash("sha256").update(code).digest("base64url")
}

export function buildAuthorizationCode(input: {
  query: AuthorizationCodeQuery
  userId: string
  sessionId: string
  authTime?: number
  codeExpiresInMs: number
  now?: Date
}): MintedAuthorizationCode {
  const now = input.now ?? new Date()
  const code = randomBytes(AUTHORIZATION_CODE_BYTES).toString("base64url")

  return {
    code,
    identifier: authorizationCodeIdentifier(code),
    // Field order and names follow `redirectWithAuthorizationCode`; the library
    // reads `type`, `query`, `userId`, `sessionId`, `referenceId`, `authTime`.
    //
    // `authTime` is MILLISECONDS. The library's own producer writes
    // `new Date(session.createdAt).getTime()` and its consumer,
    // `normalizeTimestampValue`, does `new Date(value)` — which reads a number
    // as ms. Seconds here would put `auth_time` in January 1970, and the value
    // is copied onto the refresh token, so every later refresh would carry it
    // too. Unit is stated because the shape alone does not reveal it.
    value: JSON.stringify({
      type: "authorization_code",
      query: input.query,
      userId: input.userId,
      sessionId: input.sessionId,
      authTime: input.authTime ?? now.getTime(),
    }),
    expiresAt: new Date(now.getTime() + input.codeExpiresInMs),
  }
}
