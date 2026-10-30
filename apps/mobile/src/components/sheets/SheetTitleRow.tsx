import type { ReactNode } from "react"
import { StyleSheet, Text, View } from "react-native"

import { TEXT_PRIMARY } from "../../lib/color"

export type SheetTitleRowProps = {
  title: string
  /** A control at the end of the row, such as a switch. */
  trailing?: ReactNode
}

// A sheet title centered on the sheet, as in the Bible reader's book picker.
// Two equal side slots keep it centered whatever the trailing control's width,
// so the one-line title needs no textAlign.
export function SheetTitleRow({ title, trailing }: SheetTitleRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.side} />
      <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.side, styles.sideEnd]}>{trailing}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
    marginBottom: 12,
  },
  // The Switch's width: a long title truncates instead of covering it.
  side: {
    flex: 1,
    flexDirection: "row",
    minWidth: 52,
  },
  sideEnd: {
    justifyContent: "flex-end",
  },
  // The same size as `ReaderSheetHeader`'s title, without text scaling.
  title: {
    flexShrink: 1,
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: "600",
  },
})
