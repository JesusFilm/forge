/**
 * The registration controller (R1 to R5, R29, KTD12). Pure, with every
 * dependency injected: the token read, the language read, the identity read,
 * the mutation, the clock and the debounce timer are all fakes here, so the
 * whole decision surface tests with no native module and no network.
 *
 * The bound that matters most is R1's "once per launch". The lifecycle pass
 * fires the permission hook on mount and on every foreground change, so the
 * controller — not the caller — is what keeps one launch to one registration.
 */

import {
  PUSH_REGISTRATION_DEBOUNCE_MS,
  PUSH_REGISTRATION_MAX_ATTEMPTS,
  PUSH_REGISTRATION_REFRESH_INTERVAL_MS,
} from "../constants"
import { hashPushRegistrationPayload } from "../payload"
import type { PushRegistrationRecord } from "../store"
import {
  createPushRegistration,
  type PushRegistrationDeps,
} from "../registration"

const NOW = 1_700_000_000_000

const ENVIRONMENT = {
  platform: "IOS" as const,
  appBuild: "1.0.0+42",
  phoneLocale: "en-US",
  timeZone: "Pacific/Auckland",
}

const TOKEN = "ExponentPushToken[abc]"

/** A UUID, the shape the real store mints once per install. */
const INSTALL_ID = "3f2a9c10-5b6d-4e71-8a02-9c3d4e5f6071"

type Receipt = { testDeviceId: string; status: string }

class FailureStub extends Error {
  constructor(
    readonly code: string,
    readonly definitive: boolean,
    readonly pushCode: string | null = null,
  ) {
    super(`push_${code.toLowerCase()}`)
  }
}

function createHarness(
  options: {
    enabled?: boolean
    stored?: Partial<PushRegistrationRecord> | null
    token?: () => Promise<string | null>
    installId?: () => Promise<string>
    appLanguageSlug?: string | null
    identity?: { viewerToken: string; sessionToken: string } | null
    register?: jest.Mock<Promise<Receipt>, [unknown]>
    now?: () => number
  } = {},
) {
  let record: PushRegistrationRecord | null =
    options.stored == null
      ? null
      : {
          version: 1,
          testDeviceId: null,
          installId: INSTALL_ID,
          payloadHash: null,
          lastSuccessAt: null,
          revocationReportedAt: null,
          ...options.stored,
        }
  let appLanguageSlug: string | null = options.appLanguageSlug ?? "english"
  let identity = options.identity ?? null
  let token = TOKEN
  const installId = INSTALL_ID
  let installIdReads = 0
  const permissions: string[] = []
  const events: { event: string; context: Record<string, unknown> }[] = []
  const timers: (() => void)[] = []
  let cancelled = 0

  const register =
    options.register ??
    (jest.fn(async () => ({
      testDeviceId: "abc12345",
      status: "ACTIVE",
    })) as unknown as jest.Mock<Promise<Receipt>, [unknown]>)

  const deps: PushRegistrationDeps = {
    enabled: options.enabled ?? true,
    store: {
      hydrate: async () => {
        if (record == null) {
          record = {
            version: 1,
            testDeviceId: null,
            installId,
            payloadHash: null,
            lastSuccessAt: null,
            revocationReportedAt: null,
          }
        }
      },
      getRecord: () => record,
      recordSuccess: async ({ testDeviceId, payloadHash }) => {
        record = {
          version: 1,
          testDeviceId,
          installId: record?.installId ?? installId,
          payloadHash,
          lastSuccessAt: deps.now(),
          revocationReportedAt: null,
        }
      },
      markRevocationReported: async () => {
        record = {
          version: 1,
          testDeviceId: record?.testDeviceId ?? null,
          installId: record?.installId ?? installId,
          // Mirrors the real store, which clears the change key here so the
          // next granted pass registers instead of reading `unchanged`.
          payloadHash: null,
          lastSuccessAt: record?.lastSuccessAt ?? null,
          revocationReportedAt: deps.now(),
        }
      },
      setPermission: (next) => permissions.push(next),
    },
    readToken: options.token ?? (async () => token),
    // The real store mints once and then serves the stored id, so this never
    // answers a second value on its own.
    readInstallId:
      options.installId ??
      (async () => {
        installIdReads += 1
        return installId
      }),
    readAppLanguageSlug: async () => appLanguageSlug,
    readIdentity: async () => identity,
    readEnvironment: () => ENVIRONMENT,
    register: register as unknown as PushRegistrationDeps["register"],
    schedule: (run, ms) => {
      expect(ms).toBe(PUSH_REGISTRATION_DEBOUNCE_MS)
      timers.push(run)
      const index = timers.length - 1
      return () => {
        cancelled += 1
        timers[index] = () => undefined
      }
    },
    now: options.now ?? (() => NOW),
    telemetry: {
      info: (event, context) => events.push({ event, context }),
      warn: (event, context) => events.push({ event, context }),
      error: (event, context) => events.push({ event, context }),
    },
  }

  const registration = createPushRegistration(deps)

  /** Drains the microtask queue and fires no timer, so a case can release an
   *  injected read while a registration is still armed. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 12; round += 1) await Promise.resolve()
  }

  /** Fires every armed timer, then lets the async run settle. */
  async function fire(): Promise<void> {
    const pending = [...timers]
    timers.length = 0
    for (const run of pending) run()
    await settle()
  }

  return {
    registration,
    register,
    events,
    permissions,
    get record() {
      return record
    },
    get armed() {
      return timers.length
    },
    get cancelled() {
      return cancelled
    },
    setAppLanguageSlug: (next: string | null) => {
      appLanguageSlug = next
    },
    setIdentity: (
      next: { viewerToken: string; sessionToken: string } | null,
    ) => {
      identity = next
    },
    setToken: (next: string) => {
      token = next
    },
    get installIdReads() {
      return installIdReads
    },
    fire,
    settle,
    outcomes: () =>
      events
        .filter((entry) => entry.event === "push.registration")
        .map((entry) => entry.context.push_outcome),
  }
}

function payloadOf(register: jest.Mock, call = 0): Record<string, unknown> {
  return register.mock.calls[call][0] as Record<string, unknown>
}

describe("the first registration of a launch", () => {
  it("registers a granted phone with every field R2 names (AE1)", async () => {
    const harness = createHarness()

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(1)
    expect(payloadOf(harness.register)).toEqual({
      expoPushToken: TOKEN,
      installId: INSTALL_ID,
      platform: "IOS",
      appBuild: "1.0.0+42",
      appLanguageSlug: "english",
      phoneLocale: "en-US",
      timeZone: "Pacific/Auckland",
      permission: "granted",
    })
    expect(harness.record?.testDeviceId).toBe("abc12345")
    expect(harness.outcomes()).toEqual(["registered"])
    expect(harness.permissions).toEqual(["granted"])
  })

  it("registers nothing for a denied phone that never registered (AE2, R5)", async () => {
    const harness = createHarness()

    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
    expect(harness.permissions).toEqual(["denied"])
  })

  it("sends the viewer handle when the identity client has one", async () => {
    const harness = createHarness({
      identity: { viewerToken: "viewer-1", sessionToken: "session-1" },
    })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(payloadOf(harness.register)).toMatchObject({
      viewerToken: "viewer-1",
      sessionToken: "session-1",
    })
  })

  it("sends no handle at all when the identity client is disabled", async () => {
    const harness = createHarness({ identity: null })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    const payload = payloadOf(harness.register)
    expect("viewerToken" in payload).toBe(false)
    expect("sessionToken" in payload).toBe(false)
  })

  it("registers nothing when no push token can be read", async () => {
    const harness = createHarness({ token: async () => null })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
    expect(harness.outcomes()).toEqual(["no_token"])
  })

  it("registers nothing, and logs it, when the token read throws", async () => {
    const harness = createHarness({
      token: async () => {
        throw new Error("Notification permissions have not been granted")
      },
    })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
    expect(harness.outcomes()).toEqual(["no_token"])
  })
})

describe("once per launch (R1)", () => {
  it("calls the mutation once across ten foreground and background pairs", async () => {
    const harness = createHarness()

    for (let pair = 0; pair < 10; pair += 1) {
      // Every pass fires the hook twice, and each pass is its own debounce
      // window — so the debounce alone cannot explain one call.
      harness.registration.onPermissionRead({ granted: true })
      await harness.fire()
      harness.registration.onPermissionRead({ granted: true })
      await harness.fire()
    }

    expect(harness.register).toHaveBeenCalledTimes(1)
  })

  it("arms the debounce once per launch, so nineteen passes arm nothing", async () => {
    // The mechanism, not just the count: a latch that only skipped the mutation
    // would still arm a timer on every foreground for the life of the launch.
    const harness = createHarness()

    harness.registration.onPermissionRead({ granted: true })
    expect(harness.armed).toBe(1)
    await harness.fire()

    for (let pass = 0; pass < 19; pass += 1) {
      harness.registration.onPermissionRead({ granted: true })
    }

    expect(harness.armed).toBe(0)
    await harness.fire()
    expect(harness.register).toHaveBeenCalledTimes(1)
  })

  it("does not re-register a launch whose registration failed for good", async () => {
    // The falsification of the latch. The stored change key is what stops the
    // repeat after a SUCCESS, so only a definitive failure can tell the latch
    // apart from the payload-hash check.
    const register = jest.fn(async () => {
      throw new FailureStub("BAD_USER_INPUT", true)
    }) as unknown as jest.Mock<Promise<Receipt>, [unknown]>
    const harness = createHarness({ register })

    for (let pass = 0; pass < 10; pass += 1) {
      harness.registration.onPermissionRead({ granted: true })
      await harness.fire()
    }

    expect(register).toHaveBeenCalledTimes(1)
  })
})

describe("the payload change key (R3)", () => {
  it("skips the call when nothing changed since the stored success", async () => {
    const stored = hashPushRegistrationPayload({
      expoPushToken: TOKEN,
      installId: INSTALL_ID,
      platform: "IOS",
      appBuild: "1.0.0+42",
      appLanguageSlug: "english",
      phoneLocale: "en-US",
      timeZone: "Pacific/Auckland",
      permission: "granted",
    })
    const harness = createHarness({
      stored: {
        testDeviceId: "abc12345",
        payloadHash: stored,
        lastSuccessAt: NOW - 1_000,
      },
    })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
    expect(harness.outcomes()).toEqual(["unchanged"])
  })

  it("re-registers when the stored success is older than the refresh window", async () => {
    const stored = hashPushRegistrationPayload({
      expoPushToken: TOKEN,
      installId: INSTALL_ID,
      platform: "IOS",
      appBuild: "1.0.0+42",
      appLanguageSlug: "english",
      phoneLocale: "en-US",
      timeZone: "Pacific/Auckland",
      permission: "granted",
    })
    const staleAt = NOW - 31 * 24 * 60 * 60 * 1_000
    const freshAt = NOW - 6 * 24 * 60 * 60 * 1_000

    const stale = createHarness({
      stored: { payloadHash: stored, lastSuccessAt: staleAt },
    })
    stale.registration.onPermissionRead({ granted: true })
    await stale.fire()
    expect(stale.register).toHaveBeenCalledTimes(1)

    const fresh = createHarness({
      stored: { payloadHash: stored, lastSuccessAt: freshAt },
    })
    fresh.registration.onPermissionRead({ granted: true })
    await fresh.fire()
    expect(fresh.register).not.toHaveBeenCalled()
    // Anti-vacuous: the six-day fixture really sits inside the window and the
    // thirty-one-day one really sits outside it, whatever the constant becomes.
    expect(NOW - freshAt).toBeLessThan(PUSH_REGISTRATION_REFRESH_INTERVAL_MS)
    expect(NOW - staleAt).toBeGreaterThan(PUSH_REGISTRATION_REFRESH_INTERVAL_MS)
  })

  it("refreshes with the new slug when the app language changes (AE3)", async () => {
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    harness.setAppLanguageSlug("arabic")
    harness.registration.appLanguageChanged()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
    expect(payloadOf(harness.register, 1).appLanguageSlug).toBe("arabic")
  })

  it("calls the mutation once for one language pick that writes three fields", async () => {
    // The watch preferences write the dub slug, the subtitle slug and the
    // cached subtitle name in one handler, so the provider notifies three times.
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    harness.setAppLanguageSlug("french")
    harness.registration.appLanguageChanged()
    harness.registration.appLanguageChanged()
    harness.registration.appLanguageChanged()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
    expect(payloadOf(harness.register, 1).appLanguageSlug).toBe("french")
  })

  it("sends nothing when a preference change leaves the app language alone", async () => {
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    harness.registration.appLanguageChanged()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(1)
    expect(harness.outcomes()).toEqual(["registered", "unchanged"])
  })

  it("refreshes with the rotated token", async () => {
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    harness.registration.tokenRotated("ExponentPushToken[rotated]")
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
    expect(payloadOf(harness.register, 1).expoPushToken).toBe(
      "ExponentPushToken[rotated]",
    )
  })

  it("refreshes when the viewer identity is re-issued", async () => {
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    harness.setIdentity({ viewerToken: "viewer-2", sessionToken: "session-2" })
    harness.registration.viewerIdentityChanged()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
    expect(payloadOf(harness.register, 1)).toMatchObject({
      viewerToken: "viewer-2",
    })
  })

  it("coalesces a rotation, a language change and a re-issue into one call", async () => {
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    harness.setAppLanguageSlug("korean")
    harness.setIdentity({ viewerToken: "viewer-3", sessionToken: "session-3" })
    harness.registration.tokenRotated("ExponentPushToken[rotated]")
    harness.registration.appLanguageChanged()
    harness.registration.viewerIdentityChanged()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
    expect(payloadOf(harness.register, 1)).toMatchObject({
      expoPushToken: "ExponentPushToken[rotated]",
      appLanguageSlug: "korean",
      viewerToken: "viewer-3",
    })
  })
})

describe("a trigger that lands while a request is in flight", () => {
  /** A token read that blocks on the first call, so a case can hold a run open
   *  and drive what happens around it. */
  function blockingToken(later: string): {
    read: () => Promise<string>
    release: (token: string) => void
    reads: () => number
  } {
    let resolveFirst: (token: string) => void = () => undefined
    let reads = 0
    return {
      read: () => {
        reads += 1
        if (reads === 1) {
          return new Promise<string>((resolve) => {
            resolveFirst = resolve
          })
        }
        return Promise.resolve(later)
      },
      release: (token) => resolveFirst(token),
      reads: () => reads,
    }
  }

  it("runs the trigger once the request in flight settles", async () => {
    const reader = blockingToken("ExponentPushToken[second]")
    const harness = createHarness({ token: reader.read })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()
    harness.registration.tokenRotated("ExponentPushToken[rotated]")
    // The rotation's timer fires while the first request is still blocked,
    // which is the moment a dropped trigger is lost for the whole launch.
    await harness.fire()
    expect(harness.armed).toBe(1)

    reader.release(TOKEN)
    await harness.settle()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
  })

  it("keeps a token that rotated mid-request, so the launch registers it", async () => {
    const reader = blockingToken(TOKEN)
    const harness = createHarness({ token: reader.read })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()
    harness.registration.tokenRotated("ExponentPushToken[rotated]")
    reader.release(TOKEN)
    await harness.settle()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
    expect(payloadOf(harness.register, 1).expoPushToken).toBe(
      "ExponentPushToken[rotated]",
    )
    // The rotation beat a fresh read, which is the only thing that can carry a
    // token the first request never sent.
    expect(reader.reads()).toBe(1)
  })
})

describe("a failed registration (AE19, R4)", () => {
  it("resolves without throwing and records the failure", async () => {
    const register = jest.fn(async () => {
      throw new FailureStub("NETWORK_ERROR", false)
    }) as unknown as jest.Mock<Promise<Receipt>, [unknown]>
    const harness = createHarness({ register })

    harness.registration.onPermissionRead({ granted: true })
    await expect(harness.fire()).resolves.toBeUndefined()

    expect(
      harness.events.filter(
        (entry) => entry.event === "push.registration_failed",
      ),
    ).toHaveLength(1)
    expect(harness.record?.testDeviceId ?? null).toBeNull()
  })

  it("retries a transient failure up to the attempt cap, then stops", async () => {
    const register = jest.fn(async () => {
      throw new FailureStub("TIMEOUT", false)
    }) as unknown as jest.Mock<Promise<Receipt>, [unknown]>
    const harness = createHarness({ register })

    harness.registration.onPermissionRead({ granted: true })
    for (let round = 0; round < 6; round += 1) await harness.fire()

    expect(register).toHaveBeenCalledTimes(PUSH_REGISTRATION_MAX_ATTEMPTS)
    expect(harness.armed).toBe(0)
  })

  it("spends the cap on failures alone, so a rotation after three successes lands", async () => {
    // The cap is a retry guard. A launch that registered three real changes has
    // spent no retry, and a rotation is a new identity rather than a repeat.
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()
    for (const slug of ["arabic", "french"]) {
      harness.setAppLanguageSlug(slug)
      harness.registration.appLanguageChanged()
      await harness.fire()
    }
    // Anti-vacuous: the launch really has spent the whole cap on successes.
    expect(harness.register).toHaveBeenCalledTimes(
      PUSH_REGISTRATION_MAX_ATTEMPTS,
    )

    harness.registration.tokenRotated("ExponentPushToken[rotated]")
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(
      PUSH_REGISTRATION_MAX_ATTEMPTS + 1,
    )
    expect(
      payloadOf(harness.register, PUSH_REGISTRATION_MAX_ATTEMPTS).expoPushToken,
    ).toBe("ExponentPushToken[rotated]")
    expect(harness.outcomes()).not.toContain("attempts_spent")
  })

  it("does not retry a rate limit in the same launch", async () => {
    const register = jest.fn(async () => {
      throw new FailureStub("RATE_LIMITED", false)
    }) as unknown as jest.Mock<Promise<Receipt>, [unknown]>
    const harness = createHarness({ register })

    harness.registration.onPermissionRead({ granted: true })
    for (let round = 0; round < 4; round += 1) await harness.fire()

    expect(register).toHaveBeenCalledTimes(1)
    expect(harness.armed).toBe(0)
    expect(
      harness.events.some(
        (entry) =>
          entry.event === "push.registration_failed" &&
          entry.context.push_code === "RATE_LIMITED" &&
          entry.context.push_will_retry === false,
      ),
    ).toBe(true)
  })

  it("does not retry a retired token", async () => {
    // Admin refuses a token it has retired for 90 days, so asking again in this
    // launch can only fail the same way.
    const register = jest.fn(async () => {
      throw new FailureStub("BAD_USER_INPUT", true, "invalid_token_status")
    }) as unknown as jest.Mock<Promise<Receipt>, [unknown]>
    const harness = createHarness({ register })

    harness.registration.onPermissionRead({ granted: true })
    for (let round = 0; round < 4; round += 1) await harness.fire()

    expect(register).toHaveBeenCalledTimes(1)
    expect(
      harness.events.some(
        (entry) =>
          entry.event === "push.registration_failed" &&
          entry.context.push_server_code === "invalid_token_status",
      ),
    ).toBe(true)
  })
})

describe("a revoked permission (AE20, R29)", () => {
  const STORED = {
    testDeviceId: "abc12345",
    payloadHash: "0123456789abcdef",
    lastSuccessAt: NOW - 1_000,
  }

  it("reports the revocation once for a phone that had registered", async () => {
    const harness = createHarness({ stored: STORED })

    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(1)
    expect(payloadOf(harness.register)).toMatchObject({
      expoPushToken: TOKEN,
      installId: INSTALL_ID,
      permission: "denied",
    })
    // The handle is deliberately absent: admin binds the row by token, and the
    // stored digest already carries the viewer.
    expect("viewerToken" in payloadOf(harness.register)).toBe(false)
    expect(harness.record?.revocationReportedAt).toBe(NOW)
  })

  it("reports it once however many passes read the denial", async () => {
    const harness = createHarness({ stored: STORED })

    for (let pass = 0; pass < 10; pass += 1) {
      harness.registration.onPermissionRead({ granted: false })
      await harness.fire()
    }

    expect(harness.register).toHaveBeenCalledTimes(1)
  })

  it("reports nothing on the next launch (the falsification of once)", async () => {
    // A fresh controller over the SAME stored record is what a later launch is.
    const harness = createHarness({
      stored: { ...STORED, revocationReportedAt: NOW - 500 },
    })

    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
  })

  it("reports it while the kill switch is off (KTD12)", async () => {
    const harness = createHarness({ enabled: false, stored: STORED })

    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(1)
    expect(payloadOf(harness.register)).toMatchObject({ permission: "denied" })
  })

  it("leaves the report unmarked when it fails, so a later launch retries", async () => {
    const register = jest.fn(async () => {
      throw new FailureStub("NETWORK_ERROR", false)
    }) as unknown as jest.Mock<Promise<Receipt>, [unknown]>
    const harness = createHarness({ stored: STORED, register })

    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()

    expect(register).toHaveBeenCalledTimes(1)
    expect(harness.record?.revocationReportedAt ?? null).toBeNull()
  })

  it("re-registers when a later pass in the same launch finds the grant back", async () => {
    const harness = createHarness({ stored: STORED })
    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
    expect(payloadOf(harness.register, 1)).toMatchObject({
      permission: "granted",
    })
  })

  it("re-registers on the next launch after a revoke and a re-grant", async () => {
    // The revoke report takes the row out of every audience, so the stored
    // change key must not make the next granted pass read as unchanged.
    const first = createHarness()
    first.registration.onPermissionRead({ granted: true })
    await first.fire()
    first.registration.onPermissionRead({ granted: false })
    await first.fire()
    expect(first.record?.revocationReportedAt).toBe(NOW)

    // A fresh controller over the record the first launch left behind.
    const second = createHarness({ stored: first.record })
    second.registration.onPermissionRead({ granted: true })
    await second.fire()

    expect(second.register).toHaveBeenCalledTimes(1)
    expect(payloadOf(second.register)).toMatchObject({ permission: "granted" })
    // Anti-vacuous: the stored success really is inside the refresh window, so
    // only the cleared change key can be what registered this phone again.
    expect(NOW - (first.record?.lastSuccessAt ?? 0)).toBeLessThan(
      PUSH_REGISTRATION_REFRESH_INTERVAL_MS,
    )
  })

  it("re-registers when the viewer re-grants inside the same launch", async () => {
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()
    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()
    expect(harness.register).toHaveBeenCalledTimes(2)

    harness.registration.onPermissionRead({ granted: true })

    // The launch latch must not swallow a re-grant. Arming is the mechanism,
    // the third call is the outcome.
    expect(harness.armed).toBe(1)
    await harness.fire()
    expect(harness.register).toHaveBeenCalledTimes(3)
    expect(payloadOf(harness.register, 2)).toMatchObject({
      permission: "granted",
    })
  })
})

describe("a grant is the precondition for every registration (R5)", () => {
  it("registers nothing for a trigger that arrives before any permission read", async () => {
    // The provider publishes the app language as soon as the preferences
    // hydrate, which can beat the first pass. Registering then would send a
    // `granted` payload for a phone whose permission nobody has read.
    const harness = createHarness()

    harness.registration.appLanguageChanged()
    harness.registration.tokenRotated("ExponentPushToken[rotated]")
    harness.registration.viewerIdentityChanged()
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
  })

  it("registers nothing on a change while the permission is denied", async () => {
    const harness = createHarness({
      stored: { testDeviceId: "abc12345", lastSuccessAt: NOW - 1_000 },
    })
    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()
    harness.register.mockClear()

    harness.setAppLanguageSlug("arabic")
    harness.registration.appLanguageChanged()
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
  })

  it("sends no armed registration once a pass has read the denial", async () => {
    // The viewer can revoke inside the two-second window. Both halves matter:
    // the armed timer is cancelled, and a run already past it re-reads.
    const harness = createHarness({
      stored: { testDeviceId: "abc12345", lastSuccessAt: NOW - 1_000 },
    })
    harness.registration.onPermissionRead({ granted: true })
    expect(harness.armed).toBe(1)

    harness.registration.onPermissionRead({ granted: false })
    await harness.fire()

    expect(harness.cancelled).toBe(1)
    // Only the revocation, never a `granted` payload after the denial.
    expect(harness.register).toHaveBeenCalledTimes(1)
    expect(payloadOf(harness.register)).toMatchObject({ permission: "denied" })
  })

  it("sends no granted payload when the viewer revokes mid-request", async () => {
    // The re-read after the token read, not the cancel: the timer has already
    // fired, so nothing else can stop this registration.
    let releaseToken: (token: string) => void = () => undefined
    let reads = 0
    const harness = createHarness({
      stored: { testDeviceId: "abc12345", lastSuccessAt: NOW - 1_000 },
      token: () => {
        reads += 1
        if (reads === 1) {
          return new Promise<string>((resolve) => {
            releaseToken = resolve
          })
        }
        return Promise.resolve(TOKEN)
      },
    })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()
    expect(harness.armed).toBe(0)

    harness.registration.onPermissionRead({ granted: false })
    releaseToken(TOKEN)
    await harness.settle()

    // Only the revocation report, and it is the re-read that stopped the other
    // half: no timer was left to cancel.
    expect(harness.cancelled).toBe(0)
    expect(harness.register).toHaveBeenCalledTimes(1)
    expect(payloadOf(harness.register)).toMatchObject({ permission: "denied" })
    expect(harness.outcomes()).toContain("not_granted")
  })

  it("registers on a change once a pass has read the grant", async () => {
    const harness = createHarness()
    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    harness.setAppLanguageSlug("arabic")
    harness.registration.appLanguageChanged()
    await harness.fire()

    expect(harness.register).toHaveBeenCalledTimes(2)
  })
})

describe("the kill switch (KTD12)", () => {
  it("performs no first registration while it is off", async () => {
    const harness = createHarness({ enabled: false })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
    expect(harness.outcomes()).toEqual(["gate_off"])
    // The permission label still reaches the store, so Profile keeps working.
    expect(harness.permissions).toEqual(["granted"])
  })

  it("performs no refresh on a rotation or a language change either", async () => {
    const harness = createHarness({ enabled: false })

    harness.registration.tokenRotated("ExponentPushToken[rotated]")
    harness.registration.appLanguageChanged()
    harness.registration.viewerIdentityChanged()
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
  })
})

describe("the install id", () => {
  it("rides every registration, from the store and nowhere else", async () => {
    // Without it admin retires the viewer's OTHER phones when this one
    // registers, which is the whole reason the field exists.
    const harness = createHarness()

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(payloadOf(harness.register).installId).toBe(INSTALL_ID)
    expect(harness.installIdReads).toBe(1)
  })

  it("fails the pass rather than register without one", async () => {
    // A payload with no install id would make admin supersede by viewer
    // again, so a read that rejects must lose the registration instead.
    const harness = createHarness({
      installId: async () => {
        throw new Error("storage unavailable")
      },
    })

    harness.registration.onPermissionRead({ granted: true })
    await harness.fire()

    expect(harness.register).not.toHaveBeenCalled()
    expect(
      harness.events.some(
        (entry) => entry.event === "push.registration_failed",
      ),
    ).toBe(true)
  })
})
