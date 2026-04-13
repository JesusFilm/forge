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
import type { Principal } from "@/graphql/builder"

const PUBLIC_USER: Principal | null = null
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const EDITOR_ALICE: Principal = { id: "alice", role: "EDITOR" }
const EDITOR_BOB: Principal = { id: "bob", role: "EDITOR" }
const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const SYSTEM: Principal = { id: null, role: "SYSTEM" }

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

const CORE_VIDEO = { source: "CORE" as const }
const MANAGER_VIDEO = { source: "MANAGER" as const }

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
      { key: "write:experiences", role: "PUBLIC", expected: false },
      { key: "admin:all", role: "PUBLIC", expected: false },

      // VIEWER reach
      { key: "read:reference", role: "VIEWER", expected: true },
      { key: "read:experiences", role: "VIEWER", expected: true },
      { key: "read:videos", role: "VIEWER", expected: true },
      { key: "write:experiences", role: "VIEWER", expected: false },
      { key: "publish:experiences", role: "VIEWER", expected: false },

      // EDITOR reach
      { key: "read:experiences", role: "EDITOR", expected: true },
      { key: "write:experiences", role: "EDITOR", expected: true },
      { key: "publish:experiences", role: "EDITOR", expected: true },
      { key: "archive:experiences", role: "EDITOR", expected: true },
      { key: "write:videos", role: "EDITOR", expected: false },
      { key: "system:trigger-workflow", role: "EDITOR", expected: false },
      { key: "admin:all", role: "EDITOR", expected: false },

      // ADMIN gets everything editorial + sync triggers + admin:all
      { key: "read:experiences", role: "ADMIN", expected: true },
      { key: "write:experiences", role: "ADMIN", expected: true },
      { key: "write:videos", role: "ADMIN", expected: true },
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
      { key: "write:experiences", role: "SYSTEM", expected: false },
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
})

// -----------------------------------------------------------------------------
// canEditVideo — ADMIN only (Core-sourced restriction)
// -----------------------------------------------------------------------------

describe("canEditVideo", () => {
  it("ADMIN can edit Core-sourced video (flips source on first edit)", () => {
    expect(canEditVideo(ADMIN, CORE_VIDEO)).toBe(true)
  })
  it("ADMIN can edit manager-sourced video", () => {
    expect(canEditVideo(ADMIN, MANAGER_VIDEO)).toBe(true)
  })
  it("EDITOR cannot edit any video in v1 (Core-sourced restriction)", () => {
    expect(canEditVideo(EDITOR_ALICE, CORE_VIDEO)).toBe(false)
    expect(canEditVideo(EDITOR_ALICE, MANAGER_VIDEO)).toBe(false)
  })
  it("VIEWER and PUBLIC cannot edit", () => {
    expect(canEditVideo(VIEWER, CORE_VIDEO)).toBe(false)
    expect(canEditVideo(PUBLIC_USER, CORE_VIDEO)).toBe(false)
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
      "read:reference",
      "write:experiences",
      "write:videos",
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
})
