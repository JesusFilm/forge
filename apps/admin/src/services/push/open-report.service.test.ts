import { afterEach, describe, expect, it, vi } from "vitest"

import { PushInputError } from "./errors"
import { reportPushOpen } from "./open-report.service"

const NONCE = "n".repeat(43)
const STORED_DIGEST = "a".repeat(64)
const OTHER_DIGEST = "b".repeat(64)
const SESSION_DIGEST = "c".repeat(64)

type Delivery = {
  id: string
  campaignId: string
  registrationId: string | null
  languageSlug: string
  country: string | null
  sendingAt: Date | null
  registration: { viewerDigest: string | null } | null
}

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: "delivery_1",
    campaignId: "campaign_1",
    registrationId: "reg_1",
    languageSlug: "french",
    country: "FR",
    sendingAt: new Date("2026-10-01T20:00:00.000Z"),
    registration: { viewerDigest: STORED_DIGEST },
    ...overrides,
  }
}

function buildPrisma(
  found: Delivery | null = delivery(),
  options: { createFails?: unknown } = {},
) {
  const created: Record<string, unknown>[] = []
  return {
    created,
    client: {
      pushDelivery: {
        findUnique: vi.fn(async () => found),
      },
      pushOpen: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          if (options.createFails) throw options.createFails
          created.push(args.data)
          return { id: "open_1", ...args.data }
        }),
      },
    },
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    input: { nonce: NONCE },
    viewerDigest: null,
    sessionDigest: null,
    ...overrides,
  }
}

const uniqueViolation = Object.assign(new Error("unique"), { code: "P2002" })

afterEach(() => {
  vi.restoreAllMocks()
})

describe("reporting an announcement open", () => {
  it("resolves the nonce through its own index", async () => {
    const { client } = buildPrisma()
    await reportPushOpen(client as never, request())
    expect(client.pushDelivery.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nonce: NONCE } }),
    )
  })

  it("stores one open with the delivery's snapshot columns", async () => {
    const { client, created } = buildPrisma()
    const receipt = await reportPushOpen(client as never, request())
    expect(receipt.outcome).toBe("STORED")
    expect(created[0]).toMatchObject({
      deliveryId: "delivery_1",
      campaignId: "campaign_1",
      registrationId: "reg_1",
      languageSlug: "french",
      country: "FR",
      viewerMismatch: false,
    })
    expect(created[0].receivedAt).toBeInstanceOf(Date)
  })

  it("binds a handle-less open to the registration's stored digest", async () => {
    const { client, created } = buildPrisma()
    await reportPushOpen(client as never, request())
    expect(created[0].viewerDigest).toBe(STORED_DIGEST)
    expect(created[0].sessionDigest).toBeNull()
  })

  it("stores both digests when the phone carried a handle", async () => {
    const { client, created } = buildPrisma()
    await reportPushOpen(
      client as never,
      request({
        viewerDigest: STORED_DIGEST,
        sessionDigest: SESSION_DIGEST,
      }),
    )
    expect(created[0].viewerDigest).toBe(STORED_DIGEST)
    expect(created[0].sessionDigest).toBe(SESSION_DIGEST)
    expect(created[0].viewerMismatch).toBe(false)
  })

  it("flags a mismatch when a present handle differs from the stored digest", async () => {
    const { client, created } = buildPrisma()
    await reportPushOpen(
      client as never,
      request({
        viewerDigest: OTHER_DIGEST,
        sessionDigest: SESSION_DIGEST,
      }),
    )
    expect(created[0].viewerDigest).toBe(OTHER_DIGEST)
    expect(created[0].viewerMismatch).toBe(true)
  })

  it("flags no mismatch when the registration carries no digest yet", async () => {
    const { client, created } = buildPrisma(
      delivery({ registration: { viewerDigest: null } }),
    )
    await reportPushOpen(
      client as never,
      request({
        viewerDigest: OTHER_DIGEST,
        sessionDigest: SESSION_DIGEST,
      }),
    )
    expect(created[0].viewerMismatch).toBe(false)
    expect(created[0].viewerDigest).toBe(OTHER_DIGEST)
  })

  it("counts an unknown nonce in a log line and stores nothing", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = buildPrisma(null)
    const receipt = await reportPushOpen(client as never, request())
    expect(receipt.outcome).toBe("UNKNOWN")
    expect(client.pushOpen.create).not.toHaveBeenCalled()
    const lines = infoSpy.mock.calls.map((args) => String(args[0] ?? ""))
    expect(lines.join("\n")).toContain("[push] event=open_unknown_nonce")
    expect(lines.join("\n")).not.toContain(NONCE)
  })

  it("answers a second report for one delivery without an error", async () => {
    const { client } = buildPrisma(delivery(), {
      createFails: uniqueViolation,
    })
    const receipt = await reportPushOpen(client as never, request())
    expect(receipt.outcome).toBe("DUPLICATE")
  })

  it("refuses a malformed nonce before it reads the delivery", async () => {
    const { client } = buildPrisma()
    await expect(
      reportPushOpen(client as never, request({ input: { nonce: "short" } })),
    ).rejects.toThrowError(PushInputError)
    expect(client.pushDelivery.findUnique).not.toHaveBeenCalled()
  })

  it("hands a stored open to the attribution seam once", async () => {
    const { client } = buildPrisma()
    const afterOpenStored = vi.fn()
    await reportPushOpen(client as never, request(), { afterOpenStored })
    expect(afterOpenStored).toHaveBeenCalledTimes(1)
    expect(afterOpenStored.mock.calls[0][0]).toMatchObject({
      id: "open_1",
      deliveryId: "delivery_1",
      campaignId: "campaign_1",
      registrationId: "reg_1",
      viewerDigest: STORED_DIGEST,
      deliverySendingAt: new Date("2026-10-01T20:00:00.000Z"),
    })
  })

  it("does not call the attribution seam for a duplicate", async () => {
    const { client } = buildPrisma(delivery(), {
      createFails: uniqueViolation,
    })
    const afterOpenStored = vi.fn()
    await reportPushOpen(client as never, request(), { afterOpenStored })
    expect(afterOpenStored).not.toHaveBeenCalled()
  })

  it("keeps the receipt when the attribution seam fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = buildPrisma()
    const receipt = await reportPushOpen(client as never, request(), {
      afterOpenStored: () => {
        throw new Error("attribution exploded")
      },
    })
    expect(receipt.outcome).toBe("STORED")
    expect(
      errSpy.mock.calls.map((args) => String(args[0])).join("\n"),
    ).toContain("[push] event=open_attribution_failed")
  })

  it("writes no nonce or digest into any log line", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    try {
      const { client } = buildPrisma()
      await reportPushOpen(
        client as never,
        request({
          viewerDigest: OTHER_DIGEST,
          sessionDigest: SESSION_DIGEST,
        }),
      )
      const combined = spies
        .flatMap((spy) => spy.mock.calls.map((args) => String(args[0] ?? "")))
        .join("\n")
      expect(combined).toContain("[push] event=open")
      expect(combined).not.toContain(NONCE)
      expect(combined).not.toContain(OTHER_DIGEST)
      expect(combined).not.toContain(SESSION_DIGEST)
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})
