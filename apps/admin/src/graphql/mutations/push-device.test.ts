import { beforeEach, describe, expect, it, vi } from "vitest"

import { useRateLimiter } from "@envelop/rate-limiter"
import {
  parse,
  type GraphQLEnumType,
  type GraphQLInputObjectType,
} from "graphql"

vi.mock("@/services/push/admission", () => ({
  admitPushWrite: vi.fn(),
}))
vi.mock("@/services/push/ceiling", () => ({
  assertPushCeiling: vi.fn(),
}))
vi.mock("@/services/push/registration.service", () => ({
  registerPushDevice: vi.fn(),
}))
vi.mock("@/services/push/open-report.service", () => ({
  reportPushOpen: vi.fn(),
}))
vi.mock("@/services/push/attribution.service", () => ({
  attributeEpisodeAfterPushOpen: vi.fn(),
}))

const { schema } = await import("@/graphql/schema")
const { admitPushWrite } = await import("@/services/push/admission")
const { assertPushCeiling } = await import("@/services/push/ceiling")
const { registerPushDevice } =
  await import("@/services/push/registration.service")
const { reportPushOpen } = await import("@/services/push/open-report.service")
const { attributeEpisodeAfterPushOpen } =
  await import("@/services/push/attribution.service")
const {
  PushAdmissionError,
  PushCeilingExceededError,
  PushInvalidTokenStatusError,
  PushViewerHandleRejectedError,
} = await import("@/services/push/errors")

const admitMock = admitPushWrite as ReturnType<typeof vi.fn>
const ceilingMock = assertPushCeiling as ReturnType<typeof vi.fn>
const registerMock = registerPushDevice as ReturnType<typeof vi.fn>
const openMock = reportPushOpen as ReturnType<typeof vi.fn>
const attributeMock = attributeEpisodeAfterPushOpen as ReturnType<typeof vi.fn>

const VIEWER_TOKEN = "v".repeat(43)
const SESSION_TOKEN = "s".repeat(43)
const NONCE = "n".repeat(43)
const VIEWER_DIGEST = "d".repeat(64)
const SESSION_DIGEST = "e".repeat(64)
const INSTALL = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
const OTHER_INSTALL = "8c1d9b2a-0e64-4f17-8a55-6b0f3d2c1e90"

type Field = {
  resolve: (root: unknown, args: never, ctx: unknown, info: unknown) => unknown
}

function mutationField(name: string): Field {
  return schema.getMutationType()!.getFields()[name] as unknown as Field
}

const prisma = { marker: "prisma" }

function invoke(
  name: string,
  input: Record<string, unknown>,
  headers: Record<string, string> = { "cf-ipcountry": "NZ" },
) {
  return Promise.resolve(
    mutationField(name).resolve(
      null,
      { input } as never,
      {
        prisma,
        user: { id: null, role: "CONSUMER_BEARER", rateLimitBucketKey: "k" },
        request: new Request("https://admin.example/graphql", { headers }),
      },
      {},
    ),
  )
}

function registrationInput(overrides: Record<string, unknown> = {}) {
  return {
    expoPushToken: "ExponentPushToken[abcdefghijklmnopqrstuv]",
    platform: "IOS",
    appBuild: "1.2.3",
    appLanguageSlug: "english",
    phoneLocale: "fr-FR",
    timeZone: "Pacific/Auckland",
    permission: "granted",
    installId: INSTALL,
    viewerToken: null,
    sessionToken: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  admitMock.mockResolvedValue({
    fleetKeyId: "fleetkey1234",
    viewerDigest: null,
    sessionDigest: null,
  })
  ceilingMock.mockResolvedValue(undefined)
  registerMock.mockResolvedValue({
    testDeviceId: "abcdef0123456789",
    status: "ACTIVE",
  })
  openMock.mockResolvedValue({ outcome: "STORED" })
  attributeMock.mockResolvedValue({ outcome: "attributed", campaignId: "c_1" })
})

describe("the push mutations on the schema", () => {
  it("declares both as mutation fields", () => {
    const fields = schema.getMutationType()!.getFields()
    expect(fields.registerPushDevice).toBeDefined()
    expect(fields.reportPushOpen).toBeDefined()
  })

  it("names the receipt types the app selects on", () => {
    expect(schema.getType("PushDeviceRegistrationReceipt")).toBeDefined()
    expect(schema.getType("PushOpenReceipt")).toBeDefined()
    expect(schema.getType("RegisterPushDeviceInput")).toBeDefined()
    expect(schema.getType("ReportPushOpenInput")).toBeDefined()
  })

  it("requires the install id on the registration input", () => {
    const input = schema.getType(
      "RegisterPushDeviceInput",
    ) as GraphQLInputObjectType
    const installId = input.getFields().installId
    expect(installId).toBeDefined()
    // Required: supersession has no key without it, and the app always sends it.
    expect(String(installId.type)).toBe("String!")
  })

  it("never offers INVALID as a registration state", () => {
    const state = schema.getType("PushRegistrationState") as GraphQLEnumType
    expect(state.getValues().map((value) => value.name)).toEqual([
      "ACTIVE",
      "INACTIVE",
      "SUPERSEDED",
    ])
  })
})

describe("registerPushDevice", () => {
  it("runs admission, then the ceiling, then the service", async () => {
    const order: string[] = []
    admitMock.mockImplementation(async () => {
      order.push("admission")
      return {
        fleetKeyId: "fleetkey1234",
        viewerDigest: null,
        sessionDigest: null,
      }
    })
    ceilingMock.mockImplementation(async () => {
      order.push("ceiling")
    })
    registerMock.mockImplementation(async () => {
      order.push("service")
      return { testDeviceId: "abcdef0123456789", status: "ACTIVE" }
    })
    await invoke("registerPushDevice", registrationInput())
    expect(order).toEqual(["admission", "ceiling", "service"])
    expect(ceilingMock).toHaveBeenCalledWith("register", "fleetkey1234")
  })

  it("hands the service the registration fields without the handle", async () => {
    await invoke(
      "registerPushDevice",
      registrationInput({
        viewerToken: VIEWER_TOKEN,
        sessionToken: SESSION_TOKEN,
      }),
    )
    expect(registerMock.mock.calls[0][0]).toBe(prisma)
    expect(registerMock.mock.calls[0][1].input).toEqual({
      expoPushToken: "ExponentPushToken[abcdefghijklmnopqrstuv]",
      platform: "IOS",
      appBuild: "1.2.3",
      appLanguageSlug: "english",
      phoneLocale: "fr-FR",
      timeZone: "Pacific/Auckland",
      permission: "granted",
      installId: INSTALL,
    })
  })

  it("hands the service the install id the app sent", async () => {
    await invoke(
      "registerPushDevice",
      registrationInput({ installId: OTHER_INSTALL }),
    )
    expect(registerMock.mock.calls[0][1].input.installId).toBe(OTHER_INSTALL)
  })

  it("passes the verified viewer digest through", async () => {
    admitMock.mockResolvedValue({
      fleetKeyId: null,
      viewerDigest: VIEWER_DIGEST,
      sessionDigest: SESSION_DIGEST,
    })
    await invoke("registerPushDevice", registrationInput())
    expect(registerMock.mock.calls[0][1].viewerDigest).toBe(VIEWER_DIGEST)
  })

  it("reads the country from the edge header alone", async () => {
    await invoke("registerPushDevice", registrationInput(), {
      "cf-ipcountry": "NZ",
      "x-country-code": "US",
    })
    expect(registerMock.mock.calls[0][1].edgeCountry).toBe("NZ")
  })

  it("passes no country when only a client-settable header is present", async () => {
    await invoke("registerPushDevice", registrationInput(), {
      "x-vercel-ip-country": "US",
    })
    expect(registerMock.mock.calls[0][1].edgeCountry).toBeNull()
  })

  it("answers the receipt the app reads", async () => {
    await expect(
      invoke("registerPushDevice", registrationInput()),
    ).resolves.toEqual({ testDeviceId: "abcdef0123456789", status: "ACTIVE" })
  })

  it("refuses a caller admission turned away, before the ceiling", async () => {
    admitMock.mockRejectedValue(new PushAdmissionError())
    await expect(
      invoke("registerPushDevice", registrationInput()),
    ).rejects.toMatchObject({
      extensions: { code: "UNAUTHENTICATED", pushCode: "admission_denied" },
    })
    expect(ceilingMock).not.toHaveBeenCalled()
    expect(registerMock).not.toHaveBeenCalled()
  })

  it("names a refused viewer handle apart from a missing bearer", async () => {
    // The app re-checks its handle only on this push code.
    admitMock.mockRejectedValue(new PushViewerHandleRejectedError())
    await expect(
      invoke("registerPushDevice", registrationInput()),
    ).rejects.toMatchObject({
      extensions: {
        code: "UNAUTHENTICATED",
        pushCode: "viewer_handle_rejected",
      },
    })
    expect(registerMock).not.toHaveBeenCalled()
  })

  it("maps a ceiling refusal to a rate-limit code, and never registers", async () => {
    ceilingMock.mockRejectedValue(new PushCeilingExceededError("register"))
    await expect(
      invoke("registerPushDevice", registrationInput()),
    ).rejects.toMatchObject({
      extensions: { code: "TOO_MANY_REQUESTS", pushCode: "ceiling_exceeded" },
    })
    expect(registerMock).not.toHaveBeenCalled()
  })

  it("maps a retired token to a refusal the app can stop on", async () => {
    registerMock.mockRejectedValue(new PushInvalidTokenStatusError())
    await expect(
      invoke("registerPushDevice", registrationInput()),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT", pushCode: "invalid_token_status" },
    })
  })

  it("leaves an unexpected failure as an internal error", async () => {
    registerMock.mockRejectedValue(new Error("the database fell over"))
    await expect(
      invoke("registerPushDevice", registrationInput()),
    ).rejects.toThrowError("the database fell over")
  })
})

describe("reportPushOpen", () => {
  it("runs admission and the open ceiling before the service", async () => {
    await invoke("reportPushOpen", {
      nonce: NONCE,
      viewerToken: null,
      sessionToken: null,
    })
    expect(admitMock).toHaveBeenCalledTimes(1)
    expect(ceilingMock).toHaveBeenCalledWith("open", "fleetkey1234")
    expect(openMock.mock.calls[0][1]).toEqual({
      input: { nonce: NONCE },
      viewerDigest: null,
      sessionDigest: null,
    })
  })

  it("passes both verified digests through", async () => {
    admitMock.mockResolvedValue({
      fleetKeyId: null,
      viewerDigest: VIEWER_DIGEST,
      sessionDigest: SESSION_DIGEST,
    })
    await invoke("reportPushOpen", {
      nonce: NONCE,
      viewerToken: VIEWER_TOKEN,
      sessionToken: SESSION_TOKEN,
    })
    expect(openMock.mock.calls[0][1]).toEqual({
      input: { nonce: NONCE },
      viewerDigest: VIEWER_DIGEST,
      sessionDigest: SESSION_DIGEST,
    })
  })

  it("answers an unknown nonce as data, not as an error", async () => {
    openMock.mockResolvedValue({ outcome: "UNKNOWN" })
    await expect(
      invoke("reportPushOpen", {
        nonce: NONCE,
        viewerToken: null,
        sessionToken: null,
      }),
    ).resolves.toEqual({ outcome: "UNKNOWN" })
  })

  it("refuses an unverified handle instead of reporting anonymously", async () => {
    // The app re-reports the open without the handle only on this push code.
    admitMock.mockRejectedValue(new PushViewerHandleRejectedError())
    await expect(
      invoke("reportPushOpen", {
        nonce: NONCE,
        viewerToken: VIEWER_TOKEN,
        sessionToken: SESSION_TOKEN,
      }),
    ).rejects.toMatchObject({
      extensions: {
        code: "UNAUTHENTICATED",
        pushCode: "viewer_handle_rejected",
      },
    })
    expect(openMock).not.toHaveBeenCalled()
  })

  it("refuses an open report from a caller admission turned away", async () => {
    admitMock.mockRejectedValue(new PushAdmissionError())
    await expect(
      invoke("reportPushOpen", {
        nonce: NONCE,
        viewerToken: VIEWER_TOKEN,
        sessionToken: SESSION_TOKEN,
      }),
    ).rejects.toMatchObject({
      extensions: { code: "UNAUTHENTICATED", pushCode: "admission_denied" },
    })
    expect(openMock).not.toHaveBeenCalled()
  })

  it("hands the report an attribution hook that runs the reverse join", async () => {
    const stored = {
      id: "open_1",
      deliveryId: "delivery_1",
      campaignId: "campaign_1",
      registrationId: "reg_1",
      viewerDigest: VIEWER_DIGEST,
      sessionDigest: SESSION_DIGEST,
      languageSlug: "french",
      country: "FR",
      viewerMismatch: false,
      receivedAt: new Date("2026-10-01T21:00:00.000Z"),
      deliverySendingAt: new Date("2026-10-01T20:00:00.000Z"),
    }
    openMock.mockImplementation(
      async (
        _client: unknown,
        _request: unknown,
        options: { afterOpenStored?: (open: unknown) => Promise<void> },
      ) => {
        await options.afterOpenStored?.(stored)
        return { outcome: "STORED" }
      },
    )
    await invoke("reportPushOpen", {
      nonce: NONCE,
      viewerToken: null,
      sessionToken: null,
    })
    // The bounded wrapper, never the raw join: it is what holds the budget and
    // answers a failure instead of throwing into the receipt.
    expect(attributeMock).toHaveBeenCalledWith(prisma, stored)
  })

  it("writes no token, handle, or nonce into a log line", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    try {
      await invoke(
        "registerPushDevice",
        registrationInput({
          viewerToken: VIEWER_TOKEN,
          sessionToken: SESSION_TOKEN,
        }),
      )
      await invoke("reportPushOpen", {
        nonce: NONCE,
        viewerToken: VIEWER_TOKEN,
        sessionToken: SESSION_TOKEN,
      })
      admitMock.mockRejectedValue(new PushAdmissionError())
      await invoke("reportPushOpen", {
        nonce: NONCE,
        viewerToken: VIEWER_TOKEN,
        sessionToken: SESSION_TOKEN,
      }).catch(() => undefined)
      admitMock.mockRejectedValue(new PushViewerHandleRejectedError())
      await invoke("reportPushOpen", {
        nonce: NONCE,
        viewerToken: VIEWER_TOKEN,
        sessionToken: SESSION_TOKEN,
      }).catch(() => undefined)
      const combined = spies
        .flatMap((spy) => spy.mock.calls.map((args) => String(args[0] ?? "")))
        .join("\n")
      expect(combined).not.toContain(VIEWER_TOKEN)
      expect(combined).not.toContain(SESSION_TOKEN)
      expect(combined).not.toContain(NONCE)
      expect(combined).not.toContain("ExponentPushToken")
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})

describe("the mutation rate limit covers both push fields", () => {
  it("counts each field in its own bucket under the wildcard entry", async () => {
    const { rateLimitConfigByField } =
      await import("@/graphql/plugins/rate-limit")
    const seen: { contextIdentity: string; fieldIdentity: string }[] = []
    const plugin = useRateLimiter({
      identifyFn: () => "push-test-identity",
      configByField: rateLimitConfigByField,
      store: {
        getForIdentity: (identity) => {
          seen.push(identity as (typeof seen)[number])
          return []
        },
        setForIdentity: () => {},
      },
    })

    const document = parse(`
      mutation PushRateLimit {
        registerPushDevice(
          input: {
            expoPushToken: "ExponentPushToken[abcdefghijklmnopqrstuv]"
            platform: IOS
            appBuild: "1.2.3"
            appLanguageSlug: "english"
            phoneLocale: "fr-FR"
            timeZone: "Pacific/Auckland"
            permission: granted
            installId: "${INSTALL}"
          }
        ) {
          testDeviceId
        }
        reportPushOpen(input: { nonce: "${NONCE}" }) {
          outcome
        }
      }
    `)

    await plugin.onExecute!({
      args: {
        document,
        schema,
        contextValue: {},
        variableValues: {},
        rootValue: {},
      },
      setResultAndStopExecution: () => {},
    } as never)

    // A wildcard entry that matched nothing would leave this empty, and one
    // shared counter would collapse the two identities into one.
    expect(seen.map((identity) => identity.fieldIdentity)).toEqual([
      "registerPushDevice",
      "reportPushOpen",
    ])
    expect(new Set(seen.map((identity) => identity.contextIdentity))).toEqual(
      new Set(["push-test-identity"]),
    )
  })

  it("keeps the mutation budget on one wildcard entry", async () => {
    const { rateLimitConfigByField } =
      await import("@/graphql/plugins/rate-limit")
    expect(
      rateLimitConfigByField.filter((entry) => entry.type === "Mutation"),
    ).toEqual([{ type: "Mutation", field: "*", max: 30, window: "1m" }])
  })
})
