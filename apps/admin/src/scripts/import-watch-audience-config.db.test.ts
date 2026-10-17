import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { WatchAudienceConfigurationSchema } from "@forge/experience-schema"
import { afterAll, describe, expect, it, vi } from "vitest"

// Proves the released import path; the service write gate's off branch is
// pinned in experience.service.test.ts.
vi.mock("@/lib/feature-flags", () => ({
  isWatchAudienceEnabled: async () => true,
}))
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import { ExperienceService } from "@/services/experience.service"
import { WatchSettingService } from "@/services/watch-setting.service"
import {
  DEFAULT_FIXTURE_PATH,
  assertLocalDatabaseUrl,
  importWatchAudienceConfig,
} from "./import-watch-audience-config"

// Real PostgreSQL proof of fixture -> draft -> human publish -> published
// projection. Mocked suites prove the plan's branch shape; only a real database
// proves the existing Experience validation accepts the block, that a draft
// stays invisible to the public projection, and that nothing publishes by
// itself. Point DATABASE_URL at a DISPOSABLE local database with NO other
// default template (the public projection and this script both pick the first
// non-archived template, so a shared database would test someone else's row).
const RUN_REAL_DB_TEST =
  process.env.WATCH_AUDIENCE_IMPORT_DB_TEST?.trim() === "1"

const ADMIN: Principal = { id: "wai-admin", role: "ADMIN" }
const run = randomBytes(4).toString("hex")

const fixture = WatchAudienceConfigurationSchema.parse(
  JSON.parse(readFileSync(DEFAULT_FIXTURE_PATH, "utf8")),
)

describe.skipIf(!RUN_REAL_DB_TEST)(
  "import-watch-audience-config (real PostgreSQL)",
  () => {
    const service = new ExperienceService(prisma)
    const settings = new WatchSettingService(prisma)
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

    const revisionCount = (entityId: string) =>
      prisma.contentRevision.count({ where: { entityId } })

    it("stages a draft idempotently, stays private until a human publishes, then projects", async () => {
      assertLocalDatabaseUrl(process.env.DATABASE_URL)
      expect(
        await prisma.experience.count({
          where: { isTemplate: true, archivedAt: null },
        }),
        "needs a disposable database with no other default template",
      ).toBe(0)

      const template = await service.create({
        input: {
          isTemplate: true,
          locale: "en",
          slug: `u12-template-${run}`,
          title: "Template",
          blocks: [{ t: "text", heading: "Existing block" }],
        },
        user: ADMIN,
      })
      createdExperienceIds.push(template.id)
      const localeId = template.locales[0]!.id
      const canonicalBefore = await prisma.experienceLocale.findUniqueOrThrow({
        where: { id: localeId },
      })

      // Dry run: reports, writes nothing.
      const revisionsBefore = await revisionCount(localeId)
      const dry = await importWatchAudienceConfig({
        prisma,
        configuration: fixture,
        locale: "en",
        apply: false,
      })
      expect(dry).toMatchObject({
        mode: "dry-run",
        action: "create-block",
        written: false,
        published: false,
        experienceLocaleId: localeId,
      })
      expect(await revisionCount(localeId)).toBe(revisionsBefore)

      // Apply: the existing service validates and stages exactly one draft.
      const applied = await importWatchAudienceConfig({
        prisma,
        configuration: fixture,
        locale: "en",
        apply: true,
      })
      expect(applied).toMatchObject({ action: "create-block", written: true })
      const staged = await service.getLocaleDraftState({
        id: localeId,
        user: ADMIN,
      })
      const audienceBlocks = (
        staged.effective.blocks as { t: string }[]
      ).filter((block) => block.t === "watchAudience")
      expect(audienceBlocks).toHaveLength(1)
      expect(audienceBlocks[0]).toMatchObject({
        sectionKey: "watch-audience",
        configuration: fixture,
      })
      // The existing block survives; the canonical row is untouched.
      expect(
        (staged.effective.blocks as { t: string }[]).map((block) => block.t),
      ).toEqual(["text", "watchAudience"])
      const canonicalAfter = await prisma.experienceLocale.findUniqueOrThrow({
        where: { id: localeId },
      })
      expect(canonicalAfter.blocks).toEqual(canonicalBefore.blocks)
      expect(canonicalAfter.status).toBe(canonicalBefore.status)

      // Idempotent: a second apply changes nothing.
      const revisionsAfterApply = await revisionCount(localeId)
      const again = await importWatchAudienceConfig({
        prisma,
        configuration: fixture,
        locale: "en",
        apply: true,
      })
      expect(again).toMatchObject({ action: "unchanged", written: false })
      expect(await revisionCount(localeId)).toBe(revisionsAfterApply)

      // Draft isolation: the public projection sees nothing before a publish.
      const beforePublish = await settings.get({ locale: "en" })
      expect(await settings.getWatchAudience(beforePublish)).toBeNull()

      // The human publish control (not this script) makes it live.
      await service.publishLocale({ input: { id: localeId }, user: ADMIN })
      const published = await settings.getWatchAudience(
        await settings.get({ locale: "en" }),
      )
      expect(published).toMatchObject({
        rejected: false,
        sourceBlockId: "watch-audience",
        sourceLocale: "en",
      })
      expect(JSON.parse(published!.configJson!)).toEqual(fixture)

      // A changed configuration updates the block in place and stays a draft.
      const changed = structuredClone(fixture)
      changed.roles[0].actions.reverse()
      const update = await importWatchAudienceConfig({
        prisma,
        configuration: changed,
        locale: "en",
        apply: true,
      })
      expect(update).toMatchObject({ action: "update-block", written: true })
      const stillPublished = await settings.getWatchAudience(
        await settings.get({ locale: "en" }),
      )
      expect(JSON.parse(stillPublished!.configJson!)).toEqual(fixture)
    })
  },
)
