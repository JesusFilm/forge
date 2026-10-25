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

const VIDEO_RELATION_ORDER_BY = [
  { order: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
]

describe("videoLocalesFilter", () => {
  it("anonymous → PUBLISHED only", () => {
    expect(videoLocalesFilter({}, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("VIEWER → PUBLISHED only (matches anonymous)", () => {
    expect(videoLocalesFilter({}, VIEWER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("CONSUMER_BEARER (web SSR) → PUBLISHED only", () => {
    expect(videoLocalesFilter({}, CONSUMER_BEARER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("EDITOR → only non-deleted rows (sees DRAFT + PUBLISHED)", () => {
    expect(videoLocalesFilter({}, EDITOR)).toEqual({
      where: { deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("ADMIN → only non-deleted rows", () => {
    expect(videoLocalesFilter({}, ADMIN)).toEqual({
      where: { deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("anonymous + locale → PUBLISHED-only filter narrows to the requested locale", () => {
    expect(videoLocalesFilter({ locale: "fr" }, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null, locale: "fr" },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("EDITOR + locale → no status filter but does narrow by locale", () => {
    expect(videoLocalesFilter({ locale: "fr" }, EDITOR)).toEqual({
      where: { deletedAt: null, locale: "fr" },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("ADMIN + locale → no status filter but does narrow by locale", () => {
    expect(videoLocalesFilter({ locale: "fr" }, ADMIN)).toEqual({
      where: { deletedAt: null, locale: "fr" },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("anonymous + languageSlug → PUBLISHED-only filter narrows to the exact public variant", () => {
    expect(
      videoLocalesFilter({ languageSlug: "russian" }, PUBLIC_USER),
    ).toEqual({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        languageSlug: "russian",
      },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("anonymous + locale + languageSlug → combines broad BCP-47 and exact variant filters", () => {
    expect(
      videoLocalesFilter(
        { locale: "ru", languageSlug: "russian" },
        PUBLIC_USER,
      ),
    ).toEqual({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        locale: "ru",
        languageSlug: "russian",
      },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("anonymous + locale=null → behaves like no locale (PUBLISHED-only across all locales)", () => {
    expect(videoLocalesFilter({ locale: null }, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("anonymous + locale='' → behaves like no locale (PUBLISHED-only across all locales)", () => {
    expect(videoLocalesFilter({ locale: "" }, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("anonymous + languageSlug='' → behaves like no exact variant", () => {
    expect(videoLocalesFilter({ languageSlug: "" }, PUBLIC_USER)).toEqual({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    })
  })
})

describe("videoStudyQuestionsFilter", () => {
  it("omitted locale returns default primary non-deleted questions only", () => {
    expect(videoStudyQuestionsFilter({})).toEqual({
      where: { deletedAt: null, primary: true },
      orderBy: [{ order: "asc" }, { languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("requested locale narrows to that locale and non-deleted rows", () => {
    expect(videoStudyQuestionsFilter({ locale: "ru" })).toEqual({
      where: { deletedAt: null, locale: "ru" },
      orderBy: [{ order: "asc" }, { languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("requested locale + languageSlug narrows to that exact public variant", () => {
    expect(
      videoStudyQuestionsFilter({
        locale: "ru",
        languageSlug: "russian",
      }),
    ).toEqual({
      where: { deletedAt: null, locale: "ru", languageSlug: "russian" },
      orderBy: [{ order: "asc" }, { languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("requested languageSlug without locale narrows to exact variant without primary-only fallback", () => {
    expect(videoStudyQuestionsFilter({ languageSlug: "russian" })).toEqual({
      where: { deletedAt: null, languageSlug: "russian" },
      orderBy: [{ order: "asc" }, { languageSlug: "asc" }, { id: "asc" }],
    })
  })

  it("empty locale behaves like omitted locale", () => {
    expect(videoStudyQuestionsFilter({ locale: "" })).toEqual({
      where: { deletedAt: null, primary: true },
      orderBy: [{ order: "asc" }, { languageSlug: "asc" }, { id: "asc" }],
    })
  })
})

describe("videoParentsFilter", () => {
  it("anonymous → only parents with a PUBLISHED locale, not soft-deleted, and not watch-restricted", () => {
    expect(videoParentsFilter(PUBLIC_USER)).toEqual({
      where: {
        parent: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          NOT: { restrictViewPlatforms: { has: "watch" } },
        },
      },
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("VIEWER → same filter as anonymous", () => {
    expect(videoParentsFilter(VIEWER)).toEqual({
      where: {
        parent: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          NOT: { restrictViewPlatforms: { has: "watch" } },
        },
      },
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("CONSUMER_BEARER (web SSR) → same filter as anonymous", () => {
    expect(videoParentsFilter(CONSUMER_BEARER)).toEqual({
      where: {
        parent: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          NOT: { restrictViewPlatforms: { has: "watch" } },
        },
      },
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("EDITOR → no visibility filter but deterministic relation ordering", () => {
    expect(videoParentsFilter(EDITOR)).toEqual({
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("ADMIN → no visibility filter but deterministic relation ordering", () => {
    expect(videoParentsFilter(ADMIN)).toEqual({
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })
})

describe("videoChildrenFilter", () => {
  it("anonymous → only children with a PUBLISHED locale, not soft-deleted, and not watch-restricted", () => {
    expect(videoChildrenFilter(PUBLIC_USER)).toEqual({
      where: {
        child: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          NOT: { restrictViewPlatforms: { has: "watch" } },
        },
      },
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("VIEWER → same filter as anonymous", () => {
    expect(videoChildrenFilter(VIEWER)).toEqual({
      where: {
        child: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          NOT: { restrictViewPlatforms: { has: "watch" } },
        },
      },
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("CONSUMER_BEARER (web SSR) → same filter as anonymous", () => {
    expect(videoChildrenFilter(CONSUMER_BEARER)).toEqual({
      where: {
        child: {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          NOT: { restrictViewPlatforms: { has: "watch" } },
        },
      },
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("EDITOR → no visibility filter but deterministic relation ordering", () => {
    expect(videoChildrenFilter(EDITOR)).toEqual({
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })

  it("ADMIN → no visibility filter but deterministic relation ordering", () => {
    expect(videoChildrenFilter(ADMIN)).toEqual({
      orderBy: VIDEO_RELATION_ORDER_BY,
    })
  })
})
