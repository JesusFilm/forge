// feat-699 KTD3: a dark window style makes iOS draw its own sheets, alerts,
// menus and keyboard dark. It is a window override, not the Info.plist key, so
// the window scene still reports the phone's setting to usePhoneColorScheme.
import { AppState, Appearance, Platform } from "react-native"

let activeListener: { remove(): void } | null = null

function setDarkStyle(): void {
  Appearance.setColorScheme("dark")
}

/** Sets the dark window style on iOS, and again each time the app becomes
 *  active. Android is unchanged. Safe to call more than once. */
export function applyDarkInterfaceStyle(): void {
  if (Platform.OS !== "ios") return
  setDarkStyle()
  // The override reaches only the windows that exist now, so a later call
  // covers the windows that iOS added since.
  activeListener ??= AppState.addEventListener("change", (state) => {
    if (state === "active") setDarkStyle()
  })
}
