// Per-principal regression for the principal-aware filters on
// `Video.locales`, `Video.parents`, `Video.children`. These widenings
// landed for the web rebuild (consumer-migration U5+U6, 2026-05-14) and
// MUST hold the anonymous-PUBLISHED-only invariant — see origin R10/R17
// and `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`.

import { describe, expect, it } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  videoChildrenFilter,
  videoLocalesFilter,
  videoParentsFilter,
  videoStudyQuestionsFilter,
} from "@/graphql/types/video"

const PUBLIC_USER: Principal | null = null
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }
const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const CONSUMER_BEARER: Principal = {
  id: null,
  role: "CONSUMER_BEARER",
  rateLimitBucketKey: "consumer-bucket-key",
}

describe("videoLocalesFilter", () => {
  it("anonymous → PUBLISHED only", () => {
    expect(videoLocalesFilter({}, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
    })
  })

  it("VIEWER → PUBLISHED only (matches anonymous)", () => {
    expect(videoLocalesFilter({}, VIEWER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
    })
  })

  it("CONSUMER_BEARER (web SSR) → PUBLISHED only", () => {
    expect(videoLocalesFilter({}, CONSUMER_BEARER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
    })
  })

  it("EDITOR → only non-deleted rows (sees DRAFT + PUBLISHED)", () => {
    expect(videoLocalesFilter({}, EDITOR)).toEqual({
      where: { deletedAt: null },
    })
  })

  it("ADMIN → only non-deleted rows", () => {
    expect(videoLocalesFilter({}, ADMIN)).toEqual({
      where: { deletedAt: null },
    })
  })

  it("anonymous + locale → PUBLISHED-only filter narrows to the requested locale", () => {
    expect(videoLocalesFilter({ locale: "fr" }, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null, locale: "fr" },
    })
  })

  it("EDITOR + locale → no status filter but does narrow by locale", () => {
    expect(videoLocalesFilter({ locale: "fr" }, EDITOR)).toEqual({
      where: { deletedAt: null, locale: "fr" },
    })
  })

  it("ADMIN + locale → no status filter but does narrow by locale", () => {
    expect(videoLocalesFilter({ locale: "fr" }, ADMIN)).toEqual({
      where: { deletedAt: null, locale: "fr" },
    })
  })

  it("anonymous + locale=null → behaves like no locale (PUBLISHED-only across all locales)", () => {
    expect(videoLocalesFilter({ locale: null }, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
    })
  })

  it("anonymous + locale='' → behaves like no locale (PUBLISHED-only across all locales)", () => {
    expect(videoLocalesFilter({ locale: "" }, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
    })
  })
})

describe("videoStudyQuestionsFilter", () => {
  it("omitted locale returns default primary non-deleted questions only", () => {
    expect(videoStudyQuestionsFilter({})).toEqual({
      where: { deletedAt: null, primary: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    })
  })

  it("requested locale narrows to that locale and non-deleted rows", () => {
    expect(videoStudyQuestionsFilter({ locale: "ru" })).toEqual({
      where: { deletedAt: null, locale: "ru" },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    })
  })

  it("empty locale behaves like omitted locale", () => {
    expect(videoStudyQuestionsFilter({ locale: "" })).toEqual({
      where: { deletedAt: null, primary: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    })
  })
})

describe("videoParentsFilter", () => {
  it("anonymous → only parents with a PUBLISHED locale and not soft-deleted", () => {
    expect(videoParentsFilter(PUBLIC_USER)).toEqual({
      where: {
        parent: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
        },
      },
    })
  })

  it("VIEWER → same PUBLISHED-only filter as anonymous", () => {
    expect(videoParentsFilter(VIEWER)).toEqual({
      where: {
        parent: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
        },
      },
    })
  })

  it("CONSUMER_BEARER (web SSR) → same PUBLISHED-only filter as anonymous", () => {
    expect(videoParentsFilter(CONSUMER_BEARER)).toEqual({
      where: {
        parent: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
        },
      },
    })
  })

  it("EDITOR → no filter (sees all parents, even unpublished)", () => {
    expect(videoParentsFilter(EDITOR)).toEqual({})
  })

  it("ADMIN → no filter", () => {
    expect(videoParentsFilter(ADMIN)).toEqual({})
  })
})

describe("videoChildrenFilter", () => {
  it("anonymous → only children with a PUBLISHED locale and not soft-deleted", () => {
    expect(videoChildrenFilter(PUBLIC_USER)).toEqual({
      where: {
        child: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
        },
      },
    })
  })

  it("VIEWER → same PUBLISHED-only filter as anonymous", () => {
    expect(videoChildrenFilter(VIEWER)).toEqual({
      where: {
        child: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
        },
      },
    })
  })

  it("CONSUMER_BEARER (web SSR) → same PUBLISHED-only filter as anonymous", () => {
    expect(videoChildrenFilter(CONSUMER_BEARER)).toEqual({
      where: {
        child: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
        },
      },
    })
  })

  it("EDITOR → no filter (sees all children, even unpublished)", () => {
    expect(videoChildrenFilter(EDITOR)).toEqual({})
  })

  it("ADMIN → no filter", () => {
    expect(videoChildrenFilter(ADMIN)).toEqual({})
  })
})
