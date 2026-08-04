import { describe, expect, it, vi } from "vitest"

import {
  buildAccountDeletionHooks,
  type AccountDeletionDeps,
} from "./account-deletion.service"

const APPLE_CONFIG = {
  bundleId: "org.jesusfilm.forgewatch",
  clientSecret: "apple-native-secret",
}

function buildDeps(overrides: Partial<AccountDeletionDeps> = {}) {
  const log = vi.fn()
  const deps: AccountDeletionDeps = {
    findAppleAccount: vi.fn(async () => null),
    getAppleConfig: () => null,
    getAdminErasureConfig: () => null,
    log,
    ...overrides,
  }
  return { deps, log }
}

describe("beforeDelete", () => {
  it("revokes the stored Apple refresh token when config and token exist", async () => {
    const revokeFetch = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      findAppleAccount: vi.fn(async () => ({ refreshToken: "apple-refresh" })),
      getAppleConfig: () => ({ ...APPLE_CONFIG, fetchImpl: revokeFetch }),
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(revokeFetch).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it("logs and continues when Apple revocation fails, so deletion is never blocked", async () => {
    const revokeFetch = vi.fn(
      async () => new Response(null, { status: 400 }),
    ) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      findAppleAccount: vi.fn(async () => ({ refreshToken: "apple-refresh" })),
      getAppleConfig: () => ({ ...APPLE_CONFIG, fetchImpl: revokeFetch }),
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("account_deletion_apple_revocation_failed"),
    )
  })

  it("skips revocation quietly when there is no Apple account or token", async () => {
    const { deps, log } = buildDeps({
      findAppleAccount: vi.fn(async () => ({ refreshToken: null })),
      getAppleConfig: () => APPLE_CONFIG,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(log).not.toHaveBeenCalled()
  })

  it("propagates account-row read failures so deletion aborts with the account intact", async () => {
    const { deps } = buildDeps({
      findAppleAccount: vi.fn(async () => {
        throw new Error("db unavailable")
      }),
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow("db unavailable")
  })
})

describe("afterDelete", () => {
  it("erases admin-side watch data through the internal route", async () => {
    const erasureFetch = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://admin.example.org/api/internal/watch-progress",
        )
        expect(init?.method).toBe("DELETE")
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer erasure-key",
        )
        expect(JSON.parse(String(init?.body))).toEqual({ userId: "user-1" })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    ) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      getAdminErasureConfig: () => ({
        baseUrl: "https://admin.example.org",
        apiKey: "erasure-key",
      }),
      fetchImpl: erasureFetch,
    })

    await buildAccountDeletionHooks(deps).afterDelete({ id: "user-1" })

    expect(erasureFetch).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it("degrades to no admin call when erasure env config is absent", async () => {
    const { deps, log } = buildDeps()

    await buildAccountDeletionHooks(deps).afterDelete({ id: "user-1" })

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("account_deletion_admin_erasure_skipped"),
    )
  })

  it("logs loudly but does not throw when the erasure call fails", async () => {
    const erasureFetch = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      getAdminErasureConfig: () => ({
        baseUrl: "https://admin.example.org",
        apiKey: "erasure-key",
      }),
      fetchImpl: erasureFetch,
    })

    await expect(
      buildAccountDeletionHooks(deps).afterDelete({ id: "user-1" }),
    ).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("account_deletion_admin_erasure_failed"),
    )
  })

  it("classifies network failure on the erasure call without throwing", async () => {
    const erasureFetch = vi.fn(async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      getAdminErasureConfig: () => ({
        baseUrl: "https://admin.example.org",
        apiKey: "erasure-key",
      }),
      fetchImpl: erasureFetch,
    })

    await expect(
      buildAccountDeletionHooks(deps).afterDelete({ id: "user-1" }),
    ).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("reason=network_error"),
    )
  })
})
