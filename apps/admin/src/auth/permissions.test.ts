import { describe, expect, it } from "vitest"
import {
  canArchiveExperience,
  canEditExperience,
  canEditExperienceLocale,
  canEditVideo,
  canPublishExperienceLocale,
  canViewExperience,
  canViewExperienceLocale,
  canWriteDerived,
  hasPermission,
  type PermissionKey,
} from "@/auth/permissions"
import {
  CONSUMER_BEARER_PRINCIPAL,
  MANAGER_BACKEND_PRINCIPAL,
  type Principal,
} from "@/auth/principal"

const PUBLIC_USER: Principal | null = null
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const MANAGER_OPERATOR_VIEWER: Principal = {
  id: "manager-1",
  role: "VIEWER",
  managerRole: "OPERATOR",
}
const EDITOR_ALICE: Principal = { id: "alice", role: "EDITOR" }
const EDITOR_BOB: Principal = { id: "bob", role: "EDITOR" }
const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const MANAGER_OPERATOR_ADMIN: Principal = {
  id: "manager-admin-1",
  role: "ADMIN",
  managerRole: "OPERATOR",
}
const SYSTEM: Principal = { id: null, role: "SYSTEM" }
const WEB_USER: Principal = {
  id: "auth-user-1",
  role: "WEB_USER",
  rateLimitBucketKey: "auth-user-1",
}

const EXPERIENCE_OWNED_BY_ALICE = {
  ownerId: "alice",
  archivedAt: null,
}
const EXPERIENCE_OWNED_BY_ALICE_ARCHIVED = {
  ownerId: "alice",
  archivedAt: new Date(),
}
const EXPERIENCE_NO_OWNER = {
  ownerId: null,
  archivedAt: null,
}

const PUBLISHED_LOCALE_OF_ALICE = {
  status: "PUBLISHED" as const,
  experience: EXPERIENCE_OWNED_BY_ALICE,
}
const DRAFT_LOCALE_OF_ALICE = {
  status: "DRAFT" as const,
  experience: EXPERIENCE_OWNED_BY_ALICE,
}
const ARCHIVED_LOCALE_OF_ALICE = {
  status: "ARCHIVED" as const,
  experience: EXPERIENCE_OWNED_BY_ALICE,
}

// -----------------------------------------------------------------------------
// hasPermission — tier matrix
// -----------------------------------------------------------------------------

describe("hasPermission — tier-based gate", () => {
  // Walks a permission key against every role tier.
  const cases: Array<{ key: PermissionKey; role: string; expected: boolean }> =
    [
      // PUBLIC reach
      { key: "read:reference", role: "PUBLIC", expected: true },
      { key: "read:experiences", role: "PUBLIC", expected: false },
      { key: "read:videos", role: "PUBLIC", expected: false },
      { key: "read:video-mapper-catalog", role: "PUBLIC", expected: false },
      { key: "read:media-assets", role: "PUBLIC", expected: false },
      { key: "access:manager", role: "PUBLIC", expected: false },
      { key: "read:manager-read-models", role: "PUBLIC", expected: false },
      { key: "write:experiences", role: "PUBLIC", expected: false },
      { key: "write:media-assets", role: "PUBLIC", expected: false },
      { key: "write:manager-jobs", role: "PUBLIC", expected: false },
      { key: "write:watch-events", role: "PUBLIC", expected: false },
      { key: "admin:all", role: "PUBLIC", expected: false },

      // VIEWER reach
      { key: "read:reference", role: "VIEWER", expected: true },
      { key: "read:experiences", role: "VIEWER", expected: true },
      { key: "read:videos", role: "VIEWER", expected: true },
      { key: "read:video-mapper-catalog", role: "VIEWER", expected: false },
      { key: "read:media-assets", role: "VIEWER", expected: false },
      { key: "access:manager", role: "VIEWER", expected: false },
      { key: "read:manager-read-models", role: "VIEWER", expected: false },
      { key: "write:experiences", role: "VIEWER", expected: false },
      { key: "write:media-assets", role: "VIEWER", expected: false },
      { key: "write:manager-jobs", role: "VIEWER", expected: false },
      { key: "write:watch-events", role: "VIEWER", expected: false },
      { key: "publish:experiences", role: "VIEWER", expected: false },

      // EDITOR reach
      { key: "read:experiences", role: "EDITOR", expected: true },
      { key: "write:experiences", role: "EDITOR", expected: true },
      { key: "publish:experiences", role: "EDITOR", expected: true },
      { key: "archive:experiences", role: "EDITOR", expected: true },
      { key: "read:media-assets", role: "EDITOR", expected: true },
      { key: "write:media-assets", role: "EDITOR", expected: true },
      { key: "access:manager", role: "EDITOR", expected: false },
      { key: "read:manager-read-models", role: "EDITOR", expected: false },
      { key: "write:manager-jobs", role: "EDITOR", expected: false },
      { key: "write:watch-events", role: "EDITOR", expected: false },
      { key: "delete:media-assets", role: "EDITOR", expected: false },
      { key: "write:videos", role: "EDITOR", expected: false },
      { key: "system:trigger-workflow", role: "EDITOR", expected: false },
      { key: "admin:all", role: "EDITOR", expected: false },

      // ADMIN gets everything editorial + sync triggers + admin:all
      { key: "read:experiences", role: "ADMIN", expected: true },
      { key: "read:video-mapper-catalog", role: "ADMIN", expected: true },
      { key: "write:experiences", role: "ADMIN", expected: true },
      { key: "write:videos", role: "ADMIN", expected: true },
      { key: "read:media-assets", role: "ADMIN", expected: true },
      { key: "write:media-assets", role: "ADMIN", expected: true },
      { key: "access:manager", role: "ADMIN", expected: false },
      { key: "read:manager-read-models", role: "ADMIN", expected: false },
      { key: "write:manager-jobs", role: "ADMIN", expected: false },
      { key: "write:watch-events", role: "ADMIN", expected: true },
      { key: "delete:media-assets", role: "ADMIN", expected: true },
      { key: "publish:experiences", role: "ADMIN", expected: true },
      { key: "system:trigger-workflow", role: "ADMIN", expected: true },
      { key: "admin:all", role: "ADMIN", expected: true },
      // ADMIN does NOT auto-satisfy SYSTEM-only gates intended for workflows.
      // Intentional? — the matrix says system:write-derived is SYSTEM-min;
      // ADMIN currently passes via the "ADMIN satisfies any tier" rule in
      // meetsTier, but explicitly: the workflow runtime authenticates as
      // SYSTEM, not ADMIN. We assert ADMIN passes (defensive override path).
      { key: "system:write-derived", role: "ADMIN", expected: true },

      // SYSTEM is workflow-only — never satisfies editorial gates.
      { key: "read:experiences", role: "SYSTEM", expected: false },
      { key: "read:video-mapper-catalog", role: "SYSTEM", expected: false },
      { key: "write:experiences", role: "SYSTEM", expected: false },
      { key: "read:media-assets", role: "SYSTEM", expected: false },
      { key: "write:media-assets", role: "SYSTEM", expected: false },
      { key: "access:manager", role: "SYSTEM", expected: false },
      { key: "read:manager-read-models", role: "SYSTEM", expected: false },
      { key: "write:manager-jobs", role: "SYSTEM", expected: false },
      { key: "write:watch-events", role: "SYSTEM", expected: false },
      { key: "system:write-derived", role: "SYSTEM", expected: true },
      { key: "system:trigger-workflow", role: "SYSTEM", expected: false },
    ]

  for (const { key, role, expected } of cases) {
    const principal =
      role === "PUBLIC"
        ? null
        : ({ id: `${role.toLowerCase()}-1`, role } as Principal)
    it(`${role} → ${key} = ${expected}`, () => {
      expect(hasPermission(principal, key)).toBe(expected)
    })
  }
})

describe("hasPermission — Manager membership gate", () => {
  it("grants Manager panel access only with ManagerRole.OPERATOR", () => {
    expect(hasPermission(MANAGER_OPERATOR_VIEWER, "access:manager")).toBe(true)
  })

  it("does not let Admin ADMIN bypass Manager membership", () => {
    expect(hasPermission(ADMIN, "access:manager")).toBe(false)
    expect(hasPermission(MANAGER_OPERATOR_ADMIN, "access:manager")).toBe(true)
  })
})

describe("hasPermission — Manager backend bearer gate", () => {
  it("grants backend read/job permissions without granting human panel access", () => {
    expect(
      hasPermission(MANAGER_BACKEND_PRINCIPAL, "read:manager-read-models"),
    ).toBe(true)
    expect(hasPermission(MANAGER_BACKEND_PRINCIPAL, "write:manager-jobs")).toBe(
      true,
    )
    expect(hasPermission(MANAGER_BACKEND_PRINCIPAL, "access:manager")).toBe(
      false,
    )
  })
})

describe("hasPermission — Web user bearer gate", () => {
  it("grants only watch-event writes", () => {
    expect(hasPermission(WEB_USER, "write:watch-events")).toBe(true)
    expect(hasPermission(WEB_USER, "read:videos")).toBe(false)
    expect(hasPermission(WEB_USER, "read:experiences")).toBe(false)
    expect(hasPermission(WEB_USER, "write:experiences")).toBe(false)
    expect(hasPermission(WEB_USER, "admin:all")).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// canViewExperience
// -----------------------------------------------------------------------------

describe("canViewExperience", () => {
  it("ADMIN sees archived", () => {
    expect(canViewExperience(ADMIN, EXPERIENCE_OWNED_BY_ALICE_ARCHIVED)).toBe(
      true,
    )
  })
  it("EDITOR sees archived (review needs)", () => {
    expect(
      canViewExperience(EDITOR_BOB, EXPERIENCE_OWNED_BY_ALICE_ARCHIVED),
    ).toBe(true)
  })
  it("VIEWER does not see archived", () => {
    expect(canViewExperience(VIEWER, EXPERIENCE_OWNED_BY_ALICE_ARCHIVED)).toBe(
      false,
    )
  })
  it("PUBLIC does not see archived", () => {
    expect(
      canViewExperience(PUBLIC_USER, EXPERIENCE_OWNED_BY_ALICE_ARCHIVED),
    ).toBe(false)
  })
  it("PUBLIC sees non-archived", () => {
    expect(canViewExperience(PUBLIC_USER, EXPERIENCE_OWNED_BY_ALICE)).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// canViewExperienceLocale
// -----------------------------------------------------------------------------

describe("canViewExperienceLocale", () => {
  it("ADMIN sees DRAFT", () => {
    expect(canViewExperienceLocale(ADMIN, DRAFT_LOCALE_OF_ALICE)).toBe(true)
  })
  it("EDITOR sees DRAFT (cross-editor review)", () => {
    expect(canViewExperienceLocale(EDITOR_BOB, DRAFT_LOCALE_OF_ALICE)).toBe(
      true,
    )
  })
  it("VIEWER sees PUBLISHED", () => {
    expect(canViewExperienceLocale(VIEWER, PUBLISHED_LOCALE_OF_ALICE)).toBe(
      true,
    )
  })
  it("VIEWER does NOT see DRAFT", () => {
    expect(canViewExperienceLocale(VIEWER, DRAFT_LOCALE_OF_ALICE)).toBe(false)
  })
  it("VIEWER does NOT see ARCHIVED", () => {
    expect(canViewExperienceLocale(VIEWER, ARCHIVED_LOCALE_OF_ALICE)).toBe(
      false,
    )
  })
  it("PUBLIC sees PUBLISHED", () => {
    expect(
      canViewExperienceLocale(PUBLIC_USER, PUBLISHED_LOCALE_OF_ALICE),
    ).toBe(true)
  })
  it("PUBLIC does NOT see DRAFT", () => {
    expect(canViewExperienceLocale(PUBLIC_USER, DRAFT_LOCALE_OF_ALICE)).toBe(
      false,
    )
  })
})

// -----------------------------------------------------------------------------
// canEditExperience — ownership-gated for EDITOR
// -----------------------------------------------------------------------------

describe("canEditExperience", () => {
  it("ADMIN can edit any non-archived", () => {
    expect(canEditExperience(ADMIN, EXPERIENCE_OWNED_BY_ALICE)).toBe(true)
  })
  it("ADMIN can edit even unowned content", () => {
    expect(canEditExperience(ADMIN, EXPERIENCE_NO_OWNER)).toBe(true)
  })
  it("ADMIN can edit archived (admin override)", () => {
    expect(canEditExperience(ADMIN, EXPERIENCE_OWNED_BY_ALICE_ARCHIVED)).toBe(
      true,
    )
  })
  it("EDITOR can edit own content", () => {
    expect(canEditExperience(EDITOR_ALICE, EXPERIENCE_OWNED_BY_ALICE)).toBe(
      true,
    )
  })
  it("EDITOR can NOT edit other editor's content", () => {
    expect(canEditExperience(EDITOR_BOB, EXPERIENCE_OWNED_BY_ALICE)).toBe(false)
  })
  it("EDITOR can NOT edit archived (even own)", () => {
    expect(
      canEditExperience(EDITOR_ALICE, EXPERIENCE_OWNED_BY_ALICE_ARCHIVED),
    ).toBe(false)
  })
  it("EDITOR can NOT edit unowned content", () => {
    expect(canEditExperience(EDITOR_ALICE, EXPERIENCE_NO_OWNER)).toBe(false)
  })
  it("VIEWER cannot edit anything", () => {
    expect(canEditExperience(VIEWER, EXPERIENCE_OWNED_BY_ALICE)).toBe(false)
  })
  it("PUBLIC cannot edit", () => {
    expect(canEditExperience(PUBLIC_USER, EXPERIENCE_OWNED_BY_ALICE)).toBe(
      false,
    )
  })
  it("SYSTEM cannot edit experience (editorial isolation)", () => {
    expect(canEditExperience(SYSTEM, EXPERIENCE_OWNED_BY_ALICE)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// canEditExperienceLocale + canPublishExperienceLocale (delegate to parent)
// -----------------------------------------------------------------------------

describe("canEditExperienceLocale", () => {
  it("ownership inherited from parent Experience", () => {
    expect(canEditExperienceLocale(EDITOR_ALICE, DRAFT_LOCALE_OF_ALICE)).toBe(
      true,
    )
    expect(canEditExperienceLocale(EDITOR_BOB, DRAFT_LOCALE_OF_ALICE)).toBe(
      false,
    )
  })
})

describe("canPublishExperienceLocale", () => {
  it("matches edit rules — owner or admin", () => {
    expect(
      canPublishExperienceLocale(EDITOR_ALICE, DRAFT_LOCALE_OF_ALICE),
    ).toBe(true)
    expect(canPublishExperienceLocale(EDITOR_BOB, DRAFT_LOCALE_OF_ALICE)).toBe(
      false,
    )
    expect(canPublishExperienceLocale(ADMIN, DRAFT_LOCALE_OF_ALICE)).toBe(true)
  })
  it("SYSTEM cannot publish (editorial isolation)", () => {
    expect(canPublishExperienceLocale(SYSTEM, DRAFT_LOCALE_OF_ALICE)).toBe(
      false,
    )
  })
})

// -----------------------------------------------------------------------------
// canArchiveExperience
// -----------------------------------------------------------------------------

describe("canArchiveExperience", () => {
  it("owner can archive", () => {
    expect(canArchiveExperience(EDITOR_ALICE, EXPERIENCE_OWNED_BY_ALICE)).toBe(
      true,
    )
  })
  it("non-owner editor cannot archive", () => {
    expect(canArchiveExperience(EDITOR_BOB, EXPERIENCE_OWNED_BY_ALICE)).toBe(
      false,
    )
  })
  it("admin can archive any", () => {
    expect(canArchiveExperience(ADMIN, EXPERIENCE_OWNED_BY_ALICE)).toBe(true)
  })
  it("SYSTEM cannot archive (editorial isolation)", () => {
    expect(canArchiveExperience(SYSTEM, EXPERIENCE_OWNED_BY_ALICE)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// canEditVideo — ADMIN only (Core-sourced restriction)
// -----------------------------------------------------------------------------

describe("canEditVideo", () => {
  it("ADMIN can edit video (v1 ADMIN-only, regardless of source)", () => {
    expect(canEditVideo(ADMIN)).toBe(true)
  })
  it("EDITOR cannot edit video in v1", () => {
    expect(canEditVideo(EDITOR_ALICE)).toBe(false)
  })
  it("VIEWER cannot edit video", () => {
    expect(canEditVideo(VIEWER)).toBe(false)
  })
  it("PUBLIC cannot edit video", () => {
    expect(canEditVideo(PUBLIC_USER)).toBe(false)
  })
  it("SYSTEM cannot edit video (workflow isolation)", () => {
    expect(canEditVideo(SYSTEM)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// canWriteDerived — workflow-only column writes (e.g. embedding)
// -----------------------------------------------------------------------------

describe("canWriteDerived", () => {
  it("SYSTEM principal can write derived columns", () => {
    expect(canWriteDerived(SYSTEM)).toBe(true)
  })
  it("ADMIN can write derived columns (operational override)", () => {
    expect(canWriteDerived(ADMIN)).toBe(true)
  })
  it("EDITOR cannot write derived columns", () => {
    expect(canWriteDerived(EDITOR_ALICE)).toBe(false)
  })
  it("VIEWER and PUBLIC cannot write derived", () => {
    expect(canWriteDerived(VIEWER)).toBe(false)
    expect(canWriteDerived(PUBLIC_USER)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// Permission matrix completeness — every permission key must be in the matrix
// (TS would catch missing entries; this asserts at runtime too).
// -----------------------------------------------------------------------------

describe("permission matrix completeness", () => {
  it("every PermissionKey resolves without throwing for every role", () => {
    const allKeys: PermissionKey[] = [
      "read:experiences",
      "read:videos",
      "read:video-metadata",
      "read:video-mapper-catalog",
      "read:reference",
      "read:media-assets",
      "access:manager",
      "read:manager-read-models",
      "write:experiences",
      "write:videos",
      "write:media-assets",
      "write:transcript-embeddings",
      "write:experience-embeddings",
      "write:manager-enrichment-trigger",
      "write:manager-jobs",
      "delete:media-assets",
      "publish:experiences",
      "archive:experiences",
      "system:trigger-workflow",
      "system:write-derived",
      "admin:all",
    ]
    const principals = [PUBLIC_USER, VIEWER, EDITOR_ALICE, ADMIN, SYSTEM]
    for (const key of allKeys) {
      for (const p of principals) {
        expect(() => hasPermission(p, key)).not.toThrow()
      }
    }
  })

  it("write:manager-enrichment-trigger is ADMIN-only at the editorial-tier ladder", () => {
    expect(hasPermission(ADMIN, "write:manager-enrichment-trigger")).toBe(true)
    expect(
      hasPermission(EDITOR_ALICE, "write:manager-enrichment-trigger"),
    ).toBe(false)
    expect(hasPermission(VIEWER, "write:manager-enrichment-trigger")).toBe(
      false,
    )
    expect(hasPermission(PUBLIC_USER, "write:manager-enrichment-trigger")).toBe(
      false,
    )
    expect(hasPermission(SYSTEM, "write:manager-enrichment-trigger")).toBe(
      false,
    )
  })

  it("write:experience-embeddings is ADMIN-only", () => {
    // Admin-native experience-embedding backfill. Mirrors the
    // write:transcript-embeddings tier gate so a regression that widens
    // the key (e.g. flips to EDITOR) fails loudly here and not just at
    // the mutation boundary.
    expect(hasPermission(ADMIN, "write:experience-embeddings")).toBe(true)
    expect(hasPermission(EDITOR_ALICE, "write:experience-embeddings")).toBe(
      false,
    )
    expect(hasPermission(VIEWER, "write:experience-embeddings")).toBe(false)
    expect(hasPermission(PUBLIC_USER, "write:experience-embeddings")).toBe(
      false,
    )
    // SYSTEM does not satisfy editorial write gates (intentional; the
    // inner workflow's canWriteDerived is the SYSTEM-reachable path).
    expect(hasPermission(SYSTEM, "write:experience-embeddings")).toBe(false)
  })

  it("write:transcript-embeddings is ADMIN-only", () => {
    // A regression that widens the key (e.g. flips to EDITOR) should
    // fail loudly here and not just at the mutation boundary.
    expect(hasPermission(ADMIN, "write:transcript-embeddings")).toBe(true)
    expect(hasPermission(EDITOR_ALICE, "write:transcript-embeddings")).toBe(
      false,
    )
    expect(hasPermission(VIEWER, "write:transcript-embeddings")).toBe(false)
    expect(hasPermission(PUBLIC_USER, "write:transcript-embeddings")).toBe(
      false,
    )
    // SYSTEM does not satisfy editorial write gates (intentional; the
    // indexer's canWriteDerived is the SYSTEM-reachable path).
    expect(hasPermission(SYSTEM, "write:transcript-embeddings")).toBe(false)
  })

  it("media asset write is EDITOR+, but delete is ADMIN-only", () => {
    expect(hasPermission(EDITOR_ALICE, "read:media-assets")).toBe(true)
    expect(hasPermission(EDITOR_ALICE, "write:media-assets")).toBe(true)
    expect(hasPermission(EDITOR_ALICE, "delete:media-assets")).toBe(false)
    expect(hasPermission(ADMIN, "delete:media-assets")).toBe(true)
    expect(hasPermission(VIEWER, "read:media-assets")).toBe(false)
    expect(hasPermission(PUBLIC_USER, "read:media-assets")).toBe(false)
  })

  describe("WORKFLOW_TRIGGER (service-account, plan 006)", () => {
    const WORKFLOW_TRIGGER: Principal = {
      id: null,
      role: "WORKFLOW_TRIGGER",
    }

    it("satisfies write:transcript-embeddings", () => {
      expect(
        hasPermission(WORKFLOW_TRIGGER, "write:transcript-embeddings"),
      ).toBe(true)
    })

    it("satisfies write:manager-enrichment-trigger (feat-119 PR2 CLI path)", () => {
      expect(
        hasPermission(WORKFLOW_TRIGGER, "write:manager-enrichment-trigger"),
      ).toBe(true)
    })

    it("satisfies write:experience-embeddings (admin-native experience backfill CLI path)", () => {
      expect(
        hasPermission(WORKFLOW_TRIGGER, "write:experience-embeddings"),
      ).toBe(true)
    })

    it("satisfies read:video-metadata (feat-125 manager admin-trigger lookup)", () => {
      expect(hasPermission(WORKFLOW_TRIGGER, "read:video-metadata")).toBe(true)
    })

    it("does NOT satisfy read:video-mapper-catalog", () => {
      expect(hasPermission(WORKFLOW_TRIGGER, "read:video-mapper-catalog")).toBe(
        false,
      )
    })

    it("does NOT satisfy any permission key outside the narrow allowlist", () => {
      // Iterate every PermissionKey via TypeScript's exhaustive Record
      // pattern so adding a new key without explicitly deciding
      // whether WORKFLOW_TRIGGER should satisfy it forces a compile
      // error here (the Record type) plus a test failure below if the
      // key is added to WORKFLOW_TRIGGER_PERMISSIONS without updating
      // the allowedKeys list.
      const allowedKeys: ReadonlySet<PermissionKey> = new Set([
        "write:transcript-embeddings",
        "write:manager-enrichment-trigger",
        "write:experience-embeddings",
        "read:video-metadata",
      ])
      const allKeys: Record<PermissionKey, true> = {
        "read:experiences": true,
        "read:videos": true,
        "read:video-metadata": true,
        "read:video-mapper-catalog": true,
        "read:reference": true,
        "read:media-assets": true,
        "access:manager": true,
        "read:manager-read-models": true,
        "write:experiences": true,
        "write:videos": true,
        "write:media-assets": true,
        "write:transcript-embeddings": true,
        "write:experience-embeddings": true,
        "write:watch-events": true,
        "write:manager-enrichment-trigger": true,
        "write:manager-jobs": true,
        "delete:media-assets": true,
        "publish:experiences": true,
        "archive:experiences": true,
        "system:trigger-workflow": true,
        "system:write-derived": true,
        "admin:all": true,
      }
      for (const key of Object.keys(allKeys) as PermissionKey[]) {
        const expected = allowedKeys.has(key)
        expect(hasPermission(WORKFLOW_TRIGGER, key)).toBe(expected)
      }
    })
  })

  describe("MANAGER_BACKEND (service-account, Manager read/job contracts)", () => {
    it("satisfies only Manager backend contract permissions", () => {
      const allowedKeys: ReadonlySet<PermissionKey> = new Set([
        "read:manager-read-models",
        "write:manager-jobs",
      ])
      const allKeys: Record<PermissionKey, true> = {
        "read:experiences": true,
        "read:videos": true,
        "read:video-metadata": true,
        "read:video-mapper-catalog": true,
        "read:reference": true,
        "read:media-assets": true,
        "access:manager": true,
        "read:manager-read-models": true,
        "write:experiences": true,
        "write:videos": true,
        "write:media-assets": true,
        "write:transcript-embeddings": true,
        "write:experience-embeddings": true,
        "write:watch-events": true,
        "write:manager-enrichment-trigger": true,
        "write:manager-jobs": true,
        "delete:media-assets": true,
        "publish:experiences": true,
        "archive:experiences": true,
        "system:trigger-workflow": true,
        "system:write-derived": true,
        "admin:all": true,
      }
      for (const key of Object.keys(allKeys) as PermissionKey[]) {
        const expected = allowedKeys.has(key)
        expect(hasPermission(MANAGER_BACKEND_PRINCIPAL, key)).toBe(expected)
      }
    })
  })

  describe("VIDEO_MAPPER (service-account, catalog sync)", () => {
    const VIDEO_MAPPER: Principal = {
      id: null,
      role: "VIDEO_MAPPER",
    }

    it("satisfies only read:video-mapper-catalog", () => {
      const allowedKeys: ReadonlySet<PermissionKey> = new Set([
        "read:video-mapper-catalog",
      ])
      const allKeys: Record<PermissionKey, true> = {
        "read:experiences": true,
        "read:videos": true,
        "read:video-metadata": true,
        "read:video-mapper-catalog": true,
        "read:reference": true,
        "read:media-assets": true,
        "access:manager": true,
        "read:manager-read-models": true,
        "write:experiences": true,
        "write:videos": true,
        "write:media-assets": true,
        "write:transcript-embeddings": true,
        "write:experience-embeddings": true,
        "write:watch-events": true,
        "write:manager-enrichment-trigger": true,
        "write:manager-jobs": true,
        "delete:media-assets": true,
        "publish:experiences": true,
        "archive:experiences": true,
        "system:trigger-workflow": true,
        "system:write-derived": true,
        "admin:all": true,
      }
      for (const key of Object.keys(allKeys) as PermissionKey[]) {
        const expected = allowedKeys.has(key)
        expect(hasPermission(VIDEO_MAPPER, key)).toBe(expected)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // CONSUMER_BEARER (plan 003) — rate-limit-only identity; ZERO permissions.
  //
  // Two CI surfaces enforce the empty-set invariant:
  //  1. Every PermissionKey returns false from hasPermission for any
  //     CONSUMER_BEARER principal — regardless of the bearer's
  //     `rateLimitBucketKey`.
  //  2. CONSUMER_BEARER role is never a member of any workflow-trigger
  //     allowlist, AND the env-var split (WEB_ADMIN_API_KEYS vs
  //     WORKFLOW_API_KEYS) is preserved so widening one set cannot
  //     accidentally widen the other.
  // ---------------------------------------------------------------------------

  describe("CONSUMER_BEARER (plan 003 — rate-limit-only identity)", () => {
    it("returns false for every PermissionKey, regardless of bucket key", () => {
      // Adding a new PermissionKey forces a compile error here AND a
      // test failure unless explicitly added to the registry. The
      // Record exhaustiveness check pairs with the runtime walk.
      const allKeys: Record<PermissionKey, true> = {
        "read:experiences": true,
        "read:videos": true,
        "read:video-metadata": true,
        "read:video-mapper-catalog": true,
        "read:reference": true,
        "read:media-assets": true,
        "access:manager": true,
        "read:manager-read-models": true,
        "write:experiences": true,
        "write:videos": true,
        "write:media-assets": true,
        "write:transcript-embeddings": true,
        "write:experience-embeddings": true,
        "write:watch-events": true,
        "write:manager-enrichment-trigger": true,
        "write:manager-jobs": true,
        "delete:media-assets": true,
        "publish:experiences": true,
        "archive:experiences": true,
        "system:trigger-workflow": true,
        "system:write-derived": true,
        "admin:all": true,
      }
      const bearer = CONSUMER_BEARER_PRINCIPAL({ rateLimitBucketKey: "any" })
      for (const key of Object.keys(allKeys) as PermissionKey[]) {
        expect(hasPermission(bearer, key)).toBe(false)
      }
    })

    it("returns false across a range of bucket keys (bucket key never grants permission)", () => {
      const someKey: PermissionKey = "read:reference"
      for (const bucketKey of ["a", "key-aaa", "very-long-bearer-key", "1"]) {
        const bearer = CONSUMER_BEARER_PRINCIPAL({
          rateLimitBucketKey: bucketKey,
        })
        expect(hasPermission(bearer, someKey)).toBe(false)
      }
    })

    it("never appears in WORKFLOW_TRIGGER_PERMISSIONS-style enumerations (role isolation)", () => {
      // Role-isolation invariant: CONSUMER_BEARER must not be promoted
      // to the workflow-trigger allowlist via the WORKFLOW_TRIGGER
      // role string aliasing. Construct a CONSUMER_BEARER principal
      // and assert that the workflow-trigger permission keys are NOT
      // satisfied (because the bearer's role is CONSUMER_BEARER, not
      // WORKFLOW_TRIGGER — the two principal types share the bearer
      // surface but not the permission surface).
      const bearer = CONSUMER_BEARER_PRINCIPAL({ rateLimitBucketKey: "any" })
      expect(hasPermission(bearer, "write:transcript-embeddings")).toBe(false)
      expect(hasPermission(bearer, "write:manager-enrichment-trigger")).toBe(
        false,
      )
    })

    it("env-var split: each bearer module reads only its own CSV (isolation)", async () => {
      // Asserts that the bearer-CSV env vars are read from distinct
      // sources. A regression that pointed `consumer-bearer.ts` at
      // `WORKFLOW_API_KEYS` (or vice versa) would silently merge the
      // principal mints — workflow callers would bucket as consumer
      // (rate-limit isolation collapse) and consumer callers would
      // mint WORKFLOW_TRIGGER (permission widening). The distinct
      // env vars are the load-bearing boundary.
      //
      const { readFile } = await import("node:fs/promises")
      const { fileURLToPath } = await import("node:url")
      const consumerSource = await readFile(
        fileURLToPath(new URL("./consumer-bearer.ts", import.meta.url)),
        "utf8",
      )
      const workflowSource = await readFile(
        fileURLToPath(new URL("./workflow-bearer.ts", import.meta.url)),
        "utf8",
      )
      const videoMapperSource = await readFile(
        fileURLToPath(new URL("./video-mapper-bearer.ts", import.meta.url)),
        "utf8",
      )
      // Each narrow file references its own env var…
      expect(consumerSource).toMatch(/env\.WEB_ADMIN_API_KEYS/)
      expect(workflowSource).toMatch(/env\.WORKFLOW_API_KEYS/)
      expect(videoMapperSource).toMatch(/env\.VIDEO_MAPPER_ADMIN_API_KEYS/)
      // …and NOT the others'.
      expect(consumerSource).not.toMatch(/env\.WORKFLOW_API_KEYS/)
      expect(workflowSource).not.toMatch(/env\.WEB_ADMIN_API_KEYS/)
      expect(videoMapperSource).not.toMatch(/env\.WORKFLOW_API_KEYS/)
      expect(videoMapperSource).not.toMatch(/env\.WEB_ADMIN_API_KEYS/)
    })
  })
})
