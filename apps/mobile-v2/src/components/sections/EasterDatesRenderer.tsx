import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { HDate, months } from "@hebcal/hdate"

import { AnimatedChevron, animateLayout } from "../ui/AnimatedChevron"
import { useTypography } from "../../hooks/useTypography"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Date Calculations ───────────────────────────────────────────────────────

/** Gregorian computus -- Western (Catholic/Protestant) Easter Sunday. */
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

/** Julian computus converted to Gregorian -- Orthodox Easter Sunday. */
export function calculateOrthodoxEaster(year: number): Date {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)
  const day = ((d + e + 114) % 31) + 1
  // Julian-to-Gregorian offset: 13 days for 1900-2099
  return new Date(year, month - 1, day + 13)
}

/** Passover (15 Nisan) via @hebcal/hdate. */
export function calculatePassover(year: number): Date {
  const hebYear = new HDate(new Date(year, 3, 1)).getFullYear()
  return new HDate(15, months.NISAN, hebYear).greg()
}

// ── Component ───────────────────────────────────────────────────────────────

export interface EasterDatesRendererProps {
  section: NormalizedBlock
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
}

export function EasterDatesRenderer({ section }: EasterDatesRendererProps) {
  const typography = useTypography()
  const [expanded, setExpanded] = useState(false)

  const easterDatesTitle = section.easterDatesTitle as string | null
  const westernEasterLabel = section.westernEasterLabel as string | null
  const orthodoxEasterLabel = section.orthodoxEasterLabel as string | null
  const passoverLabel = section.passoverLabel as string | null
  const locale = (section.locale as string | null) ?? "en-US"

  const currentYear = new Date().getFullYear()
  const westernEaster = calculateWesternEaster(currentYear)
  const orthodoxEaster = calculateOrthodoxEaster(currentYear)
  const passover = calculatePassover(currentYear)

  const formatDate = (date: Date) =>
    date.toLocaleDateString(locale, DATE_OPTIONS)

  const title = (easterDatesTitle ?? "").replace("{year}", String(currentYear))

  const toggle = () => {
    animateLayout()
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
            <Text style={[styles.title, typography.titleLarge]}>{title}</Text>
            <AnimatedChevron
              isExpanded={expanded}
              fromDeg="0deg"
              toDeg="180deg"
              glyph={"\u25BE"}
              style={styles.chevron}
            />
          </Pressable>
          {expanded && (
            <View style={styles.content}>
              <View style={styles.dateGroup}>
                <Text style={[styles.dateLabel, typography.body]}>
                  {westernEasterLabel}
                </Text>
                <Text style={[styles.datePrimary, typography.headingScale.h2]}>
                  {formatDate(westernEaster)}
                </Text>
              </View>
              <View style={styles.dateGroup}>
                <Text style={[styles.dateLabel, typography.body]}>
                  {orthodoxEasterLabel}
                </Text>
                <Text style={[styles.dateSecondary, typography.titleSmall]}>
                  {formatDate(orthodoxEaster)}
                </Text>
              </View>
              <View style={styles.dateGroup}>
                <Text style={[styles.dateLabel, typography.body]}>
                  {passoverLabel}
                </Text>
                <Text style={[styles.dateSecondary, typography.titleSmall]}>
                  {formatDate(passover)}
                </Text>
              </View>
            </View>
          )}
        </LinearGradient>
      </View>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
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
    minHeight: 48,
  },
  title: {
    flex: 1,
    fontWeight: "700",
    color: "rgba(0, 0, 0, 0.85)",
    fontFamily: "System",
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
    fontWeight: "500",
    color: "rgba(0, 0, 0, 0.5)",
    fontFamily: "System",
  },
  datePrimary: {
    fontWeight: "800",
    color: "rgba(0, 0, 0, 0.85)",
    fontFamily: "System",
    letterSpacing: -0.5,
  },
  dateSecondary: {
    fontWeight: "800",
    color: "rgba(0, 0, 0, 0.75)",
    fontFamily: "System",
  },
})
