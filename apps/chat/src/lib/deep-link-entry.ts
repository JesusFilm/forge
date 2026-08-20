import type { ChatIdentity } from "@/auth/session-cookie"

/** The three shells a `/c/<id>` open can resolve to (feat-209 KTD5). */
export type DeepLinkEntryKind = "unavailable" | "sign_in" | "granted"

/** Inputs the `/c/[id]` route resolves server-side before calling the resolver. */
export type DeepLinkEntryInput = {
  idValid: boolean
  authConfigured: boolean
  identity: ChatIdentity | null
  seekerEnabled: boolean
}

/**
 * Pure entry decision for a `/c/<id>` deep link (feat-209 KTD5) — no React,
 * no server-only imports; the route resolves the inputs and maps the result
 * onto AppShell. Precedence, each earlier check winning:
 *
 * 1. `!idValid` → unavailable — before the identity check, because signing in
 *    can never fix a malformed id (AE3/AE4).
 * 2. `!authConfigured` → unavailable — before the identity branch: a deploy
 *    with no auth can never own a conversation, and a sign-in prompt there is
 *    a dead-end (the login route refuses to start a flow).
 * 3. `identity === null` → sign_in — the id is plausible and auth works, so
 *    the missing piece is the user.
 * 4. `!seekerEnabled` → unavailable — signed in but gate-denied.
 * 5. Otherwise → granted.
 */
export function resolveDeepLinkEntry({
  idValid,
  authConfigured,
  identity,
  seekerEnabled,
}: DeepLinkEntryInput): { kind: DeepLinkEntryKind } {
  if (!idValid) return { kind: "unavailable" }
  if (!authConfigured) return { kind: "unavailable" }
  if (identity === null) return { kind: "sign_in" }
  if (!seekerEnabled) return { kind: "unavailable" }
  return { kind: "granted" }
}
