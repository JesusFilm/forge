import { useEffect, useRef, useState } from "react"
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { HDate, months } from "@hebcal/hdate"

import type { EasterDatesSection } from "../../lib/sectionModels"

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// -- Date calculation algorithms --------------------------------------------

/** Gregorian computus — computes Western (Catholic/Protestant) Easter Sunday. */
export function calculateWesternEaster(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

/** Julian computus converted to Gregorian — computes Orthodox Easter Sunday. */
export function calculateOrthodoxEaster(year: number): Date {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)
  const day = ((d + e + 114) % 31) + 1
  // Julian-to-Gregorian offset: 13 days for 1900–2099.
  // Use day arithmetic (not milliseconds) to avoid DST issues.
  return new Date(year, month - 1, day + 13)
}

/** Computes Passover (15 Nisan) via @hebcal/hdate Hebrew calendar. */
export function calculatePassover(year: number): Date {
  const hebYear = new HDate(new Date(year, 3, 1)).getFullYear()
  return new HDate(15, months.NISAN, hebYear).greg()
}

// -- Animated chevron -------------------------------------------------------

function AnimatedChevron({ isExpanded }: { isExpanded: boolean }) {
  const rotation = useRef(new Animated.Value(isExpanded ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: isExpanded ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start()
  }, [isExpanded, rotation])

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  })

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Text style={styles.chevron}>▾</Text>
    </Animated.View>
  )
}

// -- Component --------------------------------------------------------------

export interface EasterDatesRendererProps {
  section: EasterDatesSection
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
}

export function EasterDatesRenderer({ section }: EasterDatesRendererProps) {
  const {
    easterDatesTitle,
    westernEasterLabel,
    orthodoxEasterLabel,
    passoverLabel,
    locale,
  } = section

  const [expanded, setExpanded] = useState(false)

  const currentYear = new Date().getFullYear()
  const westernEaster = calculateWesternEaster(currentYear)
  const orthodoxEaster = calculateOrthodoxEaster(currentYear)
  const passover = calculatePassover(currentYear)

  const formatDate = (date: Date) =>
    date.toLocaleDateString(locale ?? "en-US", DATE_OPTIONS)

  const title = (easterDatesTitle ?? "").replace("{year}", String(currentYear))

  const toggle = () => {
    LayoutAnimation.configureNext({
      duration: 300,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    })
    setExpanded((prev) => !prev)
  }

  return (
    <View style={styles.container}>
      <View style={styles.cardShadow}>
        <LinearGradient
          colors={["#5b9bd5", "#d4a033", "#c0392b"]}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={styles.card}
        >
          <Pressable
            style={styles.header}
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityState={{ expanded }}
          >
            <Text style={styles.title}>{title}</Text>
            <AnimatedChevron isExpanded={expanded} />
          </Pressable>
          {expanded && (
            <View style={styles.content}>
              <View style={styles.dateGroup}>
                <Text style={styles.dateLabel}>{westernEasterLabel}</Text>
                <Text style={styles.datePrimary}>
                  {formatDate(westernEaster)}
                </Text>
              </View>
              <View style={styles.dateGroup}>
                <Text style={styles.dateLabel}>{orthodoxEasterLabel}</Text>
                <Text style={styles.dateSecondary}>
                  {formatDate(orthodoxEaster)}
                </Text>
              </View>
              <View style={styles.dateGroup}>
                <Text style={styles.dateLabel}>{passoverLabel}</Text>
                <Text style={styles.dateSecondary}>{formatDate(passover)}</Text>
              </View>
            </View>
          )}
        </LinearGradient>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  cardShadow: {
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: "700",
    color: "rgba(0, 0, 0, 0.85)",
    marginRight: 12,
  },
  chevron: {
    fontSize: 22,
    color: "rgba(0, 0, 0, 0.6)",
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 16,
  },
  dateGroup: {
    gap: 2,
  },
  dateLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "rgba(0, 0, 0, 0.5)",
  },
  datePrimary: {
    fontSize: 28,
    fontWeight: "800",
    color: "rgba(0, 0, 0, 0.85)",
    letterSpacing: -0.5,
  },
  dateSecondary: {
    fontSize: 18,
    fontWeight: "800",
    color: "rgba(0, 0, 0, 0.75)",
  },
})
