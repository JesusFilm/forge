import { beforeEach, describe, expect, it, vi } from "vitest"

const queryRaw = vi.fn()
const executeRaw = vi.fn()
const executeRawUnsafe = vi.fn()
const transaction = vi.fn()
const env = { OKTA_ISSUER: undefined as string | undefined }

vi.mock("@/db/client", () => ({
  prisma: {
    $queryRaw: queryRaw,
    $transaction: transaction,
  },
}))

vi.mock("@/config/env", () => ({
  env,
  getAuthBaseUrl: () => "https://auth.jesusfilm.org/",
}))

describe("finalizeBetterAuth17Schema", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.OKTA_ISSUER = undefined
    transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: executeRaw,
        $executeRawUnsafe: executeRawUnsafe,
        $queryRaw: queryRaw,
      }),
    )
  })

  it("rejects an unknown provider before changing persistence", async () => {
    queryRaw.mockResolvedValueOnce([
      { providerId: "untrusted", accountId: "subject-1", issuer: null },
    ])
    const { finalizeBetterAuth17Schema } =
      await import("./finalize-better-auth-17-schema")

    await expect(finalizeBetterAuth17Schema()).rejects.toThrow(
      "no trusted mapping for provider(s): untrusted",
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it("rejects issuer/account collisions before installing mappings", async () => {
    env.OKTA_ISSUER = "https://auth.jesusfilm.org/api/auth/"
    queryRaw.mockResolvedValueOnce([
      { providerId: "jfp", accountId: "subject-1", issuer: null },
      { providerId: "okta", accountId: "subject-1", issuer: null },
    ])
    const { finalizeBetterAuth17Schema } =
      await import("./finalize-better-auth-17-schema")

    await expect(finalizeBetterAuth17Schema()).rejects.toThrow(
      "issuer migration collision for providers jfp and okta",
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it("installs trusted mappings before backfill and final constraints", async () => {
    queryRaw
      .mockResolvedValueOnce([
        { providerId: "credential", accountId: "user-1", issuer: null },
        { providerId: "firebase", accountId: "firebase-1", issuer: null },
        {
          providerId: "google",
          accountId: "google-1",
          issuer: "https://accounts.google.com",
        },
      ])
      .mockResolvedValueOnce([{ count: 0n }])
    const { finalizeBetterAuth17Schema } =
      await import("./finalize-better-auth-17-schema")

    await expect(finalizeBetterAuth17Schema()).resolves.toBeUndefined()

    expect(transaction).toHaveBeenCalledOnce()
    expect(executeRaw).toHaveBeenCalled()
    expect(
      executeRaw.mock.calls.some(
        (call) =>
          call[1] === "jfp" &&
          call[2] === "https://auth.jesusfilm.org/api/auth",
      ),
    ).toBe(true)
    expect(
      executeRaw.mock.calls.some(
        (call) => call[1] === "firebase" && call[2] === "local:firebase",
      ),
    ).toBe(true)
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      'CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_account_id_key" ON "account"("issuer", "account_id")',
    )
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      'ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL',
    )
  })
})
