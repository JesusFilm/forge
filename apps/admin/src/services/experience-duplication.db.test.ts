import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { afterAll, describe, expect, it } from "vitest"
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import { createContext } from "@/graphql/context"
import { schema } from "@/graphql/schema"
import { ConcurrentModificationError } from "./errors"
import { ExperiencePreviewService } from "./experience-preview.service"
import {
  ExperienceHomepageLayoutPublishError,
  ExperienceService,
} from "./experience.service"
import { WatchSettingService } from "./watch-setting.service"

// The schema is built against the CommonJS graphql instance; executing it with
// the ESM instance fails the cross-realm schema check.
const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")

// Real PostgreSQL proof of the duplicate -> preview -> edit -> discard round
// trip. Mocked suites prove the service's branch shape; only a real database
// proves the nested create, the staged revision, the token lookup, and that the
// live homepage resolver still picks the source. Point DATABASE_URL at a
// DISPOSABLE migrated database: the suite writes rows and does not clean every
// table it touches.
const RUN_REAL_DB_TEST =
  process.env.EXPERIENCE_DUPLICATION_DB_TEST?.trim() === "1"

const ADMIN: Principal = { id: "dup-admin", role: "ADMIN" }
const ALICE: Principal = { id: "dup-alice", role: "EDITOR" }
const BOB: Principal = { id: "dup-bob", role: "EDITOR" }
const VIEWER: Principal = { id: "dup-viewer", role: "VIEWER" }

const run = randomBytes(4).toString("hex")
const locale = `x-dup-${run}`

const homepageBlocks = [
  { t: "watchHomeHero", sectionKey: "home-hero" },
  {
    t: "watchHomeCategoryRail",
    sectionKey: "browse-categories",
    categoryIds: ["jesus", "family"],
  },
  { t: "text", heading: "Ordinary block" },
  {
    t: "mediaCollection",
    sectionKey: "feed",
    variant: "carousel",
    itemsSource: "dynamicCollections",
    showItemNumbers: false,
    items: [],
  },
]

function snapshotData(overrides: Record<string, unknown>) {
  return {
    slug: `home-${run}`,
    isHomepage: true,
    pathSegment: null,
    title: "Saved draft home",
    metaDescription: null,
    ogTitle: null,
    ogDescription: null,
    ogImageUrl: null,
    blocks: homepageBlocks,
    ...overrides,
  }
}

async function sourceState(experienceId: string) {
  const locales = await prisma.experienceLocale.findMany({
    where: { experienceId },
    orderBy: { id: "asc" },
  })
  const revisions = await prisma.contentRevision.findMany({
    where: { entityId: { in: locales.map((row) => row.id) } },
    orderBy: { id: "asc" },
  })
  return JSON.parse(JSON.stringify({ locales, revisions })) as unknown
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Experience duplication (real PostgreSQL)",
  () => {
    const service = new ExperienceService(prisma)
    const previews = new ExperiencePreviewService(prisma)
    const createdExperienceIds: string[] = []

    afterAll(async () => {
      if (!RUN_REAL_DB_TEST) return
      const locales = await prisma.experienceLocale.findMany({
        where: { experienceId: { in: createdExperienceIds } },
        select: { id: true },
      })
      await prisma.contentRevision.deleteMany({
        where: { entityId: { in: locales.map((row) => row.id) } },
      })
      await prisma.experience.deleteMany({
        where: { id: { in: createdExperienceIds } },
      })
      await prisma.$disconnect()
    })

    it("copies the live homepage into an independent, previewable, unassigned draft", async () => {
      // Source: the live homepage for an isolated test locale, plus an active
      // saved draft whose title differs from the published canonical title.
      const source = await prisma.experience.create({
        data: {
          ownerId: ADMIN.id,
          locales: {
            create: {
              locale,
              slug: `home-${run}`,
              isHomepage: true,
              title: "Published home",
              blocks: homepageBlocks,
              status: "PUBLISHED",
              publishedAt: new Date(),
            },
          },
        },
        include: { locales: true },
      })
      createdExperienceIds.push(source.id)
      const sourceLocale = source.locales[0]!
      const sourceToken = randomBytes(32).toString("base64url")
      await prisma.contentRevision.create({
        data: {
          entityType: "ExperienceLocale",
          entityId: sourceLocale.id,
          snapshot: { v: 1, data: snapshotData({}) },
          status: "DRAFT",
          previewToken: sourceToken,
          revisedBy: ADMIN.id,
          revisedByKind: "USER",
          reason: "fixture",
        },
      })
      const before = await sourceState(source.id)

      // Permission is checked before any read.
      await expect(
        service.duplicate({ input: { id: source.id }, user: VIEWER }),
      ).rejects.toThrow("Forbidden")

      const effective = await service.duplicate({
        input: { id: source.id },
        user: ALICE,
      })
      createdExperienceIds.push(effective.id)
      const copied = effective.duplication.locales[0]!
      expect(effective.ownerId).toBe(ALICE.id)
      expect(copied.source.copiedFrom).toBe("ACTIVE_DRAFT")
      expect(copied.locale).toMatchObject({
        isHomepage: false,
        homepageLayout: true,
        status: "DRAFT",
        publishedAt: null,
        title: "Saved draft home",
        slug: `home-${run}-copy`,
      })
      expect(copied.locale.blocks).toEqual(homepageBlocks)

      // Exactly one active draft exists for the copy, with its own token.
      const copyDrafts = await prisma.contentRevision.findMany({
        where: { entityId: copied.locale.id, status: "DRAFT" },
      })
      expect(copyDrafts).toHaveLength(1)
      expect(copyDrafts[0]!.previewToken).toBe(copied.previewToken)
      expect(copied.previewToken).not.toBe(sourceToken)

      // The preview works immediately and renders as a homepage without
      // claiming the assignment.
      const preview = await previews.resolveByToken({
        token: copied.previewToken!,
      })
      expect(preview).toMatchObject({
        localeId: copied.locale.id,
        isHomepage: false,
        homepageLayout: true,
        title: "Saved draft home",
      })
      expect(preview!.blocks).toHaveLength(homepageBlocks.length)

      // The live homepage resolver still answers with the source.
      const watchSetting = await new WatchSettingService(prisma).get({
        locale,
      })
      expect(watchSetting.homepageExperience?.id).toBe(sourceLocale.id)

      // CAS: null asserts "no draft" and fails; a stale revision fails; the
      // current revision saves. The source stays byte-identical throughout.
      await expect(
        service.updateLocale({
          input: { id: copied.locale.id, title: "Never" },
          user: ALICE,
          expectedDraftRevision: null,
        }),
      ).rejects.toBeInstanceOf(ConcurrentModificationError)
      await expect(
        service.updateLocale({
          input: { id: copied.locale.id, title: "Never" },
          user: ALICE,
          expectedDraftRevision: `${copyDrafts[0]!.id}.stale`,
        }),
      ).rejects.toBeInstanceOf(ConcurrentModificationError)
      await expect(
        service.updateLocale({
          input: { id: copied.locale.id, title: "Edited copy" },
          user: BOB,
          expectedDraftRevision: copied.draftRevision,
        }),
      ).rejects.toThrow("Forbidden")
      const edited = await service.updateLocale({
        input: { id: copied.locale.id, title: "Edited copy" },
        user: ALICE,
        expectedDraftRevision: copied.draftRevision,
      })
      expect(edited).toMatchObject({
        title: "Edited copy",
        isHomepage: false,
        homepageLayout: true,
      })
      await expect(
        previews.resolveByToken({ token: copied.previewToken! }),
      ).resolves.toMatchObject({ title: "Edited copy" })
      expect(await sourceState(source.id)).toEqual(before)

      // Publishing the unassigned copy is refused and changes nothing: the
      // homepage layout must be assigned first, whatever blocks it holds.
      await expect(
        service.publishLocale({ input: { id: copied.locale.id }, user: ALICE }),
      ).rejects.toBeInstanceOf(ExperienceHomepageLayoutPublishError)
      const stillDraft = await prisma.experienceLocale.findUniqueOrThrow({
        where: { id: copied.locale.id },
      })
      expect(stillDraft).toMatchObject({
        status: "DRAFT",
        publishedAt: null,
        isHomepage: false,
      })

      // Discard retires the token and returns to the as-duplicated content.
      const discarded = await service.discardLocaleDraft({
        input: { id: copied.locale.id },
        user: ALICE,
      })
      expect(discarded).toMatchObject({
        title: "Saved draft home",
        homepageLayout: true,
        isHomepage: false,
      })
      await expect(
        previews.resolveByToken({ token: copied.previewToken! }),
      ).resolves.toBeNull()
      await expect(
        previews.resolveByToken({ token: sourceToken }),
      ).resolves.toMatchObject({ localeId: sourceLocale.id })

      // CANONICAL copies the published content, not the saved draft.
      const canonical = await service.duplicate({
        input: { id: source.id, sourceVersion: "CANONICAL" },
        user: ALICE,
      })
      createdExperienceIds.push(canonical.id)
      expect(canonical.duplication.locales[0]!.locale).toMatchObject({
        title: "Published home",
        slug: `home-${run}-copy-2`,
        isHomepage: false,
        homepageLayout: true,
      })
      expect(canonical.duplication.locales[0]!.source).toMatchObject({
        copiedFrom: "CANONICAL",
        draftRevision: null,
      })

      expect(await sourceState(source.id)).toEqual(before)
      const homepage = await new WatchSettingService(prisma).get({ locale })
      expect(homepage.homepageExperience?.id).toBe(sourceLocale.id)

      // The GraphQL adapters over the same database: the mutation forwards the
      // explicit source version, and the anonymous preview capability exposes
      // assignment and rendering context separately.
      const editorContext = {
        ...(await createContext({
          request: new Request("http://localhost/api/graphql"),
        })),
        user: ALICE,
      }
      const mutation = await graphql({
        schema,
        source: `mutation ($id: ID!) {
          duplicateExperience(id: $id, sourceVersion: CANONICAL) {
            id
            locales { id isHomepage homepageLayout status title }
          }
        }`,
        variableValues: { id: source.id },
        contextValue: editorContext,
      })
      expect(mutation.errors).toBeUndefined()
      const viaGraphql = (
        mutation.data as {
          duplicateExperience: {
            id: string
            locales: Array<{ id: string } & Record<string, unknown>>
          }
        }
      ).duplicateExperience
      createdExperienceIds.push(viaGraphql.id)
      expect(viaGraphql.locales).toEqual([
        expect.objectContaining({
          isHomepage: false,
          homepageLayout: true,
          status: "DRAFT",
          title: "Published home",
        }),
      ])
      const { previewToken } = await prisma.contentRevision.findFirstOrThrow({
        where: { entityId: viaGraphql.locales[0]!.id, status: "DRAFT" },
      })

      const anonymousContext = await createContext({
        request: new Request("http://localhost/api/graphql"),
      })
      const previewResult = await graphql({
        schema,
        source: `query ($token: String!) {
          experiencePreview(token: $token) {
            isHomepage
            homepageLayout
            title
            blocks { __typename }
          }
        }`,
        variableValues: { token: previewToken },
        contextValue: anonymousContext,
      })
      expect(previewResult.errors).toBeUndefined()
      expect(previewResult.data).toEqual({
        experiencePreview: {
          isHomepage: false,
          homepageLayout: true,
          title: "Published home",
          blocks: [
            { __typename: "WatchHomeHeroBlock" },
            { __typename: "WatchHomeCategoryRailBlock" },
            { __typename: "TextBlock" },
            { __typename: "MediaCollectionBlock" },
          ],
        },
      })
    })
  },
)
