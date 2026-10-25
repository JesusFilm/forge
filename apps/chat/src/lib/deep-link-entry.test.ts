import { describe, expect, it } from "vitest"

import type { ChatIdentity } from "@/auth/session-cookie"

import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  deepLinkShell,
  resolveDeepLinkEntry,
  type DeepLinkEntryKind,
} from "./deep-link-entry"

// Exhaustive BY CONSTRUCTION: `satisfies Record<DeepLinkEntryKind, true>` makes
// a new kind a compile error here, so the sweeps below can never silently skip
// one. A hand-written array would pass vacuously on a kind nobody added to it.
const ALL_KINDS = Object.keys({
  granted: true,
  granted_unresolvable: true,
  sign_in: true,
  unavailable: true,
} satisfies Record<DeepLinkEntryKind, true>) as DeepLinkEntryKind[]

// A signed-in-shaped identity: the gate-granted dogfooder claim set.
const identity: ChatIdentity = {
  sub: "user-1",
  email: "dogfooder@example.com",
  emailVerified: true,
}

describe("resolveDeepLinkEntry", () => {
  it("resolves an invalid id to unavailable, never sign_in, for anonymous (AE3/AE4)", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: false,
        authConfigured: true,
        identity: null,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  // RE-CUT by feat-399 (was: "unavailable even for a full-grant identity").
  // The denial for a full-grant visitor was feat-209's designed inertness and
  // the defect feat-399 fixes — their rail emptied on a typo'd link.
  it("resolves an invalid id to granted_unresolvable for a full-grant identity", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: false,
        authConfigured: true,
        identity,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "granted_unresolvable" })
  })

  // Three discriminating fixtures for the SAME malformed id, each holding
  // every OTHER axis permissive: deleting any one conjunct of the resolver's
  // single `granted` expression turns exactly one of them red.
  it("resolves an invalid id to unavailable when only the GATE is withheld", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: false,
        authConfigured: true,
        identity,
        seekerEnabled: false,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves an invalid id to unavailable when only AUTH CONFIG is withheld", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: false,
        authConfigured: false,
        identity,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves an invalid id to unavailable when only the IDENTITY is missing", () => {
    // Also the AE3/AE4 pin restated: never sign_in for a malformed id, even
    // with auth configured and the gate wide open.
    expect(
      resolveDeepLinkEntry({
        idValid: false,
        authConfigured: true,
        identity: null,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves unconfigured auth to unavailable for anonymous", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: false,
        identity: null,
        seekerEnabled: false,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves unconfigured auth to unavailable even with a signed-in-shaped identity", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: false,
        identity,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves a valid id with configured auth and no identity to sign_in", () => {
    // seekerEnabled: false is the discriminating fixture — sign_in must win
    // BEFORE the seekerEnabled check, or this would read unavailable.
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: true,
        identity: null,
        seekerEnabled: false,
      }),
    ).toEqual({ kind: "sign_in" })
  })

  it("resolves a signed-in but gate-denied user to unavailable", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: true,
        identity,
        seekerEnabled: false,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves a valid id with a gate-granted identity to granted", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: true,
        identity,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "granted" })
  })
})

describe("deepLinkShell", () => {
  // The security-shaped invariant of the whole route: seekerEnabled is the
  // gate grant, and it feeds the URL hook, history hydration, and every
  // session-mutating rail control. Exactly two kinds may carry it.
  it("grants the shell for exactly the two granted kinds", () => {
    const kinds: DeepLinkEntryKind[] = [
      "granted",
      "granted_unresolvable",
      "sign_in",
      "unavailable",
    ]
    expect(kinds.filter((kind) => deepLinkShell(kind).seekerEnabled)).toEqual([
      "granted",
      "granted_unresolvable",
    ])
  })

  it("never pairs a deniedScreen with a granted shell (the KTD5 belt)", () => {
    for (const kind of ALL_KINDS) {
      const shell = deepLinkShell(kind)
      expect(shell.seekerEnabled && shell.deniedScreen !== undefined).toBe(
        false,
      )
    }
  })

  it("maps granted to a plain live shell", () => {
    expect(deepLinkShell("granted")).toEqual({
      seekerEnabled: true,
      deniedScreen: undefined,
      deepLinkUnresolvable: false,
    })
  })

  it("maps granted_unresolvable to a live shell opening on the pane", () => {
    expect(deepLinkShell("granted_unresolvable")).toEqual({
      seekerEnabled: true,
      deniedScreen: undefined,
      deepLinkUnresolvable: true,
    })
  })

  it("maps sign_in to the inert sign-in denial shell", () => {
    expect(deepLinkShell("sign_in")).toEqual({
      seekerEnabled: false,
      deniedScreen: "sign_in",
      deepLinkUnresolvable: false,
    })
  })

  it("maps unavailable to the inert unavailable denial shell", () => {
    expect(deepLinkShell("unavailable")).toEqual({
      seekerEnabled: false,
      deniedScreen: "unavailable",
      deepLinkUnresolvable: false,
    })
  })

  it("denies an unknown kind — the unreachable default fails CLOSED", () => {
    // Deliberately SYNTHETIC (2026-08-20): the union has no fifth member, so
    // the cast is the only way to reach the default arm. The compile-time
    // `never` binding is the primary guard; this pins the runtime posture.
    expect(deepLinkShell("something_new" as DeepLinkEntryKind)).toEqual({
      seekerEnabled: false,
      deniedScreen: "unavailable",
      deepLinkUnresolvable: false,
    })
  })
})

describe("the /c/[id] route's wiring (source pin)", () => {
  // Closes the one-line revert this suite cannot otherwise see: an inline
  // kind compare back in the route compiles, typechecks and leaves every
  // behavioral test green. cwd is apps/chat under vitest.
  const routeSource = readFileSync(
    join(process.cwd(), "src/app/c/[id]/page.tsx"),
    "utf8",
  )

  it("reads the shell props from deepLinkShell, not an inline kind compare", () => {
    expect(routeSource).toContain("deepLinkShell(entry.kind)")
  })

  it("hands AppShell no hand-rolled grant expression", () => {
    // Anti-vacuous companion: proves the pin above is not satisfied by a file
    // that ALSO re-derives the grant inline. `entry.kind ===` appearing
    // anywhere in the route means the decision escaped the mapper.
    expect(routeSource).not.toContain("entry.kind ===")
  })
})
