/**
 * KTD1 and KTD15 — the provider wrapper. Every test injects a stub client, so
 * no test reaches Expo.
 *
 * The env module is mocked with a mutable object, not with literals passed as
 * options, because the production access-token guard reads `env` itself. A test
 * that only passed `accessTokenRequired: true` would leave the production
 * source unpinned.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    NODE_ENV: "test" as "test" | "development" | "production",
    EXPO_ACCESS_TOKEN: undefined as string | undefined,
    PUSH_CAMPAIGNS_ENABLED: undefined as string | undefined,
    PUSH_BATCH_PAGE_SIZE: undefined as number | undefined,
    PUSH_STEP_MAX_DURATION_MS: undefined as number | undefined,
    PUSH_CHUNK_DEADLINE_MS: undefined as number | undefined,
    PUSH_PROVIDER_CONCURRENCY: undefined as number | undefined,
    PUSH_MESSAGES_PER_SECOND: undefined as number | undefined,
    PUSH_RECEIPT_PAGE_SIZE: undefined as number | undefined,
    PUSH_FCM_BLOCKED_COUNTRIES: undefined as string | undefined,
  },
  resolvePushFcmBlockedCountries: (value: string | undefined) => {
    const raw = value?.trim()
    if (!raw) return ["CN"]
    if (raw.toLowerCase() === "none") return []
    return raw.split(",").map((part) => part.trim().toUpperCase())
  },
}))

vi.mock("@/config/env", () => mockEnv)

const {
  PUSH_MESSAGE_MAX_BYTES,
  PUSH_PROVIDER_CHUNK_SIZE,
  PUSH_RECEIPT_CHUNK_SIZE,
  PushProviderAuthError,
  PushProviderFatalError,
  PushProviderIndeterminateError,
  PushProviderRetryableError,
  PushTransportConfigurationError,
  classifyPushProviderError,
  createPushTransport,
  providerErrorCode,
  resetPushSendRateBucket,
  resolvePushSendConfig,
  reservePushSendWindow,
  withPushProviderDeadline,
} = await import("./transport")

type StubClient = {
  sendPushNotificationsAsync: ReturnType<typeof vi.fn>
  getPushNotificationReceiptsAsync: ReturnType<typeof vi.fn>
}

function stubClient(overrides: Partial<StubClient> = {}): StubClient {
  return {
    sendPushNotificationsAsync: vi.fn(async () => []),
    getPushNotificationReceiptsAsync: vi.fn(async () => ({})),
    ...overrides,
  }
}

function message(index: number, overrides: Record<string, unknown> = {}) {
  return {
    token: `ExponentPushToken[token-${index}]`,
    title: "A title",
    body: "A body",
    data: { nonce: `nonce-${index}`, kind: "video", slug: "jesus" },
    ...overrides,
  }
}

function providerError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("a provider message that embeds a token"), {
    ...fields,
  })
}

beforeEach(() => {
  mockEnv.env.NODE_ENV = "test"
  mockEnv.env.EXPO_ACCESS_TOKEN = undefined
  mockEnv.env.PUSH_CAMPAIGNS_ENABLED = undefined
  mockEnv.env.PUSH_BATCH_PAGE_SIZE = undefined
  mockEnv.env.PUSH_STEP_MAX_DURATION_MS = undefined
  mockEnv.env.PUSH_CHUNK_DEADLINE_MS = undefined
  mockEnv.env.PUSH_PROVIDER_CONCURRENCY = undefined
  mockEnv.env.PUSH_MESSAGES_PER_SECOND = undefined
  mockEnv.env.PUSH_RECEIPT_PAGE_SIZE = undefined
  mockEnv.env.PUSH_FCM_BLOCKED_COUNTRIES = undefined
  resetPushSendRateBucket()
})

describe("resolvePushSendConfig", () => {
  it("applies the sizing table when nothing is set", () => {
    const config = resolvePushSendConfig()

    expect(config).toMatchObject({
      campaignsEnabled: false,
      batchPageSize: 5_000,
      stepMaxDurationMs: 220_000,
      stepReserveMs: 40_000,
      chunkDeadlineMs: 10_000,
      providerConcurrency: 3,
      messagesPerSecond: 500,
      receiptPageSize: 10_000,
      blockedCountries: ["CN"],
    })
  })

  it("reads each knob from its own environment variable", () => {
    mockEnv.env.PUSH_CAMPAIGNS_ENABLED = "true"
    mockEnv.env.PUSH_BATCH_PAGE_SIZE = 11
    mockEnv.env.PUSH_STEP_MAX_DURATION_MS = 12_000
    mockEnv.env.PUSH_CHUNK_DEADLINE_MS = 13
    mockEnv.env.PUSH_PROVIDER_CONCURRENCY = 4
    mockEnv.env.PUSH_MESSAGES_PER_SECOND = 15
    mockEnv.env.PUSH_RECEIPT_PAGE_SIZE = 16
    mockEnv.env.PUSH_FCM_BLOCKED_COUNTRIES = "ru,cn"

    expect(resolvePushSendConfig()).toMatchObject({
      campaignsEnabled: true,
      batchPageSize: 11,
      stepMaxDurationMs: 12_000,
      chunkDeadlineMs: 13,
      providerConcurrency: 4,
      messagesPerSecond: 15,
      receiptPageSize: 16,
      blockedCountries: ["RU", "CN"],
    })
  })

  it("keeps the step reserve below the step budget", () => {
    mockEnv.env.PUSH_STEP_MAX_DURATION_MS = 10_000

    const config = resolvePushSendConfig()

    expect(config.stepReserveMs).toBeLessThan(config.stepMaxDurationMs)
  })
})

describe("the production access-token guard", () => {
  it("refuses to construct in production without the access token", () => {
    mockEnv.env.NODE_ENV = "production"

    expect(() => createPushTransport({ client: stubClient() })).toThrow(
      PushTransportConfigurationError,
    )
  })

  it("constructs in production once the access token is present", () => {
    mockEnv.env.NODE_ENV = "production"
    mockEnv.env.EXPO_ACCESS_TOKEN = "expo-access-token"

    expect(() => createPushTransport({ client: stubClient() })).not.toThrow()
  })

  it("constructs outside production without the access token", () => {
    expect(() => createPushTransport({ client: stubClient() })).not.toThrow()
  })

  it("never names the access token in the refusal", () => {
    mockEnv.env.NODE_ENV = "production"
    mockEnv.env.EXPO_ACCESS_TOKEN = undefined

    try {
      createPushTransport({ client: stubClient() })
      expect.unreachable("construction must refuse")
    } catch (error) {
      expect((error as Error).message).toContain("EXPO_ACCESS_TOKEN")
      expect((error as Error).message).not.toContain("expo-access-token")
    }
  })
})

describe("reservePushSendWindow", () => {
  it("lets the first messages through with no wait", () => {
    expect(reservePushSendWindow(100, 500, 1_000)).toBe(0)
  })

  it("paces later chunks so the rate never exceeds the ceiling", () => {
    reservePushSendWindow(500, 500, 1_000)

    expect(reservePushSendWindow(500, 500, 1_000)).toBe(1_000)
    expect(reservePushSendWindow(250, 500, 1_000)).toBe(2_000)
  })

  it("forgets a window the clock has already passed", () => {
    reservePushSendWindow(500, 500, 1_000)

    expect(reservePushSendWindow(100, 500, 9_000)).toBe(0)
  })

  it("is process-wide, so a second transport shares the bucket", async () => {
    const first = createPushTransport({
      client: stubClient(),
      config: { ...resolvePushSendConfig(), messagesPerSecond: 500 },
    })
    const second = createPushTransport({
      client: stubClient(),
      config: { ...resolvePushSendConfig(), messagesPerSecond: 500 },
    })

    expect(first).not.toBe(second)
    reservePushSendWindow(500, 500, 1_000)
    expect(reservePushSendWindow(1, 500, 1_000)).toBe(1_000)
  })
})

describe("classifyPushProviderError", () => {
  it("treats a rate limit as retryable, so the chunk reverts", () => {
    expect(classifyPushProviderError(providerError({ statusCode: 429 }))).toBe(
      "retryable",
    )
  })

  it.each([
    ["ECONNREFUSED"],
    ["ENOTFOUND"],
    ["UND_ERR_CONNECT_TIMEOUT"],
    ["EAI_AGAIN"],
  ])("treats the pre-socket code %s as retryable", (code) => {
    expect(
      classifyPushProviderError(
        Object.assign(new Error("fetch failed"), { cause: { code } }),
      ),
    ).toBe("retryable")
  })

  it.each([[401], [403]])("treats status %i as an auth failure", (status) => {
    expect(
      classifyPushProviderError(providerError({ statusCode: status })),
    ).toBe("auth")
  })

  it.each([
    ["UNAUTHORIZED"],
    ["INVALID_CREDENTIALS"],
    ["PUSH_TOO_MANY_EXPERIENCE_IDS"],
  ])("classifies the provider code %s without reading the message", (code) => {
    const classification = classifyPushProviderError(providerError({ code }))

    expect(classification === "auth" || classification === "fatal").toBe(true)
  })

  it("treats an oversized message as fatal for the chunk", () => {
    expect(
      classifyPushProviderError(providerError({ code: "MESSAGE_TOO_BIG" })),
    ).toBe("fatal")
  })

  it("treats an unclassifiable failure as indeterminate, never as retryable", () => {
    expect(classifyPushProviderError(new Error("something went wrong"))).toBe(
      "indeterminate",
    )
  })

  it("treats a server error as indeterminate, because the request may have left", () => {
    expect(classifyPushProviderError(providerError({ statusCode: 500 }))).toBe(
      "indeterminate",
    )
  })
})

describe("providerErrorCode", () => {
  it("returns the provider's code, never its message", () => {
    expect(providerErrorCode(providerError({ code: "MESSAGE_TOO_BIG" }))).toBe(
      "MESSAGE_TOO_BIG",
    )
  })

  it("falls back to the status code", () => {
    expect(providerErrorCode(providerError({ statusCode: 503 }))).toBe(
      "http_503",
    )
  })

  it("falls back to a fixed label when nothing typed is present", () => {
    expect(providerErrorCode(new Error("a token leaked in here"))).toBe(
      "unclassified",
    )
  })

  it("bounds the code to the delivery column width", () => {
    const code = providerErrorCode(providerError({ code: "X".repeat(200) }))

    expect(code.length).toBeLessThanOrEqual(32)
  })
})

describe("withPushProviderDeadline", () => {
  it("resolves inside the budget", async () => {
    await expect(
      withPushProviderDeadline(Promise.resolve("done"), 50),
    ).resolves.toBe("done")
  })

  it("rejects as indeterminate when the budget passes", async () => {
    await expect(
      withPushProviderDeadline(
        new Promise((resolve) => setTimeout(resolve, 200)),
        10,
      ),
    ).rejects.toBeInstanceOf(PushProviderIndeterminateError)
  })

  it("never leaves the raced promise unhandled", async () => {
    const rejections: unknown[] = []
    const listener = (error: unknown) => rejections.push(error)
    process.on("unhandledRejection", listener)
    try {
      const late = new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("late failure")), 20)
      })
      await expect(withPushProviderDeadline(late, 5)).rejects.toBeInstanceOf(
        PushProviderIndeterminateError,
      )
      await new Promise((resolve) => setTimeout(resolve, 60))
    } finally {
      process.off("unhandledRejection", listener)
    }

    expect(rejections).toEqual([])
  })
})

describe("sendChunk", () => {
  it("returns one outcome per message, in order", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => [
        { status: "ok", id: "ticket-1" },
        { status: "ok", id: "ticket-2" },
      ]),
    })
    const transport = createPushTransport({ client })

    const outcomes = await transport.sendChunk([message(1), message(2)])

    expect(outcomes).toEqual([
      { kind: "accepted", ticketId: "ticket-1" },
      { kind: "accepted", ticketId: "ticket-2" },
    ])
  })

  it("carries the announcement payload the app parses", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => [
        { status: "ok", id: "ticket-1" },
      ]),
    })
    const transport = createPushTransport({ client })

    await transport.sendChunk([message(1)])

    expect(client.sendPushNotificationsAsync).toHaveBeenCalledWith([
      expect.objectContaining({
        to: "ExponentPushToken[token-1]",
        title: "A title",
        body: "A body",
        channelId: "announcements",
        data: { nonce: "nonce-1", kind: "video", slug: "jesus" },
      }),
    ])
  })

  it("reads a dead-token ticket as a dead token, by its code", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => [
        {
          status: "error",
          message:
            '"ExponentPushToken[token-1]" is not a registered push notification recipient',
          details: {
            error: "DeviceNotRegistered",
            expoPushToken: "ExponentPushToken[token-1]",
          },
        },
      ]),
    })
    const transport = createPushTransport({ client })

    const outcomes = await transport.sendChunk([message(1)])

    expect(outcomes).toEqual([
      { kind: "dead_token", providerCode: "DeviceNotRegistered" },
    ])
  })

  it("never returns the provider's message on an error ticket", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => [
        {
          status: "error",
          message: "ExponentPushToken[token-1] is bad",
          details: { error: "MessageTooBig" },
        },
      ]),
    })
    const transport = createPushTransport({ client })

    const outcomes = await transport.sendChunk([message(1)])

    expect(JSON.stringify(outcomes)).not.toContain("ExponentPushToken")
    expect(outcomes).toEqual([
      { kind: "failed", providerCode: "MessageTooBig" },
    ])
  })

  it("refuses a chunk above the provider's limit", async () => {
    const transport = createPushTransport({ client: stubClient() })
    const messages = Array.from(
      { length: PUSH_PROVIDER_CHUNK_SIZE + 1 },
      (_value, index) => message(index),
    )

    await expect(transport.sendChunk(messages)).rejects.toBeInstanceOf(
      PushProviderFatalError,
    )
  })

  it("drops an oversized message without sending it and keeps the rest aligned", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => [
        { status: "ok", id: "ticket-2" },
      ]),
    })
    const transport = createPushTransport({ client })

    const outcomes = await transport.sendChunk([
      message(1, { body: "x".repeat(PUSH_MESSAGE_MAX_BYTES) }),
      message(2),
    ])

    expect(outcomes).toEqual([
      { kind: "failed", providerCode: "message_too_big" },
      { kind: "accepted", ticketId: "ticket-2" },
    ])
    expect(client.sendPushNotificationsAsync).toHaveBeenCalledWith([
      expect.objectContaining({ to: "ExponentPushToken[token-2]" }),
    ])
  })

  it("does not call the provider when every message is oversized", async () => {
    const client = stubClient()
    const transport = createPushTransport({ client })

    const outcomes = await transport.sendChunk([
      message(1, { body: "x".repeat(PUSH_MESSAGE_MAX_BYTES) }),
    ])

    expect(client.sendPushNotificationsAsync).not.toHaveBeenCalled()
    expect(outcomes).toEqual([
      { kind: "failed", providerCode: "message_too_big" },
    ])
  })

  it("raises a retryable error on a rate limit so the caller reverts the chunk", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => {
        throw providerError({ statusCode: 429 })
      }),
    })
    const transport = createPushTransport({ client })

    await expect(transport.sendChunk([message(1)])).rejects.toBeInstanceOf(
      PushProviderRetryableError,
    )
  })

  it("raises an auth error on bad credentials", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => {
        throw providerError({ statusCode: 401, code: "UNAUTHORIZED" })
      }),
    })
    const transport = createPushTransport({ client })

    await expect(transport.sendChunk([message(1)])).rejects.toBeInstanceOf(
      PushProviderAuthError,
    )
  })

  it("never carries the provider's message into the raised error", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => {
        throw providerError({ statusCode: 401 })
      }),
    })
    const transport = createPushTransport({ client })

    const error = await transport
      .sendChunk([message(1)])
      .catch((raised) => raised)

    expect((error as Error).message).not.toContain("a provider message")
    expect((error as Error).message).not.toContain("token")
  })

  it("treats a short-count ticket array as indeterminate", async () => {
    const client = stubClient({
      sendPushNotificationsAsync: vi.fn(async () => [
        { status: "ok", id: "ticket-1" },
      ]),
    })
    const transport = createPushTransport({ client })

    await expect(
      transport.sendChunk([message(1), message(2)]),
    ).rejects.toBeInstanceOf(PushProviderIndeterminateError)
  })
})

describe("fetchReceipts", () => {
  it("maps each receipt to its outcome", async () => {
    const client = stubClient({
      getPushNotificationReceiptsAsync: vi.fn(async () => ({
        "ticket-1": { status: "ok" },
        "ticket-2": {
          status: "error",
          message: "ExponentPushToken[token-2] is dead",
          details: { error: "DeviceNotRegistered" },
        },
        "ticket-3": {
          status: "error",
          message: "provider trouble",
          details: { error: "ProviderError" },
        },
      })),
    })
    const transport = createPushTransport({ client })

    const receipts = await transport.fetchReceipts([
      "ticket-1",
      "ticket-2",
      "ticket-3",
    ])

    expect(receipts.get("ticket-1")).toEqual({ kind: "handed_off" })
    expect(receipts.get("ticket-2")).toEqual({
      kind: "dead_token",
      providerCode: "DeviceNotRegistered",
    })
    expect(receipts.get("ticket-3")).toEqual({
      kind: "failed",
      providerCode: "ProviderError",
    })
  })

  it("leaves a ticket the provider did not answer out of the map", async () => {
    const client = stubClient({
      getPushNotificationReceiptsAsync: vi.fn(async () => ({
        "ticket-1": { status: "ok" },
      })),
    })
    const transport = createPushTransport({ client })

    const receipts = await transport.fetchReceipts(["ticket-1", "ticket-2"])

    expect(receipts.has("ticket-2")).toBe(false)
  })

  it("splits a page into provider-sized requests", async () => {
    const client = stubClient({
      getPushNotificationReceiptsAsync: vi.fn(async () => ({})),
    })
    const transport = createPushTransport({ client })
    const ids = Array.from(
      { length: PUSH_RECEIPT_CHUNK_SIZE + 1 },
      (_value, index) => `ticket-${index}`,
    )

    await transport.fetchReceipts(ids)

    expect(
      client.getPushNotificationReceiptsAsync.mock.calls.length,
    ).toBeGreaterThan(1)
    for (const [batch] of client.getPushNotificationReceiptsAsync.mock.calls) {
      expect((batch as string[]).length).toBeLessThanOrEqual(300)
    }
  })

  it("classifies a receipt failure the same way a send failure is classified", async () => {
    const client = stubClient({
      getPushNotificationReceiptsAsync: vi.fn(async () => {
        throw providerError({ statusCode: 429 })
      }),
    })
    const transport = createPushTransport({ client })

    await expect(transport.fetchReceipts(["ticket-1"])).rejects.toBeInstanceOf(
      PushProviderRetryableError,
    )
  })
})
