/**
 * The registration controller (R1 to R5, R29, KTD12). Pure, with every
 * dependency injected, so the whole decision surface tests with no native
 * module: the provider wires the real adapter, the mutation client, the record
 * store, the clock and the log sink.
 *
 * It hangs off the lifecycle pass's permission-read hook, so it never performs
 * a permission read of its own (KTD9). The pass fires on mount and on every
 * foreground change, which is why the launch latch lives here rather than in
 * the caller.
 */

import {
  PUSH_REGISTRATION_DEBOUNCE_MS,
  PUSH_REGISTRATION_MAX_ATTEMPTS,
  PUSH_REGISTRATION_REFRESH_INTERVAL_MS,
  PUSH_VIEWER_HANDLE_REJECTED_CODE,
  type PushPermissionState,
} from "./constants"
import {
  buildPushRegistrationPayload,
  hashPushRegistrationPayload,
  type PushDeviceEnvironment,
  type PushRegistrationPayload,
  type PushViewerHandle,
} from "./payload"
import type { PushRegistrationRecord } from "./store"
import { readPushFailure } from "./failure"

/** Why a registration ran. A fixed set, because the log facets on it. */
export type PushRegistrationTrigger =
  | "permission_read"
  | "token_rotated"
  | "app_language"
  | "viewer_identity"
  | "retry"

/** What a request did. Also fixed for the log. */
export type PushRegistrationOutcome =
  | "registered"
  | "unchanged"
  | "gate_off"
  | "not_granted"
  | "no_token"
  | "attempts_spent"
  | "failed"

/** The slice of the record store the controller needs. */
export type PushRegistrationStorePort = {
  hydrate: () => Promise<void>
  getRecord: () => PushRegistrationRecord | null
  recordSuccess: (input: {
    testDeviceId: string
    payloadHash: string
  }) => Promise<void>
  markRevocationReported: () => Promise<void>
  setPermission: (permission: PushPermissionState) => void
}

/**
 * Named `telemetry` on purpose: datadogReservedAttributes.guard only sweeps
 * sinks spelled datadogLog, DdLogs or telemetry, so a rename makes every emit
 * site below invisible to it.
 */
export type PushTelemetry = {
  info: (event: string, context: Record<string, unknown>) => void
  warn: (event: string, context: Record<string, unknown>) => void
  error: (event: string, context: Record<string, unknown>) => void
}

export type PushRegistrationReceipt = {
  testDeviceId: string
  status: string
}

export type PushRegistrationDeps = {
  /** KTD12's build-time gate. Off skips registration and still reports R29. */
  enabled: boolean
  store: PushRegistrationStorePort
  /** Null when the phone has no token to give, and never throwing outward. */
  readToken: () => Promise<string | null>
  /** This install's id, minted on the first read and kept by the store. */
  readInstallId: () => Promise<string>
  readAppLanguageSlug: () => Promise<string | null>
  /** Null when the recommendation client is off or has no handle yet. */
  readIdentity: () => Promise<PushViewerHandle | null>
  /** Admin refused this token: its next read re-checks it. Never throws. */
  recheckIdentity: (refusedViewerToken: string) => Promise<void>
  readEnvironment: () => PushDeviceEnvironment
  register: (
    payload: PushRegistrationPayload,
  ) => Promise<PushRegistrationReceipt>
  /** The debounce timer, injected so a test drives it without a real clock. */
  schedule: (run: () => void, ms: number) => () => void
  now: () => number
  telemetry: PushTelemetry
}

export type PushRegistration = {
  /** Fired inside the lifecycle pass, with the permission it already read. */
  onPermissionRead: (permission: { granted: boolean }) => void
  tokenRotated: (token: string) => void
  appLanguageChanged: () => void
  viewerIdentityChanged: () => void
}

export function createPushRegistration(
  deps: PushRegistrationDeps,
): PushRegistration {
  /** R1's launch latch: the pass fires the hook on every foreground change. */
  let launchRequested = false
  /** A pass read a denial, so the next grant is a re-grant rather than a
   *  repeat: the revoke report already left the phone out of every audience. */
  let permissionDenied = false
  /** R29 is once per launch attempt; only a success is remembered on disk. */
  let revocationAttempted = false
  let attempts = 0
  let inFlight = false
  let cancelDebounce: (() => void) | null = null
  let pendingTrigger: PushRegistrationTrigger | null = null
  /** The token a rotation event handed us, which beats a fresh native read. */
  let rotatedToken: string | null = null
  /** R5: nothing registers until a pass has SEEN a grant. A change trigger can
   *  arrive first, and would otherwise send a `granted` payload for a
   *  permission nobody has read. */
  let granted = false
  /** The viewer token Admin refused this launch. It is never sent again, so a
   *  handle the re-check keeps cannot lock the phone out of every audience. */
  let rejectedViewerToken: string | null = null

  function log(
    outcome: PushRegistrationOutcome,
    trigger: PushRegistrationTrigger,
  ): void {
    deps.telemetry.info("push.registration", {
      push_trigger: trigger,
      push_outcome: outcome,
    })
  }

  function arm(trigger: PushRegistrationTrigger): void {
    pendingTrigger = trigger
    // One timer, re-armed: a rotation, a language pick and a re-issue inside
    // the same window become one registration (R3).
    cancelDebounce?.()
    cancelDebounce = deps.schedule(() => {
      cancelDebounce = null
      const reason = pendingTrigger ?? trigger
      pendingTrigger = null
      void run(reason)
    }, PUSH_REGISTRATION_DEBOUNCE_MS)
  }

  function request(trigger: PushRegistrationTrigger): void {
    if (!granted) return
    if (!deps.enabled) {
      log("gate_off", trigger)
      return
    }
    if (attempts >= PUSH_REGISTRATION_MAX_ATTEMPTS) {
      log("attempts_spent", trigger)
      return
    }
    arm(trigger)
  }

  async function buildPayload(
    permission: PushPermissionState,
    withIdentity: boolean,
  ): Promise<PushRegistrationPayload | null> {
    let token: string | null = rotatedToken
    if (token == null) {
      try {
        token = await deps.readToken()
      } catch {
        // A read that throws is the same outcome as no token: the phone cannot
        // be registered right now, and the viewer must never see it (R4).
        token = null
      }
    }
    if (token == null || token.length === 0) return null
    // No fallback: the install id is what admin supersedes by, so a read that
    // rejects fails the whole pass rather than sending a payload without it.
    const [installId, appLanguageSlug, identity] = await Promise.all([
      deps.readInstallId(),
      deps.readAppLanguageSlug().catch(() => null),
      withIdentity
        ? deps.readIdentity().catch(() => null)
        : Promise.resolve(null),
    ])
    const refused =
      identity != null && identity.viewerToken === rejectedViewerToken
    return buildPushRegistrationPayload({
      expoPushToken: token,
      installId,
      permission,
      appLanguageSlug,
      identity: refused ? null : identity,
      environment: deps.readEnvironment(),
    })
  }

  async function run(trigger: PushRegistrationTrigger): Promise<void> {
    if (inFlight) {
      // Re-arm rather than drop: this trigger can carry a rotated token the
      // request in flight never saw (R3).
      arm(trigger)
      return
    }
    inFlight = true
    /** Whether this run has already spent one of the cap's attempts. */
    let counted = false
    /** The viewer token this run sent, if Admin refuses it. */
    let sentViewerToken: string | null = null
    try {
      await deps.store.hydrate()
      const payload = await buildPayload("granted", true)
      if (payload == null) {
        log("no_token", trigger)
        return
      }
      sentViewerToken = payload.viewerToken ?? null
      const hash = hashPushRegistrationPayload(payload)
      const record = deps.store.getRecord()
      const lastSuccessAt = record?.lastSuccessAt ?? null
      const stale =
        lastSuccessAt == null ||
        deps.now() - lastSuccessAt >= PUSH_REGISTRATION_REFRESH_INTERVAL_MS
      if (record?.payloadHash === hash && !stale) {
        log("unchanged", trigger)
        return
      }
      // Re-read, because the viewer can revoke inside the debounce window or
      // while the token read is in flight. Sending `granted` after a pass has
      // seen the denial would put the phone back in the audience.
      if (!granted) {
        log("not_granted", trigger)
        return
      }
      attempts += 1
      counted = true
      const receipt = await deps.register(payload)
      await deps.store.recordSuccess({
        testDeviceId: receipt.testDeviceId,
        payloadHash: hash,
      })
      // The cap bounds FAILED attempts, so a launch that registered real
      // changes can still send the next one.
      attempts = 0
      // Clear only the token this payload carried: a rotation that landed
      // mid-request must survive the request it took no part in.
      if (rotatedToken === payload.expoPushToken) rotatedToken = null
      deps.telemetry.info("push.registration", {
        push_trigger: trigger,
        push_outcome: "registered",
        push_status: receipt.status,
      })
    } catch (error) {
      // Count a throw from BEFORE the request too: the retry below reads a
      // plain Error as transient, so an uncounted attempt (a rejecting
      // install-id read) would re-arm the 2 s timer for the whole launch.
      if (!counted) attempts += 1
      const failure = readPushFailure(error)
      // Admin refused the handle, not the bearer: re-check the handle, and let
      // the retry go without the refused token so this launch still registers.
      const refusedToken =
        failure.pushCode === PUSH_VIEWER_HANDLE_REJECTED_CODE
          ? sentViewerToken
          : null
      if (refusedToken != null) {
        rejectedViewerToken = refusedToken
        await deps.recheckIdentity(refusedToken).catch(() => undefined)
      }
      // A rate limit clears on its own and admin's ceiling is per minute, so a
      // retry inside this launch can only spend another request.
      const retryable =
        (refusedToken != null || !failure.definitive) &&
        failure.code !== "RATE_LIMITED" &&
        attempts < PUSH_REGISTRATION_MAX_ATTEMPTS
      deps.telemetry.info("push.registration_failed", {
        push_trigger: trigger,
        push_code: failure.code,
        push_server_code: failure.pushCode,
        push_attempt: attempts,
        push_will_retry: retryable,
      })
      if (retryable) arm("retry")
    } finally {
      inFlight = false
    }
  }

  /** R29: one report per revocation, remembered on disk so the next launch is
   *  quiet. A phone that never registered reports nothing (R5). */
  async function reportRevocation(): Promise<void> {
    if (revocationAttempted) return
    revocationAttempted = true
    try {
      await deps.store.hydrate()
      const record = deps.store.getRecord()
      const registered =
        record != null &&
        (record.testDeviceId != null || record.lastSuccessAt != null)
      if (!registered || record.revocationReportedAt != null) return
      // No viewer handle: admin finds the row by token, and the row already
      // carries the digest from the registration that created it.
      const payload = await buildPayload("denied", false)
      if (payload == null) {
        // The token read needs the grant on some platforms, so this can be the
        // ordinary answer. Leave the record unmarked and let a later launch try.
        deps.telemetry.info("push.revocation", { push_outcome: "no_token" })
        return
      }
      await deps.register(payload)
      await deps.store.markRevocationReported()
      deps.telemetry.info("push.revocation", { push_outcome: "reported" })
    } catch (error) {
      const failure = readPushFailure(error)
      deps.telemetry.info("push.revocation", {
        push_outcome: "failed",
        push_code: failure.code,
        push_server_code: failure.pushCode,
      })
    }
  }

  return {
    onPermissionRead(permission) {
      granted = permission.granted
      deps.store.setPermission(permission.granted ? "granted" : "denied")
      if (!permission.granted) {
        permissionDenied = true
        // A registration armed before the viewer revoked must not land.
        cancelDebounce?.()
        cancelDebounce = null
        void reportRevocation()
        return
      }
      const regranted = permissionDenied
      permissionDenied = false
      if (launchRequested && !regranted) return
      launchRequested = true
      request("permission_read")
    },

    tokenRotated(token) {
      rotatedToken = token
      request("token_rotated")
    },

    appLanguageChanged() {
      request("app_language")
    },

    viewerIdentityChanged() {
      request("viewer_identity")
    },
  }
}
