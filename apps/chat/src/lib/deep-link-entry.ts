import type { ChatIdentity } from "@/auth/session-cookie"
import type { DeniedScreen } from "@/components/chat/denial-screens"

/**
 * The shells a `/c/<id>` open can resolve to (feat-209 KTD5, feat-399).
 *
 * `granted_unresolvable` is feat-399's addition: the visitor holds the FULL
 * gate grant but the id can never resolve (malformed segment). It is a
 * granted shell — live rail, live history, the URL layer owning the address
 * bar — that happens to open on the unavailable pane, NOT a denial shell.
 */
export type DeepLinkEntryKind =
  | "unavailable"
  | "sign_in"
  | "granted"
  | "granted_unresolvable"

/** Inputs the `/c/[id]` route resolves server-side before calling the resolver. */
export type DeepLinkEntryInput = {
  idValid: boolean
  authConfigured: boolean
  identity: ChatIdentity | null
  seekerEnabled: boolean
}

/**
 * Pure entry decision for a `/c/<id>` deep link (feat-209 KTD5, amended by
 * feat-399) — no React, no server-only imports; the route resolves the
 * inputs, maps the kind through `deepLinkShell`, and renders AppShell.
 *
 * The full grant is computed ONCE, above the ladder: both granted outcomes
 * read that single expression, so a malformed-id grant can never disagree
 * with a valid-id grant (they are the same boolean, not two ladders).
 *
 * Precedence, each earlier check winning:
 *
 * 1. `!idValid` → `granted_unresolvable` for a fully granted visitor
 *    (feat-399 — their rail and history stay alive; the pane tells them the
 *    link was broken), `unavailable` for everyone else. Still resolved
 *    BEFORE the identity branch, because signing in can never fix a
 *    malformed id (AE3/AE4) — a non-granted visitor must never be offered
 *    sign_in here.
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
  // The ONE grant expression. Rules 2-4 re-derive the same three conditions
  // as a ladder for the VALID-id path, which owes the visitor a screen per
  // cause; rule 5 is unreachable unless this is true.
  const granted = authConfigured && identity !== null && seekerEnabled
  if (!idValid)
    return { kind: granted ? "granted_unresolvable" : "unavailable" }
  if (!authConfigured) return { kind: "unavailable" }
  if (identity === null) return { kind: "sign_in" }
  if (!seekerEnabled) return { kind: "unavailable" }
  return { kind: "granted" }
}

/** The AppShell props a resolved entry maps to — the whole route mapping. */
export type DeepLinkShell = {
  /** Feeds AppShell's `seekerEnabled`: the gate grant, and with it the URL
   * hook, history hydration, and every session-mutating rail control. */
  seekerEnabled: boolean
  /** The SERVER-decided denial shell (inert rail). Undefined on both granted
   * kinds — feat-399's pane is a granted-shell pane, never this. */
  deniedScreen: DeniedScreen | undefined
  /** feat-399: open the granted shell on the unavailable pane. */
  deepLinkUnresolvable: boolean
}

/**
 * Kind → AppShell props. The ONE place the grant becomes a rendered shell,
 * so the route carries no conditionals of its own and the mapping is unit
 * testable (an async server component is not).
 *
 * Fail-closed by construction: `seekerEnabled: true` appears on exactly the
 * two granted kinds, and the `default` arm — unreachable while the switch is
 * exhaustive, which the `never` binding enforces at compile time — denies.
 */
export function deepLinkShell(kind: DeepLinkEntryKind): DeepLinkShell {
  switch (kind) {
    case "granted":
      return {
        seekerEnabled: true,
        deniedScreen: undefined,
        deepLinkUnresolvable: false,
      }
    case "granted_unresolvable":
      return {
        seekerEnabled: true,
        deniedScreen: undefined,
        deepLinkUnresolvable: true,
      }
    case "sign_in":
      return {
        seekerEnabled: false,
        deniedScreen: "sign_in",
        deepLinkUnresolvable: false,
      }
    case "unavailable":
      return {
        seekerEnabled: false,
        deniedScreen: "unavailable",
        deepLinkUnresolvable: false,
      }
    default:
      // Compile-time exhaustiveness: a new kind that forgets an arm above
      // fails to typecheck here rather than silently taking the deny below.
      return denyShell(kind)
  }
}

/** The deny fallback for `deepLinkShell`'s unreachable default arm. Taking
 * `never` is what makes the switch exhaustiveness check bite. */
function denyShell(kind: never): DeepLinkShell {
  void kind
  return {
    seekerEnabled: false,
    deniedScreen: "unavailable",
    deepLinkUnresolvable: false,
  }
}
