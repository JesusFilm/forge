import { memo } from "react"
import { StyleSheet, Text, View } from "react-native"

import { useTypography } from "../../hooks/useTypography"
import { ACCENT, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import {
  formatLibraryBytes,
  type LibraryStorageSummary,
} from "../../lib/libraryDownloads"

const TRACK_COLOR = "rgba(255, 255, 255, 0.1)"

export interface StorageSummaryProps {
  summary: LibraryStorageSummary
}

/** Downloads count/size under the Library title, plus an optional device-capacity usage bar (R2). */
export const StorageSummary = memo(function StorageSummary({
  summary,
}: StorageSummaryProps) {
  const typography = useTypography()
  const { count, combinedBytes, usageFraction } = summary

  return (
    <View style={styles.root}>
      <Text style={[styles.label, typography.bodySmall]}>
        <Text style={styles.labelStrong}>{count} downloads</Text> ·{" "}
        {formatLibraryBytes(combinedBytes)}
      </Text>
      {usageFraction != null && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${usageFraction * 100}%` }]} />
        </View>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  root: {
    marginTop: 6,
  },
  label: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  labelStrong: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
  },
  track: {
    marginTop: 7,
    height: 4,
    borderRadius: 2,
    backgroundColor: TRACK_COLOR,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
})
