import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PushTestDeviceIdSchema } from "./contracts"
import { PushInputError, PushInvalidTokenStatusError } from "./errors"
import {
  nextPushRegistrationStatus,
  registerPushDevice,
  resetPushLanguageCache,
} from "./registration.service"

const TOKEN = "ExponentPushToken[abcdefghijklmnopqrstuv]"
const DIGEST = "d".repeat(64)
const OTHER_DIGEST = "e".repeat(64)

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
    ["SUPERSEDED", "granted", "SUPERSEDED", false],
    [null, "denied", "INACTIVE", true],
    ["ACTIVE", "denied", "INACTIVE", true],
    ["INACTIVE", "denied", "INACTIVE", false],
    ["SUPERSEDED", "denied", "SUPERSEDED", false],
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

  it("supersedes the viewer's other active row on the same platform", async () => {
    const { client, supersedes } = buildPrisma()
    await registerPushDevice(client as never, request({ viewerDigest: DIGEST }))
    expect(supersedes).toHaveLength(1)
    expect(supersedes[0]).toMatchObject({
      where: {
        viewerDigest: DIGEST,
        platform: "IOS",
        status: "ACTIVE",
        id: { not: "reg_new" },
      },
      data: { status: "SUPERSEDED" },
    })
  })

  it("supersedes nothing when the phone sent no viewer handle", async () => {
    const { client, supersedes } = buildPrisma()
    await registerPushDevice(client as never, request())
    expect(supersedes).toHaveLength(0)
  })

  it("supersedes nothing when the registration ends inactive", async () => {
    const { client, supersedes } = buildPrisma()
    await registerPushDevice(
      client as never,
      request({ viewerDigest: DIGEST, input: { permission: "denied" } }),
    )
    expect(supersedes).toHaveLength(0)
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
    await registerPushDevice(client as never, request({ viewerDigest: DIGEST }))
    // Both writes run inside the one callback, so a failed supersession can
    // never leave the new row active beside the old one.
    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(client.pushRegistration.create).toHaveBeenCalledTimes(1)
    expect(client.pushRegistration.updateMany).toHaveBeenCalledTimes(1)
  })

  it("keeps every log line free of the token, the handle, and a digest", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    try {
      await registerPushDevice(
        buildPrisma().client as never,
        request({ viewerDigest: DIGEST }),
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
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })

  it("logs the platform and country source and nothing identifying", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = buildPrisma()
    await registerPushDevice(client as never, request({ viewerDigest: DIGEST }))
    const line = String(infoSpy.mock.calls[0]?.[0] ?? "")
    expect(line).toContain("[push] event=register")
    expect(line).toContain("platform=ios")
    expect(line).toContain("country_source=edge")
    expect(line).toContain("status=active")
    expect(line).not.toContain(TOKEN)
    expect(line).not.toContain(DIGEST)
    expect(line).not.toContain("ExponentPushToken")
  })
})
