import { createHash, randomBytes } from "node:crypto"

/**
 * A per-request OAuth `state` plus a PKCE `code_verifier` / S256 `code_challenge`
 * (R8). Direct port of apps/admin/src/auth/oauth-state.ts — the plumbing is
 * production-proven against apps/auth and chat does not diverge here.
 */
export type OAuthState = {
  state: string
  codeVerifier: string
  codeChallenge: string
}

/** Generate a fresh `state` + PKCE pair for a single sign-in attempt. */
export function createOAuthState(): OAuthState {
  const codeVerifier = base64Url(randomBytes(32))

  return {
    state: base64Url(randomBytes(24)),
    codeVerifier,
    codeChallenge: base64Url(
      createHash("sha256").update(codeVerifier).digest(),
    ),
  }
}

// Encode bytes as base64url (RFC 4648 §5, no padding) — URL-safe for the state
// / PKCE values that travel in query params and cookies.
export function base64Url(input: Buffer) {
  return input.toString("base64url")
}
