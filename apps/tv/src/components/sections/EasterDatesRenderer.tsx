import { Platform, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { HDate, months } from "@hebcal/hdate"

import type { NormalizedBlock } from "../../lib/normalizer"

// ── Date Calculations ───────────────────────────────────────────────────────
// SYNC: copied verbatim from apps/mobile-v2/src/components/sections/EasterDatesRenderer.tsx

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
