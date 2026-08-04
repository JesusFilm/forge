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
  const listeners = new Set<() => void>()

  function commit(next: AuthSessionSnapshot) {
    if (next === snapshot) return
    snapshot = next
    for (const listener of listeners) listener()
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
        const user = await deps.fetchSession()
        if (user == null) {
          jwt = null
          commit(SIGNED_OUT)
        } else if (
          snapshot.status !== "signedIn" ||
          snapshot.user.id !== user.id ||
          snapshot.user.email !== user.email ||
          snapshot.user.name !== user.name
        ) {
          commit({ status: "signedIn", user })
        }
      } catch {
        // Keep the current snapshot; the next refresh self-heals.
      }
    },

    /** Commit a completed sign-in immediately (U6 calls after the flow). */
    applySignedIn(user: AuthUser) {
      jwt = null
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
      if (jwt && isJwtFresh(jwt, now())) return jwt
      if (!jwtFetch) {
        const flight = deps
          .fetchToken()
          .then((token) => {
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
      return jwtFetch
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
      jwt = null
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

export type SignedInUserPayload = {
  id: string
  email?: string | null
  name?: string | null
  createdAt?: string | Date | null
}

type BetterAuthExpoClient = {
  getSession: () => Promise<{
    data: {
      user: { id: string; email?: string | null; name?: string | null }
    } | null
  }>
  signOut: () => Promise<unknown>
  deleteUser: () => Promise<{
    data?: unknown
    error?: { code?: string | null; message?: string | null } | null
  }>
  signIn: {
    /** Native sheets: verify the provider identity token server-side. */
    social: (options: {
      provider: "apple" | "google"
      idToken: { token: string }
    }) => Promise<{
      data: { user: SignedInUserPayload } | null
      error?: { message?: string } | null
    }>
    /** Hosted-page fallback: the jfp self-RP flow (browser sheet + expo
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
        // signIn.oauth2 for the hosted-page fallback (jfp self-RP).
        genericOAuthClient(),
      ],
    }) as unknown as BetterAuthExpoClient
  }
  return client
}
/* eslint-enable @typescript-eslint/no-require-imports */

let store: AuthSessionStore | null = null

/** The app-wide session store, wired to the real Better Auth client. */
export function getAuthSession(): AuthSessionStore {
  if (!store) {
    store = createAuthSessionStore({
      fetchSession: async () => {
        const result = await getAuthClient().getSession()
        const user = result.data?.user
        if (!user) return null
        return {
          id: user.id,
          email: user.email ?? undefined,
          name: user.name ?? undefined,
        }
      },
      fetchToken: async () => {
        const result = await getAuthClient().$fetch("/token", {
          method: "GET",
        })
        const token = (result.data as { token?: unknown } | undefined)?.token
        return typeof token === "string" && token.length > 0 ? token : null
      },
      signOutRemote: async () => {
        await getAuthClient().signOut()
      },
    })
  }
  return store
}
