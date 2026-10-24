// Sign-in QR as a pure View grid via qrcode-generator (react-native-svg is
// BANNED in apps/tv — react-native-tvos-porting-pitfalls-20260414.md §2).
// Third sibling of LinkModal's QrMatrix and home/QrPanel; display-only.

import { useMemo } from "react"
import { StyleSheet, View } from "react-native"
import qrcode from "qrcode-generator"

import { scale } from "../../lib/scale"

// Above the scale(300) couch-scan floor (QrPanel's documented minimum).
const QR_TARGET_SIZE = scale(360)

// QR modules need hard black-on-white for scanner contrast — never theme tones.
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

export function SignInQr({ url }: { url: string }) {
  const matrix = useMemo(() => buildQrMatrix(url), [url])

  return (
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
  )
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: QR_LIGHT,
    borderRadius: scale(16),
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
  },
})
