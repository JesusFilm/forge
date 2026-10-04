import { useEffect, useRef, useState } from "react"
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  type AnnouncementItem,
  markAnnouncementRead,
  useAnnouncements,
} from "../../lib/announcements"
import {
  ACCENT,
  BG_COLOR,
  BLACK,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import { localDay } from "../../lib/dailyPause/today"
import { requestPause } from "../../lib/pauseCurtain"
import { HORIZONTAL_PADDING } from "../../styles/shared"
import {
  HOME_HEADER_ROW_HEIGHT,
  HOME_HEADER_ROW_TOP,
} from "../ui/homeHeaderLayout"

const PANEL_MAX_WIDTH = 320
const PANEL_GAP = 8

/** The Home header's bell. A red dot marks unread announcements, and a tap
 *  opens the list under the bell. */
export function AnnouncementsButton({
  glassStyle,
}: {
  glassStyle: StyleProp<ViewStyle>
}) {
  const [open, setOpen] = useState(false)
  const { items, unreadCount } = useAnnouncements()
  // Liquid Glass answers a touch itself. Elsewhere the bell shrinks like the
  // reader's glass buttons; never dim it, because GlassView ignores opacity.
  const nativeFeedback = isLiquidGlassAvailable() && isGlassEffectAPIAvailable()

  const openItem = (item: AnnouncementItem) => {
    markAnnouncementRead(item.id)
    setOpen(false)
    // The list fades out over the curtain's first frames.
    requestPause()
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          unreadCount > 0
            ? `Announcements, ${unreadCount} new`
            : "Announcements"
        }
        onPress={() => setOpen(true)}
      >
        {({ pressed }) => (
          <View style={!nativeFeedback && pressed && styles.pressed}>
            <GlassView
              style={glassStyle}
              glassEffectStyle="regular"
              colorScheme="dark"
              isInteractive={nativeFeedback}
            >
              <Ionicons name="notifications" size={20} color={TEXT_PRIMARY} />
            </GlassView>
            {unreadCount > 0 ? <View style={styles.badge} /> : null}
          </View>
        )}
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <AnnouncementsPanel
          items={items}
          onClose={() => setOpen(false)}
          onOpenItem={openItem}
        />
      </Modal>
    </>
  )
}

function AnnouncementsPanel({
  items,
  onClose,
  onOpenItem,
}: {
  items: AnnouncementItem[]
  onClose: () => void
  onOpenItem: (item: AnnouncementItem) => void
}) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  // The Modal mounts this panel on every open, so each open gets a new value.
  const scale = useRef(new Animated.Value(0.9)).current

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      damping: 18,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }, [scale])

  const today = localDay(new Date())

  return (
    <View style={styles.fill}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close announcements"
      />
      <Animated.View
        style={[
          styles.panel,
          {
            top:
              insets.top +
              HOME_HEADER_ROW_TOP +
              HOME_HEADER_ROW_HEIGHT +
              PANEL_GAP,
            width: Math.min(PANEL_MAX_WIDTH, width - HORIZONTAL_PADDING * 2),
            transform: [{ scale }],
          },
        ]}
      >
        <Text style={styles.heading} accessibilityRole="header">
          Announcements
        </Text>
        {items.length === 0 ? (
          <Text style={styles.empty}>No announcements yet.</Text>
        ) : (
          items.map((item) => {
            const when = item.publishedOn === today ? "Today" : item.publishedOn
            return (
              <Pressable
                key={item.id}
                onPress={() => onOpenItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.title} Daily devotional, ${when}${
                  item.unread ? ", new" : ""
                }`}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="play" size={16} color={TEXT_PRIMARY} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowMeta}>Daily devotional · {when}</Text>
                </View>
                {item.unread ? <View style={styles.rowDot} /> : null}
              </Pressable>
            )
          })
        )}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: hexToRgba(BLACK, 0.25) },
  pressed: { transform: [{ scale: 0.94 }] },
  badge: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: BG_COLOR,
  },
  panel: {
    position: "absolute",
    right: HORIZONTAL_PADDING,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: SURFACE_COLOR,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: hexToRgba(TEXT_PRIMARY, 0.1),
    transformOrigin: "top right",
    shadowColor: BLACK,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  heading: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 17,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  empty: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowPressed: { backgroundColor: hexToRgba(TEXT_PRIMARY, 0.06) },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACCENT,
  },
  rowText: { flex: 1 },
  rowTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20,
  },
  rowMeta: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 13,
    marginTop: 2,
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
})
