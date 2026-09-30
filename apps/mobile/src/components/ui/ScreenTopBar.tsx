import type { ComponentProps } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"

import { useTypography } from "../../hooks/useTypography"
import { useT } from "../../i18n/useT"
import { BG_COLOR, TEXT_PRIMARY } from "../../lib/color"
import { HORIZONTAL_PADDING, button, feedback } from "../../styles/shared"
import { HOME_HEADER_ROW_TOP } from "./homeHeaderLayout"

export type ScreenTopBarAction = {
  icon: ComponentProps<typeof Ionicons>["name"]
  accessibilityLabel: string
  onPress: () => void
  /** The RUM tap name, so a translated label does not split the series. */
  actionName?: string
}

export type ScreenTopBarProps = {
  /** Omitted on the My Watch tab, whose tab bar item already names it. */
  title?: string
  /** Adds a leading back control, for a screen pushed over My Watch. */
  showBack?: boolean
  trailingAction?: ScreenTopBarAction
  /** Floats the bar over the page instead of taking a row, so the page can
   *  start its content just under the safe area. The host pads for that. */
  overlay?: boolean
}

const TARGET_SIZE = 44
// Pulls each 44pt target out so its glyph lines up with the content edge.
const EDGE_PULL = 10

type LeaveRouter = Pick<
  ReturnType<typeof useRouter>,
  "back" | "canGoBack" | "navigate"
>

/** Leave a screen pushed over My Watch. A cold deep link lands on an empty
 *  stack, where back() does nothing, so it navigates to the tab instead. */
export function leaveToMyWatch(router: LeaveRouter): void {
  if (router.canGoBack()) router.back()
  else router.navigate("/(tabs)/profile")
}

export function ScreenTopBar({
  title,
  showBack = false,
  trailingAction,
  overlay = false,
}: ScreenTopBarProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const typography = useTypography()
  const t = useT("Common")

  const handleBack = () => leaveToMyWatch(router)
  // Overlaid, only the controls take touches, so a drag beside them scrolls.
  const passThrough = overlay ? "box-none" : "auto"

  return (
    <View
      pointerEvents={passThrough}
      style={[
        overlay ? styles.overlay : styles.bar,
        { paddingTop: insets.top + HOME_HEADER_ROW_TOP },
      ]}
    >
      {overlay && (
        <View
          pointerEvents="none"
          style={[styles.statusBackdrop, { height: insets.top }]}
        />
      )}
      <View style={styles.row} pointerEvents={passThrough}>
        {showBack && (
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={t("goBackAriaLabel")}
            {...{ "dd-action-name": "screen-top-bar-back" }}
            style={({ pressed }) => [
              button.iconButton44,
              styles.leading,
              pressed && feedback.pressed,
            ]}
          >
            <Ionicons name="chevron-back" size={28} color={TEXT_PRIMARY} />
          </Pressable>
        )}
        {title != null ? (
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              styles.title,
              showBack ? typography.titleLarge : typography.headingScale.h2,
            ]}
          >
            {title}
          </Text>
        ) : (
          <View style={styles.spacer} pointerEvents="none" />
        )}
        {trailingAction != null && (
          <Pressable
            onPress={trailingAction.onPress}
            accessibilityRole="button"
            accessibilityLabel={trailingAction.accessibilityLabel}
            {...(trailingAction.actionName != null && {
              "dd-action-name": trailingAction.actionName,
            })}
            style={({ pressed }) => [
              button.iconButton44,
              styles.trailing,
              pressed && feedback.pressed,
            ]}
          >
            <Ionicons
              name={trailingAction.icon}
              size={26}
              color={TEXT_PRIMARY}
            />
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BG_COLOR,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 8,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  // Keeps scrolled content from showing under the status bar.
  statusBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: BG_COLOR,
  },
  row: {
    minHeight: TARGET_SIZE,
    flexDirection: "row",
    alignItems: "center",
  },
  leading: {
    marginLeft: -EDGE_PULL,
  },
  trailing: {
    marginRight: -EDGE_PULL,
  },
  title: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  spacer: {
    flex: 1,
  },
})
