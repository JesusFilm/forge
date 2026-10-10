import { ActionSheetIOS, Alert, Platform } from "react-native"

export type MenuAction = {
  text: string
  style?: "destructive" | "cancel"
  onPress?: () => void
}

/**
 * react-native's Android dialog keeps only the first three buttons —
 * `Libraries/Alert/Alert.js` does `buttons.slice(0, 3)` and drops the rest with
 * no warning.
 */
export const ANDROID_BUTTON_LIMIT = 3

/**
 * One ordered list becomes the iOS sheet's whole config. A hand-kept
 * `destructiveButtonIndex` is a silent data-loss path the moment an option is
 * inserted, or a conditional option changes the list's length.
 */
export function iosSheetOptions(actions: readonly MenuAction[]): {
  options: string[]
  destructiveButtonIndex?: number
  cancelButtonIndex?: number
} {
  const destructive = actions.findIndex((a) => a.style === "destructive")
  const cancel = actions.findIndex((a) => a.style === "cancel")
  return {
    options: actions.map((a) => a.text),
    ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
    ...(cancel >= 0 ? { cancelButtonIndex: cancel } : {}),
  }
}

/**
 * Android drops the buttons past the third, which deletes the explicit Cancel
 * and leaves the destructive action in the default slot. Drop Cancel ourselves
 * instead — the dialog stays dismissible through `cancelable` — and keep every
 * action the viewer came for.
 */
export function androidActions(actions: readonly MenuAction[]): MenuAction[] {
  if (actions.length <= ANDROID_BUTTON_LIMIT) return [...actions]
  return actions
    .filter((a) => a.style !== "cancel")
    .slice(0, ANDROID_BUTTON_LIMIT)
}

/**
 * Show a menu of actions. iOS draws a list of choices as a sheet and a question
 * as an alert; Android has only the dialog, capped as above.
 */
export function presentActionMenu(input: {
  title?: string
  message?: string
  actions: readonly MenuAction[]
  ios?: "sheet" | "alert"
}): void {
  const { title, message, actions, ios = "sheet" } = input

  if (Platform.OS === "ios" && ios === "sheet") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        ...(title != null ? { title } : {}),
        ...(message != null ? { message } : {}),
        ...iosSheetOptions(actions),
        // App is dark-only; keep the sheet in step rather than following the OS.
        userInterfaceStyle: "dark",
      },
      (index) => actions[index]?.onPress?.(),
    )
    return
  }

  if (Platform.OS === "ios") {
    Alert.alert(title ?? "", message, [...actions])
    return
  }

  Alert.alert(title ?? "", message, androidActions(actions), {
    // A menu the viewer can back out of stays backable-out-of even when the
    // three-button cap takes its Cancel button.
    cancelable: actions.some((a) => a.style === "cancel"),
  })
}
