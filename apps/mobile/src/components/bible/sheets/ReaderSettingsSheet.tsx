import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useSheetListHeight } from "../../../hooks/useSheetListHeight"
import {
  READER_TOUCH_TARGET,
  type ReaderLayout,
} from "../../../lib/bible/reader/chrome"
import { READER_SHEET_COPY } from "../../../lib/bible/sheets/copy"
import { readerSheetControlColors } from "../../../lib/bible/sheets/theme"
import {
  READER_LINE_SPACINGS,
  READER_MODES,
  READER_PALETTES,
  READER_TEXT_SIZE_STEPS,
  READER_TYPEFACES,
  type ReaderSettings,
} from "../../../lib/bible/settings/snapshot"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { readingFontFamily } from "../../../lib/bible/theme/typography"
import { feedback, HORIZONTAL_PADDING } from "../../../styles/shared"
import { ReaderSheetHeader } from "./ReaderSheetHeader"

const COPY = READER_SHEET_COPY.settings

/** Option labels stop growing here, so a row of five still fits a phone. */
const OPTION_MAX_FONT_SCALE = 1.3

export type ReaderSettingsSheetProps = {
  tokens: ReaderTokens
  settings: ReaderSettings
  /** R11: a tablet always shows the arrow buttons, so it has no setting. */
  layout: ReaderLayout
  /** The shown translation's own credit; null for BSB or while unknown. */
  currentCredit: { name: string; credit: string } | null
  onChange: (patch: Partial<ReaderSettings>) => void
  onClose: () => void
}

// R33's seven settings and the "About the text" credits (KTD6). Each change
// goes to the settings store, which the reader and this sheet both read.
export function ReaderSettingsSheet({
  tokens,
  settings,
  layout,
  currentCredit,
  onChange,
  onClose,
}: ReaderSettingsSheetProps) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const height = useSheetListHeight(windowHeight)
  const secondary = { color: tokens.secondaryText }

  return (
    <View
      testID="reader-settings-sheet"
      style={[styles.root, { height, backgroundColor: tokens.background }]}
    >
      <View style={styles.header}>
        <ReaderSheetHeader
          tokens={tokens}
          title={COPY.title}
          onClose={onClose}
        />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: HORIZONTAL_PADDING,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <OptionGroup
          tokens={tokens}
          label={COPY.mode}
          value={settings.mode}
          options={READER_MODES.map((mode) => ({
            value: mode,
            label: COPY.modes[mode],
          }))}
          onSelect={(mode) => onChange({ mode })}
        />
        <OptionGroup
          tokens={tokens}
          label={COPY.textSize}
          value={settings.textSizeStep}
          options={READER_TEXT_SIZE_STEPS.map((_, step) => ({
            value: step,
            label: "A",
            accessibilityLabel: COPY.textSizeStep(
              step + 1,
              READER_TEXT_SIZE_STEPS.length,
            ),
            textStyle: { fontSize: 13 + step * 3 },
          }))}
          onSelect={(textSizeStep) => onChange({ textSizeStep })}
        />
        <OptionGroup
          tokens={tokens}
          label={COPY.palette}
          value={settings.palette}
          options={READER_PALETTES.map((palette) => ({
            value: palette,
            label: COPY.palettes[palette],
          }))}
          onSelect={(palette) => onChange({ palette })}
        />
        <OptionGroup
          tokens={tokens}
          label={COPY.typeface}
          value={settings.typeface}
          options={READER_TYPEFACES.map((typeface) => ({
            value: typeface,
            label: COPY.typefaces[typeface],
            // Each option shows in its own face.
            textStyle: {
              fontFamily: readingFontFamily(
                typeface,
                COPY.typefaces[typeface],
                Platform.OS,
              ),
            },
          }))}
          onSelect={(typeface) => onChange({ typeface })}
        />
        <OptionGroup
          tokens={tokens}
          label={COPY.lineSpacing}
          value={settings.lineSpacing}
          options={READER_LINE_SPACINGS.map((lineSpacing) => ({
            value: lineSpacing,
            label: COPY.lineSpacings[lineSpacing],
          }))}
          onSelect={(lineSpacing) => onChange({ lineSpacing })}
        />
        <SwitchRow
          tokens={tokens}
          label={COPY.verseNumbers}
          value={settings.verseNumbers}
          onChange={(verseNumbers) => onChange({ verseNumbers })}
        />
        {layout === "phone" && (
          <SwitchRow
            tokens={tokens}
            label={COPY.showArrows}
            hint={COPY.showArrowsHint}
            value={settings.showArrows}
            onChange={(showArrows) => onChange({ showArrows })}
          />
        )}
        <View style={styles.about}>
          <Text
            accessibilityRole="header"
            style={[styles.groupLabel, secondary]}
          >
            {COPY.aboutTitle}
          </Text>
          {currentCredit && (
            <Text style={[styles.credit, { color: tokens.text }]}>
              {COPY.currentCredit(currentCredit.name, currentCredit.credit)}
            </Text>
          )}
          <Text style={[styles.credit, secondary]}>{COPY.bsbCredit}</Text>
          <Text style={[styles.credit, secondary]}>{COPY.catalogCredit}</Text>
          <Text style={[styles.credit, secondary]}>
            {COPY.versificationCredit}
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

type Option<T> = {
  value: T
  label: string
  accessibilityLabel?: string
  textStyle?: TextStyle
}

type OptionGroupProps<T> = {
  tokens: ReaderTokens
  label: string
  value: T
  options: Option<T>[]
  onSelect: (value: T) => void
}

function OptionGroup<T extends string | number>({
  tokens,
  label,
  value,
  options,
  onSelect,
}: OptionGroupProps<T>) {
  const controls = readerSheetControlColors(tokens)
  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: tokens.secondaryText }]}>
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={styles.options}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => {
                if (!selected) onSelect(option.value)
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: selected
                    ? controls.selectedFill
                    : controls.fill,
                },
                pressed && feedback.pressed,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  {
                    color: selected ? controls.selectedText : controls.text,
                  },
                  option.textStyle,
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={OPTION_MAX_FONT_SCALE}
              >
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

type SwitchRowProps = {
  tokens: ReaderTokens
  label: string
  hint?: string
  value: boolean
  onChange: (value: boolean) => void
}

function SwitchRow({ tokens, label, hint, value, onChange }: SwitchRowProps) {
  const controls = readerSheetControlColors(tokens)
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={[styles.switchLabel, { color: tokens.text }]}>
          {label}
        </Text>
        {hint && (
          <Text style={[styles.hint, { color: tokens.secondaryText }]}>
            {hint}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: controls.switchOff, true: controls.switchOn }}
        ios_backgroundColor={controls.switchOff}
        thumbColor="#ffffff"
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
  },
  header: {
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  scroll: {
    flex: 1,
  },
  group: {
    marginBottom: 18,
  },
  groupLabel: {
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  options: {
    flexDirection: "row",
    gap: 8,
  },
  option: {
    flex: 1,
    minHeight: READER_TOUCH_TARGET,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "500",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    marginBottom: 8,
  },
  switchText: {
    flex: 1,
  },
  switchLabel: {
    fontFamily: "System",
    fontSize: 16,
  },
  hint: {
    fontFamily: "System",
    fontSize: 14,
    marginTop: 2,
  },
  about: {
    marginTop: 16,
    gap: 8,
  },
  credit: {
    fontFamily: "System",
    fontSize: 14,
    lineHeight: 20,
  },
})
