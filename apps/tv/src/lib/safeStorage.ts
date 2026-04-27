/**
 * AsyncStorage wrapper that degrades to an in-memory fallback when
 * the native module is not linked.
 *
 * Why:
 * - `@react-native-async-storage/async-storage` throws at static-import
 *   time ("NativeModule: AsyncStorage is null") if the dev client was
 *   built before the package was added to `package.json`. Until the
 *   native rebuild lands (`EXPO_TV=1 npx expo prebuild --clean` +
 *   `expo run:ios|android`), the module is unavailable.
 * - A static `import AsyncStorage from "..."` at the top of a consumer
 *   file would crash the whole bundle. Using `require()` inside a guard
 *   here lets the rest of the app keep working while recents simply
 *   don't persist across reloads.
 *
 * Once the native rebuild has happened, this wrapper transparently
 * returns the real AsyncStorage and recents start persisting again —
 * no consumer-side code change required.
 */

export type StorageBackend = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

function loadAsyncStorage(): StorageBackend | null {
  try {
    // Dynamic require so module-load failure does not crash bundle init.
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
 * Returns the real AsyncStorage when its native module is linked, or
 * an in-memory fallback otherwise. Logs once when the fallback is
 * active so the gap is visible in dev without spamming logs.
 *
 * Exported (rather than evaluated at module scope) so test harnesses
 * can inject their own backend if useful, and so the loader runs
 * lazily — the first hook mount triggers the resolution, not bundle
 * init.
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
 * Test-only: reset the cached backend so a fresh resolution runs on
 * the next getStorage() call. Used by unit tests that want to swap
 * fallbacks between runs. No-op in production code paths.
 */
export function _resetStorageForTests(): void {
  _storage = null
  _loggedFallback = false
}
