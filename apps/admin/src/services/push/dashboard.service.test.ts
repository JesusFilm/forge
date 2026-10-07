import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import type { WorkflowWorkerStatusRow } from "@/services/workflow-worker-heartbeat.service"

import {
  PUSH_WORKER_UNAVAILABLE_ROW_ID,
  classifyPushWorkerState,
  fillPushRegistrationDays,
  listPushCampaigns,
  listPushLanguageOptions,
  pushLanguageLabel,
  readPushActorNames,
  readPushCampaignDetail,
  readPushDestinationTitle,
  readPushRegistrationsPerDay,
  searchPushDestinations,
} from "./dashboard.service"

vi.mock("@/services/workflow-worker-heartbeat.service", () => ({
  loadWorkflowWorkerStatusRows: vi.fn(async () => []),
}))

type FindManyArgs = { where: Record<string, unknown>; take?: number }

/**
 * A mock that records the `where` it was asked for. The argument has to be
 * declared, or the spy's call tuple is empty and nothing can be read back.
 */
function recordingFindMany<T>(rows: T[]) {
  const seen: FindManyArgs[] = []
  const findMany = vi.fn(async (args: FindManyArgs) => {
    seen.push(args)
    return rows
  })
  return { findMany, seen }
}

function worker(
  overrides: Partial<WorkflowWorkerStatusRow>,
): WorkflowWorkerStatusRow {
  return {
    id: "admin:host:1",
    statusLabel: "Online",
    statusTone: "success",
    meta: "admin / started 1m ago",
    detail: "Heartbeat 4s ago.",
    ...overrides,
  }
}

describe("listPushCampaigns", () => {
  it("projects the English title and counts every authored language", async () => {
    const { findMany, seen } = recordingFindMany([
      {
        id: "c1",
        status: "DRAFT",
        mode: "WAVE",
        destinationKind: "SERIES",
        destinationSlug: "jesus",
        audienceScope: "COUNTRIES",
        countries: ["SA"],
        languageFilter: [],
        sendDate: null,
        localHour: null,
        testSentAt: null,
        sendingStartedAt: null,
        completedAt: null,
        updatedAt: new Date("2026-09-20T00:00:00Z"),
        copies: [
          { languageSlug: "arabic", title: "إعلان" },
          { languageSlug: "english", title: "An announcement" },
        ],
      },
    ])
    const prisma = { pushCampaign: { findMany } } as unknown as PrismaClient

    const rows = await listPushCampaigns(prisma, 25)

    expect(rows[0]?.englishTitle).toBe("An announcement")
    expect(rows[0]?.languageCount).toBe(2)
    expect(seen[0]).toMatchObject({ take: 25 })
  })

  it("leaves the English title null when only another language is authored", async () => {
    const prisma = {
      pushCampaign: {
        findMany: vi.fn(async () => [
          {
            id: "c2",
            status: "DRAFT",
            mode: "WAVE",
            destinationKind: null,
            destinationSlug: null,
            audienceScope: "EVERYWHERE",
            countries: [],
            languageFilter: [],
            sendDate: null,
            localHour: null,
            testSentAt: null,
            sendingStartedAt: null,
            completedAt: null,
            updatedAt: new Date("2026-09-20T00:00:00Z"),
            copies: [{ languageSlug: "arabic", title: "إعلان" }],
          },
        ]),
      },
    } as unknown as PrismaClient

    const rows = await listPushCampaigns(prisma)

    expect(rows[0]?.englishTitle).toBeNull()
    expect(rows[0]?.languageCount).toBe(1)
  })
})

type UserRow = { id: string; name: string; email: string }

/** A user table that answers only the ids the query asks for. */
function userTable(rows: readonly UserRow[]) {
  const findMany = vi.fn(
    async (args: { where: { id: { in: readonly string[] } } }) =>
      rows.filter((row) => args.where.id.in.includes(row.id)),
  )
  return { findMany }
}

/** Returns only the selected columns, so an unselected column reads as absent. */
function selectedColumns(
  row: Record<string, unknown>,
  select: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => Boolean(select[key])),
  )
}

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    status: "DRAFT",
    mode: "WAVE",
    destinationKind: "SERIES",
    destinationSlug: "jesus",
    audienceScope: "EVERYWHERE",
    countries: [],
    languageFilter: [],
    sendDate: null,
    localHour: null,
    testSentAt: null,
    sendingStartedAt: null,
    completedAt: null,
    lastError: null,
    contentVersion: 4,
    lastTestContentVersion: 3,
    lastActorId: "user_hand",
    aiLastActorId: "user_ai",
    aiLastWrittenAt: new Date("2026-10-06T09:30:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-06T10:05:00Z"),
    copies: [
      { languageSlug: "english", title: "An announcement", body: "Tonight" },
    ],
    ...overrides,
  }
}

function detailPrisma(row: Record<string, unknown>, users: UserRow[]) {
  const user = userTable(users)
  const prisma = {
    pushCampaign: {
      findUnique: vi.fn(async (args: { select: Record<string, unknown> }) =>
        selectedColumns(row, args.select),
      ),
    },
    user,
  } as unknown as PrismaClient
  return { prisma, user }
}

const PEOPLE: UserRow[] = [
  { id: "user_hand", name: "Bob Editor", email: "bob@example.org" },
  { id: "user_ai", name: "Alice Reviewer", email: "alice@example.org" },
]

describe("readPushCampaignDetail", () => {
  it("returns the version the last test carried (R35, KTD5)", async () => {
    const { prisma } = detailPrisma(campaignRow(), PEOPLE)

    const detail = await readPushCampaignDetail(prisma, "c1")

    expect(detail?.contentVersion).toBe(4)
    expect(detail?.lastTestContentVersion).toBe(3)
  })

  it("names the agent write's person, not the later hand editor (R22, AE7)", async () => {
    const { prisma } = detailPrisma(campaignRow(), PEOPLE)

    const detail = await readPushCampaignDetail(prisma, "c1")

    expect(detail?.aiMarker).toEqual({
      actorId: "user_ai",
      actorName: "Alice Reviewer",
      writtenAt: new Date("2026-10-06T09:30:00Z"),
    })
  })

  it("returns no marker and looks up no person when no agent wrote it", async () => {
    const { prisma, user } = detailPrisma(
      campaignRow({ aiLastActorId: null, aiLastWrittenAt: null }),
      PEOPLE,
    )

    const detail = await readPushCampaignDetail(prisma, "c1")

    expect(detail?.aiMarker).toBeNull()
    expect(user.findMany).not.toHaveBeenCalled()
  })
})

describe("readPushActorNames", () => {
  it("names a person by name, then by email, then by the id itself (KTD6)", async () => {
    const user = userTable([
      { id: "named", name: "Alice Reviewer", email: "alice@example.org" },
      { id: "blank", name: "  ", email: "blank@example.org" },
    ])
    const prisma = { user } as unknown as PrismaClient

    const names = await readPushActorNames(prisma, [
      "named",
      "blank",
      "gone",
      null,
    ])

    expect(names.get("named")).toBe("Alice Reviewer")
    expect(names.get("blank")).toBe("blank@example.org")
    expect(names.get("gone")).toBe("gone")
    expect(user.findMany).toHaveBeenCalledTimes(1)
  })

  it("asks for nobody when no id is set", async () => {
    const user = userTable([])
    const prisma = { user } as unknown as PrismaClient

    const names = await readPushActorNames(prisma, [null])

    expect(names.size).toBe(0)
    expect(user.findMany).not.toHaveBeenCalled()
  })
})

describe("fillPushRegistrationDays", () => {
  it("returns one entry per day, oldest first, with a real zero for a quiet day", () => {
    const filled = fillPushRegistrationDays([{ day: "2026-09-19", count: 7 }], {
      days: 3,
      now: new Date("2026-09-20T13:00:00Z"),
    })

    expect(filled).toEqual([
      { day: "2026-09-18", count: 0 },
      { day: "2026-09-19", count: 7 },
      { day: "2026-09-20", count: 0 },
    ])
  })
})

describe("readPushRegistrationsPerDay", () => {
  it("counts a Date-typed day column and fills the rest of the window", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [
        { day: new Date("2026-09-20T00:00:00Z"), count: 4n },
      ]),
    } as unknown as PrismaClient

    const rows = await readPushRegistrationsPerDay(prisma, {
      days: 2,
      now: new Date("2026-09-20T09:00:00Z"),
    })

    expect(rows).toEqual([
      { day: "2026-09-19", count: 0 },
      { day: "2026-09-20", count: 4 },
    ])
  })
})

describe("classifyPushWorkerState", () => {
  it("reads one live worker as online", () => {
    expect(classifyPushWorkerState([worker({})]).kind).toBe("online")
  })

  it("reads every reported worker stale as stale", () => {
    const state = classifyPushWorkerState([
      worker({ statusLabel: "Stale", statusTone: "danger" }),
    ])
    expect(state.kind).toBe("stale")
    expect(state.workers).toHaveLength(1)
  })

  it("reads no worker at all as unknown, not as stale", () => {
    expect(classifyPushWorkerState([]).kind).toBe("unknown")
  })

  it("reads the heartbeat-unavailable sentinel as unknown, not as a worker", () => {
    const state = classifyPushWorkerState([
      worker({
        id: PUSH_WORKER_UNAVAILABLE_ROW_ID,
        statusLabel: "Unknown",
        statusTone: "muted",
      }),
    ])
    expect(state.kind).toBe("unknown")
  })

  it("stays online when one worker is live beside a stale one", () => {
    const state = classifyPushWorkerState([
      worker({ id: "a", statusLabel: "Stale", statusTone: "danger" }),
      worker({ id: "b", statusLabel: "Running", statusTone: "info" }),
    ])
    expect(state.kind).toBe("online")
  })
})

describe("pushLanguageLabel", () => {
  it("prefers the English name, then the native name, then the slug", () => {
    expect(
      pushLanguageLabel({ en: "Arabic", native: "العربية" }, "arabic"),
    ).toBe("Arabic")
    expect(pushLanguageLabel({ native: "العربية" }, "arabic")).toBe("العربية")
    expect(pushLanguageLabel({}, "arabic")).toBe("arabic")
    expect(pushLanguageLabel(null, "arabic")).toBe("arabic")
  })
})

describe("listPushLanguageOptions", () => {
  it("puts English first and sorts the rest by label", async () => {
    const prisma = {
      language: {
        findMany: vi.fn(async () => [
          { slug: "zulu", name: { en: "Zulu" } },
          { slug: "arabic", name: { en: "Arabic" } },
          { slug: "english", name: { en: "English" } },
          { slug: null, name: { en: "Nameless" } },
        ]),
      },
    } as unknown as PrismaClient

    const options = await listPushLanguageOptions(prisma)

    expect(options.map((option) => option.slug)).toEqual([
      "english",
      "arabic",
      "zulu",
    ])
  })
})

describe("searchPushDestinations", () => {
  it("asks for series and collection labels when the kind is SERIES", async () => {
    const { findMany, seen } = recordingFindMany([
      { slug: "jesus", label: "SERIES", locales: [{ title: "JESUS" }] },
    ])
    const prisma = { video: { findMany } } as unknown as PrismaClient

    const rows = await searchPushDestinations(prisma, {
      kind: "SERIES",
      query: " jes ",
    })

    expect(seen[0]?.where.label).toEqual({ in: ["SERIES", "COLLECTION"] })
    expect(rows[0]).toMatchObject({
      kind: "SERIES",
      slug: "jesus",
      title: "JESUS",
    })
  })

  it.each(["VIDEO", "SERIES"] as const)(
    "offers only live, published, unrestricted rows for the %s kind",
    async (kind) => {
      const { findMany, seen } = recordingFindMany<never>([])
      const prisma = { video: { findMany } } as unknown as PrismaClient

      await searchPushDestinations(prisma, { kind, query: "jes" })

      // A draft picked here would open the not-found screen on every phone, so
      // the three visibility conditions ride beside the label and the query.
      expect(seen[0]?.where).toMatchObject({
        deletedAt: null,
        locales: { some: { status: "PUBLISHED", deletedAt: null } },
        NOT: { restrictViewPlatforms: { has: "watch" } },
      })
      expect(seen[0]?.where.OR).toHaveLength(2)
    },
  )

  it("excludes series and collection labels when the kind is VIDEO", async () => {
    const { findMany, seen } = recordingFindMany<never>([])
    const prisma = { video: { findMany } } as unknown as PrismaClient

    await searchPushDestinations(prisma, { kind: "VIDEO" })

    expect(seen[0]?.where.label).toEqual({ notIn: ["SERIES", "COLLECTION"] })
    // An empty query filters nothing, so the picker opens on the newest rows.
    expect(seen[0]?.where.OR).toBeUndefined()
  })

  it("falls back to the slug when a video carries no English title", async () => {
    const { findMany } = recordingFindMany([
      {
        slug: "untitled-film",
        label: "FEATURE_FILM",
        locales: [{ title: "  " }],
      },
    ])
    const prisma = { video: { findMany } } as unknown as PrismaClient

    const rows = await searchPushDestinations(prisma, { kind: "VIDEO" })

    expect(rows[0]?.title).toBe("untitled-film")
  })

  it("reads published, unarchived experience locales for the EXPERIENCE kind", async () => {
    const { findMany, seen } = recordingFindMany([
      { slug: "easter", title: "Easter", locale: "en" },
    ])
    const prisma = {
      experienceLocale: { findMany },
    } as unknown as PrismaClient

    const rows = await searchPushDestinations(prisma, { kind: "EXPERIENCE" })

    expect(seen[0]?.where.status).toBe("PUBLISHED")
    expect(seen[0]?.where.experience).toEqual({ archivedAt: null })
    expect(rows[0]).toMatchObject({ kind: "EXPERIENCE", slug: "easter" })
  })

  it("resolves a chosen destination's title only on an exact slug match", async () => {
    const { findMany } = recordingFindMany([
      { slug: "jesus-extra", label: "SERIES", locales: [{ title: "Extra" }] },
      { slug: "jesus", label: "SERIES", locales: [{ title: "JESUS" }] },
    ])
    const prisma = { video: { findMany } } as unknown as PrismaClient

    await expect(
      readPushDestinationTitle(prisma, { kind: "SERIES", slug: "jesus" }),
    ).resolves.toBe("JESUS")
    await expect(
      readPushDestinationTitle(prisma, { kind: "SERIES", slug: "jesus-x" }),
    ).resolves.toBeNull()
    await expect(
      readPushDestinationTitle(prisma, { kind: null, slug: null }),
    ).resolves.toBeNull()
  })
})
