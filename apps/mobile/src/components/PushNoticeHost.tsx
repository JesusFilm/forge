/**
 * R21's message surface. The tap handler is router-free and runs from a timer
 * or a native listener, so the message it publishes needs a host that outlives
 * every route — the same reason `ExportReportHost` exists.
 *
 * It renders the app's existing Snackbar, so nothing about the look is new.
 */

import { useCallback, useSyncExternalStore } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSegments } from "expo-router"

import { ACCENT } from "../lib/color"
import {
  clearPushNotice,
  getPushNoticeSnapshot,
  subscribeToPushNotices,
} from "../lib/push/notice"
import {
  isTabGroupRoute,
  TAB_BAR_CLEARANCE_GAP,
  TAB_BAR_SCREEN_EXTENT_IOS,
  useTabBarClearance,
} from "../lib/tabBar"
import { Snackbar } from "./ui/Snackbar"

export function PushNoticeHost() {
  const insets = useSafeAreaInsets()
  // This host mounts at the ROOT, outside the tab controller, so its inset does
  // not carry the tab bar and `useTabBarClearance` cannot be used as the lift.
  // Same geometry as `ExportReportHost`.
  const tabBarClearance = useTabBarClearance()
  const liftsOverBar = isTabGroupRoute(useSegments()) && tabBarClearance > 0
  const bottom =
    (liftsOverBar
      ? TAB_BAR_SCREEN_EXTENT_IOS + TAB_BAR_CLEARANCE_GAP
      : insets.bottom) + 16
  const { message } = useSyncExternalStore(
    subscribeToPushNotices,
    getPushNoticeSnapshot,
  )
  const onDismiss = useCallback(() => clearPushNotice(), [])

  if (message == null) return null

  return (
    <Snackbar
      message={message}
      visible
      onDismiss={onDismiss}
      iconName="information-circle"
      iconColor={ACCENT}
      bottomOffset={bottom}
    />
  )
}
