import { describe, expect, it } from "vitest"

import {
  ADMIN_KIND_TO_STRAPI,
  ADMIN_ONLY_KINDS,
  STRAPI_TO_ADMIN_KIND,
  adminKindToStrapiTypename,
  strapiTypenameToAdminKind,
  type AdminKind,
  type StrapiTypename,
} from "./discriminator-map"

describe("STRAPI_TO_ADMIN_KIND", () => {
  it("has exactly 16 shared mapping entries", () => {
    // Strapi's ExperienceBlocksDynamicZone union (excluding `Error`) has
    // 16 component types; every entry must map to a unique admin kind.
    expect(Object.keys(STRAPI_TO_ADMIN_KIND)).toHaveLength(16)
  })

  it("maps every Strapi typename to a non-empty admin kind", () => {
    for (const [strapi, admin] of Object.entries(STRAPI_TO_ADMIN_KIND)) {
      expect(admin, `mapping for ${strapi}`).toMatch(/^[a-z][a-zA-Z]+$/)
    }
  })

  it("admin kinds are unique across the shared set (no two Strapi typenames map to the same admin kind)", () => {
    const adminKinds = Object.values(STRAPI_TO_ADMIN_KIND)
    expect(new Set(adminKinds).size).toBe(adminKinds.length)
  })
})

describe("ADMIN_ONLY_KINDS", () => {
  it("includes videoRecommendations", () => {
    expect(ADMIN_ONLY_KINDS).toContain("videoRecommendations")
  })

  it("does not overlap with shared admin kinds", () => {
    const sharedKinds = new Set<string>(Object.values(STRAPI_TO_ADMIN_KIND))
    for (const adminOnly of ADMIN_ONLY_KINDS) {
      expect(sharedKinds.has(adminOnly), `${adminOnly} is admin-only`).toBe(
        false,
      )
    }
  })
})

describe("ADMIN_KIND_TO_STRAPI", () => {
  it("inverts STRAPI_TO_ADMIN_KIND exactly", () => {
    const inverseSize = Object.keys(ADMIN_KIND_TO_STRAPI).length
    expect(inverseSize).toBe(Object.keys(STRAPI_TO_ADMIN_KIND).length)
  })

  it("is bidirectionally consistent — adminKindToStrapiTypename(STRAPI_TO_ADMIN_KIND[k]) === k", () => {
    for (const [strapi, admin] of Object.entries(STRAPI_TO_ADMIN_KIND)) {
      expect(adminKindToStrapiTypename(admin), `round-trip for ${strapi}`).toBe(
        strapi,
      )
    }
  })

  it("returns undefined for admin-only kinds", () => {
    for (const adminOnly of ADMIN_ONLY_KINDS) {
      expect(adminKindToStrapiTypename(adminOnly)).toBeUndefined()
    }
  })

  it("returns undefined for completely unknown kinds", () => {
    expect(adminKindToStrapiTypename("totallyUnknown")).toBeUndefined()
  })
})

describe("strapiTypenameToAdminKind", () => {
  it("maps a known Strapi typename to its admin kind", () => {
    expect(strapiTypenameToAdminKind("ComponentSectionsMediaCollection")).toBe(
      "mediaCollection",
    )
  })

  it("returns the unknown-sentinel for an unmapped typename", () => {
    const result = strapiTypenameToAdminKind("ComponentSectionsTotallyNew")
    expect(result).toEqual({
      kind: "unknown",
      raw: "ComponentSectionsTotallyNew",
    })
  })

  it("returns the unknown-sentinel for empty string (defensive)", () => {
    const result = strapiTypenameToAdminKind("")
    expect(result).toEqual({ kind: "unknown", raw: "" })
  })
})

describe("type exports", () => {
  it("exposes StrapiTypename and AdminKind as the union literal types", () => {
    // Compile-time proof that a known typename narrows to AdminKind.
    const known: StrapiTypename = "ComponentSectionsCta"
    const admin: AdminKind = STRAPI_TO_ADMIN_KIND[known]
    expect(admin).toBe("cta")
  })
})

// =============================================================================
// Cross-package totality test — DEFERRED to U4.
//
// The plan's "Discriminator-map admin coverage" scenario imports
// BlocksSchema from @forge/admin/domain/blocks and asserts every shared
// admin kind in BlocksSchema is reachable via this map. That import
// requires admin's package.json `exports` map (added in U4). The test
// lands alongside the exports-map change so the import resolves cleanly.
// =============================================================================
