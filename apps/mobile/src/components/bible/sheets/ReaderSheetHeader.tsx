import { StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { directionalIcon } from "../../../i18n/layoutRtl"
import { useT } from "../../../i18n/useT"
import { READER_TOUCH_TARGET } from "../../../lib/bible/reader/chrome"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { ReaderGlassButton } from "../ReaderGlassButton"

export type ReaderSheetHeaderProps = {
  tokens: ReaderTokens
  title: string
  /** A smaller line under the title, e.g. the book of a chapter step. */
  subtitle?: string
  onClose: () => void
  /** The previous step of a multi-step sheet. */
  back?: { label: string; onPress: () => void }
  /** Centers the title on the sheet, whatever the back button's width. */
  centerTitle?: boolean
}

// A title and a Close button. The button is the no-gesture way out of the
// sheet (PRODUCT.md): the grabber and the swipe need a precise gesture.
export function ReaderSheetHeader({
  tokens,
  title,
  subtitle,
  onClose,
  back,
  centerTitle = false,
}: ReaderSheetHeaderProps) {
  const t = useT("BibleReader")
  // Centered: two equal side slots hold the buttons, so the title sits on
  // the sheet's middle line.
  const backButton = back && (
    <ReaderGlassButton
      tokens={tokens}
      shape="pill"
      accessibilityLabel={t("sheetBackAriaLabel", { label: back.label })}
      actionName="bible-sheet-back"
      onPress={back.onPress}
      style={styles.back}
    >
      <Ionicons
        name={directionalIcon("chevron-back")}
        size={20}
        color={tokens.icon}
        style={styles.backIcon}
      />
      <Text
        style={[styles.backLabel, { color: tokens.text }]}
        numberOfLines={1}
      >
        {back.label}
      </Text>
    </ReaderGlassButton>
  )
  const closeButton = (
    <ReaderGlassButton
      tokens={tokens}
      accessibilityLabel={t("sheetCloseAriaLabel")}
      actionName="bible-sheet-close"
      onPress={onClose}
      style={styles.close}
    >
      <Ionicons name="close" size={22} color={tokens.secondaryText} />
    </ReaderGlassButton>
  )
  return (
    <View style={styles.row}>
      {centerTitle ? (
        <View style={styles.sideSlot}>{backButton}</View>
      ) : (
        backButton
      )}
      <View
        style={[styles.titleColumn, centerTitle && styles.titleColumnCentered]}
      >
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            { color: tokens.text },
            centerTitle && styles.centeredText,
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              styles.subtitle,
              { color: tokens.secondaryText },
              centerTitle && styles.centeredText,
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {centerTitle ? (
        <View style={[styles.sideSlot, styles.sideSlotEnd]}>{closeButton}</View>
      ) : (
        closeButton
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: READER_TOUCH_TARGET,
  },
  // The glass sits inside its 44 pt target; these line it up with the text.
  back: {
    flexShrink: 1,
    marginLeft: -2,
    marginRight: 4,
  },
  backIcon: {
    marginLeft: -6,
    marginRight: 2,
  },
  backLabel: {
    flexShrink: 1,
    fontSize: 16,
  },
  sideSlot: {
    flex: 1,
    flexDirection: "row",
    minWidth: READER_TOUCH_TARGET,
  },
  sideSlotEnd: {
    justifyContent: "flex-end",
  },
  titleColumn: {
    flex: 1,
    minWidth: 0,
  },
  // A long title truncates at half the row, so the back label stays readable.
  titleColumnCentered: {
    flex: 0,
    flexShrink: 1,
    maxWidth: "50%",
    alignItems: "center",
  },
  centeredText: {
    textAlign: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 1,
  },
  close: {
    marginRight: -2,
  },
})
