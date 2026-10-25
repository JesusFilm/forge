import { Platform, UIManager } from "react-native"

let available: boolean | null = null

/**
 * True on iOS when the binary has `RNCSegmentedControl`, the native
 * `UISegmentedControl` (Liquid Glass on iOS 26). A dev client built before the
 * module would otherwise draw "Unimplemented component" in its place.
 */
export function canUseNativeSegmentedControl(): boolean {
  if (available == null) {
    available =
      Platform.OS === "ios" &&
      UIManager.hasViewManagerConfig?.("RNCSegmentedControl") === true
  }
  return available
}
