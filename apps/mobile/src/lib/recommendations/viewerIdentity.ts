/**
 * The installation's anonymous recommendation viewer (feat-516). One record in
 * secure storage holds the server-minted viewer handle and the operational
 * session token. The store bootstraps lazily, shares one flight between
 * concurrent callers, re-bootstraps once when Admin rejects the handle, and
 * never rotates the session while a playback holds it.
 *
 * Framework-agnostic factory with injected deps, like `authSession.ts`: every
 * decision is unit-tested with no client, no native module and a fake clock.
 */
import {
  RecommendationClientError,
  toRecommendationClientError,
} from "./errors"

export const RECOMMENDATION_VIEWER_STORAGE_KEY =
  "forge-watch.recommendation-viewer.v1"

/** Admin mints 32 random bytes as base64url: exactly 43 characters. */
export const VIEWER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** The contract: mint a new session after this much inactivity. */
export const SESSION_INACTIVITY_ROTATION_MS = 24 * 60 * 60 * 1_000

/** A failed or rejected bootstrap is not retried inside this window. */
export const BOOTSTRAP_COOLDOWN_MS = 60_000

/** A suspect handle whose `status` check failed transiently is re-verified
 *  no sooner than this; meanwhile it keeps serving. */
export const VERIFY_RETRY_BACKOFF_MS = 60_000

/** A handle rejected this soon after its bootstrap is treated as a failure. */
export const FRESH_HANDLE_WINDOW_MS = 5 * 60 * 1_000

/** `touch()` persists `lastActiveAt` at most this often. */
export const LAST_ACTIVE_PERSIST_INTERVAL_MS = 5 * 60 * 1_000

export type RecommendationViewerRecord = {
  version: 1
  viewerToken: string
  viewerExpiresAt: string
  sessionToken: string
  bootstrappedAt: string
  lastActiveAt: string
  personalization: boolean
}

export type RecommendationIdentity = {
  viewerToken: string
  sessionToken: string
}

export type ViewerAction = "status" | "reset" | "withdraw" | "grant" | "delete"

export type ViewerStatus = { state: string; personalization: boolean }

export type ViewerIdentityResult =
  | {
      kind: "ready"
      identity: RecommendationIdentity
      personalization: boolean
    }
  | { kind: "disabled" }
  | { kind: "unprovisioned" }
  | {
      kind: "unavailable"
      reason: "bootstrap_failed" | "bootstrap_cooldown" | "rate_limited"
    }

export type SecureStorageLike = {
  getItemAsync: (key: string) => Promise<string | null>
  setItemAsync: (key: string, value: string) => Promise<void>
  deleteItemAsync: (key: string) => Promise<void>
}

export type ViewerIdentityDeps = {
  isEnabled: () => boolean
  /** False when no fleet bearer is configured: nothing is sent at all. */
  hasBearer: () => boolean
  storage: SecureStorageLike
  bootstrap: () => Promise<{
    viewerToken: string
    sessionToken: string
    expiresAt: string
    personalization: boolean
  }>
  updateViewer: (
    identity: RecommendationIdentity,
    action: ViewerAction,
  ) => Promise<ViewerStatus>
  /** A cryptographic 43-char token, or null when the runtime has no source. */
  randomToken: () => string | null
  now?: () => number
  report?: (
    event: string,
    context?: Record<string, string | number | boolean>,
  ) => void
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

/** A stored record is trusted only when every field has the expected shape. */
export function parseViewerRecord(
  raw: string | null,
): RecommendationViewerRecord | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (
      value == null ||
      typeof value !== "object" ||
      value.version !== 1 ||
      typeof value.viewerToken !== "string" ||
      !VIEWER_TOKEN_PATTERN.test(value.viewerToken) ||
      typeof value.sessionToken !== "string" ||
      !VIEWER_TOKEN_PATTERN.test(value.sessionToken) ||
      !isIsoDate(value.viewerExpiresAt) ||
      !isIsoDate(value.bootstrappedAt) ||
      !isIsoDate(value.lastActiveAt) ||
      typeof value.personalization !== "boolean"
    ) {
      return null
    }
    return {
      version: 1,
      viewerToken: value.viewerToken,
      viewerExpiresAt: value.viewerExpiresAt,
      sessionToken: value.sessionToken,
      bootstrappedAt: value.bootstrappedAt,
      lastActiveAt: value.lastActiveAt,
      personalization: value.personalization,
    }
  } catch {
    return null
  }
}

export type ViewerIdentityStore = ReturnType<typeof createViewerIdentityStore>

export function createViewerIdentityStore(deps: ViewerIdentityDeps) {
  const now = deps.now ?? (() => Date.now())
  const report = deps.report ?? (() => undefined)
  const iso = (ms: number) => new Date(ms).toISOString()

  let record: RecommendationViewerRecord | null = null
  let loaded = false
  let inFlight: Promise<ViewerIdentityResult> | null = null
  let holdCount = 0
  let cooldownUntil: number | null = null
  let lastPersistedActiveAt: number | null = null
  /** Admin answered UNAUTHENTICATED with this handle; verify before use. */
  let suspect = false
  /** A transient `status` failure defers the next verification until then. */
  let verifyRetryAfter: number | null = null
  let rotationSourceReported = false
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    try {
      record = parseViewerRecord(
        await deps.storage.getItemAsync(RECOMMENDATION_VIEWER_STORAGE_KEY),
      )
    } catch {
      record = null
      report("storage_read_failed")
    }
  }

  async function persist(next: RecommendationViewerRecord): Promise<void> {
    record = next
    try {
      await deps.storage.setItemAsync(
        RECOMMENDATION_VIEWER_STORAGE_KEY,
        JSON.stringify(next),
      )
    } catch {
      // The in-memory record still serves this launch; the next launch
      // bootstraps a fresh handle, which loses only this install's history.
      report("storage_write_failed")
    }
  }

  async function clear(): Promise<void> {
    record = null
    try {
      await deps.storage.deleteItemAsync(RECOMMENDATION_VIEWER_STORAGE_KEY)
    } catch {
      report("storage_delete_failed")
    }
  }

  const ready = (
    current: RecommendationViewerRecord,
  ): ViewerIdentityResult => ({
    kind: "ready",
    identity: {
      viewerToken: current.viewerToken,
      sessionToken: current.sessionToken,
    },
    personalization: current.personalization,
  })

  async function bootstrap(): Promise<ViewerIdentityResult> {
    const at = now()
    if (cooldownUntil != null && at < cooldownUntil) {
      return { kind: "unavailable", reason: "bootstrap_cooldown" }
    }
    try {
      const minted = await deps.bootstrap()
      if (
        !VIEWER_TOKEN_PATTERN.test(minted.viewerToken) ||
        !VIEWER_TOKEN_PATTERN.test(minted.sessionToken) ||
        !isIsoDate(minted.expiresAt)
      ) {
        throw new RecommendationClientError("BAD_USER_INPUT")
      }
      await persist({
        version: 1,
        viewerToken: minted.viewerToken,
        viewerExpiresAt: minted.expiresAt,
        sessionToken: minted.sessionToken,
        bootstrappedAt: iso(at),
        lastActiveAt: iso(at),
        personalization: minted.personalization,
      })
      lastPersistedActiveAt = at
      cooldownUntil = null
      suspect = false
      report("bootstrapped")
      return ready(record!)
    } catch (error) {
      const failure = toRecommendationClientError(error)
      cooldownUntil = at + BOOTSTRAP_COOLDOWN_MS
      if (failure.code === "RATE_LIMITED") {
        // The bucket, not the bearer, refused: wait the window, no failure.
        report("bootstrap_rate_limited")
        return { kind: "unavailable", reason: "rate_limited" }
      }
      report("bootstrap_failed", { rec_code: failure.code })
      return { kind: "unavailable", reason: "bootstrap_failed" }
    }
  }

  async function rotateIfIdle(
    current: RecommendationViewerRecord,
  ): Promise<ViewerIdentityResult | null> {
    const at = now()
    if (holdCount > 0) return null
    if (at - Date.parse(current.lastActiveAt) <= SESSION_INACTIVITY_ROTATION_MS)
      return null
    const candidate = deps.randomToken()
    if (candidate == null) {
      // Once per store, so "no idle installs" and "no random source" differ
      // in the dashboard.
      if (!rotationSourceReported) {
        rotationSourceReported = true
        report("session_rotation_unavailable")
      }
      return null
    }
    try {
      // `status` links the new session to the installation before any
      // delivery or playback uses it; only a success commits the rotation.
      const status = await deps.updateViewer(
        { viewerToken: current.viewerToken, sessionToken: candidate },
        "status",
      )
      await persist({
        ...current,
        sessionToken: candidate,
        lastActiveAt: iso(at),
        personalization: status.personalization,
      })
      lastPersistedActiveAt = at
      report("session_rotated")
      return null
    } catch (error) {
      const failure = toRecommendationClientError(error)
      if (failure.code === "UNAUTHENTICATED") {
        report("handle_rejected", { rec_during: "rotation" })
        suspect = true
        return verifySuspect(current)
      }
      // The old session stays valid; Admin links it again on the next call.
      report("session_rotate_failed", { rec_code: failure.code })
      return null
    }
  }

  /**
   * UNAUTHENTICATED cannot tell a dead handle from a broken app bearer, and
   * the stored viewer is this install's whole history. So: re-verify the
   * stored handle with `status`; only when that is rejected AND a bootstrap
   * under the same bearer succeeds is the handle replaced. A rejected
   * bootstrap means the bearer is the problem, and the viewer is kept.
   */
  async function verifySuspect(
    current: RecommendationViewerRecord,
  ): Promise<ViewerIdentityResult> {
    const at = now()
    if (cooldownUntil != null && at < cooldownUntil) {
      return { kind: "unavailable", reason: "bootstrap_cooldown" }
    }
    try {
      const status = await deps.updateViewer(
        {
          viewerToken: current.viewerToken,
          sessionToken: current.sessionToken,
        },
        "status",
      )
      suspect = false
      verifyRetryAfter = null
      await persist({ ...current, personalization: status.personalization })
      report("handle_verified")
      return ready(record ?? current)
    } catch (error) {
      const failure = toRecommendationClientError(error)
      if (failure.code !== "UNAUTHENTICATED") {
        // Transient: the handle is neither proven nor disproven; keep using
        // it, and do not ask again on every read while Admin is degraded.
        verifyRetryAfter = at + VERIFY_RETRY_BACKOFF_MS
        report("verify_deferred", { rec_code: failure.code })
        return ready(current)
      }
    }
    const replaced = await bootstrap()
    if (replaced.kind === "ready") {
      report("handle_replaced")
      notify()
    }
    // A failed bootstrap keeps `record` (bootstrap persists only on success)
    // and arms the cooldown; the bearer, not the handle, is the fault.
    return replaced
  }

  async function resolve(): Promise<ViewerIdentityResult> {
    if (!deps.isEnabled()) return { kind: "disabled" }
    if (!deps.hasBearer()) return { kind: "unprovisioned" }
    await load()
    const at = now()
    if (record == null) return bootstrap()
    if (Date.parse(record.viewerExpiresAt) <= at) {
      report("handle_expired")
      await clear()
      return bootstrap()
    }
    if (suspect) {
      if (verifyRetryAfter != null && at < verifyRetryAfter)
        return ready(record)
      return verifySuspect(record)
    }
    const rotated = await rotateIfIdle(record)
    if (rotated) return rotated
    return record ? ready(record) : bootstrap()
  }

  function get(): Promise<ViewerIdentityResult> {
    if (inFlight) return inFlight
    const flight = resolve().finally(() => {
      if (inFlight === flight) inFlight = null
    })
    inFlight = flight
    return flight
  }

  /**
   * Admin rejected the stored handle on some other operation. The record is
   * KEPT and marked suspect: the next `get()` runs `verifySuspect`. A fresh
   * handle also arms the cooldown first, so a server-side fault cannot churn
   * identities.
   */
  async function invalidate(): Promise<void> {
    if (!record) return
    const at = now()
    const fresh =
      at - Date.parse(record.bootstrappedAt) < FRESH_HANDLE_WINDOW_MS
    report("handle_rejected", { rec_fresh: fresh })
    suspect = true
    if (fresh) cooldownUntil = at + BOOTSTRAP_COOLDOWN_MS
  }

  return {
    /** The identity to send, bootstrapping when needed. Never throws. */
    get,

    invalidate,

    /** Fires after a profile transition or a replaced identity, so a
     *  displayed slate can refresh. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Note activity so an active install never crosses the rotation window. */
    touch(): void {
      if (!record) return
      const at = now()
      record = { ...record, lastActiveAt: iso(at) }
      if (
        lastPersistedActiveAt == null ||
        at - lastPersistedActiveAt >= LAST_ACTIVE_PERSIST_INTERVAL_MS
      ) {
        lastPersistedActiveAt = at
        void persist(record)
      }
    },

    /** Blocks rotation for the hold's lifetime; the release is idempotent. */
    holdPlayback(): () => void {
      holdCount += 1
      let released = false
      return () => {
        if (released) return
        released = true
        holdCount = Math.max(0, holdCount - 1)
      }
    },

    /**
     * The viewer lifecycle actions. Null when no identity is available. A
     * definitive rejection invalidates the handle and rethrows.
     */
    async update(action: ViewerAction): Promise<ViewerStatus | null> {
      const result = await get()
      if (result.kind !== "ready") return null
      try {
        const status = await deps.updateViewer(result.identity, action)
        if (record) {
          await persist({
            ...record,
            lastActiveAt: iso(now()),
            personalization: status.personalization,
          })
        }
        if (action !== "status") notify()
        return status
      } catch (error) {
        const failure = toRecommendationClientError(error)
        if (failure.code === "UNAUTHENTICATED") await invalidate()
        throw failure
      }
    },

    /** What the store currently holds, without any network. */
    getSnapshot(): { personalization: boolean } | null {
      return record ? { personalization: record.personalization } : null
    },
  }
}
