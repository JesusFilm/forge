import { memo } from "react"
import { StyleSheet, Text, View } from "react-native"

import { useTypography } from "../../hooks/useTypography"
import { TEXT_PRIMARY } from "../../lib/color"

const SEPARATOR_COLOR = "rgba(255, 255, 255, 0.1)"

export interface DownloadsSummaryProps {
  count: number
}

/** The downloads count under the Library head row, over a 1pt separator line. */
export const DownloadsSummary = memo(function DownloadsSummary({
  count,
}: DownloadsSummaryProps) {
  const typography = useTypography()

  return (
    <View style={styles.root}>
      <Text style={[styles.label, typography.bodySmall]}>
        {`${count} download${count === 1 ? "" : "s"}`}
      </Text>
      <View testID="downloads-summary-separator" style={styles.separator} />
    </View>
  )
})

const styles = StyleSheet.create({
  root: {
    marginTop: 6,
  },
  label: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  separator: {
    marginTop: 7,
    height: 1,
    backgroundColor: SEPARATOR_COLOR,
  },
})
