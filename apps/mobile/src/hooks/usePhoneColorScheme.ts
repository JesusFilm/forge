import { useSyncExternalStore } from "react"
import { Platform, useColorScheme } from "react-native"

import {
  getSystemAppearanceModule,
  type PhoneColorScheme,
} from "../../modules/system-appearance"

function subscribe(onChange: () => void): () => void {
  const subscription = getSystemAppearanceModule().addChangeListener(onChange)
  return () => subscription.remove()
}

function readPhoneScheme(): PhoneColorScheme {
  return getSystemAppearanceModule().getPhoneColorScheme()
}

/** The phone's own setting for the reader's System mode (feat-705 KTD4). The
 *  iOS dark window style makes `useColorScheme()` always "dark", so iOS reads
 *  the native module. The only color scheme reader: a guard rejects others. */
export function usePhoneColorScheme(): PhoneColorScheme {
  // Both hooks run on every platform, so the hook order never changes.
  const reactNativeScheme = useColorScheme()
  const phoneScheme = useSyncExternalStore(subscribe, readPhoneScheme)
  if (Platform.OS === "ios") return phoneScheme
  return reactNativeScheme === "light" || reactNativeScheme === "dark"
    ? reactNativeScheme
    : null
}
