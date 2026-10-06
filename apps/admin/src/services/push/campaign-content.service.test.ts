import type {
  PrismaClient,
  PushAudienceScope,
  PushCampaignStatus,
  PushDestinationKind,
} from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// R18 — the content write never reads the send switch, so it runs with it off.
vi.mock("@/config/env", () => ({
  env: { PUSH_CAMPAIGNS_ENABLED: "false" },
}))

const destinations = vi.hoisted(() => ({
  kinds: new Map<string, PushDestinationKind[]>(),
  published: new Set<string>(),
}))

// The real catalog predicates are proven against Postgres in
// `campaign-content.db.test.ts`; this suite proves what the write does with
// their answers.
vi.mock("./destinations", () => ({
  readPushDestinationKinds: vi.fn(
    async (_prisma: unknown, slug: string) =>
      destinations.kinds.get(slug) ?? [],
  ),
  isPushDestinationPublished: vi.fn(
    async (_prisma: unknown, destination: { slug: string }) =>
      destinations.published.has(destination.slug),
  ),
}))

import {
  createPushCampaignContent,
  writePushCampaignContent,
} from "./campaign-content.service"
import {
  PushFrozenError,
  PushInputError,
  PushNotFoundError,
  PushStaleContentVersionError,
  PushTooManyCopyRowsError,
  PushUnknownDestinationError,
  PushUnknownLanguageError,
} from "./errors"

const CAMPAIGN = "campaign_1"
const EDITOR = "user_editor"
const AGENT_EDITOR = "user_agent_editor"

const ENGLISH = {
  languageSlug: "english",
  title: "An announcement",
  body: "Watch tonight",
}
const SPANISH = {
  languageSlug: "spanish",
  title: "Un anuncio",
  body: "Mira esta noche",
}
const FRENCH = {
  languageSlug: "french",
  title: "Une annonce",
  body: "Regardez ce soir",
}

type StoredCampaign = {
  id: string
  status: PushCampaignStatus
  contentVersion: number
  destinationKind: PushDestinationKind | null
  destinationSlug: string | null
  audienceScope: PushAudienceScope
  countries: string[]
  languageFilter: string[]
  lastActorId: string | null
  aiLastActorId: string | null
  aiLastWrittenAt: Date | null
  updatedAt: Date
}

type StoredCopy = {
  id: string
  campaignId: string
  languageSlug: string
  title: string
  body: string
}

type CopyWhere = {
  campaignId_languageSlug?: { campaignId: string; languageSlug: string }
  campaignId?: string
  languageSlug?: { in: string[] }
}

/**
 * A stored campaign and the catalog around it. Each write applies to this
 * state, so a result read back here is what the service wrote, not what the
 * test told the fake to answer.
 */
function fakeStore(seed: {
  campaign?: Partial<StoredCampaign> | null
  copies?: ReadonlyArray<Omit<StoredCopy, "id" | "campaignId">>
  knownLanguages?: readonly string[]
}) {
  let nextId = 0
  const campaigns = new Map<string, StoredCampaign>()
  if (seed.campaign !== null) {
    campaigns.set(CAMPAIGN, {
      id: CAMPAIGN,
      status: "DRAFT",
      contentVersion: 3,
      destinationKind: "VIDEO",
      destinationSlug: "jesus",
      audienceScope: "EVERYWHERE",
      countries: [],
      languageFilter: [],
      lastActorId: EDITOR,
      aiLastActorId: null,
      aiLastWrittenAt: null,
      updatedAt: new Date("2026-10-01T00:00:00Z"),
      ...seed.campaign,
    })
  }
  let copies: StoredCopy[] = (seed.copies ?? [ENGLISH, SPANISH]).map(
    (copy) => ({ ...copy, id: `copy_${nextId++}`, campaignId: CAMPAIGN }),
  )
  const known = new Set(seed.knownLanguages ?? ["english", "spanish", "french"])

  const read = (id: string) => {
    const campaign = campaigns.get(id)
    if (!campaign) return null
    return {
      ...campaign,
      // Prisma answers each read with fresh objects; so does the fake.
      copies: copies
        .filter((copy) => copy.campaignId === id)
        .map((copy) => ({ ...copy }))
        .sort((left, right) =>
          left.languageSlug.localeCompare(right.languageSlug),
        ),
    }
  }

  const pushCampaign = {
    findUnique: vi.fn(async (args: { where: { id: string } }) =>
      read(args.where.id),
    ),
    updateMany: vi.fn(
      async (args: {
        where: {
          id: string
          status: { in: PushCampaignStatus[] }
          contentVersion: number
        }
        data: Record<string, unknown> & {
          contentVersion: { increment: number }
        }
      }) => {
        const campaign = campaigns.get(args.where.id)
        if (
          !campaign ||
          !args.where.status.in.includes(campaign.status) ||
          campaign.contentVersion !== args.where.contentVersion
        ) {
          return { count: 0 }
        }
        const { contentVersion, ...rest } = args.data
        Object.assign(campaign, rest, {
          contentVersion: campaign.contentVersion + contentVersion.increment,
        })
        return { count: 1 }
      },
    ),
    create: vi.fn(
      async (args: {
        data: Omit<StoredCampaign, "id" | "updatedAt"> & {
          copies: {
            createMany: {
              data: Array<Omit<StoredCopy, "id" | "campaignId">>
            }
          }
        }
      }) => {
        const { copies: nested, ...data } = args.data
        const id = `campaign_new_${nextId++}`
        campaigns.set(id, { ...data, id, updatedAt: new Date() })
        copies = [
          ...copies,
          ...nested.createMany.data.map((copy) => ({
            ...copy,
            id: `copy_${nextId++}`,
            campaignId: id,
          })),
        ]
        return read(id)
      },
    ),
  }

  const pushCampaignCopy = {
    createMany: vi.fn(async (args: { data: Omit<StoredCopy, "id">[] }) => {
      copies = [
        ...copies,
        ...args.data.map((copy) => ({ ...copy, id: `copy_${nextId++}` })),
      ]
      return { count: args.data.length }
    }),
    update: vi.fn(
      async (args: {
        where: CopyWhere
        data: { title: string; body: string }
      }) => {
        const key = args.where.campaignId_languageSlug
        const row = copies.find(
          (copy) =>
            copy.campaignId === key?.campaignId &&
            copy.languageSlug === key?.languageSlug,
        )
        if (!row) throw new Error("no copy row to update")
        Object.assign(row, args.data)
        return row
      },
    ),
    deleteMany: vi.fn(async (args: { where: CopyWhere }) => {
      const before = copies.length
      copies = copies.filter(
        (copy) =>
          copy.campaignId !== args.where.campaignId ||
          !args.where.languageSlug?.in.includes(copy.languageSlug),
      )
      return { count: before - copies.length }
    }),
  }

  const language = {
    findMany: vi.fn(
      async (args: { where: { slug: { in: string[] }; deletedAt: null } }) =>
        args.where.slug.in
          .filter((slug) => known.has(slug))
          .map((slug) => ({ slug })),
    ),
  }

  const client = {
    pushCampaign,
    pushCampaignCopy,
    language,
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(client)),
  }
  return {
    prisma: client as unknown as PrismaClient,
    client,
    stored: () => read(CAMPAIGN),
    copyRows: () => copies,
  }
}

function patch(
  store: ReturnType<typeof fakeStore>,
  content: Parameters<typeof writePushCampaignContent>[1] extends infer T
    ? T extends { source: "mcp"; patch: infer P }
      ? P
      : never
    : never,
  expectedContentVersion = 3,
) {
  return writePushCampaignContent(store.prisma, {
    source: "mcp",
    campaignId: CAMPAIGN,
    actorId: AGENT_EDITOR,
    expectedContentVersion,
    patch: content,
  })
}

beforeEach(() => {
  destinations.kinds.clear()
  destinations.published.clear()
})

describe("writePushCampaignContent as an MCP patch", () => {
  it("keeps the language filter when the patch names only the countries (AE12)", async () => {
    const store = fakeStore({
      campaign: {
        audienceScope: "COUNTRIES",
        countries: ["MX"],
        languageFilter: ["english", "spanish"],
      },
    })

    const result = await patch(store, {
      audience: { countries: ["MX", "br"] },
    })

    expect(store.stored()).toMatchObject({
      audienceScope: "COUNTRIES",
      countries: ["MX", "BR"],
      languageFilter: ["english", "spanish"],
    })
    expect(result.changed.audience).toEqual({
      before: {
        scope: "COUNTRIES",
        countries: ["MX"],
        languageFilter: ["english", "spanish"],
      },
      after: {
        scope: "COUNTRIES",
        countries: ["MX", "BR"],
        languageFilter: ["english", "spanish"],
      },
    })
  })

  it("clears the language filter when the patch names an empty list", async () => {
    const store = fakeStore({
      campaign: { languageFilter: ["english", "spanish"] },
    })

    await patch(store, { audience: { languageFilter: [] } })

    expect(store.stored()?.languageFilter).toEqual([])
    expect(store.stored()?.audienceScope).toBe("EVERYWHERE")
  })

  it("moves a tested campaign to draft and raises the version by one (AE1)", async () => {
    const store = fakeStore({ campaign: { status: "TESTED" } })

    const result = await patch(store, {
      copies: [{ ...FRENCH }],
    })

    expect(store.stored()).toMatchObject({
      status: "DRAFT",
      contentVersion: 4,
    })
    expect(result.statusChange).toEqual({ from: "TESTED", to: "DRAFT" })
    expect(result.changed.languages).toEqual({
      added: ["french"],
      updated: [],
      removed: [],
      unchangedCount: 2,
    })
    expect(result.after.copies.map((copy) => copy.languageSlug)).toEqual([
      "english",
      "french",
      "spanish",
    ])
  })

  it("records the person and the time as the AI marker (R21)", async () => {
    const store = fakeStore({})
    const before = Date.now()

    const result = await patch(store, { copies: [{ ...FRENCH }] })

    expect(store.stored()?.lastActorId).toBe(AGENT_EDITOR)
    expect(store.stored()?.aiLastActorId).toBe(AGENT_EDITOR)
    const writtenAt = store.stored()?.aiLastWrittenAt?.getTime() ?? 0
    expect(writtenAt).toBeGreaterThanOrEqual(before)
    expect(result.after.aiMarker).toEqual({
      actorId: AGENT_EDITOR,
      writtenAt: store.stored()?.aiLastWrittenAt,
    })
  })

  it("refuses a filter that names a language admin does not know (R31)", async () => {
    const store = fakeStore({})

    const write = patch(store, {
      audience: { languageFilter: ["english", "klingon"] },
    })

    await expect(write).rejects.toBeInstanceOf(PushUnknownLanguageError)
    await expect(write).rejects.toMatchObject({ slugs: ["klingon"] })
    expect(store.client.pushCampaign.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a copy row for a language admin does not know, before any write (R12)", async () => {
    const store = fakeStore({})

    await expect(
      patch(store, {
        copies: [{ languageSlug: "espanol", title: "Hola", body: "Mira" }],
      }),
    ).rejects.toMatchObject({ slugs: ["espanol"] })
    expect(store.client.pushCampaign.updateMany).not.toHaveBeenCalled()
  })

  it("does not look up a filter slug that the campaign already holds", async () => {
    const store = fakeStore({
      campaign: { languageFilter: ["withdrawn"] },
      knownLanguages: ["english", "spanish", "french"],
    })

    await patch(store, {
      audience: { languageFilter: ["withdrawn", "french"] },
    })

    expect(store.stored()?.languageFilter).toEqual(["withdrawn", "french"])
  })

  it("returns an empty change, writes nothing, and keeps the status and version for an identical patch, even at a stale version", async () => {
    const store = fakeStore({
      campaign: { status: "TESTED", contentVersion: 7 },
    })

    const result = await patch(
      store,
      {
        copies: [{ ...SPANISH }],
        audience: { scope: "EVERYWHERE", languageFilter: [] },
        destination: { kind: "VIDEO", slug: "jesus" },
      },
      2,
    )

    expect(result.written).toBe(false)
    expect(result.changed).toEqual({
      languages: { added: [], updated: [], removed: [], unchangedCount: 2 },
      destination: null,
      audience: null,
    })
    expect(result.statusChange).toBeNull()
    expect(store.stored()).toMatchObject({
      status: "TESTED",
      contentVersion: 7,
      lastActorId: EDITOR,
      aiLastActorId: null,
    })
    expect(store.client.$transaction).not.toHaveBeenCalled()
  })

  it("refuses a change at a version above the stored one as stale, and writes nothing (R34)", async () => {
    const store = fakeStore({})

    const write = patch(store, { copies: [{ ...FRENCH }] }, 4)

    await expect(write).rejects.toBeInstanceOf(PushStaleContentVersionError)
    await expect(write).rejects.toMatchObject({
      currentContentVersion: 3,
      lastActorId: EDITOR,
    })
    expect(store.client.$transaction).not.toHaveBeenCalled()
    expect(store.client.pushCampaign.updateMany).not.toHaveBeenCalled()
    expect(store.stored()?.contentVersion).toBe(3)
    expect(store.copyRows().map((copy) => copy.languageSlug)).toEqual([
      "english",
      "spanish",
    ])
  })

  it("ignores a removal of a row that is not there", async () => {
    const store = fakeStore({})

    const result = await patch(store, {
      copies: [{ ...SPANISH, title: "Un anuncio nuevo" }],
      removeLanguages: ["french"],
    })

    expect(result.changed.languages).toEqual({
      added: [],
      updated: ["spanish"],
      removed: [],
      unchangedCount: 1,
    })
  })

  it("removes a row the patch names and leaves the others", async () => {
    const store = fakeStore({ copies: [ENGLISH, SPANISH, FRENCH] })

    const result = await patch(store, { removeLanguages: ["spanish"] })

    expect(result.changed.languages.removed).toEqual(["spanish"])
    expect(store.stored()?.copies.map((copy) => copy.languageSlug)).toEqual([
      "english",
      "french",
    ])
  })

  it("refuses a merged state over 300 rows with too_many_rows", async () => {
    const stored = Array.from({ length: 299 }, (_, index) => ({
      languageSlug: `lang-${index}`,
      title: "Title",
      body: "Body",
    }))
    const store = fakeStore({ copies: [ENGLISH, ...stored] })

    const write = patch(store, {
      copies: [{ ...FRENCH }],
    })

    await expect(write).rejects.toBeInstanceOf(PushTooManyCopyRowsError)
    await expect(write).rejects.toMatchObject({ rowCount: 301 })
    expect(store.client.pushCampaign.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a patch that leaves the campaign with no English copy", async () => {
    const store = fakeStore({ copies: [] })

    const write = patch(store, { copies: [{ ...SPANISH }] })

    await expect(write).rejects.toBeInstanceOf(PushInputError)
    await expect(write).rejects.toMatchObject({
      issues: [{ path: "copies", message: "English copy is required" }],
    })
  })

  it("refuses a merged audience that names countries and everywhere", async () => {
    const store = fakeStore({
      campaign: { audienceScope: "COUNTRIES", countries: ["MX"] },
    })

    const write = patch(store, { audience: { scope: "EVERYWHERE" } })

    await expect(write).rejects.toBeInstanceOf(PushInputError)
    await expect(write).rejects.toMatchObject({
      issues: [{ path: "audience.countries" }],
    })
  })

  it("refuses a destination of the wrong kind and names the actual kind (R32)", async () => {
    destinations.kinds.set("jesus-film", ["VIDEO"])
    const store = fakeStore({})

    const write = patch(store, {
      destination: { kind: "SERIES", slug: "jesus-film" },
    })

    await expect(write).rejects.toBeInstanceOf(PushUnknownDestinationError)
    await expect(write).rejects.toMatchObject({
      kind: "SERIES",
      slug: "jesus-film",
      actualKind: "VIDEO",
    })
    expect(store.client.pushCampaign.updateMany).not.toHaveBeenCalled()
  })

  it("saves a destination that exists and is not published, and says so (R13)", async () => {
    destinations.kinds.set("coming-soon", ["SERIES"])
    const store = fakeStore({})

    const result = await patch(store, {
      destination: { kind: "SERIES", slug: "coming-soon" },
    })

    expect(result.destinationPublished).toBe(false)
    expect(store.stored()).toMatchObject({
      destinationKind: "SERIES",
      destinationSlug: "coming-soon",
    })
  })

  it("does not check a destination that the patch resends unchanged", async () => {
    const store = fakeStore({})

    const result = await patch(store, {
      copies: [{ ...FRENCH }],
      destination: { kind: "VIDEO", slug: "jesus" },
    })

    expect(result.destinationPublished).toBeNull()
    expect(result.changed.destination).toBeNull()
  })

  it.each(["SCHEDULED", "SENDING", "SENT", "PAUSED", "CANCELLED"] as const)(
    "refuses a patch on a %s campaign with its status (AE5, R17)",
    async (status) => {
      const store = fakeStore({ campaign: { status } })

      const write = patch(store, { copies: [{ ...FRENCH }] })

      await expect(write).rejects.toBeInstanceOf(PushFrozenError)
      await expect(write).rejects.toMatchObject({ status })
      expect(store.client.language.findMany).not.toHaveBeenCalled()
      expect(store.client.pushCampaign.updateMany).not.toHaveBeenCalled()
    },
  )

  it("refuses a patch identical to the stored content of a SENT campaign", async () => {
    const store = fakeStore({ campaign: { status: "SENT" } })

    await expect(
      patch(store, { copies: [{ ...ENGLISH }] }),
    ).rejects.toBeInstanceOf(PushFrozenError)
  })

  it("refuses a patch on a campaign that does not exist", async () => {
    const store = fakeStore({ campaign: null })

    await expect(
      patch(store, { copies: [{ ...ENGLISH }] }),
    ).rejects.toBeInstanceOf(PushNotFoundError)
  })

  it("refuses 41 copy rows in one call with an issue on copies (KTD12)", async () => {
    const store = fakeStore({})
    const copies = Array.from({ length: 41 }, (_, index) => ({
      languageSlug: `lang-${index}`,
      title: "Title",
      body: "Body",
    }))

    const write = patch(store, { copies })

    await expect(write).rejects.toBeInstanceOf(PushInputError)
    await expect(write).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: "copies" })],
    })
  })
})

describe("writePushCampaignContent as a dashboard save", () => {
  function save(
    store: ReturnType<typeof fakeStore>,
    update: Parameters<typeof writePushCampaignContent>[1] extends infer T
      ? T extends { source: "dashboard"; update: infer U }
        ? U
        : never
      : never,
    expectedContentVersion = 3,
  ) {
    return writePushCampaignContent(store.prisma, {
      source: "dashboard",
      campaignId: CAMPAIGN,
      actorId: EDITOR,
      expectedContentVersion,
      update,
    })
  }

  it("keeps a tested campaign tested when the save changes nothing (R36)", async () => {
    const store = fakeStore({ campaign: { status: "TESTED" } })

    const result = await save(store, {
      copies: [ENGLISH, SPANISH],
      destination: { kind: "VIDEO", slug: "jesus" },
      audience: { scope: "EVERYWHERE" },
    })

    expect(result.written).toBe(false)
    expect(store.stored()).toMatchObject({
      status: "TESTED",
      contentVersion: 3,
    })
  })

  describe("an audience resent in another order (R36)", () => {
    const STORED_AUDIENCE = {
      audienceScope: "COUNTRIES" as const,
      countries: ["MX", "BR"],
      languageFilter: ["english", "spanish"],
    }

    function testedStore() {
      return fakeStore({ campaign: { status: "TESTED", ...STORED_AUDIENCE } })
    }

    function reordered() {
      return {
        scope: "COUNTRIES" as const,
        countries: ["BR", "MX"],
        languageFilter: ["spanish", "english"],
      }
    }

    it("is a no-op that keeps the campaign TESTED at its version", async () => {
      const store = testedStore()

      const result = await save(store, {
        copies: [ENGLISH, SPANISH],
        destination: { kind: "VIDEO", slug: "jesus" },
        audience: reordered(),
      })

      expect(result.written).toBe(false)
      expect(result.changed.audience).toBeNull()
      expect(store.client.pushCampaign.updateMany).not.toHaveBeenCalled()
      expect(store.stored()).toMatchObject({
        status: "TESTED",
        contentVersion: 3,
        ...STORED_AUDIENCE,
      })
    })

    it("keeps the stored order when a copy row changes in the same save", async () => {
      const store = testedStore()

      const result = await save(store, {
        copies: [ENGLISH, { ...SPANISH, body: "Mira hoy" }],
        destination: { kind: "VIDEO", slug: "jesus" },
        audience: reordered(),
      })

      expect(result.written).toBe(true)
      expect(result.changed.audience).toBeNull()
      expect(result.changed.languages.updated).toEqual(["spanish"])
      expect(store.stored()).toMatchObject({
        status: "DRAFT",
        contentVersion: 4,
        ...STORED_AUDIENCE,
      })
    })
  })

  it("replaces the copy set: a row the form omits is removed, a changed row is updated", async () => {
    const store = fakeStore({ copies: [ENGLISH, SPANISH, FRENCH] })

    const result = await save(store, {
      copies: [ENGLISH, { ...FRENCH, body: "Regardez maintenant" }],
      audience: { scope: "EVERYWHERE" },
    })

    expect(result.changed.languages).toEqual({
      added: [],
      updated: ["french"],
      removed: ["spanish"],
      unchangedCount: 1,
    })
    expect(store.stored()?.copies).toMatchObject([
      ENGLISH,
      { ...FRENCH, body: "Regardez maintenant" },
    ])
  })

  it("leaves the AI marker as it was", async () => {
    const markedAt = new Date("2026-10-02T09:00:00Z")
    const store = fakeStore({
      campaign: { aiLastActorId: AGENT_EDITOR, aiLastWrittenAt: markedAt },
    })

    await save(store, {
      copies: [{ ...ENGLISH, title: "A person's edit" }, SPANISH],
    })

    expect(store.stored()).toMatchObject({
      lastActorId: EDITOR,
      aiLastActorId: AGENT_EDITOR,
      aiLastWrittenAt: markedAt,
    })
  })
})

describe("createPushCampaignContent", () => {
  it("creates a draft at version 1 with the copy, the marker, and the changes (R9)", async () => {
    const store = fakeStore({ campaign: null })

    const result = await createPushCampaignContent(store.prisma, {
      actorId: AGENT_EDITOR,
      content: { copies: [ENGLISH, SPANISH] },
    })

    expect(result.after).toMatchObject({
      status: "DRAFT",
      contentVersion: 1,
      lastActorId: AGENT_EDITOR,
      aiMarker: { actorId: AGENT_EDITOR },
      destination: null,
    })
    expect(result.changed.languages).toEqual({
      added: ["english", "spanish"],
      updated: [],
      removed: [],
      unchangedCount: 0,
    })
    expect(result.statusChange).toBeNull()
    expect(result.destinationPublished).toBeNull()
  })

  it("refuses a create with no English copy before it writes", async () => {
    const store = fakeStore({ campaign: null })

    await expect(
      createPushCampaignContent(store.prisma, {
        actorId: AGENT_EDITOR,
        content: { copies: [SPANISH] },
      }),
    ).rejects.toBeInstanceOf(PushInputError)
    expect(store.client.pushCampaign.create).not.toHaveBeenCalled()
  })

  it("refuses an unknown destination before it writes", async () => {
    const store = fakeStore({ campaign: null })

    await expect(
      createPushCampaignContent(store.prisma, {
        actorId: AGENT_EDITOR,
        content: {
          copies: [ENGLISH],
          destination: { kind: "VIDEO", slug: "nowhere" },
        },
      }),
    ).rejects.toMatchObject({ slug: "nowhere", actualKind: null })
    expect(store.client.pushCampaign.create).not.toHaveBeenCalled()
  })
})
