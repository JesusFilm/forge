import { NativeModules, TurboModuleRegistry } from "react-native"

/**
 * AsyncStorage wrapper with an in-memory fallback when the native module isn't
 * linked. The require is gated behind a NativeModules pre-check (not just try/catch):
 * Metro dispatches the top-level throw to RN's global error handler before JS catch.
 */

export type StorageBackend = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

const ASYNC_STORAGE_NATIVE_MODULE_NAME = "RNCAsyncStorage"

/**
 * True when the AsyncStorage native module is registered on either NativeModules
 * (legacy) or TurboModuleRegistry (new arch). Pre-checking lets us skip the
 * require when missing, so the package's top-level throw never fires.
 */
function isAsyncStorageNativeModuleRegistered(): boolean {
  // Old architecture: AsyncStorage v2 falls back to NativeModules
  // when TurboModuleRegistry is absent.
  if (NativeModules[ASYNC_STORAGE_NATIVE_MODULE_NAME] != null) return true

  // New architecture: TurboModuleRegistry.get is non-throwing (returns
  // null if absent). Wrapped in try/catch defensively in case some
  // RN version exposes a stricter shape.
  try {
    return TurboModuleRegistry.get(ASYNC_STORAGE_NATIVE_MODULE_NAME) != null
  } catch {
    return false
  }
}

function loadAsyncStorage(): StorageBackend | null {
  // Only require the package when the native module is registered; skipping the
  // require is the only way to keep the dev red-box quiet (see file header).
  if (!isAsyncStorageNativeModuleRegistered()) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require("@react-native-async-storage/async-storage")
    const candidate =
      (mod as { default?: unknown } | null)?.default ?? (mod as unknown)
    if (
      candidate == null ||
      typeof (candidate as { getItem?: unknown }).getItem !== "function"
    ) {
      return null
    }
    return candidate as StorageBackend
  } catch {
    // Belt-and-suspenders. If the native module IS registered but
    // the require still throws for some reason (e.g., a future
    // breaking change in the package), fall back rather than crash.
    return null
  }
}

function makeMemoryStorage(): StorageBackend {
  const store = new Map<string, string>()
  return {
    async getItem(key) {
      return store.get(key) ?? null
    },
    async setItem(key, value) {
      store.set(key, value)
    },
    async removeItem(key) {
      store.delete(key)
    },
  }
}

let _storage: StorageBackend | null = null
let _loggedFallback = false

/**
 * Real AsyncStorage when linked, else in-memory fallback (logged once). Exported
 * as a function (not module-scope) so resolution runs lazily on first hook mount
 * rather than at bundle init, and so tests can inject their own backend.
 */
export function getStorage(): StorageBackend {
  if (_storage != null) return _storage
  const native = loadAsyncStorage()
  if (native != null) {
    _storage = native
    return native
  }
  if (!_loggedFallback) {
    _loggedFallback = true
    console.warn(
      "[tv/safeStorage] AsyncStorage native module not linked — " +
        "using in-memory fallback. Recents will not persist across " +
        "reloads. Run `pnpm --filter tv prebuild` followed by a fresh " +
        "`pnpm --filter tv ios` (or android) to wire the native module.",
    )
  }
  _storage = makeMemoryStorage()
  return _storage
}

/**
 * Test-only: reset the cached backend so getStorage() re-resolves next call.
 * Lets unit tests swap fallbacks between runs; unused in production.
 */
export function _resetStorageForTests(): void {
  _storage = null
  _loggedFallback = false
}
