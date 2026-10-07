// The push.* tools through `POST /mcp` against Postgres (F1, F2, AE4, AE5, AE9);
// only sign-in and the rate limit are stubbed. Run with PUSH_DB_TEST=1 and a
// DATABASE_URL, as the other push `*.db.test.ts` suites do.
import { PrismaClient, type PushCampaignStatus } from "@prisma/client"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { env } from "@/config/env"
import { writePushCampaignContent } from "@/services/push/campaign-content.service"
import { PUSH_ENGLISH_LANGUAGE_SLUG } from "@/services/push/language-resolution"

const PREFIX = "push_mcp_route_db_"
const ACTOR = `${PREFIX}editor`
const HAND_EDITOR = `${PREFIX}hand_editor`

const holder = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  sendingEnabled: "true" as string | undefined,
}))

vi.mock("@/db/client", () => ({
  get prisma() {
    return holder.prisma
  },
}))
vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(async () => ({ allowed: true, source: "ip" })),
}))
vi.mock("@/auth/admin-mcp-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/auth/admin-mcp-oauth")>()),
  resolveAdminMcpPrincipal: vi.fn(async () => ({
    principal: { id: ACTOR, role: "EDITOR" },
    token: { subject: ACTOR, scopes: [] },
  })),
}))
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>()
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, key, receiver) {
        if (key === "PUSH_CAMPAIGNS_ENABLED") return holder.sendingEnabled
        return Reflect.get(target, key, receiver)
      },
    }),
  }
})

import { POST } from "./route"

const databaseUrl = process.env.DATABASE_URL
const mine = { id: { startsWith: PREFIX } }

const SPANISH = `${PREFIX}spanish`
const FRENCH = `${PREFIX}french`
const UNKNOWN = `${PREFIX}unknown`
const DRAFT_FILM = `${PREFIX}draft-film`
const LIVE_FILM = `${PREFIX}live-film`
const GONE_FILM = `${PREFIX}gone-film`
const CAMPAIGN = `${PREFIX}campaign`
// The audience is global, so these phones use a zone and a country that no
// sibling suite writes or counts.
const MY_ZONE = "Pacific/Pitcairn"
const MY_COUNTRY = "PN"
const TEST_LEDGER = `${PREFIX}test_ledger`

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

type Envelope = {
  ok: boolean
  reason?: string
  message?: string
  status?: string
  currentRevision?: number
  [key: string]: unknown
}

type WriteResult = Envelope & {
  campaign: { id: string; status: PushCampaignStatus; revision: number }
  statusChange: { from: string; to: string } | null
  editorUrl: string
  changed: {
    languages: {
      added: string[]
      updated: string[]
      removed: string[]
      unchangedCount: number
    }
    destination: unknown
    audience: {
      before: { languageFilter: string[] }
      after: { scope: string; countries: string[]; languageFilter: string[] }
    } | null
  }
  languages: string[]
  warnings: Array<{ code: string; message: string }>
  nextSteps: string[]
  aiMarker: { by: string; at: string } | null
}

let requestId = 0

async function rpc(method: string, params?: unknown) {
  requestId += 1
  const res = await POST(
    new Request("https://admin.jesusfilm.org/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    }),
  )
  expect(res.status).toBe(200)
  return (await res.json()) as {
    result?: { structuredContent?: unknown; tools?: Array<{ name: string }> }
    error?: unknown
  }
}

async function tool<T = Envelope>(name: string, args: unknown): Promise<T> {
  const body = await rpc("tools/call", { name, arguments: args })
  expect(body.error, JSON.stringify(body.error)).toBeUndefined()
  return body.result?.structuredContent as T
}

function warningCodes(result: { warnings: Array<{ code: string }> }) {
  return result.warnings.map((warning) => warning.code)
}

async function clean(prisma: PrismaClient): Promise<void> {
  await prisma.workflowRun.deleteMany({ where: mine })
  await prisma.pushCampaign.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { lastActorId: { startsWith: PREFIX } },
        { aiLastActorId: { startsWith: PREFIX } },
      ],
    },
  })
  await prisma.pushRegistration.deleteMany({ where: mine })
  await prisma.video.deleteMany({ where: mine })
  await prisma.language.deleteMany({ where: mine })
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push campaign MCP tools against Postgres",
  () => {
    let prisma: PrismaClient

    // Built here, not in the describe body, which skipIf still runs.
    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      holder.prisma = prisma
    })

    beforeEach(async () => {
      holder.sendingEnabled = "true"
      await clean(prisma)
      // Suites in parallel share English, so it is one atomic upsert under an
      // id that no suite's clean deletes (campaign-content.db.test.ts too).
      await prisma.language.upsert({
        where: { slug: PUSH_ENGLISH_LANGUAGE_SLUG },
        create: {
          id: "push_db_shared_lang_english",
          coreId: "push_db_shared_core_english",
          slug: PUSH_ENGLISH_LANGUAGE_SLUG,
        },
        update: {},
      })
      await prisma.language.createMany({
        data: [
          { slug: SPANISH, bcp47: "es", name: { en: "Spanish Pushmcp" } },
          { slug: FRENCH, bcp47: "fr", name: { en: "French Pushmcp" } },
        ].map((language) => ({
          id: `${PREFIX}lang_${language.slug}`,
          coreId: `${PREFIX}core_${language.slug}`,
          ...language,
        })),
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
              title: "Pushmcp draft film",
              status: "DRAFT",
            },
          },
        },
      })
      await prisma.video.create({
        data: {
          id: `${PREFIX}video_live_film`,
          coreId: `${PREFIX}core_live_film`,
          slug: LIVE_FILM,
          label: "FEATURE_FILM",
          locales: {
            create: {
              id: `${PREFIX}vl_live_film`,
              locale: "en",
              title: "Pushmcp live film",
              status: "PUBLISHED",
            },
          },
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    async function seedCampaign(
      input: {
        status?: PushCampaignStatus
        contentVersion?: number
        copies?: ReadonlyArray<typeof ENGLISH_COPY>
        destinationSlug?: string
        workflowRunLogId?: string
      } = {},
    ): Promise<void> {
      await prisma.pushCampaign.create({
        data: {
          id: CAMPAIGN,
          status: input.status ?? "DRAFT",
          contentVersion: input.contentVersion ?? 3,
          destinationKind: "VIDEO",
          destinationSlug: input.destinationSlug ?? LIVE_FILM,
          lastActorId: HAND_EDITOR,
          workflowRunLogId: input.workflowRunLogId ?? null,
          copies: {
            createMany: {
              data: [
                ...(input.copies ?? [ENGLISH_COPY, SPANISH_COPY, FRENCH_COPY]),
              ],
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

    async function createdCampaign(id: string) {
      return prisma.pushCampaign.findUniqueOrThrow({
        where: { id },
        include: { copies: { orderBy: { languageSlug: "asc" } } },
      })
    }

    it("drafts a campaign from a request, start to finish (F1, AE4)", async () => {
      await prisma.pushRegistration.createMany({
        data: ["1", "2"].map((suffix) => ({
          id: `${PREFIX}reg_${suffix}`,
          expoPushToken: `ExponentPushToken[${PREFIX}${suffix}]`,
          testDeviceId: `${PREFIX}device_${suffix}`,
          installId: `${PREFIX}install_${suffix}`,
          platform: "IOS" as const,
          appBuild: "1.0.0",
          appLanguageSlug: SPANISH,
          phoneLocale: "es-PN",
          phoneLanguageSlug: null,
          timeZone: MY_ZONE,
          country: MY_COUNTRY,
          countrySource: "EDGE" as const,
          status: "ACTIVE" as const,
        })),
      })

      const init = await rpc("initialize")
      expect(init.error).toBeUndefined()
      const listed = await rpc("tools/list")
      expect(listed.result?.tools?.map((entry) => entry.name)).toEqual(
        expect.arrayContaining([
          "push.language.search",
          "push.destination.search",
          "push.audience.count",
          "push.campaign.list",
          "push.campaign.read",
          "push.campaign.create",
          "push.campaign.update",
        ]),
      )

      const destinations = await tool<{
        ok: true
        destinations: Array<{
          kind: string
          slug: string
          published: boolean
          reason: string | null
        }>
      }>("push.destination.search", { q: "Pushmcp draft film" })
      expect(destinations.ok).toBe(true)
      expect(destinations.destinations).toContainEqual(
        expect.objectContaining({
          kind: "VIDEO",
          slug: DRAFT_FILM,
          published: false,
          reason: "no_published_locale",
        }),
      )

      const counts = await tool<{
        ok: true
        total: number
        byAppLanguage: Array<{ slug: string; count: number }>
      }>("push.audience.count", {
        scope: "COUNTRIES",
        countries: [MY_COUNTRY.toLowerCase()],
      })
      expect(counts.ok).toBe(true)
      expect(counts.total).toBe(2)
      expect(counts.byAppLanguage).toContainEqual(
        expect.objectContaining({ slug: SPANISH, count: 2 }),
      )

      const languages = await tool<{ ok: true; unknown: string[] }>(
        "push.language.search",
        { slugs: [SPANISH, FRENCH, UNKNOWN] },
      )
      expect(languages.ok).toBe(true)
      expect(languages.unknown).toEqual([UNKNOWN])

      const created = await tool<WriteResult>("push.campaign.create", {
        copies: [ENGLISH_COPY, SPANISH_COPY, FRENCH_COPY],
        destination: { kind: "VIDEO", slug: DRAFT_FILM },
        audience: { scope: "COUNTRIES", countries: [MY_COUNTRY] },
      })

      expect(created.ok).toBe(true)
      expect(created.campaign.status).toBe("DRAFT")
      expect(created.campaign.revision).toBe(1)
      expect(created.statusChange).toBeNull()
      expect(created.editorUrl).toMatch(
        new RegExp(`/dashboard/push-campaigns/${created.campaign.id}$`),
      )
      expect([...created.changed.languages.added].sort()).toEqual(
        [PUSH_ENGLISH_LANGUAGE_SLUG, SPANISH, FRENCH].sort(),
      )
      expect([...created.languages].sort()).toEqual(
        [PUSH_ENGLISH_LANGUAGE_SLUG, SPANISH, FRENCH].sort(),
      )
      expect(warningCodes(created)).toContain("destination_not_published")
      expect(created.nextSteps.length).toBeGreaterThan(0)
      expect(created.nextSteps.join(" ")).toMatch(/send a test/i)
      expect(created.nextSteps.join(" ")).toMatch(/schedule/i)
      expect(created.aiMarker).toEqual({ by: ACTOR, at: expect.any(String) })

      const stored = await createdCampaign(created.campaign.id)
      expect(stored.status).toBe("DRAFT")
      expect(stored.destinationSlug).toBe(DRAFT_FILM)
      expect(stored.aiLastActorId).toBe(ACTOR)
      expect(stored.lastActorId).toBe(ACTOR)
    })

    it("fixes one language after review and refuses a write from out-of-date data (F2)", async () => {
      await seedCampaign({ status: "TESTED", contentVersion: 3 })
      const before = await readCampaign()

      const fixed = await tool<WriteResult>("push.campaign.update", {
        campaignId: CAMPAIGN,
        expectedRevision: 3,
        copies: [{ ...SPANISH_COPY, title: "Un anuncio nuevo" }],
      })

      expect(fixed.ok).toBe(true)
      expect(fixed.statusChange).toEqual({ from: "TESTED", to: "DRAFT" })
      expect(warningCodes(fixed)).toContain("test_invalidated")
      expect(fixed.changed.languages).toEqual({
        added: [],
        updated: [SPANISH],
        removed: [],
        unchangedCount: 2,
      })
      expect(fixed.changed.destination).toBeNull()
      expect(fixed.changed.audience).toBeNull()
      expect(fixed.campaign).toEqual({
        id: CAMPAIGN,
        status: "DRAFT",
        revision: 4,
      })
      const after = await readCampaign()
      for (const slug of [PUSH_ENGLISH_LANGUAGE_SLUG, FRENCH]) {
        const old = before.copies.find((row) => row.languageSlug === slug)
        const now = after.copies.find((row) => row.languageSlug === slug)
        expect(now?.updatedAt, slug).toEqual(old?.updatedAt)
      }

      // A person saves the form in the dashboard after the agent read rev 4.
      await writePushCampaignContent(prisma, {
        source: "dashboard",
        campaignId: CAMPAIGN,
        actorId: HAND_EDITOR,
        expectedContentVersion: 4,
        update: {
          copies: [
            ENGLISH_COPY,
            { ...SPANISH_COPY, title: "Un anuncio nuevo" },
            { ...FRENCH_COPY, title: "Une annonce revue" },
          ],
        },
      })

      const stale = await tool("push.campaign.update", {
        campaignId: CAMPAIGN,
        expectedRevision: 4,
        copies: [{ ...SPANISH_COPY, title: "Otro anuncio" }],
      })
      expect(stale).toMatchObject({
        ok: false,
        reason: "stale_revision",
        currentRevision: 5,
      })
      expect(
        (await readCampaign()).copies.find(
          (row) => row.languageSlug === SPANISH,
        )?.title,
      ).toBe("Un anuncio nuevo")

      const again = await tool<WriteResult>("push.campaign.update", {
        campaignId: CAMPAIGN,
        expectedRevision: 5,
        copies: [{ ...SPANISH_COPY, title: "Un anuncio nuevo" }],
      })
      expect(again.ok).toBe(true)
      expect(again.changed).toEqual({
        languages: { added: [], updated: [], removed: [], unchangedCount: 3 },
        destination: null,
        audience: null,
      })
      expect(again.statusChange).toBeNull()
      expect(again.campaign.revision).toBe(5)
    })

    it("warns that a running test no longer counts and names when to test again", async () => {
      await prisma.workflowRun.create({
        data: {
          id: TEST_LEDGER,
          workflowKey: "push-campaign",
          trigger: "USER",
          subjectType: "push_campaign",
          subjectId: CAMPAIGN,
          status: "RUNNING",
          startedAt: new Date("2026-10-06T09:00:30.000Z"),
          details: { kind: "TEST" },
        },
      })
      await seedCampaign({ status: "DRAFT", workflowRunLogId: TEST_LEDGER })

      const result = await tool<WriteResult>("push.campaign.update", {
        campaignId: CAMPAIGN,
        expectedRevision: 3,
        copies: [{ ...SPANISH_COPY, title: "Un anuncio nuevo" }],
      })

      expect(result.ok).toBe(true)
      expect(warningCodes(result)).toContain("test_run_superseded")
      // The receipt window is 15 minutes from 09:00:30, rounded up to 09:16.
      expect(result.nextSteps.join(" ")).toContain("09:16 UTC")
    })

    it("refuses to change a SCHEDULED campaign and names its status (AE5)", async () => {
      await seedCampaign({ status: "SCHEDULED" })

      const result = await tool("push.campaign.update", {
        campaignId: CAMPAIGN,
        expectedRevision: 3,
        copies: [{ ...SPANISH_COPY, title: "Un anuncio nuevo" }],
      })

      expect(result).toMatchObject({
        ok: false,
        reason: "not_editable",
        status: "SCHEDULED",
      })
      expect(result.message).toContain("SCHEDULED")
      expect(result.message).not.toMatch(/cancel/i)
      const row = await readCampaign()
      expect(row.status).toBe("SCHEDULED")
      expect(row.contentVersion).toBe(3)
    })

    describe("status matrix (R10, R17)", () => {
      const statuses: PushCampaignStatus[] = [
        "DRAFT",
        "TESTED",
        "SCHEDULED",
        "SENDING",
        "SENT",
        "PAUSED",
        "CANCELLED",
      ]

      it.each(statuses)(
        "a changing update and a no-op update of a %s campaign",
        async (status) => {
          await seedCampaign({ status })
          const editable = status === "DRAFT" || status === "TESTED"

          const noop = await tool<WriteResult>("push.campaign.update", {
            campaignId: CAMPAIGN,
            expectedRevision: 3,
            copies: [SPANISH_COPY],
          })
          if (editable) {
            expect(noop.ok).toBe(true)
            expect(noop.statusChange).toBeNull()
            expect(noop.campaign.status).toBe(status)
          } else {
            expect(noop).toMatchObject({
              ok: false,
              reason: "not_editable",
              status,
            })
          }
          expect((await readCampaign()).status).toBe(status)

          const change = await tool<WriteResult>("push.campaign.update", {
            campaignId: CAMPAIGN,
            expectedRevision: 3,
            copies: [{ ...SPANISH_COPY, title: "Un anuncio nuevo" }],
          })
          if (editable) {
            expect(change.ok).toBe(true)
            expect(change.campaign.status).toBe("DRAFT")
            expect((await readCampaign()).status).toBe("DRAFT")
          } else {
            expect(change).toMatchObject({
              ok: false,
              reason: "not_editable",
              status,
            })
            const row = await readCampaign()
            expect(row.status).toBe(status)
            expect(row.contentVersion).toBe(3)
          }
        },
      )

      it("creates every campaign as a DRAFT", async () => {
        const created = await tool<WriteResult>("push.campaign.create", {
          copies: [ENGLISH_COPY],
        })

        expect(created.campaign.status).toBe("DRAFT")
        expect((await createdCampaign(created.campaign.id)).status).toBe(
          "DRAFT",
        )
      })
    })

    it("saves a draft while sending is turned off and warns (R18)", async () => {
      holder.sendingEnabled = "false"

      const off = await tool<WriteResult>("push.campaign.create", {
        copies: [ENGLISH_COPY],
      })
      expect(off.ok).toBe(true)
      expect(warningCodes(off)).toContain("sending_disabled")

      holder.sendingEnabled = "true"
      const on = await tool<WriteResult>("push.campaign.create", {
        copies: [ENGLISH_COPY],
      })
      expect(warningCodes(on)).not.toContain("sending_disabled")
    })

    it("leaves the language filter empty when the author did not limit the audience (AE9)", async () => {
      const created = await tool<WriteResult>("push.campaign.create", {
        copies: [ENGLISH_COPY, SPANISH_COPY],
        destination: { kind: "VIDEO", slug: LIVE_FILM },
        audience: { scope: "COUNTRIES", countries: ["MX"] },
      })

      expect(created.ok).toBe(true)
      expect(warningCodes(created)).not.toContain("language_filter_set")
      expect(warningCodes(created)).not.toContain("language_filter_mismatch")
      expect(warningCodes(created)).not.toContain("destination_not_published")
      expect(created.changed.audience?.after).toEqual({
        scope: "COUNTRIES",
        countries: ["MX"],
        languageFilter: [],
      })
      expect(
        (await createdCampaign(created.campaign.id)).languageFilter,
      ).toEqual([])
    })

    it("warns when the language filter is set and names a language with no copy", async () => {
      const created = await tool<WriteResult>("push.campaign.create", {
        copies: [ENGLISH_COPY, SPANISH_COPY],
        audience: {
          scope: "COUNTRIES",
          countries: ["MX"],
          languageFilter: [SPANISH, FRENCH],
        },
      })

      expect(warningCodes(created)).toEqual(
        expect.arrayContaining([
          "language_filter_set",
          "language_filter_mismatch",
        ]),
      )
      const mismatch = created.warnings.find(
        (warning) => warning.code === "language_filter_mismatch",
      )
      expect(mismatch?.message).toContain(FRENCH)
      expect(mismatch?.message).not.toContain(SPANISH)
    })

    it("warns on a read and on a write that keep a destination whose row was deleted", async () => {
      await seedCampaign({ destinationSlug: GONE_FILM })

      const read = await tool<
        Envelope & { warnings: Array<{ code: string }>; revision: number }
      >("push.campaign.read", { campaignId: CAMPAIGN })
      expect(read.ok).toBe(true)
      expect(read.revision).toBe(3)
      expect(warningCodes(read)).toContain("destination_missing")

      const written = await tool<WriteResult>("push.campaign.update", {
        campaignId: CAMPAIGN,
        expectedRevision: 3,
        copies: [{ ...SPANISH_COPY, title: "Un anuncio nuevo" }],
      })
      expect(written.ok).toBe(true)
      expect(warningCodes(written)).toContain("destination_missing")
    })

    it("refuses an unknown language and an unknown destination, and saves nothing (R12, R32)", async () => {
      const language = await tool("push.campaign.create", {
        copies: [ENGLISH_COPY, { ...SPANISH_COPY, languageSlug: UNKNOWN }],
      })
      expect(language).toMatchObject({
        ok: false,
        reason: "unknown_language",
        slugs: [UNKNOWN],
      })

      const destination = await tool("push.campaign.create", {
        copies: [ENGLISH_COPY],
        destination: { kind: "SERIES", slug: LIVE_FILM },
      })
      expect(destination).toMatchObject({
        ok: false,
        reason: "unknown_destination",
        slug: LIVE_FILM,
        actualKind: "VIDEO",
      })

      await expect(
        prisma.pushCampaign.count({ where: { aiLastActorId: ACTOR } }),
      ).resolves.toBe(0)
    })
  },
)
