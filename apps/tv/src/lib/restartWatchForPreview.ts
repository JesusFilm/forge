import { reloadAppAsync, requireNativeModule } from "expo"
import { Platform } from "react-native"
import { getStorage } from "./safeStorage"
import {
  serializeWatchPreferences,
  WATCH_PREFERENCES_STORAGE_KEY,
  type WatchPreferences,
} from "./watchPreferences"

export async function restartWatchForPreview(prefs: WatchPreferences) {
  await getStorage().setItem(
    WATCH_PREFERENCES_STORAGE_KEY,
    serializeWatchPreferences(prefs),
  )
  if (Platform.OS === "android") {
    await requireNativeModule<{ restartAppForPreview: () => Promise<void> }>(
      "NativeAndroidPlayer",
    ).restartAppForPreview()
  } else {
    await reloadAppAsync("Preview selected startup animation")
  }
}
