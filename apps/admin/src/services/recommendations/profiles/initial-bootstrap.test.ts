import { beforeEach, describe, expect, it, vi } from "vitest"

const loadEvidence = vi.hoisted(() => vi.fn())
vi.mock("./profile-projection.service", () => ({
  loadDatabaseProfileProjectionEvidence: loadEvidence,
}))

import { canSkipInitialEmptyProfileBootstrap } from "./initial-bootstrap"

const input = {
  profileId: "profile-1",
  privacyGeneration: 1,
  sessionDigest: "a".repeat(64),
  now: new Date("2026-09-30T00:00:00.000Z"),
}

const emptyEvidence = {
  durable: [],
  session: [],
  explicitPreferences: [],
  negativeEvidence: [],
}

function tx(
  state: { hasLink: boolean; hasGeneration: boolean; hasRun: boolean } = {
    hasLink: true,
    hasGeneration: false,
    hasRun: false,
  },
  hasRawSource = false,
) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([{ createdAt: new Date("2026-09-29") }])
    .mockResolvedValueOnce([state])
    .mockResolvedValueOnce([{ hasRawSource }])
  return { $queryRaw: queryRaw } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  loadEvidence.mockResolvedValue(emptyEvidence)
})

describe("initial empty profile bootstrap admission", () => {
  it("accepts only a linked untouched scope with no raw or projected source", async () => {
    const client = tx()
    await expect(
      canSkipInitialEmptyProfileBootstrap(client, input),
    ).resolves.toBe(true)
    expect(loadEvidence).toHaveBeenCalledOnce()
  })

  it.each([
    { hasLink: false, hasGeneration: false, hasRun: false },
    { hasLink: true, hasGeneration: true, hasRun: false },
    { hasLink: true, hasGeneration: false, hasRun: true },
  ])(
    "rejects a scope with an invalid link or retained history: %j",
    async (state) => {
      await expect(
        canSkipInitialEmptyProfileBootstrap(tx(state), input),
      ).resolves.toBe(false)
      expect(loadEvidence).not.toHaveBeenCalled()
    },
  )

  it("rejects pending raw source facts even before eligibility or embedding", async () => {
    await expect(
      canSkipInitialEmptyProfileBootstrap(tx(undefined, true), input),
    ).resolves.toBe(false)
    expect(loadEvidence).not.toHaveBeenCalled()
  })

  it.each([
    "durable",
    "session",
    "explicitPreferences",
    "negativeEvidence",
  ] as const)(
    "rejects a populated %s projection source channel",
    async (channel) => {
      loadEvidence.mockResolvedValueOnce({
        ...emptyEvidence,
        [channel]: [{}],
      })
      await expect(
        canSkipInitialEmptyProfileBootstrap(tx(), input),
      ).resolves.toBe(false)
    },
  )
})
