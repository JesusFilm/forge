/**
 * The stored registration record, as a plain module store — the pattern the
 * last-watched record uses, so the registration controller and the Profile row
 * both read it with no React dependency and no native module.
 *
 * It holds the change key (R3), the last success (R3's weekly refresh), the
 * remembered revocation (R29), the test ID Profile shows (R31) and the install
 * id admin supersedes registrations by. It holds NEITHER the push token nor a
 * viewer handle: nothing that identifies the phone to a third party is
 * persisted, and the token is re-read from the adapter whenever it is needed.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import { randomUUIDCompat } from "../viewer-id"
import {
  PUSH_INSTALL_ID_PATTERN,
  PUSH_REGISTRATION_RECORD_VERSION,
  PUSH_REGISTRATION_STORAGE_KEY,
  type PushPermissionState,
} from "./constants"

export type PushRegistrationRecord = {
  version: number
  /** R31's notification test ID. Never the push token. */
  testDeviceId: string | null
  /**
   * This install's own id, minted once and kept for the life of the install.
   * Admin retires the previous token of the same install and platform, so the
   * viewer's other phones keep their registrations.
   */
  installId: string | null
  /** R3's change key. Cleared by a revocation report, never by a read. */
  payloadHash: string | null
  lastSuccessAt: number | null
  revocationReportedAt: number | null
}

/** What the Profile row renders from. */
export type PushRegistrationSnapshot = {
  testDeviceId: string | null
  permission: PushPermissionState | "unknown"
}

export type PushRegistrationStoreDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  now: () => number
  /** Called at most once per install, and never for an id already stored. */
  mintInstallId: () => string
}

export type PushRegistrationStore = ReturnType<
  typeof createPushRegistrationStore
>

const EMPTY_RECORD: PushRegistrationRecord = {
  version: PUSH_REGISTRATION_RECORD_VERSION,
  testDeviceId: null,
  installId: null,
  payloadHash: null,
  lastSuccessAt: null,
  revocationReportedAt: null,
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Admin's own bound, re-checked here: an id it would refuse is worse than no
 *  id, because nothing ever replaces it. */
function storedInstallId(value: unknown): string | null {
  const id = nullableString(value)
  return id != null && PUSH_INSTALL_ID_PATTERN.test(id) ? id : null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * A stored record is trusted only when the version matches and every field has
 * the expected shape. Anything else reads as no record, which costs one extra
 * registration and nothing more.
 */
export function parsePushRegistrationRecord(
  raw: string | null,
): PushRegistrationRecord | null {
  if (raw == null || raw.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }
  const record = parsed as Record<string, unknown>
  if (record.version !== PUSH_REGISTRATION_RECORD_VERSION) return null
  return {
    version: PUSH_REGISTRATION_RECORD_VERSION,
    testDeviceId: nullableString(record.testDeviceId),
    installId: storedInstallId(record.installId),
    payloadHash: nullableString(record.payloadHash),
    lastSuccessAt: nullableNumber(record.lastSuccessAt),
    revocationReportedAt: nullableNumber(record.revocationReportedAt),
  }
}

export function createPushRegistrationStore(deps: PushRegistrationStoreDeps) {
  let record: PushRegistrationRecord | null = null
  let hydration: Promise<void> | null = null
  /** Held here when the read failed and there was no record to patch, so a
   *  storage fault costs one delayed write and never a second id. */
  let mintedInstallId: string | null = null
  let permission: PushRegistrationSnapshot["permission"] = "unknown"
  let snapshot: PushRegistrationSnapshot = {
    testDeviceId: null,
    permission: "unknown",
  }
  const listeners = new Set<() => void>()

  /** useSyncExternalStore loops on a fresh object, so only a real change
   *  replaces the snapshot. */
  function publish(): void {
    const next: PushRegistrationSnapshot = {
      testDeviceId: record?.testDeviceId ?? null,
      permission,
    }
    if (
      next.testDeviceId === snapshot.testDeviceId &&
      next.permission === snapshot.permission
    ) {
      return
    }
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  async function persist(next: PushRegistrationRecord): Promise<void> {
    record = next
    publish()
    try {
      await deps.setItem(PUSH_REGISTRATION_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Best-effort: memory already holds the record for this launch, and the
      // next launch simply registers once more.
    }
  }

  /** Memoized and never rejecting. A FAILED read releases the memo, so a
   *  later trigger retries instead of re-registering every launch. */
  function hydrate(): Promise<void> {
    if (hydration != null) return hydration
    let failed = false
    const flight = (async () => {
      let raw: string | null = null
      try {
        raw = await deps.getItem(PUSH_REGISTRATION_STORAGE_KEY)
      } catch {
        failed = true
        return
      }
      if (record != null) return
      record = parsePushRegistrationRecord(raw) ?? { ...EMPTY_RECORD }
      publish()
    })()
    hydration = flight
    // Registered on the FLIGHT, not inside the body: inside, a synchronous
    // throw runs the release before the assignment above and the clobbered
    // memo then holds the store at absent for good.
    const release = () => {
      if (failed && hydration === flight) hydration = null
    }
    void flight.then(release, release)
    return flight
  }

  /** The stored id, or the one this launch minted when no record was read. */
  function currentInstallId(): string | null {
    return record?.installId ?? mintedInstallId
  }

  return {
    getRecord(): PushRegistrationRecord | null {
      return record
    },

    hydrate,

    /**
     * This install's id, minted on the first call and never again. A second
     * caller sees the minted id because `persist` assigns the record before it
     * awaits the write.
     */
    async ensureInstallId(): Promise<string> {
      await hydrate()
      const stored = record?.installId ?? null
      if (stored != null) return stored
      const installId = (mintedInstallId ??= deps.mintInstallId())
      // A failed read leaves no record to patch. Writing one here would drop
      // the test ID and the change key this phone already has, so the next
      // call persists the same id once the read heals.
      if (record != null) await persist({ ...record, installId })
      return installId
    },

    async recordSuccess(input: {
      testDeviceId: string
      payloadHash: string
    }): Promise<void> {
      await persist({
        version: PUSH_REGISTRATION_RECORD_VERSION,
        testDeviceId: input.testDeviceId,
        installId: currentInstallId(),
        payloadHash: input.payloadHash,
        lastSuccessAt: deps.now(),
        // R29 is once per revocation, not once per install: a phone that
        // registers again must be able to report its next revocation.
        revocationReportedAt: null,
      })
    },

    async markRevocationReported(): Promise<void> {
      await persist({
        ...(record ?? EMPTY_RECORD),
        installId: currentInstallId(),
        // Admin drops a denied row from every audience, so the change key must
        // not make the next granted pass read as unchanged (R3).
        payloadHash: null,
        revocationReportedAt: deps.now(),
      })
    },

    /** The permission label the lifecycle pass read, for the Profile row. It is
     *  launch state, never persisted: the OS is the authority on it. */
    setPermission(next: PushPermissionState): void {
      permission = next
      publish()
    },

    getSnapshot(): PushRegistrationSnapshot {
      return snapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Module singletons outlive a test file; this clears one without reaching
     *  into its internals. */
    reset(): void {
      record = null
      hydration = null
      mintedInstallId = null
      permission = "unknown"
      snapshot = { testDeviceId: null, permission: "unknown" }
      listeners.clear()
    },
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Hermes ships no WebCrypto, so `expo-crypto` binds the platform's generator.
 * The require runs lazily and only where the runtime has none, the ordering
 * `recommendations/random.ts` uses, so jest never loads the native module.
 */
function mintInstallId(): string {
  const runtime = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto
  if (typeof runtime?.randomUUID === "function") return runtime.randomUUID()
  try {
    const expo = require("expo-crypto") as { randomUUID?: () => string }
    if (typeof expo.randomUUID === "function") return expo.randomUUID()
  } catch {
    // No native module here either. The compat generator is still unique
    // enough to key one install.
  }
  return randomUUIDCompat()
}
/* eslint-enable @typescript-eslint/no-require-imports */

let store: PushRegistrationStore | null = null

/** The app-wide push registration store. */
export function getPushRegistrationStore(): PushRegistrationStore {
  if (store == null) {
    store = createPushRegistrationStore({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      now: () => Date.now(),
      mintInstallId,
    })
  }
  return store
}

/** Test seam: drop the singleton so the next getter builds a fresh store. */
export function resetPushRegistrationStoreForTests(): void {
  store?.reset()
  store = null
}
