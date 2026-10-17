import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { createContext } from "@/graphql/context"
import { schema } from "@/graphql/schema"
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest"
import { createWatchAudienceConfiguration } from "@forge/experience-schema"
import { prisma } from "@/db/client"
import { ExperienceService } from "./experience.service"
import { ExperiencePreviewService } from "./experience-preview.service"
import { WatchSettingService } from "./watch-setting.service"
import { emitRevalidateWebhook } from "./revalidate-webhook"

// Only network/background effects are replaced. All authoring, row locks,
// drafts, preview capability reads, publication and history use real PostgreSQL.
vi.mock("./revalidate-webhook", () => ({
  emitRevalidateWebhook: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/workflows/experienceEmbedding", () => ({
  runExperienceEmbedding: vi.fn(),
}))
vi.mock("workflow/api", () => ({ start: vi.fn() }))
const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")
const enabled = process.env.WATCH_AUDIENCE_DB_TEST === "1"
const user = { id: "u11-local-admin", role: "ADMIN" as const }
const run = randomBytes(6).toString("hex")
const locale = `x-u11-${run}`
const created: string[] = []
const service = new ExperienceService(prisma)
const watch = new WatchSettingService(prisma)
const previews = new ExperiencePreviewService(prisma)
const block = (heading: string) => {
  const configuration = createWatchAudienceConfiguration()
  configuration.roles[0]!.heading = heading
  return {
    t: "watchAudience" as const,
    sectionKey: "watch-audience",
    configuration,
  }
}
async function publicConfig(language = locale) {
  return watch.getWatchAudience(await watch.get({ locale: language }))
}

// Run only after coordinator creates/migrates a DEDICATED, empty local database:
// WATCH_AUDIENCE_DB_TEST=1 DATABASE_URL=postgresql://...@localhost:5432/forge_watch_audience_test
// pnpm --filter @forge/admin exec vitest run src/services/watch-audience-publication.db.test.ts
// Use agent-io-guard for migration/setup and any broad test command.
describe.skipIf(!enabled)(
  "Watch audience publication (isolated real PostgreSQL)",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!)
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !/^\/forge_watch_audience_test(?:_[a-z0-9_-]+)?$/.test(url.pathname)
      )
        throw new Error(
          "U11 DB proof requires a dedicated LOCAL forge_watch_audience_test database",
        )
      if (
        (await prisma.experience.count({ where: { isTemplate: true } })) !== 0
      )
        throw new Error(
          "U11 DB proof requires an empty database with no existing default template",
        )
    })
    afterAll(async () => {
      if (!created.length) return
      const locales = await prisma.experienceLocale.findMany({
        where: { experienceId: { in: created } },
        select: { id: true },
      })
      await prisma.contentRevision.deleteMany({
        where: {
          entityType: "ExperienceLocale",
          entityId: { in: locales.map((r) => r.id) },
        },
      })
      await prisma.experience.deleteMany({ where: { id: { in: created } } })
      await prisma.$disconnect()
    })
    it("saves → previews → publishes one default-template definition, preserving live reads and revision history", async () => {
      const initial = block("Published definition")
      const template = await service.create({
        input: {
          isTemplate: true,
          locale,
          slug: `template-${run}`,
          blocks: [initial],
        },
        user,
      })
      created.push(template.id)
      const id = template.locales[0]!.id
      expect(await publicConfig()).toBeNull()
      await service.publishLocale({ input: { id }, user })
      expect(
        JSON.parse((await publicConfig())!.configJson!).roles[0].heading,
      ).toBe("Published definition")

      const edited = block("Saved draft definition")
      await service.updateLocale({ input: { id, blocks: [edited] }, user })
      const revision = await prisma.contentRevision.findFirstOrThrow({
        where: {
          entityType: "ExperienceLocale",
          entityId: id,
          status: "DRAFT",
        },
      })
      const preview = await previews.resolveByToken({
        token: revision.previewToken!,
      })
      expect(preview?.blocks).toEqual([edited])
      expect(preview).toMatchObject({
        isTemplate: true,
        isDefaultTemplate: true,
      })

      // Both parents are supported route templates. Only A is the deterministic
      // Watch owner; B's capability must not promise a public questionnaire.
      const secondary = await service.create({
        input: {
          isTemplate: true,
          locale,
          slug: `template-b-${run}`,
          blocks: [block("B must never replace A")],
        },
        user,
      })
      created.push(secondary.id)
      try {
        const selected = await prisma.experience.findUniqueOrThrow({
          where: { id: template.id },
          select: { createdAt: true },
        })
        await prisma.experience.update({
          where: { id: secondary.id },
          data: { createdAt: new Date(selected.createdAt.getTime() + 1000) },
        })
        const secondaryLocaleId = secondary.locales[0]!.id
        const secondaryRevision = await prisma.contentRevision.findFirstOrThrow(
          {
            where: {
              entityType: "ExperienceLocale",
              entityId: secondaryLocaleId,
              status: "DRAFT",
            },
          },
        )
        const secondaryPreview = await previews.resolveByToken({
          token: secondaryRevision.previewToken!,
        })
        expect(secondaryPreview).toMatchObject({
          experienceId: secondary.id,
          isTemplate: true,
          isDefaultTemplate: false,
          blocks: [block("B must never replace A")],
        })
        const capabilityContext = await createContext({
          request: new Request("http://admin.test/api/graphql"),
        })
        for (const [token, isDefaultTemplate, heading] of [
          [revision.previewToken!, true, "Saved draft definition"],
          [secondaryRevision.previewToken!, false, "B must never replace A"],
        ] as const) {
          const response = await graphql({
            schema,
            source: `query PreviewIdentity($token:String!){experiencePreview(token:$token){isTemplate isDefaultTemplate blocks{__typename ... on WatchAudienceBlock{configurationJson}}}}`,
            variableValues: { token },
            contextValue: capabilityContext,
          })
          expect(response.errors).toBeUndefined()
          expect(response.data?.experiencePreview).toMatchObject({
            isTemplate: true,
            isDefaultTemplate,
          })
          const capability = response.data?.experiencePreview as {
            blocks: Array<{ configurationJson: string }>
          }
          expect(
            JSON.parse(capability.blocks[0]!.configurationJson).roles[0]
              .heading,
          ).toBe(heading)
        }
        await service.publishLocale({ input: { id: secondaryLocaleId }, user })
        expect(
          JSON.parse((await publicConfig())!.configJson!).roles[0].heading,
        ).toBe("Published definition")
        const publicResponse = await graphql({
          schema,
          source: `query PublishedAudience($locale:String!){watchSetting(locale:$locale){watchAudience{configJson rejected sourceLocale sourceBlockId}}}`,
          variableValues: { locale },
          contextValue: capabilityContext,
        })
        expect(publicResponse.errors).toBeUndefined()
        expect(publicResponse.data?.watchSetting).toMatchObject({
          watchAudience: await publicConfig(),
        })
        const secondaryPublished =
          await prisma.experienceLocale.findUniqueOrThrow({
            where: { id: secondaryLocaleId },
          })
        expect(secondaryPublished.blocks).toEqual([
          block("B must never replace A"),
        ])

        // Locale availability does not promote B over selected parent A.
        const bOnlyLocale = `x-u11-b-${run}`
        const bOnly = await service.createLocale({
          input: {
            experienceId: secondary.id,
            locale: bOnlyLocale,
            slug: `template-b-only-${run}`,
            blocks: [block("B-only published locale")],
          },
          user,
        })
        await service.publishLocale({ input: { id: bOnly.id }, user })
        expect(await publicConfig(bOnlyLocale)).toBeNull()
      } finally {
        const secondaryLocales = await prisma.experienceLocale.findMany({
          where: { experienceId: secondary.id },
          select: { id: true },
        })
        await prisma.contentRevision.deleteMany({
          where: {
            entityType: "ExperienceLocale",
            entityId: { in: secondaryLocales.map((entry) => entry.id) },
          },
        })
        await prisma.experience.delete({ where: { id: secondary.id } })
      }
      expect(
        JSON.parse((await publicConfig())!.configJson!).roles[0].heading,
      ).toBe("Published definition")
      await service.publishLocale({ input: { id }, user })
      const published = await publicConfig()
      expect(published).toMatchObject({
        sourceLocale: locale,
        sourceBlockId: "watch-audience",
        rejected: false,
      })
      expect(JSON.parse(published!.configJson!).roles[0].heading).toBe(
        "Saved draft definition",
      )
      expect(
        await previews.resolveByToken({ token: revision.previewToken! }),
      ).toBeNull()
      expect(
        await prisma.contentRevision.count({
          where: {
            entityType: "ExperienceLocale",
            entityId: id,
            status: "HISTORICAL",
          },
        }),
      ).toBeGreaterThanOrEqual(4)
      expect(emitRevalidateWebhook).toHaveBeenCalledWith({
        model: "watch-setting",
        slug: null,
        locale,
      })

      const context = await createContext({
        request: new Request("http://admin.test/api/graphql"),
      })
      const response = await graphql({
        schema,
        source: `query Audience($locale:String!){watchSetting(locale:$locale){watchAudience{configJson rejected sourceLocale sourceBlockId} defaultTemplateExperience{blocks{__typename ... on WatchAudienceBlock{t sectionKey configurationJson}}}}}`,
        variableValues: { locale },
        contextValue: context,
      })
      expect(response.errors).toBeUndefined()
      expect(response.data?.watchSetting).toMatchObject({
        watchAudience: published,
        defaultTemplateExperience: {
          blocks: [
            {
              __typename: "WatchAudienceBlock",
              t: "watchAudience",
              sectionKey: "watch-audience",
            },
          ],
        },
      })
      const previewResponse = await graphql({
        schema,
        source: `query Preview($token:String!){experiencePreview(token:$token){blocks{__typename ... on WatchAudienceBlock{configurationJson}}}}`,
        variableValues: { token: revision.previewToken },
        contextValue: context,
      })
      expect(previewResponse.errors).toBeUndefined()
      expect(previewResponse.data?.experiencePreview).toBeNull()

      // A separate published homepage definition never overrides the template.
      const home = await prisma.experience.create({
        data: {
          ownerId: user.id,
          locales: {
            create: {
              locale,
              slug: `home-${run}`,
              isHomepage: true,
              status: "PUBLISHED",
              blocks: [block("Homepage must not win")],
            },
          },
        },
      })
      created.push(home.id)
      expect(
        JSON.parse((await publicConfig())!.configJson!).roles[0].heading,
      ).toBe("Saved draft definition")

      // An unpublished locale on the selected template never becomes a fallback.
      const draftLocale = await service.createLocale({
        input: {
          experienceId: template.id,
          locale: "en",
          slug: `english-${run}`,
          blocks: [block("Unpublished English")],
        },
        user,
      })
      expect(await publicConfig("en")).toBeNull()
      await service.publishLocale({ input: { id: draftLocale.id }, user })
      expect((await publicConfig("en"))?.sourceLocale).toBe("en")
      expect(await publicConfig("missing-locale")).toBeNull()

      // Validation refuses bad authored content on SAVE, before publication.
      const fourth = block("Bad draft")
      fourth.configuration.roles[0]!.questions.push({
        ...structuredClone(fourth.configuration.roles[0]!.questions[0]!),
        id: "fourth-question",
      })
      await expect(
        service.updateLocale({ input: { id, blocks: [fourth] }, user }),
      ).rejects.toThrow()
      expect(
        JSON.parse((await publicConfig())!.configJson!).roles[0].heading,
      ).toBe("Saved draft definition")

      // Publication must revalidate a historical/external revision that bypassed
      // save validation, retaining canonical content on rejection.
      const snapshot = {
        v: 1,
        data: {
          slug: `template-${run}`,
          isHomepage: false,
          homepageLayout: false,
          pathSegment: null,
          title: null,
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: [fourth],
        },
      }
      await prisma.contentRevision.create({
        data: {
          entityType: "ExperienceLocale",
          entityId: id,
          status: "DRAFT",
          snapshot,
          previewToken: randomBytes(32).toString("base64url"),
          revisedBy: user.id,
          revisedByKind: "USER",
        },
      })
      await expect(
        service.publishLocale({ input: { id }, user }),
      ).rejects.toThrow()
      expect(
        JSON.parse((await publicConfig())!.configJson!).roles[0].heading,
      ).toBe("Saved draft definition")
    })
  },
)
