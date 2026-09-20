import { describe, expect, it, vi } from "vitest"

import {
  PUSH_AUDIENCE_PAGE_LIMIT,
  PUSH_DEFAULT_BLOCKED_COUNTRIES,
  countPushAudience,
  readPushAudiencePage,
  type PushAudienceCampaign,
  type PushAudienceRegistration,
} from "./audience.service"

/**
 * What these suites read back off a mocked Prisma call. Every field is
 * declared present because the assertions below name the ones they read.
 */
type PrismaCallArgs = {
  where: Record<string, unknown>
  data: Record<string, unknown>
  orderBy: unknown
  take: number
  select: unknown
}

const EVERYWHERE: PushAudienceCampaign = {
  audienceScope: "EVERYWHERE",
  countries: [],
  languageFilter: [],
}

const SAUDI_ARABIC: PushAudienceCampaign = {
  audienceScope: "COUNTRIES",
  countries: ["SA"],
  languageFilter: ["arabic"],
}

function registration(
  overrides: Partial<PushAudienceRegistration> = {},
): PushAudienceRegistration {
  return {
    id: "reg_1",
    expoPushToken: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]",
    platform: "IOS",
    appLanguageSlug: "english",
    phoneLanguageSlug: "english",
    phoneLocale: "en-NZ",
    timeZone: "Pacific/Auckland",
    country: "NZ",
    ...overrides,
  }
}

function clientReturning(rows: PushAudienceRegistration[]) {
  return {
    pushRegistration: {
      findMany: vi.fn(async (_args: PrismaCallArgs) => rows),
      count: vi.fn(async (_args: PrismaCallArgs) => rows.length),
    },
  }
}

describe("push audience paging", () => {
  it("reads active phones in id order under a page limit", async () => {
    const client = clientReturning([registration()])

    await readPushAudiencePage(client as never, { campaign: EVERYWHERE })

    const args = client.pushRegistration.findMany.mock.calls[0][0]
    expect(args.take).toBe(PUSH_AUDIENCE_PAGE_LIMIT)
    expect(args.orderBy).toEqual({ id: "asc" })
    expect(args.where.status).toBe("ACTIVE")
  })

  it("carries the caller's smaller page limit", async () => {
    const client = clientReturning([registration()])

    await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
      limit: 2,
    })

    expect(client.pushRegistration.findMany.mock.calls[0][0].take).toBe(2)
  })

  it("names no country for an everywhere campaign", async () => {
    const client = clientReturning([])

    await readPushAudiencePage(client as never, { campaign: EVERYWHERE })

    expect(
      client.pushRegistration.findMany.mock.calls[0][0].where.country,
    ).toBeUndefined()
  })

  it("narrows to the campaign's countries and declared languages (AE7)", async () => {
    const client = clientReturning([])

    await readPushAudiencePage(client as never, { campaign: SAUDI_ARABIC })

    const { where } = client.pushRegistration.findMany.mock.calls[0][0]
    expect(where.country).toEqual({ in: ["SA"] })
    expect(where.OR).toEqual([
      { appLanguageSlug: { in: ["arabic"] } },
      { phoneLanguageSlug: { in: ["arabic"] } },
    ])
  })

  it("narrows to the zone group when one is given", async () => {
    const client = clientReturning([])

    await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
      timeZones: ["Asia/Riyadh", "Europe/Paris"],
    })

    expect(
      client.pushRegistration.findMany.mock.calls[0][0].where.timeZone,
    ).toEqual({ in: ["Asia/Riyadh", "Europe/Paris"] })
  })

  it("reads every zone when no group is given", async () => {
    const client = clientReturning([])

    await readPushAudiencePage(client as never, { campaign: EVERYWHERE })

    expect(
      client.pushRegistration.findMany.mock.calls[0][0].where.timeZone,
    ).toBeUndefined()
  })

  it("starts after the cursor when one is given", async () => {
    const client = clientReturning([])

    await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
      cursor: "reg_9",
    })

    expect(client.pushRegistration.findMany.mock.calls[0][0].where.id).toEqual({
      gt: "reg_9",
    })
  })

  it("returns a cursor only while a page is full", async () => {
    const full = clientReturning([
      registration({ id: "reg_1" }),
      registration({ id: "reg_2" }),
    ])
    const partial = clientReturning([registration({ id: "reg_1" })])

    expect(
      (
        await readPushAudiencePage(full as never, {
          campaign: EVERYWHERE,
          limit: 2,
        })
      ).nextCursor,
    ).toBe("reg_2")
    expect(
      (
        await readPushAudiencePage(partial as never, {
          campaign: EVERYWHERE,
          limit: 2,
        })
      ).nextCursor,
    ).toBeNull()
  })

  it("advances the cursor past an unreachable phone", async () => {
    const client = clientReturning([
      registration({ id: "reg_1" }),
      registration({ id: "reg_2", platform: "ANDROID", country: "CN" }),
    ])

    const page = await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
      limit: 2,
    })

    expect(page.nextCursor).toBe("reg_2")
  })
})

describe("push audience reachability", () => {
  it("reads an Android phone in China as unreachable and an iOS one as audience (AE17)", async () => {
    const client = clientReturning([
      registration({
        id: "reg_android_cn",
        platform: "ANDROID",
        country: "CN",
      }),
      registration({ id: "reg_ios_cn", platform: "IOS", country: "CN" }),
    ])

    const page = await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
    })

    expect(page.unreachable.map((row) => row.id)).toEqual(["reg_android_cn"])
    expect(page.audience.map((row) => row.id)).toEqual(["reg_ios_cn"])
  })

  it("reads an Android phone outside a blocked country as audience", async () => {
    const client = clientReturning([
      registration({
        id: "reg_android_nz",
        platform: "ANDROID",
        country: "NZ",
      }),
    ])

    const page = await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
    })

    expect(page.audience.map((row) => row.id)).toEqual(["reg_android_nz"])
    expect(page.unreachable).toEqual([])
  })

  it("takes the blocked country list from the caller", async () => {
    const client = clientReturning([
      registration({
        id: "reg_android_ir",
        platform: "ANDROID",
        country: "IR",
      }),
      registration({
        id: "reg_android_cn",
        platform: "ANDROID",
        country: "CN",
      }),
    ])

    const page = await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
      blockedCountries: ["IR"],
    })

    expect(page.unreachable.map((row) => row.id)).toEqual(["reg_android_ir"])
    expect(page.audience.map((row) => row.id)).toEqual(["reg_android_cn"])
  })

  it("compares the blocked country without regard to case", async () => {
    const client = clientReturning([
      registration({
        id: "reg_android_cn",
        platform: "ANDROID",
        country: "cn",
      }),
    ])

    const page = await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
    })

    expect(page.unreachable.map((row) => row.id)).toEqual(["reg_android_cn"])
  })

  it("blocks China by default", () => {
    expect(PUSH_DEFAULT_BLOCKED_COUNTRIES).toEqual(["CN"])
  })

  it("reads an Android phone with no country as audience", async () => {
    const client = clientReturning([
      registration({ id: "reg_android", platform: "ANDROID", country: null }),
    ])

    const page = await readPushAudiencePage(client as never, {
      campaign: EVERYWHERE,
    })

    expect(page.audience.map((row) => row.id)).toEqual(["reg_android"])
  })
})

describe("push audience counts", () => {
  it("counts the audience without the unreachable phones", async () => {
    const client = {
      pushRegistration: {
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValueOnce(120).mockResolvedValueOnce(20),
      },
    }

    const counts = await countPushAudience(client as never, {
      campaign: EVERYWHERE,
    })

    expect(counts).toEqual({ audience: 100, unreachable: 20 })
  })

  it("counts nothing unreachable when no country is blocked", async () => {
    const client = {
      pushRegistration: {
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValueOnce(7),
      },
    }

    const counts = await countPushAudience(client as never, {
      campaign: EVERYWHERE,
      blockedCountries: [],
    })

    expect(counts).toEqual({ audience: 7, unreachable: 0 })
    expect(client.pushRegistration.count).toHaveBeenCalledOnce()
  })
})
