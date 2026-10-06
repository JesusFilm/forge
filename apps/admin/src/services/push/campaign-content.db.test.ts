/**
 * Real-Postgres proof of the shared content write (KTD4, KTD7, KTD8, KTD9).
 *
 * Mocked Prisma proves the branch shape. Only Postgres proves the conditional
 * update's `WHERE`, the per-row upsert key, and the language and destination
 * lookups.
 *
 * The PrismaClients are built in `beforeAll`, never in the describe body:
 * `describe.skipIf` still runs the body to collect the tests.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/campaign-content.db.test.ts
 */
import { PrismaClient, type PushCampaignStatus } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import {
  createPushCampaignContent,
  writePushCampaignContent,
} from "./campaign-content.service"
import {
  PushStaleContentVersionError,
  PushUnknownDestinationError,
  PushUnknownLanguageError,
} from "./errors"
import { PUSH_ENGLISH_LANGUAGE_SLUG } from "./language-resolution"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_content_db_"
const CAMPAIGN = `${PREFIX}campaign`
const EDITOR = `${PREFIX}editor`
const AGENT_EDITOR = `${PREFIX}agent_editor`
const SPANISH = `${PREFIX}spanish`
const FRENCH = `${PREFIX}french`
const RETIRED = `${PREFIX}retired`
const FILM = `${PREFIX}film`
const DRAFT_FILM = `${PREFIX}draft-film`
const EASTER = `${PREFIX}easter`

const ENGLISH_COPY = {
  languageSlug: PUSH_ENGLISH_LANGUAGE_SLUG,
  title: "An announcement",
  body: "Watch tonight",
}
const SPANISH_COPY = {
  languageSlug: SPANISH,
  title: "Un anuncio",
  body: "Mira esta noche",
}
const FRENCH_COPY = {
  languageSlug: FRENCH,
  title: "Une annonce",
  body: "Regardez ce soir",
}

type CopySeed = { languageSlug: string; title: string; body: string }

async function clean(prisma: PrismaClient): Promise<void> {
  await prisma.pushCampaign.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { lastActorId: { startsWith: PREFIX } },
        { aiLastActorId: { startsWith: PREFIX } },
      ],
    },
  })
  await prisma.video.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.experience.deleteMany({ where: { id: { startsWith: PREFIX } } })
  // English is shared with sibling suites, so only a row this file made goes.
  await prisma.language.deleteMany({ where: { id: { startsWith: PREFIX } } })
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push campaign content writes against Postgres",
  () => {
    let prisma: PrismaClient
    let second: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      second = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      const english = await prisma.language.findUnique({
        where: { slug: PUSH_ENGLISH_LANGUAGE_SLUG },
      })
      if (english == null) {
        await prisma.language.create({
          data: {
            id: `${PREFIX}lang_english`,
            coreId: `${PREFIX}core_english`,
            slug: PUSH_ENGLISH_LANGUAGE_SLUG,
          },
        })
      }
      await prisma.language.createMany({
        data: [
          { slug: SPANISH, deletedAt: null },
          { slug: FRENCH, deletedAt: null },
          { slug: RETIRED, deletedAt: new Date("2026-09-01T00:00:00Z") },
        ].map((language) => ({
          id: `${PREFIX}lang_${language.slug}`,
          coreId: `${PREFIX}core_${language.slug}`,
          ...language,
        })),
      })
      await prisma.video.create({
        data: {
          id: `${PREFIX}video_film`,
          coreId: `${PREFIX}core_film`,
          slug: FILM,
          label: "FEATURE_FILM",
          locales: {
            create: {
              id: `${PREFIX}vl_film`,
              locale: "en",
              status: "PUBLISHED",
            },
          },
        },
      })
      await prisma.video.create({
        data: {
          id: `${PREFIX}video_draft_film`,
          coreId: `${PREFIX}core_draft_film`,
          slug: DRAFT_FILM,
          label: "FEATURE_FILM",
          locales: {
            create: {
              id: `${PREFIX}vl_draft_film`,
              locale: "en",
              status: "DRAFT",
            },
          },
        },
      })
      await prisma.experience.create({
        data: {
          id: `${PREFIX}experience_easter`,
          locales: {
            create: {
              id: `${PREFIX}el_easter`,
              locale: "en",
              slug: EASTER,
              status: "PUBLISHED",
            },
          },
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await Promise.all([prisma.$disconnect(), second.$disconnect()])
    })

    async function seedCampaign(
      input: {
        status?: PushCampaignStatus
        contentVersion?: number
        copies?: readonly CopySeed[]
        countries?: string[]
        languageFilter?: string[]
      } = {},
    ): Promise<void> {
      const countries = input.countries ?? []
      await prisma.pushCampaign.create({
        data: {
          id: CAMPAIGN,
          status: input.status ?? "DRAFT",
          contentVersion: input.contentVersion ?? 4,
          destinationKind: "VIDEO",
          destinationSlug: FILM,
          audienceScope: countries.length > 0 ? "COUNTRIES" : "EVERYWHERE",
          countries,
          languageFilter: input.languageFilter ?? [],
          lastActorId: EDITOR,
          copies: {
            createMany: {
              data: [...(input.copies ?? [ENGLISH_COPY, SPANISH_COPY])],
            },
          },
        },
      })
    }

    async function readCampaign() {
      return prisma.pushCampaign.findUniqueOrThrow({
        where: { id: CAMPAIGN },
        include: { copies: { orderBy: { languageSlug: "asc" } } },
      })
    }

    it("rewrites only the named language row and keeps the other rows' ids (AE2)", async () => {
      await seedCampaign({ copies: [ENGLISH_COPY, SPANISH_COPY, FRENCH_COPY] })
      const before = await readCampaign()

      const result = await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: {
          copies: [{ ...SPANISH_COPY, title: "Un anuncio nuevo" }],
        },
      })

      const after = await readCampaign()
      const bySlug = (rows: typeof before.copies) =>
        new Map(rows.map((row) => [row.languageSlug, row]))
      const old = bySlug(before.copies)
      const now = bySlug(after.copies)
      for (const slug of [PUSH_ENGLISH_LANGUAGE_SLUG, FRENCH]) {
        expect(now.get(slug)?.id).toBe(old.get(slug)?.id)
        expect(now.get(slug)?.updatedAt).toEqual(old.get(slug)?.updatedAt)
      }
      expect(now.get(SPANISH)?.id).toBe(old.get(SPANISH)?.id)
      expect(now.get(SPANISH)?.title).toBe("Un anuncio nuevo")
      expect(result.changed.languages).toEqual({
        added: [],
        updated: [SPANISH],
        removed: [],
        unchangedCount: 2,
      })
    })

    it("moves a tested campaign to draft, raises the version, and sets the marker (AE1)", async () => {
      await seedCampaign({ status: "TESTED" })

      const result = await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { copies: [{ ...ENGLISH_COPY, body: "Watch it tonight" }] },
      })

      const row = await readCampaign()
      expect(row.status).toBe("DRAFT")
      expect(row.contentVersion).toBe(5)
      expect(row.lastActorId).toBe(AGENT_EDITOR)
      expect(row.aiLastActorId).toBe(AGENT_EDITOR)
      expect(row.aiLastWrittenAt).not.toBeNull()
      expect(result.statusChange).toEqual({ from: "TESTED", to: "DRAFT" })
      expect(result.after.contentVersion).toBe(5)
    })

    it("refuses the second of two writers that loaded the same version, and keeps the first (R34)", async () => {
      await seedCampaign()
      await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { copies: [{ ...ENGLISH_COPY, title: "The first writer" }] },
      })

      const late = writePushCampaignContent(prisma, {
        source: "dashboard",
        campaignId: CAMPAIGN,
        actorId: EDITOR,
        expectedContentVersion: 4,
        update: {
          copies: [{ ...ENGLISH_COPY, title: "The second writer" }],
        },
      })

      await expect(late).rejects.toBeInstanceOf(PushStaleContentVersionError)
      await expect(late).rejects.toMatchObject({ currentContentVersion: 5 })
      const row = await readCampaign()
      expect(row.contentVersion).toBe(5)
      expect(row.lastActorId).toBe(AGENT_EDITOR)
      expect(row.copies.map((copy) => copy.languageSlug)).toEqual([
        PUSH_ENGLISH_LANGUAGE_SLUG,
        SPANISH,
      ])
      expect(row.copies[0].title).toBe("The first writer")
    })

    it("lets exactly one of two concurrent writers with the same version win", async () => {
      await seedCampaign()

      const outcomes = await Promise.allSettled(
        [
          { client: prisma, title: "Writer one" },
          { client: second, title: "Writer two" },
        ].map(({ client, title }) =>
          writePushCampaignContent(client, {
            source: "mcp",
            campaignId: CAMPAIGN,
            actorId: AGENT_EDITOR,
            expectedContentVersion: 4,
            patch: { copies: [{ ...ENGLISH_COPY, title }] },
          }),
        ),
      )

      const won = outcomes.filter((outcome) => outcome.status === "fulfilled")
      const lost = outcomes.filter((outcome) => outcome.status === "rejected")
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        PushStaleContentVersionError,
      )
      const row = await readCampaign()
      expect(row.contentVersion).toBe(5)
      const winner = outcomes.findIndex(
        (outcome) => outcome.status === "fulfilled",
      )
      expect(row.copies[0].title).toBe(
        winner === 0 ? "Writer one" : "Writer two",
      )
    })

    it("saves nothing when a create names a language admin does not know (AE3)", async () => {
      const create = createPushCampaignContent(prisma, {
        actorId: AGENT_EDITOR,
        content: {
          copies: [
            ENGLISH_COPY,
            { languageSlug: "espanol", title: "Un anuncio", body: "Mira" },
          ],
        },
      })

      await expect(create).rejects.toBeInstanceOf(PushUnknownLanguageError)
      await expect(create).rejects.toMatchObject({ slugs: ["espanol"] })
      await expect(
        prisma.pushCampaign.count({ where: { lastActorId: AGENT_EDITOR } }),
      ).resolves.toBe(0)
    })

    it("creates a draft at version 1 with its copy and an unpublished destination (R9, R13)", async () => {
      const result = await createPushCampaignContent(prisma, {
        actorId: AGENT_EDITOR,
        content: {
          copies: [ENGLISH_COPY, SPANISH_COPY],
          destination: { kind: "VIDEO", slug: DRAFT_FILM },
          audience: { scope: "COUNTRIES", countries: ["mx"] },
        },
      })

      const row = await prisma.pushCampaign.findUniqueOrThrow({
        where: { id: result.campaignId },
        include: { copies: true },
      })
      expect(row.status).toBe("DRAFT")
      expect(row.contentVersion).toBe(1)
      expect(row.lastActorId).toBe(AGENT_EDITOR)
      expect(row.aiLastActorId).toBe(AGENT_EDITOR)
      expect(row.aiLastWrittenAt).not.toBeNull()
      expect(row.destinationSlug).toBe(DRAFT_FILM)
      expect(row.countries).toEqual(["MX"])
      expect(row.copies).toHaveLength(2)
      expect(result.destinationPublished).toBe(false)
    })

    it("refuses a destination slug that names no row, and names the slug (R32)", async () => {
      await seedCampaign()
      const missing = `${PREFIX}missing`

      const write = writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { destination: { kind: "VIDEO", slug: missing } },
      })

      await expect(write).rejects.toBeInstanceOf(PushUnknownDestinationError)
      await expect(write).rejects.toMatchObject({
        slug: missing,
        actualKind: null,
      })
      await expect(write).rejects.toThrow(missing)
      expect((await readCampaign()).contentVersion).toBe(4)
    })

    it("names the actual kind when a series slug is a feature film (KTD9)", async () => {
      await seedCampaign()

      const write = writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { destination: { kind: "SERIES", slug: FILM } },
      })

      await expect(write).rejects.toMatchObject({
        slug: FILM,
        actualKind: "VIDEO",
      })
    })

    it("finds an experience by its locale slug and reports it published", async () => {
      await seedCampaign()

      const result = await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { destination: { kind: "EXPERIENCE", slug: EASTER } },
      })

      expect(result.destinationPublished).toBe(true)
      expect(result.changed.destination).toEqual({
        before: { kind: "VIDEO", slug: FILM },
        after: { kind: "EXPERIENCE", slug: EASTER },
      })
      const row = await readCampaign()
      expect(row.destinationKind).toBe("EXPERIENCE")
    })

    it("saves an unpublished destination and says it is not published (R13)", async () => {
      await seedCampaign()

      const result = await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { destination: { kind: "VIDEO", slug: DRAFT_FILM } },
      })

      expect(result.destinationPublished).toBe(false)
      expect((await readCampaign()).destinationSlug).toBe(DRAFT_FILM)
    })

    it("lets a row whose language was deleted stay while another row changes, and refuses to write it (KTD8)", async () => {
      const retiredCopy = { languageSlug: RETIRED, title: "Old", body: "Old" }
      await seedCampaign({ copies: [ENGLISH_COPY, retiredCopy] })

      await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { copies: [{ ...ENGLISH_COPY, title: "A new title" }] },
      })

      const rewrite = writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 5,
        patch: { copies: [{ ...retiredCopy, title: "Newer" }] },
      })
      await expect(rewrite).rejects.toMatchObject({ slugs: [RETIRED] })

      const removal = await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 5,
        patch: { removeLanguages: [RETIRED] },
      })
      expect(removal.changed.languages.removed).toEqual([RETIRED])
      const row = await readCampaign()
      expect(row.copies.map((copy) => copy.languageSlug)).toEqual([
        PUSH_ENGLISH_LANGUAGE_SLUG,
      ])
    })

    it("keeps the AI marker through a later dashboard save (AE7)", async () => {
      await seedCampaign()
      await writePushCampaignContent(prisma, {
        source: "mcp",
        campaignId: CAMPAIGN,
        actorId: AGENT_EDITOR,
        expectedContentVersion: 4,
        patch: { copies: [{ ...SPANISH_COPY, body: "Mira hoy" }] },
      })
      const marked = await readCampaign()

      await writePushCampaignContent(prisma, {
        source: "dashboard",
        campaignId: CAMPAIGN,
        actorId: EDITOR,
        expectedContentVersion: 5,
        update: {
          copies: [
            { ...ENGLISH_COPY, title: "A person's edit" },
            { ...SPANISH_COPY, body: "Mira hoy" },
          ],
          audience: { scope: "EVERYWHERE" },
        },
      })

      const row = await readCampaign()
      expect(row.contentVersion).toBe(6)
      expect(row.lastActorId).toBe(EDITOR)
      expect(row.aiLastActorId).toBe(AGENT_EDITOR)
      expect(row.aiLastWrittenAt).toEqual(marked.aiLastWrittenAt)
    })
  },
)
