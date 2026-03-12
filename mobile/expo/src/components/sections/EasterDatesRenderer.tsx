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

import type { EasterDatesSection } from "../../lib/sectionModels"

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export interface EasterDatesRendererProps {
  section: EasterDatesSection
}

function calculateWesternEaster(year: number): Date {
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

function calculateOrthodoxEaster(year: number): Date {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)
  const day = ((d + e + 114) % 31) + 1
  const julianDate = new Date(year, month - 1, day)
  return new Date(julianDate.getTime() + 13 * 24 * 60 * 60 * 1000)
}

function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function AnimatedChevron({ isExpanded }: { isExpanded: boolean }) {
  const rotation = useRef(new Animated.Value(isExpanded ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: isExpanded ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start()
  }, [isExpanded, rotation])

  const rotateInterpolation = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  })

  return (
    // @ts-expect-error React 19 vs RN component types
    <Animated.View style={{ transform: [{ rotate: rotateInterpolation }] }}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.chevron}>&#x25BE;</Text>
    </Animated.View>
  )
}

export function EasterDatesRenderer({ section }: EasterDatesRendererProps) {
  const {
    easterDatesTitle,
    westernEasterLabel,
    orthodoxEasterLabel,
    passoverLabel,
    locale,
  } = section

  const currentYear = new Date().getFullYear()
  const westernEaster = calculateWesternEaster(currentYear)
  const orthodoxEaster = calculateOrthodoxEaster(currentYear)
  // Passover calculation requires @hebcal/hdate which is web-only;
  // use a static offset from Western Easter (Passover is typically the day before)
  const passoverDate = new Date(westernEaster.getTime() - 24 * 60 * 60 * 1000)

  const resolvedLocale = locale ?? "en-US"

  const title = (
    easterDatesTitle ?? "When is Easter celebrated in {year}?"
  ).replace("{year}", String(currentYear))

  const [expanded, setExpanded] = useState(false)

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
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error React 19 vs RN component types */}
      <View style={styles.gradient}>
        {/* @ts-expect-error React 19 vs RN component types */}
        <Pressable
          style={styles.header}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded }}
        >
          {/* @ts-expect-error RN Text vs React 19 ReactNode */}
          <Text style={styles.title}>{title}</Text>
          <AnimatedChevron isExpanded={expanded} />
        </Pressable>
        {expanded && (
          // @ts-expect-error React 19 vs RN component types
          <View style={styles.content}>
            {/* @ts-expect-error React 19 vs RN component types */}
            <View style={styles.dateGroup}>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.dateLabel}>
                {westernEasterLabel ?? "Western Easter (Catholic/Protestant)"}
              </Text>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.datePrimary}>
                {formatDate(westernEaster, resolvedLocale)}
              </Text>
            </View>
            {/* @ts-expect-error React 19 vs RN component types */}
            <View style={styles.dateGroup}>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.dateLabel}>
                {orthodoxEasterLabel ?? "Orthodox"}
              </Text>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.dateSecondary}>
                {formatDate(orthodoxEaster, resolvedLocale)}
              </Text>
            </View>
            {/* @ts-expect-error React 19 vs RN component types */}
            <View style={styles.dateGroup}>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.dateLabel}>
                {passoverLabel ?? "Jewish Passover"}
              </Text>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.dateSecondary}>
                {formatDate(passoverDate, resolvedLocale)}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  gradient: {
    padding: 20,
    backgroundColor: "#e8a020",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: "700",
    color: "rgba(0, 0, 0, 0.85)",
    marginRight: 12,
  },
  chevron: {
    fontSize: 20,
    color: "rgba(0, 0, 0, 0.6)",
  },
  content: {
    marginTop: 16,
    gap: 16,
  },
  dateGroup: {
    gap: 2,
  },
  dateLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: "rgba(0, 0, 0, 0.5)",
  },
  datePrimary: {
    fontSize: 32,
    fontWeight: "800",
    color: "rgba(0, 0, 0, 0.85)",
    letterSpacing: -1,
  },
  dateSecondary: {
    fontSize: 18,
    fontWeight: "700",
    color: "rgba(0, 0, 0, 0.75)",
  },
})
