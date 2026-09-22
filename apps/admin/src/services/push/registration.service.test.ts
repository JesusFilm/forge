import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PushTestDeviceIdSchema } from "./contracts"
import { PushInputError, PushInvalidTokenStatusError } from "./errors"
import {
  nextPushRegistrationStatus,
  registerPushDevice,
  resetPushLanguageCache,
} from "./registration.service"

const TOKEN = "ExponentPushToken[abcdefghijklmnopqrstuv]"
const OTHER_TOKEN = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"
const DIGEST = "d".repeat(64)
const OTHER_DIGEST = "e".repeat(64)
const INSTALL = "install-0000000000000001"
const OTHER_INSTALL = "install-0000000000000002"

type Row = {
  id: string
  status: string
  testDeviceId: string
}

function request(overrides: Record<string, unknown> = {}) {
  const { input, ...rest } = overrides as {
    input?: Record<string, unknown>
  }
  return {
    input: {
      expoPushToken: TOKEN,
      platform: "IOS",
      appBuild: "1.2.3",
      appLanguageSlug: "english",
      phoneLocale: "fr-FR",
      timeZone: "Pacific/Auckland",
      permission: "granted",
      ...input,
    },
    edgeCountry: "NZ",
    viewerDigest: null,
    ...rest,
  }
}

const LANGUAGES = [
  { slug: "english", bcp47: "en" },
  { slug: "french", bcp47: "fr" },
  { slug: "korean", bcp47: "ko" },
]

function buildPrisma(existing: Row | null = null) {
  const created: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []
  const supersedes: Record<string, unknown>[] = []
  const client = {
    language: {
      findMany: vi.fn(async () => LANGUAGES),
    },
    pushRegistration: {
      findUnique: vi.fn(async () => existing),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data)
        return {
          id: "reg_new",
          testDeviceId: args.data.testDeviceId,
          status: args.data.status,
        }
      }),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        updated.push(args.data)
        return {
          id: existing?.id ?? "reg_1",
          testDeviceId: existing?.testDeviceId ?? "abcdef0123456789",
          status: args.data.status ?? existing?.status ?? "ACTIVE",
        }
      }),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        supersedes.push(args)
        return { count: 1 }
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  }
  return { client, created, updated, supersedes }
}

type StoredRow = {
  id: string
  expoPushToken: string
  installId: string | null
  viewerDigest: string | null
  platform: string
  status: string
  testDeviceId: string
}

function seedRow(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    id: "reg_seed",
    expoPushToken: TOKEN,
    installId: INSTALL,
    viewerDigest: DIGEST,
    platform: "IOS",
    status: "ACTIVE",
    testDeviceId: "abcdef0123456789",
    ...overrides,
  }
}

/**
 * A store that applies the supersede filter, so a test can prove which rows
 * stay active instead of only which where clause the service built.
 */
function buildStore(rows: StoredRow[] = []) {
  let minted = 0
  const client = {
    language: { findMany: vi.fn(async () => LANGUAGES) },
    pushRegistration: {
      findUnique: vi.fn(
        async (args: { where: { expoPushToken: string } }) =>
          rows.find((row) => row.expoPushToken === args.where.expoPushToken) ??
          null,
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        minted += 1
        const row: StoredRow = {
          id: `reg_minted_${minted}`,
          expoPushToken: String(args.data.expoPushToken),
          installId: (args.data.installId as string | undefined) ?? null,
          viewerDigest: (args.data.viewerDigest as string | undefined) ?? null,
          platform: String(args.data.platform),
          status: String(args.data.status),
          testDeviceId: String(args.data.testDeviceId),
        }
        rows.push(row)
        return row
      }),
      update: vi.fn(
        async (args: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          const row = rows.find((candidate) => candidate.id === args.where.id)
          if (row == null) throw new Error("no row to update")
          if (args.data.status != null) row.status = String(args.data.status)
          if (args.data.installId != null)
            row.installId = String(args.data.installId)
          if (args.data.viewerDigest != null)
            row.viewerDigest = String(args.data.viewerDigest)
          return row
        },
      ),
      updateMany: vi.fn(
        async (args: {
          where: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          const where = args.where
          const excluded = (where.id as { not?: string } | undefined)?.not
          const matched = rows.filter(
            (row) =>
              (where.installId === undefined ||
                row.installId === where.installId) &&
              (where.viewerDigest === undefined ||
                row.viewerDigest === where.viewerDigest) &&
              (where.platform === undefined ||
                row.platform === where.platform) &&
              (where.status === undefined || row.status === where.status) &&
              row.id !== excluded,
          )
          matched.forEach((row) => {
            row.status = String(args.data.status)
          })
          return { count: matched.length }
        },
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(client),
    ),
  }
  return { client, rows }
}

function statusOf(rows: StoredRow[], token: string): string {
  const row = rows.find((candidate) => candidate.expoPushToken === token)
  if (row == null) throw new Error(`no row for ${token}`)
  return row.status
}

beforeEach(() => {
  resetPushLanguageCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the registration status rungs", () => {
  it.each([
    [null, "granted", "ACTIVE", true],
    ["ACTIVE", "granted", "ACTIVE", false],
    ["INACTIVE", "granted", "ACTIVE", true],
    // A superseded row is one install's retired token, so the same install
    // granting again takes its place back.
    ["SUPERSEDED", "granted", "ACTIVE", true],
    [null, "denied", "INACTIVE", true],
    ["ACTIVE", "denied", "INACTIVE", true],
    ["INACTIVE", "denied", "INACTIVE", false],
    ["SUPERSEDED", "denied", "INACTIVE", true],
  ])(
    "moves %s under %s to %s",
    (current, permission, expected, expectedChanged) => {
      const next = nextPushRegistrationStatus(
        current as never,
        permission as never,
      )
      expect(next.status).toBe(expected)
      expect(next.changed).toBe(expectedChanged)
    },
  )
})

describe("registering a phone", () => {
  it("stores a first registration and returns its test ID", async () => {
    const { client, created } = buildPrisma()
    const receipt = await registerPushDevice(client as never, request())
    expect(receipt.status).toBe("ACTIVE")
    expect(PushTestDeviceIdSchema.safeParse(receipt.testDeviceId).success).toBe(
      true,
    )
    expect(created[0]).toMatchObject({
      expoPushToken: TOKEN,
      platform: "IOS",
      appBuild: "1.2.3",
      phoneLocale: "fr-FR",
      phoneLanguageSlug: "french",
      timeZone: "Pacific/Auckland",
      country: "NZ",
      countrySource: "EDGE",
      status: "ACTIVE",
    })
  })

  it("mints a test ID that is never derived from the push token", async () => {
    const { client, created } = buildPrisma()
    await registerPushDevice(client as never, request())
    const first = String(created[0].testDeviceId)
    resetPushLanguageCache()
    const second = buildPrisma()
    await registerPushDevice(second.client as never, request())
    expect(first).not.toBe(String(second.created[0].testDeviceId))
    expect(TOKEN).not.toContain(first)
  })

  it("refreshes an existing row and keeps its test ID", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "ACTIVE",
      testDeviceId: "abcdef0123456789",
    })
    const receipt = await registerPushDevice(
      client as never,
      request({ input: { timeZone: "Asia/Riyadh" } }),
    )
    expect(receipt.testDeviceId).toBe("abcdef0123456789")
    expect(updated[0]).toMatchObject({ timeZone: "Asia/Riyadh" })
    expect(updated[0].refreshedAt).toBeInstanceOf(Date)
    // An unchanged status must not restamp the status clock.
    expect(updated[0].statusChangedAt).toBeUndefined()
  })

  it("refuses a token the provider retired", async () => {
    const { client } = buildPrisma({
      id: "reg_1",
      status: "INVALID",
      testDeviceId: "abcdef0123456789",
    })
    await expect(
      registerPushDevice(client as never, request()),
    ).rejects.toThrowError(PushInvalidTokenStatusError)
    expect(client.pushRegistration.update).not.toHaveBeenCalled()
  })

  it("marks a revoked permission inactive and stamps the clock", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "ACTIVE",
      testDeviceId: "abcdef0123456789",
    })
    const receipt = await registerPushDevice(
      client as never,
      request({ input: { permission: "denied" } }),
    )
    expect(receipt.status).toBe("INACTIVE")
    expect(updated[0].status).toBe("INACTIVE")
    expect(updated[0].statusChangedAt).toBeInstanceOf(Date)
  })

  it("reports a revocation twice without a second status stamp", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "INACTIVE",
      testDeviceId: "abcdef0123456789",
    })
    const receipt = await registerPushDevice(
      client as never,
      request({ input: { permission: "denied" } }),
    )
    expect(receipt.status).toBe("INACTIVE")
    expect(updated[0].statusChangedAt).toBeUndefined()
  })

  it("reactivates a phone that granted permission again", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "INACTIVE",
      testDeviceId: "abcdef0123456789",
    })
    const receipt = await registerPushDevice(client as never, request())
    expect(receipt.status).toBe("ACTIVE")
    expect(updated[0].status).toBe("ACTIVE")
  })

  it("supersedes the install's other active row on the same platform", async () => {
    const { client, supersedes } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ viewerDigest: DIGEST, input: { installId: INSTALL } }),
    )
    expect(supersedes).toHaveLength(1)
    expect(supersedes[0]).toMatchObject({
      where: {
        installId: INSTALL,
        platform: "IOS",
        status: "ACTIVE",
        id: { not: "reg_new" },
      },
      data: { status: "SUPERSEDED" },
    })
    expect(supersedes[0]).not.toHaveProperty("where.viewerDigest")
  })

  it("keeps both of one viewer's installs active", async () => {
    const rows = [seedRow({ id: "reg_phone", installId: INSTALL })]
    const { client } = buildStore(rows)
    await registerPushDevice(
      client as never,
      request({
        viewerDigest: DIGEST,
        input: { expoPushToken: OTHER_TOKEN, installId: OTHER_INSTALL },
      }),
    )
    // One person with a phone and a tablet receives the announcement on both.
    expect(statusOf(rows, TOKEN)).toBe("ACTIVE")
    expect(statusOf(rows, OTHER_TOKEN)).toBe("ACTIVE")
  })

  it("retires the install's older token when that install rotates", async () => {
    const rows = [seedRow({ id: "reg_old", installId: INSTALL })]
    const { client } = buildStore(rows)
    await registerPushDevice(
      client as never,
      request({
        viewerDigest: DIGEST,
        input: { expoPushToken: OTHER_TOKEN, installId: INSTALL },
      }),
    )
    expect(statusOf(rows, TOKEN)).toBe("SUPERSEDED")
    expect(statusOf(rows, OTHER_TOKEN)).toBe("ACTIVE")
  })

  it("supersedes nothing on the viewer handle alone", async () => {
    const { client, supersedes } = buildPrisma()
    await registerPushDevice(client as never, request({ viewerDigest: DIGEST }))
    expect(supersedes).toHaveLength(0)
  })

  it("supersedes nothing when the app sent no install id", async () => {
    const { client, supersedes } = buildPrisma()
    await registerPushDevice(client as never, request())
    expect(supersedes).toHaveLength(0)
  })

  it("supersedes nothing when the registration ends inactive", async () => {
    const { client, supersedes } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({
        viewerDigest: DIGEST,
        input: { installId: INSTALL, permission: "denied" },
      }),
    )
    expect(supersedes).toHaveLength(0)
  })

  it("brings a superseded token back and retires its install's other row", async () => {
    const rows = [
      seedRow({ id: "reg_old", status: "SUPERSEDED" }),
      seedRow({
        id: "reg_new",
        expoPushToken: OTHER_TOKEN,
        testDeviceId: "0123456789abcdef",
      }),
    ]
    const { client } = buildStore(rows)
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const receipt = await registerPushDevice(
      client as never,
      request({ viewerDigest: DIGEST, input: { installId: INSTALL } }),
    )
    expect(receipt.status).toBe("ACTIVE")
    expect(statusOf(rows, TOKEN)).toBe("ACTIVE")
    expect(statusOf(rows, OTHER_TOKEN)).toBe("SUPERSEDED")
    expect(String(infoSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "outcome=reactivated",
    )
  })

  it("marks a superseded token inactive when its permission is gone", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "SUPERSEDED",
      testDeviceId: "abcdef0123456789",
    })
    const receipt = await registerPushDevice(
      client as never,
      request({
        input: { installId: INSTALL, permission: "denied" },
      }),
    )
    expect(receipt.status).toBe("INACTIVE")
    expect(updated[0].status).toBe("INACTIVE")
    expect(updated[0].statusChangedAt).toBeInstanceOf(Date)
  })

  it("stores the install id the app sent", async () => {
    const { client, created } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ input: { installId: INSTALL } }),
    )
    expect(created[0].installId).toBe(INSTALL)
  })

  it("leaves a stored install id alone when the app sends none", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "ACTIVE",
      testDeviceId: "abcdef0123456789",
    })
    await registerPushDevice(client as never, request())
    expect(updated[0]).not.toHaveProperty("installId")
  })

  it("leaves a stored digest alone when the phone sends no handle", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "ACTIVE",
      testDeviceId: "abcdef0123456789",
    })
    await registerPushDevice(client as never, request())
    expect(updated[0]).not.toHaveProperty("viewerDigest")
  })

  it("writes the new digest when the phone sends one", async () => {
    const { client, updated } = buildPrisma({
      id: "reg_1",
      status: "ACTIVE",
      testDeviceId: "abcdef0123456789",
    })
    await registerPushDevice(
      client as never,
      request({ viewerDigest: OTHER_DIGEST }),
    )
    expect(updated[0].viewerDigest).toBe(OTHER_DIGEST)
  })

  it("falls to the phone's region when the edge named no country", async () => {
    const { client, created } = buildPrisma()
    await registerPushDevice(client as never, request({ edgeCountry: null }))
    expect(created[0]).toMatchObject({
      country: "FR",
      countrySource: "PHONE_REGION",
    })
  })

  it("stores no country when neither source has one", async () => {
    const { client, created } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ edgeCountry: null, input: { phoneLocale: "en" } }),
    )
    expect(created[0]).toMatchObject({
      country: null,
      countrySource: "UNKNOWN",
    })
  })

  it("canonicalizes an alias time zone before it stores it", async () => {
    const { client, created } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ input: { timeZone: "US/Pacific" } }),
    )
    expect(created[0].timeZone).toBe("America/Los_Angeles")
  })

  it("refuses a time zone the runtime does not know", async () => {
    const { client } = buildPrisma()
    await expect(
      registerPushDevice(
        client as never,
        request({ input: { timeZone: "Middle/Earth" } }),
      ),
    ).rejects.toThrowError("The time zone Middle/Earth is not known")
    expect(client.pushRegistration.create).not.toHaveBeenCalled()
  })

  it("refuses a malformed push token before it touches the database", async () => {
    const { client } = buildPrisma()
    await expect(
      registerPushDevice(
        client as never,
        request({ input: { expoPushToken: "not-a-token" } }),
      ),
    ).rejects.toThrowError(PushInputError)
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it("derives the phone language through the subtag rung", async () => {
    const { client, created } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ input: { phoneLocale: "ko-KR" } }),
    )
    expect(created[0].phoneLanguageSlug).toBe("korean")
  })

  it("stores no phone language when no Language matches", async () => {
    const { client, created } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ input: { phoneLocale: "xh-ZA" } }),
    )
    expect(created[0].phoneLanguageSlug).toBeNull()
  })

  it("reads the Language rows once for several registrations", async () => {
    const { client } = buildPrisma()
    await registerPushDevice(client as never, request())
    await registerPushDevice(client as never, request())
    expect(client.language.findMany).toHaveBeenCalledTimes(1)
  })

  it("writes the row and its supersession in one transaction", async () => {
    const { client } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ viewerDigest: DIGEST, input: { installId: INSTALL } }),
    )
    // Both writes run inside the one callback, so a failed supersession can
    // never leave the new row active beside the old one.
    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(client.pushRegistration.create).toHaveBeenCalledTimes(1)
    expect(client.pushRegistration.updateMany).toHaveBeenCalledTimes(1)
  })

  it("keeps every log line free of the token, the install id, and a digest", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    try {
      await registerPushDevice(
        buildPrisma().client as never,
        request({ viewerDigest: DIGEST, input: { installId: INSTALL } }),
      )
      await registerPushDevice(
        buildPrisma({
          id: "reg_1",
          status: "ACTIVE",
          testDeviceId: "abcdef0123456789",
        }).client as never,
        request({
          viewerDigest: OTHER_DIGEST,
          input: { permission: "denied" },
        }),
      )
      await registerPushDevice(
        buildPrisma({
          id: "reg_1",
          status: "INVALID",
          testDeviceId: "abcdef0123456789",
        }).client as never,
        request({ viewerDigest: DIGEST }),
      ).catch(() => undefined)
      await registerPushDevice(
        buildPrisma().client as never,
        request({ input: { timeZone: "Middle/Earth" } }),
      ).catch(() => undefined)

      const combined = spies
        .flatMap((spy) => spy.mock.calls.map((args) => String(args[0] ?? "")))
        .join("\n")
      expect(combined).toContain("[push] event=register")
      expect(combined).not.toContain(TOKEN)
      expect(combined).not.toContain("ExponentPushToken")
      expect(combined).not.toContain(DIGEST)
      expect(combined).not.toContain(OTHER_DIGEST)
      expect(combined).not.toContain(INSTALL)
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })

  it("logs the platform and country source and nothing identifying", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ viewerDigest: DIGEST, input: { installId: INSTALL } }),
    )
    const line = String(infoSpy.mock.calls[0]?.[0] ?? "")
    expect(line).toContain("[push] event=register")
    expect(line).toContain("platform=ios")
    expect(line).toContain("country_source=edge")
    expect(line).toContain("status=active")
    expect(line).toContain("superseded=1")
    expect(line).not.toContain(TOKEN)
    expect(line).not.toContain(DIGEST)
    expect(line).not.toContain(INSTALL)
    expect(line).not.toContain("ExponentPushToken")
  })
})
