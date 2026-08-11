/**
 * Auth session module (KTD9): owns the Better Auth Expo client, the
 * hardware-backed credential storage, the short-lived user JWT, and a
 * subscribable session snapshot readable WITHOUT React — the Apollo auth
 * link and the recorder read it directly (KTD8/KTD11).
 *
 * The framework-agnostic store is a factory with injected deps so every
 * behavior decision is unit-tested with no client or native module; the
 * module-level singleton wires it to the real client lazily (never at
 * module scope — the apolloClient getter convention).
 */

import { env } from "../env"

export const DEFAULT_AUTH_BASE_URL = "https://auth.jesusfilm.org"

/** JWTs are refreshed this long before their exp so a request never rides
 *  a token that expires mid-flight. */
export const JWT_EXPIRY_SKEW_MS = 60_000

export type AuthUser = {
  id: string
  email?: string
  name?: string
  /** Server-clock creation stamps (ISO) for the R15 new-account check
   *  (KTD3); absent when the session payload does not carry them. */
  createdAt?: string
  sessionCreatedAt?: string
}

export type AuthSessionSnapshot =
  | { status: "signedOut"; user: null }
  | { status: "signedIn"; user: AuthUser }

export type AuthSessionDeps = {
  /** Resolves the current session's user, null when signed out. Throws on
   *  network failure (the store keeps its last snapshot — offline must not
   *  sign the user out locally). */
  fetchSession: () => Promise<AuthUser | null>
  /** Mints a fresh short-lived user JWT off the session (auth's /token). */
  fetchToken: () => Promise<string | null>
  /** Revokes this device's session at the identity service (R4). */
  signOutRemote: () => Promise<void>
  now?: () => number
}

/** Decode a JWT's exp (seconds) without verifying — expiry scheduling only. */
export function decodeJwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1]
  if (!payload) return null
  try {
    // atob exists on Hermes and Node 16+ alike.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const decoded = JSON.parse(atob(base64)) as { exp?: unknown }
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null
  } catch {
    return null
  }
}

export function isJwtFresh(token: string, nowMs: number): boolean {
  const expiryMs = decodeJwtExpiryMs(token)
  return expiryMs != null && expiryMs - JWT_EXPIRY_SKEW_MS > nowMs
}

/**
 * The RUM identity payload: the opaque auth subject id ONLY — no email, no
 * display name — so signed-in sessions never export account PII to the
 * telemetry vendor (System-Wide Impact). Null clears the RUM user.
 */
export function rumUserFromSession(
  snapshot: AuthSessionSnapshot,
): { id: string } | null {
  return snapshot.status === "signedIn" ? { id: snapshot.user.id } : null
}

const SIGNED_OUT: AuthSessionSnapshot = { status: "signedOut", user: null }

export type AuthSessionStore = ReturnType<typeof createAuthSessionStore>

export function createAuthSessionStore(deps: AuthSessionDeps) {
  const now = deps.now ?? (() => Date.now())
  let snapshot: AuthSessionSnapshot = SIGNED_OUT
  // The minted JWT is short-lived and held in MEMORY only — never persisted
  // (KTD9); SecureStore holds only the session credential.
  let jwt: string | null = null
  let jwtFetch: Promise<string | null> | null = null
  /** Bumped whenever the signed-in subject changes. A JWT minted under a
   *  previous subject must never be adopted or handed out — it would write
   *  one account's progress as another (R10). */
  let identityEpoch = 0
  const listeners = new Set<() => void>()

  function commit(next: AuthSessionSnapshot) {
    if (next === snapshot) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  /** Drop the cached token AND orphan any in-flight mint. */
  function invalidateJwt() {
    jwt = null
    jwtFetch = null
    identityEpoch += 1
  }

  /** The one commit policy behind refresh() and readSession(). */
  function commitSessionRead(user: AuthUser | null): AuthUser | null {
    if (user == null) {
      invalidateJwt()
      commit(SIGNED_OUT)
    } else if (snapshot.status !== "signedIn" || snapshot.user.id !== user.id) {
      // A different subject — the cached token belongs to the old one.
      invalidateJwt()
      commit({ status: "signedIn", user })
    } else if (
      snapshot.user.email !== user.email ||
      snapshot.user.name !== user.name ||
      snapshot.user.createdAt !== user.createdAt ||
      snapshot.user.sessionCreatedAt !== user.sessionCreatedAt
    ) {
      // Same subject, edited profile or a new session: token still valid.
      commit({ status: "signedIn", user })
    }
    return user
  }

  return {
    getSnapshot(): AuthSessionSnapshot {
      return snapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * Re-read the session. A definitive null signs out locally; a thrown
     * fetch (offline, corrupt storage surfaced as a throw) keeps the last
     * snapshot — degrading, never throwing.
     */
    async refresh(): Promise<void> {
      try {
        commitSessionRead(await deps.fetchSession())
      } catch {
        // Keep the current snapshot; the next refresh self-heals.
      }
    },

    /**
     * Outcome-reporting read (KTD6): commits exactly like refresh(), but a
     * thrown fetch PROPAGATES so the hosted sign-in can classify it.
     */
    async readSession(): Promise<AuthUser | null> {
      return commitSessionRead(await deps.fetchSession())
    },

    /** Commit a completed sign-in immediately (U6 calls after the flow). */
    applySignedIn(user: AuthUser) {
      invalidateJwt()
      commit({ status: "signedIn", user })
    },

    /**
     * The short-lived user JWT for progress operations, refreshed when
     * missing or within the expiry skew. Null when signed out or when the
     * mint fails (callers fail open, R11). Concurrent callers share one
     * in-flight fetch.
     */
    async getFreshJwt(): Promise<string | null> {
      if (snapshot.status !== "signedIn") return null
      const epoch = identityEpoch
      if (jwt && isJwtFresh(jwt, now())) return jwt
      if (!jwtFetch) {
        const flight = deps
          .fetchToken()
          .then((token) => {
            if (identityEpoch !== epoch) return null
            jwt = token
            return token
          })
          .catch(() => null)
        jwtFetch = flight
        void flight.then(
          () => {
            if (jwtFetch === flight) jwtFetch = null
          },
          () => {
            if (jwtFetch === flight) jwtFetch = null
          },
        )
      }
      // Re-check after the await, not just inside the mint: the account can
      // change while a caller waits on a flight that started under the old one.
      const token = await jwtFetch
      return identityEpoch === epoch ? token : null
    },

    /**
     * Sign out: revoke this device's session at auth (R4) best-effort,
     * then ALWAYS clear local state — a network failure must not strand
     * the user signed in.
     */
    async signOut(): Promise<void> {
      try {
        await deps.signOutRemote()
      } catch {
        // Local clear proceeds regardless.
      }
      invalidateJwt()
      commit(SIGNED_OUT)
    },
  }
}

// ---------------------------------------------------------------------------
// Real wiring — lazy singletons (never module-scope client construction).
// ---------------------------------------------------------------------------

export function getAuthBaseUrl(): string {
  return env.EXPO_PUBLIC_AUTH_BASE_URL ?? DEFAULT_AUTH_BASE_URL
}

type SecureStoreLike = {
  getItem: (key: string, options?: object) => string | null
  setItem: (key: string, value: string, options?: object) => void
}

/**
 * SecureStore adapter with this-device-only accessibility (R14): the
 * keychain attribute keeps credentials out of device backups on iOS;
 * Android's exclusion is app.json's allowBackup=false. Reads degrade to
 * null (corrupt storage means signed out, never a crash).
 */
export function createSecureStorageAdapter(
  store: SecureStoreLike,
  options: object,
) {
  return {
    getItem: (key: string): string | null => {
      try {
        return store.getItem(key, options)
      } catch {
        return null
      }
    },
    setItem: (key: string, value: string): void => {
      try {
        store.setItem(key, value, options)
      } catch {
        // A failed persist surfaces as signed-out on next launch.
      }
    },
  }
}

type BetterAuthExpoClient = {
  /** better-fetch returns a {data,error} envelope and does NOT throw on a
   *  non-2xx, so `error` is the only way to tell an outage from a sign-out. */
  getSession: (options?: { fetchOptions?: { timeout?: number } }) => Promise<{
    data: {
      user: {
        id: string
        email?: string | null
        name?: string | null
        createdAt?: string | Date | null
      }
      session?: { createdAt?: string | Date | null } | null
    } | null
    error?: { status?: number | null; message?: string | null } | null
  }>
  signOut: (options?: {
    fetchOptions?: { timeout?: number }
  }) => Promise<unknown>
  deleteUser: () => Promise<{
    data?: unknown
    error?: { code?: string | null; message?: string | null } | null
  }>
  signIn: {
    /** Hosted-page sign-in: the jfp self-RP flow (browser sheet + expo
     *  cookie handoff land the session in SecureStore). */
    oauth2: (options: { providerId: string; callbackURL: string }) => Promise<{
      data: unknown
      error?: { message?: string } | null
    }>
  }
  $fetch: (
    path: string,
    options?: object,
  ) => Promise<{ data?: unknown; error?: unknown }>
}

let client: BetterAuthExpoClient | null = null

/* eslint-disable @typescript-eslint/no-require-imports */
export function getAuthClient(): BetterAuthExpoClient {
  if (!client) {
    // require() keeps the native-adjacent import graph out of jest and out
    // of module-init (the root-layout require pattern).
    const { createAuthClient } =
      require("better-auth/client") as typeof import("better-auth/client")
    const { genericOAuthClient } =
      require("better-auth/client/plugins") as typeof import("better-auth/client/plugins")
    const { expoClient } =
      require("@better-auth/expo/client") as typeof import("@better-auth/expo/client")
    const SecureStore =
      require("expo-secure-store") as typeof import("expo-secure-store")
    client = createAuthClient({
      baseURL: getAuthBaseUrl(),
      plugins: [
        expoClient({
          scheme: "forgemobile",
          storagePrefix: "forge-watch",
          storage: createSecureStorageAdapter(SecureStore, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
        }),
        // signIn.oauth2 for the hosted-page sign-in (jfp self-RP).
        genericOAuthClient(),
      ],
    }) as unknown as BetterAuthExpoClient
  }
  return client
}
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Read a session response. An error envelope is an OUTAGE, not a sign-out —
 * better-fetch returns `{data:null,error}` on a 5xx without throwing, and
 * treating that as signed-out wipes the store, snapshot, and unsent queue.
 * Throwing routes it to refresh()'s degrade path instead.
 */
/** Carries the upstream status as a field so callers never parse a message. */
export class SessionFetchError extends Error {
  readonly status: number | null
  constructor(status: number | null) {
    super("session_fetch_failed")
    this.name = "SessionFetchError"
    this.status = status
  }
}

/** ISO-normalize a wire timestamp; an invalid Date degrades to undefined. */
function toIsoStamp(
  value: string | Date | null | undefined,
): string | undefined {
  if (value == null) return undefined
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : undefined
  }
  return value
}

export function userFromSessionResult(result: {
  data?: {
    user?: {
      id: string
      email?: string | null
      name?: string | null
      createdAt?: string | Date | null
    } | null
    session?: { createdAt?: string | Date | null } | null
  } | null
  error?: { status?: number | null; message?: string | null } | null
}): AuthUser | null {
  if (result.error) {
    throw new SessionFetchError(result.error.status ?? null)
  }
  const user = result.data?.user
  if (!user) return null
  return {
    id: user.id,
    email: user.email ?? undefined,
    name: user.name ?? undefined,
    createdAt: toIsoStamp(user.createdAt),
    sessionCreatedAt: toIsoStamp(result.data?.session?.createdAt),
  }
}

let store: AuthSessionStore | null = null

/**
 * The auth client arms an abort only when a timeout is passed, and the JWT
 * link holds the whole progress operation until the mint settles — so a hung
 * connection would otherwise stall every read and write with no ceiling.
 * Shorter than Apollo's 15s budget, which only starts once the JWT resolves.
 *
 * better-fetch's own `timeout` (setTimeout + AbortController) rather than
 * `AbortSignal.timeout`, which Hermes does not reliably provide.
 */
const AUTH_FETCH_TIMEOUT_MS = 5000

function authFetchOptions() {
  return { fetchOptions: { timeout: AUTH_FETCH_TIMEOUT_MS } }
}

/** The app-wide session store, wired to the real Better Auth client. */
export function getAuthSession(): AuthSessionStore {
  if (!store) {
    store = createAuthSessionStore({
      fetchSession: async () =>
        userFromSessionResult(
          await getAuthClient().getSession(authFetchOptions()),
        ),
      fetchToken: async () => {
        const result = await getAuthClient().$fetch("/token", {
          method: "GET",
          ...authFetchOptions(),
        })
        const token = (result.data as { token?: unknown } | undefined)?.token
        return typeof token === "string" && token.length > 0 ? token : null
      },
      signOutRemote: async () => {
        await getAuthClient().signOut(authFetchOptions())
      },
    })
  }
  return store
}
