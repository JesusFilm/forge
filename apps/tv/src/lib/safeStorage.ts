import { NativeModules, TurboModuleRegistry } from "react-native"

/**
 * AsyncStorage wrapper that degrades to an in-memory fallback when
 * the native module is not linked.
 *
 * Why a wrapper at all:
 * - `@react-native-async-storage/async-storage` throws at module-load
 *   time ("NativeModule: AsyncStorage is null") if the dev client was
 *   built before the package was added to `package.json`. Until the
 *   native rebuild lands (`EXPO_TV=1 npx expo prebuild --clean` +
 *   `expo run:ios|android`), the module is unavailable.
 * - A static `import AsyncStorage from "..."` at the top of a consumer
 *   file would crash the whole bundle. The fallback lets the rest of
 *   the app keep working while recents simply don't persist across
 *   reloads.
 *
 * Why a `NativeModules` pre-check:
 * - Wrapping the `require()` in a try/catch IS sufficient to catch
 *   the JavaScript exception, but Metro's dev-mode bundler dispatches
 *   the synchronous throw to React Native's global error handler
 *   BEFORE the catch on the JS side runs — which surfaces the red
 *   "Uncaught Error" overlay even though the JS state machine is
 *   handling the failure correctly. Pre-checking the native module
 *   registration via `NativeModules` / `TurboModuleRegistry` avoids
 *   triggering AsyncStorage's top-level throw at all when the native
 *   side is missing, which keeps the dev overlay clean.
 *
 * Once the native rebuild has happened, this wrapper transparently
 * returns the real AsyncStorage and recents start persisting — no
 * consumer-side code change required.
 */

export type StorageBackend = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

const ASYNC_STORAGE_NATIVE_MODULE_NAME = "RNCAsyncStorage"

/**
 * Returns true when the AsyncStorage native module is registered on
 * either the legacy bridge (`NativeModules`) or the new architecture
 * (`TurboModuleRegistry`). Pre-checking here lets us avoid `require`-
 * ing the AsyncStorage package when the module is missing — the
 * package's own top-level guard (`if (!RCTAsyncStorage) throw ...`)
 * never fires because we never trigger the import.
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
  // Pre-flight: only require the package when the underlying native
  // module is actually registered. Skipping the require entirely is
  // the only way to keep the dev red-box overlay quiet — see the
  // comment at the top of this file.
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
