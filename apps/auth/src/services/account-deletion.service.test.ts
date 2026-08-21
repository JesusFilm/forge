import { describe, expect, it, vi } from "vitest"

import {
  AccountDeletionRetryService,
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

const PLAYLIST_DELETION_CONFIG = {
  lifecycle: {
    endpoint: "https://admin.example.org/api/internal/user-playlists/lifecycle",
    secret: "lifecycle-secret-that-is-at-least-32-bytes",
  },
  erasure: {
    endpoint: "https://admin.example.org/api/internal/user-playlists/erasure",
    apiKey: "playlist-erasure-key",
  },
}

const DELETING_EVENT = {
  id: "event-delete-1",
  ownerSubject: "user-1",
  state: "DELETING" as const,
  version: 7n,
  activeLeaseExpiresAt: null,
}

function sagaFetch(fallback?: typeof fetch): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    if (path.endsWith("/lifecycle")) {
      return new Response(JSON.stringify({ applied: true }), { status: 201 })
    }
    if (path.endsWith("/erasure")) {
      return Response.json({
        receiptId: "receipt-1",
        lifecycleVersion: "7",
        idempotencyKey: "account-delete:event-delete-1",
        erasedCount: 0,
      })
    }
    if (fallback) return fallback(url, init)
    throw new Error(`unexpected admin path ${path}`)
  }) as unknown as typeof fetch
}

function buildDeps(overrides: Partial<AccountDeletionDeps> = {}) {
  const log = vi.fn()
  const deps: AccountDeletionDeps = {
    beginDeleting: vi.fn(async () => DELETING_EVENT),
    findAppleAccount: vi.fn(async () => null),
    getAppleConfig: () => null,
    getAdminWatchErasureConfig: () => null,
    getUserPlaylistDeletionConfig: () => PLAYLIST_DELETION_CONFIG,
    fetchImpl: sagaFetch(),
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
      getAdminWatchErasureConfig: () => ERASURE_CONFIG,
      getUserPlaylistDeletionConfig: () => PLAYLIST_DELETION_CONFIG,
      fetchImpl: sagaFetch(erasureFetch),
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

describe("beforeDelete — playlist deletion saga", () => {
  it("durably enters DELETING, projects it, and waits for a matching erasure acknowledgement", async () => {
    const calls: string[] = []
    const beginDeleting = vi.fn(async () => {
      calls.push("begin")
      return DELETING_EVENT
    })
    const fetchImpl = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname
        calls.push(path)
        if (path.endsWith("/lifecycle")) {
          expect(init?.headers).toMatchObject({
            "x-forge-lifecycle-signature": expect.stringMatching(/^v1=/),
          })
          expect(JSON.parse(String(init?.body))).toMatchObject({
            ownerSubject: "user-1",
            state: "DELETING",
            version: "7",
            sourceEventId: "event-delete-1",
          })
          return new Response(JSON.stringify({ applied: true }), {
            status: 201,
          })
        }
        if (path.endsWith("/erasure")) {
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            "Bearer playlist-erasure-key",
          )
          const body = JSON.parse(String(init?.body))
          expect(body).toEqual({
            ownerSubject: "user-1",
            lifecycleVersion: "7",
            idempotencyKey: "account-delete:event-delete-1",
          })
          return Response.json({
            receiptId: "receipt-1",
            lifecycleVersion: "7",
            idempotencyKey: "account-delete:event-delete-1",
            erasedCount: 2,
          })
        }
        throw new Error(`unexpected path ${path}`)
      },
    ) as unknown as typeof fetch
    const { deps } = buildDeps({
      beginDeleting,
      getUserPlaylistDeletionConfig: () => PLAYLIST_DELETION_CONFIG,
      fetchImpl,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(calls).toEqual([
      "begin",
      "/api/internal/user-playlists/lifecycle",
      "/api/internal/user-playlists/erasure",
    ])
  })

  it("keeps Apple revocation ahead of lifecycle projection and every Admin erasure", async () => {
    const calls: string[] = []
    const appleFetch = vi.fn(async () => {
      calls.push("apple")
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const adminFetch = vi.fn(async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname
      calls.push(path)
      return path.endsWith("/erasure")
        ? Response.json({
            receiptId: "receipt-1",
            lifecycleVersion: "7",
            idempotencyKey: "account-delete:event-delete-1",
            erasedCount: 0,
          })
        : new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const { deps } = buildDeps({
      beginDeleting: vi.fn(async () => {
        calls.push("begin")
        return DELETING_EVENT
      }),
      findAppleAccount: vi.fn(async () => ({ refreshToken: "apple-refresh" })),
      getAppleConfig: () => ({ ...APPLE_CONFIG, fetchImpl: appleFetch }),
      getUserPlaylistDeletionConfig: () => PLAYLIST_DELETION_CONFIG,
      getAdminWatchErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: adminFetch,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(calls).toEqual([
      "begin",
      "apple",
      "/api/internal/user-playlists/lifecycle",
      "/api/internal/user-playlists/erasure",
      "/api/internal/watch-progress",
    ])
  })

  it("fails closed when playlist deletion is only partially configured", async () => {
    const { deps } = buildDeps({
      getUserPlaylistDeletionConfig: () => {
        throw new Error("partial user-playlist deletion configuration")
      },
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow(/playlist_deletion_configuration/)
  })

  it("fails closed when the playlist deletion authority is absent", async () => {
    const { deps } = buildDeps({
      getUserPlaylistDeletionConfig: () => null,
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow(/playlist_deletion_configuration_missing/)
  })

  it("rejects a non-matching erasure acknowledgement", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname
      return path.endsWith("/erasure")
        ? Response.json({
            receiptId: "receipt-1",
            lifecycleVersion: "8",
            idempotencyKey: "wrong-key",
            erasedCount: 0,
          })
        : new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const { deps } = buildDeps({
      getUserPlaylistDeletionConfig: () => PLAYLIST_DELETION_CONFIG,
      fetchImpl,
    })

    await expect(
      buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" }),
    ).rejects.toThrow(/playlist_erasure_invalid_ack/)
  })

  it("uses the durable erasure receipt on retry without replaying lifecycle after the projection was removed", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(new URL(String(url)).pathname).toBe(
        "/api/internal/user-playlists/erasure",
      )
      return Response.json({
        receiptId: "receipt-1",
        lifecycleVersion: "7",
        idempotencyKey: "account-delete:event-delete-1",
        erasedCount: 2,
      })
    }) as unknown as typeof fetch
    const { deps } = buildDeps({
      beginDeleting: vi.fn(async () => ({
        ...DELETING_EVENT,
        status: "DELIVERED" as const,
      })),
      fetchImpl,
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
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
      getAdminWatchErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: sagaFetch(erasureFetch),
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
      getAdminWatchErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: sagaFetch(erasureFetch),
    })

    await buildAccountDeletionHooks(deps).beforeDelete({ id: "user-1" })

    expect(body).toEqual({ userId: "user-1", reason: "account-deleted" })
  })

  it("still allows deletion when legacy Watch erasure config is absent", async () => {
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
      getAdminWatchErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: sagaFetch(erasureFetch),
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
      getAdminWatchErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: sagaFetch(erasureFetch),
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
      getAdminWatchErasureConfig: () => ERASURE_CONFIG,
      fetchImpl: sagaFetch(erasureFetch),
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

describe("AccountDeletionRetryService", () => {
  it("finalizes a durable DELETING identity only after every saga acknowledgement", async () => {
    const { deps } = buildDeps()
    const store = {
      listDeleting: vi.fn(async () => [{ id: "user-1", version: 7n }]),
      finalizeDeleting: vi.fn(async () => undefined),
    }
    const retry = new AccountDeletionRetryService(deps, store)

    await expect(retry.retryBatch()).resolves.toEqual({
      attempted: 1,
      finalized: 1,
      failed: 0,
    })
    expect(store.finalizeDeleting).toHaveBeenCalledWith({
      id: "user-1",
      version: 7n,
    })
  })

  it("leaves the identity in DELETING when a side effect fails", async () => {
    const { deps } = buildDeps({
      getUserPlaylistDeletionConfig: () => null,
    })
    const store = {
      listDeleting: vi.fn(async () => [{ id: "user-1", version: 7n }]),
      finalizeDeleting: vi.fn(async () => undefined),
    }
    const retry = new AccountDeletionRetryService(deps, store)

    await expect(retry.retryBatch()).resolves.toEqual({
      attempted: 1,
      finalized: 0,
      failed: 1,
    })
    expect(store.finalizeDeleting).not.toHaveBeenCalled()
  })
})
