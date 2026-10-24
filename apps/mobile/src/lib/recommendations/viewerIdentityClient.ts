/**
 * Real wiring for the viewer identity store: SecureStore (this-device-only,
 * like the auth session credential) and the two Admin viewer mutations. Lazy
 * singleton — never module-scope — so jest and module init stay native-free.
 */
import { getApiToken } from "../config"
import { isRecommendationClientEnabled } from "./enabled"
import {
  CREATE_RECOMMENDATION_VIEWER,
  UPDATE_RECOMMENDATION_VIEWER,
} from "./operations"
import { secureRandomToken } from "./random"
import { reportRecommendationIdentity } from "./telemetry"
import { IDENTITY_DEADLINE_MS, mutateWithDeadline } from "./transport"
import {
  createViewerIdentityStore,
  type ViewerIdentityStore,
} from "./viewerIdentity"

let store: ViewerIdentityStore | null = null

/**
 * The three store thunks every client module's deps repeat. Each resolves the
 * singleton per call, so the test reset seam still takes effect.
 */
export function viewerIdentityBridge(): {
  getIdentity: () => ReturnType<ViewerIdentityStore["get"]>
  invalidateIdentity: () => Promise<void>
  touch: () => void
} {
  return {
    getIdentity: () => getRecommendationViewerStore().get(),
    invalidateIdentity: () => getRecommendationViewerStore().invalidate(),
    touch: () => getRecommendationViewerStore().touch(),
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
export function getRecommendationViewerStore(): ViewerIdentityStore {
  if (!store) {
    // require() keeps the native module out of jest and out of module init.
    const SecureStore =
      require("expo-secure-store") as typeof import("expo-secure-store")
    const options = {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }
    store = createViewerIdentityStore({
      isEnabled: isRecommendationClientEnabled,
      hasBearer: () => Boolean(getApiToken()),
      storage: {
        getItemAsync: (key) => SecureStore.getItemAsync(key, options),
        setItemAsync: (key, value) =>
          SecureStore.setItemAsync(key, value, options),
        deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, options),
      },
      bootstrap: async () => {
        const data = await mutateWithDeadline(
          CREATE_RECOMMENDATION_VIEWER,
          {},
          IDENTITY_DEADLINE_MS,
        )
        return data.createRecommendationViewer
      },
      updateViewer: async (identity, action) => {
        const data = await mutateWithDeadline(
          UPDATE_RECOMMENDATION_VIEWER,
          { ...identity, action },
          IDENTITY_DEADLINE_MS,
        )
        return data.updateRecommendationViewer
      },
      randomToken: secureRandomToken,
      report: reportRecommendationIdentity,
    })
  }
  return store
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Test seam: drop the singleton so the next getter builds a fresh store. */
export function resetRecommendationViewerStoreForTests(): void {
  store = null
}
