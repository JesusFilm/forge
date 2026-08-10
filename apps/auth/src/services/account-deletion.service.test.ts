import { describe, expect, it, vi } from "vitest"

import {
  buildAccountDeletionHooks,
  type AccountDeletionDeps,
} from "./account-deletion.service"

const APPLE_CONFIG = {
  bundleId: "org.jesusfilm.forgewatch",
  clientSecret: "apple-native-secret",
}

const ERASURE_CONFIG = {
  baseUrl: "https://admin.example.org",
  apiKey: "erasure-key",
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

function ok() {
  return vi.fn(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch
}

describe("beforeDelete — Apple revocation", () => {
  it("revokes the stored Apple refresh token when config and token exist", async () => {
    const revokeFetch = ok()
    const { deps, log } = buildDeps({
      findAppleAccount: vi.fn(async () => ({ refreshToken: "apple-refresh" })),
      getAppleConfig: () => ({ ...APPLE_CONFIG, fetchImpl: revokeFetch }),
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(revokeFetch).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining("apple_revocation_failed"),
    )
  })

  it("aborts the deletion when Apple revocation fails (strict)", async () => {
    // Completing here would delete the account while leaving live the Apple
    // grant Apple's own deletion guidance requires revoking — invisible to
    // the user and unrecoverable by them.
    const revokeFetch = vi.fn(
      async () => new Response(null, { status: 400 }),
    ) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      findAppleAccount: vi.fn(async () => ({ refreshToken: "apple-refresh" })),
      getAppleConfig: () => ({ ...APPLE_CONFIG, fetchImpl: revokeFetch }),
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow(/apple_revocation_failed/)

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("account_deletion_apple_revocation_failed"),
    )
  })

  it("does not erase watch data when Apple revocation aborted first", async () => {
    // Ordering is the point: erasing before an abort loses history on a
    // deletion that did not happen.
    const revokeFetch = vi.fn(
      async () => new Response(null, { status: 400 }),
    ) as unknown as typeof fetch
    const erasureFetch = ok()

    const { deps } = buildDeps({
      findAppleAccount: vi.fn(async () => ({ refreshToken: "apple-refresh" })),
      getAppleConfig: () => ({ ...APPLE_CONFIG, fetchImpl: revokeFetch }),
      getAdminErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: erasureFetch,
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow()

    expect(erasureFetch).not.toHaveBeenCalled()
  })

  it("skips revocation quietly when there is no Apple account or token", async () => {
    const { deps, log } = buildDeps({
      findAppleAccount: vi.fn(async () => ({ refreshToken: null })),
      getAppleConfig: () => APPLE_CONFIG,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining("apple_revocation_failed"),
    )
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

describe("beforeDelete — admin watch-data erasure", () => {
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
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    ) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      getAdminErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: erasureFetch,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(erasureFetch).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it("names itself as the caller, since apps/web clears history the same way", async () => {
    // Both callers send {userId} to this route, so admin cannot otherwise
    // tell an account deletion from a user clearing their own history.
    let body: unknown
    const erasureFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body))
        return new Response(null, { status: 200 })
      },
    ) as unknown as typeof fetch

    const { deps } = buildDeps({
      getAdminErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: erasureFetch,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(body).toEqual({ userId: "user-1", reason: "account-deleted" })
  })

  it("still allows deletion when erasure env config is absent", async () => {
    // The vars are `.optional()`, so an environment that never provisioned
    // them must not lose the ability to delete accounts.
    const { deps, log } = buildDeps()

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("account_deletion_admin_erasure_skipped"),
    )
  })

  it("aborts the deletion when a configured admin rejects the erasure (strict)", async () => {
    // Completing here would orphan watch history under a user id that no
    // longer exists in auth — retained data after a deletion request.
    const erasureFetch = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      getAdminErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: erasureFetch,
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow(/admin_erasure_rejected:500/)

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("account_deletion_admin_erasure_failed"),
    )
  })

  it("aborts the deletion when admin is unreachable (strict)", async () => {
    const erasureFetch = vi.fn(async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch

    const { deps, log } = buildDeps({
      getAdminErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: erasureFetch,
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow(/admin_erasure_unreachable/)

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("reason=network_error"),
    )
  })

  it("bounds the erasure call so a hung admin cannot wedge deletion", async () => {
    let signal: AbortSignal | null | undefined
    const erasureFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal
        return new Response(null, { status: 200 })
      },
    ) as unknown as typeof fetch

    const { deps } = buildDeps({
      getAdminErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: erasureFetch,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(signal).toBeInstanceOf(AbortSignal)
  })
})

describe("hook surface", () => {
  it("exposes no afterDelete — a post-delete failure cannot abort anything", async () => {
    const hooks = buildAccountDeletionHooks(buildDeps().deps) as Record<
      string,
      unknown
    >

    expect(hooks.afterDelete).toBeUndefined()
    expect(typeof hooks.beforeDelete).toBe("function")
  })
})
