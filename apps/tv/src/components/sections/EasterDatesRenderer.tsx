import { StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { HDate, months } from "@hebcal/hdate"

import type { EasterDatesBlockModel } from "../../lib/normalizer"
import { scale } from "../../lib/scale"
import { hexToRgba } from "../../lib/colors"
import { WATCH_THEME } from "../watch/watchDetailTheme"
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

// ── Component ───────────────────────────────────────────────────────────────

export function EasterDatesRenderer({
  section,
}: {
  section: EasterDatesBlockModel
}) {
  const { easterDatesTitle, westernEasterLabel, orthodoxEasterLabel } = section
  const passoverLabel = section.passoverLabel
  const locale = section.locale ?? "en-US"

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
          colors={[WATCH_THEME.accent, hexToRgba(WATCH_THEME.accent, 0.4)]}
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
    paddingHorizontal: scale(80),
    paddingVertical: scale(16),
  },
  cardShadow: {
    borderRadius: scale(16),
    shadowColor: WATCH_THEME.scrim(1),
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.2,
    shadowRadius: scale(12),
    elevation: 6,
  },
  card: {
    borderRadius: scale(16),
    overflow: "hidden",
    // Near-black base under the accent ramp: the gradient's translucent tail
    // reads as a darkened accent rather than washing to the page color.
    backgroundColor: WATCH_THEME.scrim(1),
    paddingHorizontal: scale(40),
    paddingVertical: scale(32),
  },
  title: {
    fontFamily: "System",
    fontSize: scale(32),
    fontWeight: "700",
    color: WATCH_THEME.text,
    marginBottom: scale(24),
  },
  content: {
    gap: scale(20),
  },
  dateGroup: {
    gap: scale(4),
  },
  dateLabel: {
    fontFamily: "System",
    fontSize: scale(18),
    fontWeight: "500",
    color: WATCH_THEME.text66,
  },
  datePrimary: {
    fontFamily: "System",
    fontSize: scale(28),
    fontWeight: "800",
    color: WATCH_THEME.text,
    letterSpacing: -0.5,
  },
  dateSecondary: {
    fontFamily: "System",
    fontSize: scale(22),
    fontWeight: "800",
    color: WATCH_THEME.text82,
  },
})
