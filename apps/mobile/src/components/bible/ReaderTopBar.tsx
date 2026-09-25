import type { ComponentProps } from "react"
import { StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_TOP_BAR_HEIGHT,
  READER_TOP_BAR_OFFSET,
} from "../../lib/bible/reader/chrome"
import { READER_COPY } from "../../lib/bible/reader/copy"
import type { TranslationDownloadState } from "../../lib/bible/repository/translationDownloads"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"
import { HORIZONTAL_PADDING } from "../../styles/shared"
import { ReaderGlassButton } from "./ReaderGlassButton"

type IconName = ComponentProps<typeof Ionicons>["name"]

export type ReaderTopBarProps = {
  tokens: ReaderTokens
  safeAreaTop: number
  /** The pushed reader's back button (R6); the Bible tab has none. */
  onBack?: () => void
  /** The pill's reference in the shown numbering, or null while waiting. */
  passage: string | null
  onPressPassage: () => void
  download: {
    state: TranslationDownloadState | null
    accessibilityLabel: string
  }
  onPressDownload: () => void
  onPressSettings: () => void
}

function downloadIcon(state: TranslationDownloadState | null): IconName {
  switch (state?.kind) {
    case "bundled":
    case "downloaded":
      return "cloud-done-outline"
    case "downloading":
      return "cloud-download"
    case "failed":
      return "alert-circle-outline"
    default:
      return "cloud-download-outline"
  }
}

/** R8: back and the pill at the left; download and settings at the right. */
export function ReaderTopBar({
  tokens,
  safeAreaTop,
  onBack,
  passage,
  onPressPassage,
  download,
  onPressDownload,
  onPressSettings,
}: ReaderTopBarProps) {
  return (
    <View
      style={[
        styles.bar,
        {
          height: safeAreaTop + READER_TOP_BAR_HEIGHT,
          paddingTop: safeAreaTop + READER_TOP_BAR_OFFSET,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.leading} pointerEvents="box-none">
        {onBack && (
          <ReaderGlassButton
            tokens={tokens}
            accessibilityLabel={READER_COPY.back}
            onPress={onBack}
          >
            <Ionicons name="chevron-back" size={24} color={tokens.icon} />
          </ReaderGlassButton>
        )}
        <ReaderGlassButton
          tokens={tokens}
          shape="pill"
          accessibilityLabel={
            passage
              ? READER_COPY.choosePassage(passage)
              : READER_COPY.choosePassageWaiting
          }
          onPress={onPressPassage}
          disabled={passage === null}
          style={styles.pill}
        >
          <Text
            style={[styles.passage, { color: tokens.text }]}
            numberOfLines={1}
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          >
            {passage ?? " "}
          </Text>
        </ReaderGlassButton>
      </View>
      <View style={styles.trailing} pointerEvents="box-none">
        <ReaderGlassButton
          tokens={tokens}
          accessibilityLabel={download.accessibilityLabel}
          onPress={onPressDownload}
          disabled={download.state === null}
        >
          <Ionicons
            name={downloadIcon(download.state)}
            size={22}
            color={tokens.icon}
          />
        </ReaderGlassButton>
        <ReaderGlassButton
          tokens={tokens}
          accessibilityLabel={READER_COPY.settings}
          onPress={onPressSettings}
        >
          <Ionicons name="settings-outline" size={22} color={tokens.icon} />
        </ReaderGlassButton>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_PADDING - 2,
    zIndex: 2,
  },
  leading: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: 4,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 8,
  },
  pill: {
    flexShrink: 1,
  },
  passage: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    fontFamily: "System",
  },
})
