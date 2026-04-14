import { Platform, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { HDate, months } from "@hebcal/hdate"

import type { NormalizedBlock } from "../../lib/normalizer"
import {
  calculateWesternEaster,
  calculateOrthodoxEaster,
} from "../../lib/easterDates"

/** Passover (15 Nisan) via @hebcal/hdate. */
function calculatePassover(year: number): Date {
  const hebYear = new HDate(new Date(year, 3, 1)).getFullYear()
  return new HDate(15, months.NISAN, hebYear).greg()
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
}

/** Round font sizes on Android to avoid sub-pixel blurriness. */
function fontSize(size: number): number {
  return Platform.OS === "android" ? Math.round(size) : size
}

// ── Component ───────────────────────────────────────────────────────────────

export function EasterDatesRenderer({ section }: { section: NormalizedBlock }) {
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

  return (
    <View style={styles.outerContainer}>
      <View style={styles.cardShadow}>
        <LinearGradient
          colors={["#5b9bd5", "#d4a033", "#c0392b"]}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={styles.card}
        >
          {title !== "" && <Text style={styles.title}>{title}</Text>}
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
        </LinearGradient>
      </View>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  outerContainer: {
    paddingHorizontal: 80,
    paddingVertical: 16,
  },
  cardShadow: {
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  card: {
    borderRadius: 16,
    overflow: "hidden",
    paddingHorizontal: 40,
    paddingVertical: 32,
  },
  title: {
    fontFamily: "System",
    fontSize: fontSize(32),
    fontWeight: "700",
    color: "rgba(0, 0, 0, 0.85)",
    marginBottom: 24,
  },
  content: {
    gap: 20,
  },
  dateGroup: {
    gap: 4,
  },
  dateLabel: {
    fontFamily: "System",
    fontSize: fontSize(18),
    fontWeight: "500",
    color: "rgba(0, 0, 0, 0.5)",
  },
  datePrimary: {
    fontFamily: "System",
    fontSize: fontSize(28),
    fontWeight: "800",
    color: "rgba(0, 0, 0, 0.85)",
    letterSpacing: -0.5,
  },
  dateSecondary: {
    fontFamily: "System",
    fontSize: fontSize(22),
    fontWeight: "800",
    color: "rgba(0, 0, 0, 0.75)",
  },
})
