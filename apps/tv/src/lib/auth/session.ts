// The signed-in session: one access token, refreshed on demand, shared by every
// caller (feat-322 U4.4).
//
// A TV fans out several GraphQL calls the moment a screen mounts. If each one
// noticed the expired token independently they would all refresh at once, and
// with refresh-token rotation the first response invalidates the token the
// other four are still using — the viewer gets signed out by their own app.
// Hence the single-flight below.

import {
  getDeviceGrantConfig,
  refreshAccessToken,
  revokeToken,
  type DeviceGrantConfig,
  type DeviceTokens,
} from "./deviceGrantClient"
import {
  clearSession,
  loadSession,
  needsRefresh,
  saveSession,
  type StoredSession,
} from "./tokenStore"

export type SessionState =
  | { kind: "signed_out" }
  | { kind: "signed_in"; accessToken: string }

type Listener = (state: SessionState) => void

const listeners = new Set<Listener>()
let cached: StoredSession | null | undefined

/**
 * Bumped whenever the identity behind the session changes (sign in, sign out).
 *
 * A refresh started before a sign-out can still be in flight when it lands. Its
 * response is a perfectly valid token for the viewer who just left — writing it
 * would sign them back in on a TV someone else is now holding. The epoch lets
 * the refresh notice that the world moved and discard its own result.
 */
let sessionEpoch = 0

function notify(): void {
  const state = currentState()
  for (const listener of listeners) {
    try {
      listener(state)
    } catch {
      // A misbehaving subscriber must not stop the others from hearing.
    }
  }
}

function currentState(): SessionState {
  return cached?.accessToken != null
    ? { kind: "signed_in", accessToken: cached.accessToken }
    : { kind: "signed_out" }
}

export function subscribeToSession(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Read the persisted session into memory. Safe to call repeatedly. */
export async function hydrateSession(): Promise<SessionState> {
  cached = await loadSession()
  notify()
  return currentState()
}

/** Record a session freshly granted by the device flow. */
export async function adoptTokens(tokens: DeviceTokens): Promise<void> {
  sessionEpoch += 1
  inFlight = null
  await saveSession(tokens)
  cached = await loadSession()
  notify()
}

// ── Single-flight refresh ───────────────────────────────────────────────────

/**
 * The in-progress refresh, if any. Joiners await this promise rather than
 * starting their own.
 */
let inFlight: Promise<StoredSession | null> | null = null

/** Test seam. Production has exactly one session, so module state is right. */
export function __resetSessionForTests(): void {
  cached = undefined
  inFlight = null
  sessionEpoch = 0
  listeners.clear()
}

async function performRefresh(
  config: DeviceGrantConfig,
  session: StoredSession,
): Promise<StoredSession | null> {
  if (session.refreshToken == null) return session

  const epoch = sessionEpoch
  const outcome = await refreshAccessToken(config, session.refreshToken)

  // The viewer signed out (or a different one signed in) while this was in the
  // air. The token is valid but belongs to a session that no longer exists;
  // persisting it would sign the previous viewer back in on a shared TV.
  if (epoch !== sessionEpoch) return null

  if (outcome.kind === "refreshed") {
    // Write BEFORE anything drops the old token. A crash between the server
    // rotating the refresh token and this device persisting it strands the TV
    // holding a credential the server has already retired.
    await saveSession({
      ...outcome.tokens,
      refreshToken: outcome.tokens.refreshToken ?? session.refreshToken,
    })
    cached = await loadSession()
    notify()
    return cached
  }

  if (outcome.kind === "revoked") {
    // The server has disowned the grant. Nothing local can rescue it.
    await clearSession()
    cached = null
    notify()
    return null
  }

  // Retryable: keep the session exactly as it was. Signing the viewer out over
  // a dropped connection is the failure this branch exists to prevent — the
  // current access token may even still be valid.
  return session
}

/**
 * Start a refresh and register its release.
 *
 * The release is CALLER-side, not a `finally` inside `performRefresh`: a
 * body-internal clear races the `inFlight` assignment and loses whenever the
 * body settles synchronously, clearing a slot that is then immediately set to
 * an already-settled promise — every later caller joins a dead flight.
 *
 * It is also identity-checked (a slower predecessor must not clear its
 * successor's slot) and registered on BOTH settlement paths via
 * `then(release, release)`. `finally` would re-throw the rejection into an
 * unhandled rejection, which in dev escalates to an all-native RCTFatal.
 */
function startRefresh(
  config: DeviceGrantConfig,
  session: StoredSession,
): Promise<StoredSession | null> {
  const flight = performRefresh(config, session)
  inFlight = flight
  const release = (): void => {
    if (inFlight === flight) inFlight = null
  }
  void flight.then(release, release)
  return flight
}

/**
 * The access token to send with the next authenticated request, refreshing it
 * first if it is close enough to expiry to lose the race.
 *
 * Returns null when signed out — callers treat that as "send no bearer", never
 * as an error.
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (cached === undefined) await hydrateSession()

  const joined = inFlight
  if (joined != null) {
    // Joiner-side catch: a rejected flight must not propagate into every
    // caller that merely happened to arrive during it.
    try {
      return (await joined)?.accessToken ?? null
    } catch {
      return cached?.accessToken ?? null
    }
  }

  const session = cached
  if (session == null) return null
  if (!needsRefresh(session, Date.now())) return session.accessToken

  try {
    return (
      (await startRefresh(getDeviceGrantConfig(), session))?.accessToken ?? null
    )
  } catch {
    // performRefresh handles OAuth outcomes as data; reaching here means
    // storage itself failed. The existing token is the best available answer.
    return cached?.accessToken ?? null
  }
}

/**
 * Sign out.
 *
 * Local state is cleared unconditionally and FIRST in effect — revocation is
 * best-effort, so a viewer on a dead connection still signs out of the device
 * in front of them, which is the whole point of the button.
 */
export async function signOut(): Promise<void> {
  const session = cached ?? (await loadSession())
  sessionEpoch += 1
  cached = null
  inFlight = null
  await clearSession()
  notify()

  const token = session?.refreshToken ?? session?.accessToken
  if (token == null) return
  try {
    await revokeToken(getDeviceGrantConfig(), token)
  } catch {
    // `revokeToken` already swallows its own failures; this guards the case
    // where it cannot even be reached. Sign-out has already happened locally
    // and must not be reported as failed.
  }
}
