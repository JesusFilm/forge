import { useEffect, useSyncExternalStore } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import {
  PUSH_TEST_ID_COPY_LABEL,
  PUSH_TEST_ID_HELP,
  PUSH_TEST_ID_NOTIFICATIONS_OFF,
  PUSH_TEST_ID_REGISTERING,
  PUSH_TEST_ID_ROW_LABEL,
  PUSH_TEST_ID_SECTION_TITLE,
  PUSH_TEST_ID_SHARE_LABEL,
} from "../../lib/push/constants"
import { getPushRegistrationStore } from "../../lib/push/store"
import { copyPushTestId, sharePushTestId } from "../../lib/push/testIdActions"
import {
  CARD_BORDER_RADIUS,
  HORIZONTAL_PADDING,
  button,
  feedback,
} from "../../styles/shared"

function usePushRegistration() {
  const store = getPushRegistrationStore()
  // The record is read from storage once per launch; the row is often the
  // first reader on a launch where the viewer never granted permission.
  useEffect(() => {
    void store.hydrate()
  }, [store])
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => store.getSnapshot(),
  )
}

/**
 * R31's Profile row: the notification test ID an admin user pastes into the
 * test-device list, with copy and share. The ID is a separate identifier that
 * admin minted for this phone — never the push token, which the app does not
 * keep at all.
 *
 * Before the first registration lands the row reads as registering, and while
 * permission is denied it says so instead. Both keep copy and share disabled,
 * because there is nothing to hand over yet.
 */
export function NotificationTestIdSection() {
  const typography = useTypography()
  const { testDeviceId, permission } = usePushRegistration()
  const hasId = testDeviceId != null && testDeviceId.length > 0

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, typography.titleSmall]}>
        {PUSH_TEST_ID_SECTION_TITLE}
      </Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.textBlock}>
            <Text style={styles.rowLabel}>{PUSH_TEST_ID_ROW_LABEL}</Text>
            {hasId ? (
              <Text
                style={[styles.value, typography.body]}
                selectable
                numberOfLines={1}
              >
                {testDeviceId}
              </Text>
            ) : (
              <Text style={styles.placeholder}>
                {permission === "denied"
                  ? PUSH_TEST_ID_NOTIFICATIONS_OFF
                  : PUSH_TEST_ID_REGISTERING}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => {
              // The guard belongs here as well as on `disabled`: a disabled
              // Pressable still holds its handler, which automation can call.
              if (testDeviceId == null) return
              copyPushTestId(testDeviceId)
            }}
            disabled={!hasId}
            style={({ pressed }) => [
              button.iconButton44,
              pressed && feedback.pressed,
              !hasId && styles.controlDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={PUSH_TEST_ID_COPY_LABEL}
            accessibilityState={{ disabled: !hasId }}
          >
            <Ionicons
              name="copy-outline"
              size={20}
              color={hasId ? ACCENT : TEXT_SECONDARY}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              if (testDeviceId == null) return
              sharePushTestId(testDeviceId)
            }}
            disabled={!hasId}
            style={({ pressed }) => [
              button.iconButton44,
              pressed && feedback.pressed,
              !hasId && styles.controlDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={PUSH_TEST_ID_SHARE_LABEL}
            accessibilityState={{ disabled: !hasId }}
          >
            <Ionicons
              name="share-outline"
              size={20}
              color={hasId ? ACCENT : TEXT_SECONDARY}
            />
          </Pressable>
        </View>
        {hasId && permission === "denied" ? (
          <Text style={styles.placeholder}>
            {PUSH_TEST_ID_NOTIFICATIONS_OFF}
          </Text>
        ) : (
          <Text style={styles.help}>{PUSH_TEST_ID_HELP}</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 24,
  },
  sectionTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    marginBottom: 8,
  },
  card: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  textBlock: {
    flex: 1,
  },
  rowLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
  },
  value: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    marginTop: 2,
  },
  placeholder: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 16,
    marginTop: 2,
  },
  help: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    lineHeight: 16,
  },
  controlDisabled: {
    opacity: 0.4,
  },
})
