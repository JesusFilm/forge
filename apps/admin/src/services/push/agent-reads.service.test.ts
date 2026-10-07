/**
 * R5–R8 — what the agent reads do with the rows Prisma returns. The
 * predicates and the published parity are proven against Postgres in
 * `agent-reads.db.test.ts`.
 */
import type { PushDestinationKind } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: { PUSH_CAMPAIGNS_ENABLED: "true" as string | undefined },
}))
vi.mock("@/config/env", () => mockEnv)

const destinationStates = vi.hoisted(
  () => new Map<string, { published: boolean; reason: string | null }>(),
)
vi.mock("./destinations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./destinations")>()),
  readPushDestinationStates: vi.fn(
    async (
      _prisma: unknown,
      _kind: PushDestinationKind,
      slugs: readonly string[],
    ) =>
      new Map(
        slugs.flatMap((slug) => {
          const state = destinationStates.get(slug)
          return state ? [[slug, state] as const] : []
        }),
      ),
  ),
}))

import {
  countPushAgentAudience,
  listPushAgentCampaigns,
  PUSH_AGENT_CAMPAIGN_LIST_MAX_LIMIT,
  PUSH_AGENT_LANGUAGE_SEARCH_LIMIT,
  readPushAgentCampaign,
  searchPushAgentLanguages,
} from "./agent-reads.service"
import { PushInputError } from "./errors"

const SPANISH_ROW = {
  slug: "spanish",
  bcp47: "es",
  name: { en: "Spanish", es: "Español", fr: "Espagnol" },
}
const ENGLISH_ROW = { slug: "english", bcp47: "en", name: { en: "English" } }

function languageClient(rows: readonly unknown[]) {
  return { language: { findMany: vi.fn(async () => rows) } }
}

beforeEach(() => {
  mockEnv.env.PUSH_CAMPAIGNS_ENABLED = "true"
  destinationStates.clear()
})

describe("searchPushAgentLanguages", () => {
  it("returns the known slugs with their names and lists an unknown slug (R5)", async () => {
    const client = languageClient([SPANISH_ROW])

    const result = await searchPushAgentLanguages(client as never, {
      slugs: ["spanish", "klingon"],
    })

    expect(result).toEqual({
      languages: [
        {
          slug: "spanish",
          englishName: "Spanish",
          nativeName: "Español",
          bcp47: "es",
        },
      ],
      unknown: ["klingon"],
      truncated: false,
    })
  })

  it("names a language with no English or native entry as null", async () => {
    const client = languageClient([
      { slug: "zapotec", bcp47: null, name: { fr: "Zapotèque" } },
    ])

    const result = await searchPushAgentLanguages(client as never, {
      slugs: ["zapotec"],
    })

    expect(result.languages).toEqual([
      { slug: "zapotec", englishName: null, nativeName: null, bcp47: null },
    ])
  })

  it("stops a name search at its cap and says the list is cut", async () => {
    const rows = Array.from(
      { length: PUSH_AGENT_LANGUAGE_SEARCH_LIMIT + 1 },
      (_, index) => ({
        slug: `arabic-${String(index).padStart(2, "0")}`,
        bcp47: null,
        name: { en: `Arabic ${index}` },
      }),
    )

    const result = await searchPushAgentLanguages(
      languageClient(rows) as never,
      { q: "arabic" },
    )

    expect(result.languages).toHaveLength(25)
    expect(result.truncated).toBe(true)
    expect(result.unknown).toEqual([])
  })

  it("does not call a full page cut", async () => {
    const rows = Array.from(
      { length: PUSH_AGENT_LANGUAGE_SEARCH_LIMIT },
      (_, index) => ({ slug: `l${index}`, bcp47: null, name: {} }),
    )

    const result = await searchPushAgentLanguages(
      languageClient(rows) as never,
      { q: "l" },
    )

    expect(result.languages).toHaveLength(25)
    expect(result.truncated).toBe(false)
  })
})

type GroupByArgs = { where: Record<string, unknown> }

function countsClient(input: {
  matching: ReadonlyArray<[string, number]>
  unreachable: ReadonlyArray<[string, number]>
  languages: readonly unknown[]
}) {
  const groups = (pairs: ReadonlyArray<[string, number]>) =>
    pairs.map(([appLanguageSlug, count]) => ({
      appLanguageSlug,
      _count: { _all: count },
    }))
  return {
    pushRegistration: {
      // The unreachable read is the audience AND the blocked Android phones.
      groupBy: vi.fn(async (args: GroupByArgs) =>
        "AND" in args.where
          ? groups(input.unreachable)
          : groups(input.matching),
      ),
    },
    language: { findMany: vi.fn(async () => input.languages) },
  }
}

describe("countPushAgentAudience", () => {
  it("counts reachable phones per app language and keeps the dashboard's totals (KTD10)", async () => {
    const client = countsClient({
      matching: [
        ["spanish", 5],
        ["english", 7],
        ["chinese", 2],
        ["klingon", 1],
      ],
      unreachable: [
        ["spanish", 1],
        ["chinese", 2],
      ],
      languages: [SPANISH_ROW, ENGLISH_ROW],
    })

    const counts = await countPushAgentAudience(client as never, {
      campaign: {
        audienceScope: "COUNTRIES",
        countries: ["MX", "CN"],
        languageFilter: [],
      },
    })

    expect(counts).toEqual({
      total: 12,
      unreachable: 3,
      byAppLanguage: [
        { slug: "english", name: "English", count: 7 },
        { slug: "spanish", name: "Spanish", count: 4 },
        { slug: "klingon", name: null, count: 1 },
      ],
    })
  })

  it("reads no unreachable phones when no country is blocked", async () => {
    const client = countsClient({
      matching: [["english", 3]],
      unreachable: [["english", 3]],
      languages: [ENGLISH_ROW],
    })

    const counts = await countPushAgentAudience(client as never, {
      campaign: {
        audienceScope: "EVERYWHERE",
        countries: [],
        languageFilter: [],
      },
      blockedCountries: [],
    })

    expect(counts).toEqual({
      total: 3,
      unreachable: 0,
      byAppLanguage: [{ slug: "english", name: "English", count: 3 }],
    })
    expect(client.pushRegistration.groupBy).toHaveBeenCalledOnce()
  })
})

const ENGLISH_COPY = {
  languageSlug: "english",
  title: "An announcement",
  body: "Watch tonight",
}
const FRENCH_COPY = {
  languageSlug: "french",
  title: "Une annonce",
  body: "Regardez ce soir",
}
const SPANISH_COPY = {
  languageSlug: "spanish",
  title: "Un anuncio",
  body: "Mira esta noche",
}

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign_1",
    status: "DRAFT",
    contentVersion: 4,
    mode: "WAVE",
    sendDate: null,
    localHour: null,
    destinationKind: "VIDEO",
    destinationSlug: "jesus",
    audienceScope: "COUNTRIES",
    countries: ["MX"],
    languageFilter: [],
    aiLastActorId: "user_agent_editor",
    aiLastWrittenAt: new Date("2026-10-06T08:00:00.000Z"),
    workflowRunLogId: null,
    createdAt: new Date("2026-10-05T08:00:00.000Z"),
    updatedAt: new Date("2026-10-06T08:00:00.000Z"),
    copies: [ENGLISH_COPY, FRENCH_COPY, SPANISH_COPY],
    ...overrides,
  }
}

function campaignClient(row: Record<string, unknown> | null) {
  return {
    pushCampaign: { findUnique: vi.fn(async () => row) },
    workflowRun: { findUnique: vi.fn(async () => null) },
  }
}

describe("readPushAgentCampaign", () => {
  it("returns only the asked copy rows and every slug (KTD21)", async () => {
    destinationStates.set("jesus", { published: true, reason: null })

    const campaign = await readPushAgentCampaign(
      campaignClient(campaignRow()) as never,
      { campaignId: "campaign_1", languages: ["spanish"] },
    )

    expect(campaign?.copies).toEqual([SPANISH_COPY])
    expect(campaign?.languages).toEqual(["english", "french", "spanish"])
  })

  it("returns every copy row when no language is asked for", async () => {
    destinationStates.set("jesus", { published: true, reason: null })

    const campaign = await readPushAgentCampaign(
      campaignClient(campaignRow()) as never,
      { campaignId: "campaign_1" },
    )

    expect(campaign?.copies).toEqual([ENGLISH_COPY, FRENCH_COPY, SPANISH_COPY])
  })

  it("reads the revision, the marker, the audience, and the live destination", async () => {
    destinationStates.set("jesus", {
      published: false,
      reason: "watch_restricted",
    })

    const campaign = await readPushAgentCampaign(
      campaignClient(campaignRow()) as never,
      { campaignId: "campaign_1" },
    )

    expect(campaign).toMatchObject({
      campaignId: "campaign_1",
      status: "DRAFT",
      revision: 4,
      editable: true,
      sendingEnabled: true,
      destination: {
        kind: "VIDEO",
        slug: "jesus",
        exists: true,
        published: false,
        reason: "watch_restricted",
      },
      audience: { scope: "COUNTRIES", countries: ["MX"], languageFilter: [] },
      test: { running: false, receiptsUntil: null },
      aiMarker: {
        actorId: "user_agent_editor",
        writtenAt: new Date("2026-10-06T08:00:00.000Z"),
      },
      createdAt: new Date("2026-10-05T08:00:00.000Z"),
    })
  })

  it("marks a stored destination with no live row as missing (KTD13)", async () => {
    const campaign = await readPushAgentCampaign(
      campaignClient(campaignRow()) as never,
      { campaignId: "campaign_1" },
    )

    expect(campaign?.destination).toEqual({
      kind: "VIDEO",
      slug: "jesus",
      exists: false,
      published: false,
      reason: null,
    })
  })

  it("reads sending as off while PUSH_CAMPAIGNS_ENABLED is not true", async () => {
    mockEnv.env.PUSH_CAMPAIGNS_ENABLED = undefined

    const campaign = await readPushAgentCampaign(
      campaignClient(campaignRow({ destinationKind: null })) as never,
      { campaignId: "campaign_1" },
    )

    expect(campaign?.sendingEnabled).toBe(false)
    expect(campaign?.destination).toBeNull()
  })

  it("leaves out the schedule of a TESTED campaign from a failed start", async () => {
    const row = campaignRow({
      status: "TESTED",
      mode: "IMMEDIATE",
      sendDate: new Date("2026-10-10T00:00:00.000Z"),
      localHour: 9,
      destinationKind: null,
    })

    const campaign = await readPushAgentCampaign(campaignClient(row) as never, {
      campaignId: "campaign_1",
    })

    expect(campaign?.schedule).toBeNull()
    const serialized = JSON.stringify(campaign)
    expect(serialized).not.toContain("2026-10-10")
    expect(serialized).not.toContain("IMMEDIATE")
    expect(serialized).not.toContain("localHour")
  })

  it("returns the schedule once the campaign is scheduled", async () => {
    const row = campaignRow({
      status: "SCHEDULED",
      sendDate: new Date("2026-10-10T00:00:00.000Z"),
      localHour: 9,
      destinationKind: null,
    })

    const campaign = await readPushAgentCampaign(campaignClient(row) as never, {
      campaignId: "campaign_1",
    })

    expect(campaign?.editable).toBe(false)
    expect(campaign?.schedule).toEqual({
      mode: "WAVE",
      sendDate: "2026-10-10",
      localHour: 9,
    })
  })

  it("returns null for a campaign that does not exist", async () => {
    await expect(
      readPushAgentCampaign(campaignClient(null) as never, {
        campaignId: "missing",
      }),
    ).resolves.toBeNull()
  })
})

function listClient(rows: readonly unknown[]) {
  return { pushCampaign: { findMany: vi.fn(async () => rows) } }
}

function listRow(id: string) {
  return {
    id,
    status: "DRAFT",
    contentVersion: 1,
    destinationKind: null,
    destinationSlug: null,
    aiLastActorId: null,
    aiLastWrittenAt: null,
    createdAt: new Date("2026-10-06T08:00:00.000Z"),
    updatedAt: new Date("2026-10-06T08:00:00.000Z"),
    copies: [{ title: `Title ${id}` }],
    _count: { copies: 2 },
  }
}

describe("listPushAgentCampaigns", () => {
  it("maps each row and says when the page is cut", async () => {
    const rows = ["c3", "c2", "c1"].map(listRow)

    const result = await listPushAgentCampaigns(listClient(rows) as never, {
      limit: 2,
    })

    expect(result.truncated).toBe(true)
    expect(result.campaigns).toEqual([
      {
        campaignId: "c3",
        status: "DRAFT",
        revision: 1,
        englishTitle: "Title c3",
        languageCount: 2,
        destination: null,
        aiMarker: null,
        createdAt: new Date("2026-10-06T08:00:00.000Z"),
        updatedAt: new Date("2026-10-06T08:00:00.000Z"),
      },
      expect.objectContaining({ campaignId: "c2" }),
    ])
  })

  it("refuses a page larger than the cap", async () => {
    await expect(
      listPushAgentCampaigns(listClient([]) as never, {
        limit: PUSH_AGENT_CAMPAIGN_LIST_MAX_LIMIT + 1,
      }),
    ).rejects.toBeInstanceOf(PushInputError)
  })
})
