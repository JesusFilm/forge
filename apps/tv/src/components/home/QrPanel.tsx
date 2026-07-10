// Beta-signup QR as a pure View grid via qrcode-generator (react-native-svg is
// BANNED in apps/tv — react-native-tvos-porting-pitfalls-20260414.md §2). Mirrors
// LinkModal's QrMatrix; display-only, focus wrapper lives in MissionSection.

import { useMemo } from "react"
import { StyleSheet, Text, View } from "react-native"
import qrcode from "qrcode-generator"

import { scale } from "../../lib/scale"
import {
  BETA_CTA_LABEL,
  BETA_SIGNUP_DISPLAY_URL,
  BETA_SIGNUP_URL,
} from "./missionContent"

// QR tile target edge (quiet zone included). Above the scale(300) couch-scan
// floor; smaller than LinkModal's 480 since it shares the mission-card band.
const QR_TARGET_SIZE = scale(360)

// QR modules need hard black-on-white for scanner contrast — deliberately
// NOT Crimson Gallery surface tones.
const QR_DARK = "#000000"
const QR_LIGHT = "#FFFFFF"

type QrMatrix = {
  rows: boolean[][]
  cellSize: number
  quietZone: number
  totalSize: number
}

function buildQrMatrix(url: string): QrMatrix {
  const qr = qrcode(0, "L")
  qr.addData(url)
  qr.make()
  const n = qr.getModuleCount()
  // n + 8 = the module grid plus a 4-cell quiet zone on each side (the QR
  // spec's minimum for reliable scans).
  const cellSize = Math.round(QR_TARGET_SIZE / (n + 8))
  const quietZone = 4 * cellSize
  const totalSize = n * cellSize + quietZone * 2

  const rows: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) {
      row.push(qr.isDark(r, c))
    }
    rows.push(row)
  }

  return { rows, cellSize, quietZone, totalSize }
}

export function QrPanel() {
  // The URL is a build-time constant, so the matrix never recomputes.
  const matrix = useMemo(() => buildQrMatrix(BETA_SIGNUP_URL), [])

  return (
    <View style={styles.panel}>
      <Text style={styles.heading} numberOfLines={1}>
        {BETA_CTA_LABEL}
      </Text>

      <View
        style={[
          styles.tile,
          {
            width: matrix.totalSize,
            height: matrix.totalSize,
            padding: matrix.quietZone,
          },
        ]}
      >
        {matrix.rows.map((row, r) => (
          <View key={`qr-row-${r}`} style={styles.row}>
            {row.map((isDark, c) => (
              <View
                key={`qr-${r}-${c}`}
                style={{
                  width: matrix.cellSize,
                  height: matrix.cellSize,
                  backgroundColor: isDark ? QR_DARK : QR_LIGHT,
                }}
              />
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.urlText} numberOfLines={1}>
        {BETA_SIGNUP_DISPLAY_URL}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    alignItems: "center",
  },
  heading: {
    fontFamily: "System",
    fontSize: Math.round(scale(26)),
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: scale(20),
  },
  tile: {
    backgroundColor: QR_LIGHT,
    borderRadius: scale(16),
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
  },
  urlText: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    fontWeight: "600",
    // Bright against the frosted wash behind the beta card (was the dim
    // COLORS.muted grey before the colourful restyle).
    color: "rgba(245,245,244,0.8)",
    marginTop: scale(20),
  },
})
