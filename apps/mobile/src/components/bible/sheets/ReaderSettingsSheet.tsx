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
import { useT, type UiMessageKey } from "../../../i18n/useT"
import {
  READER_TOUCH_TARGET,
  type ReaderLayout,
} from "../../../lib/bible/reader/chrome"
import {
  BIBLE_NOTICES,
  BIBLE_NOTICE_LANGUAGE,
} from "../../../lib/bible/sheets/copy"
import { readerSheetControlColors } from "../../../lib/bible/sheets/theme"
import {
  READER_LINE_SPACING_STEPS,
  READER_MODES,
  READER_TEXT_SIZE_STEPS,
  READER_TYPEFACES,
  type ReaderMode,
  type ReaderSettings,
  type ReaderTypeface,
} from "../../../lib/bible/settings/snapshot"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { readingFontFamily } from "../../../lib/bible/theme/typography"
import { feedback, HORIZONTAL_PADDING } from "../../../styles/shared"
import { ReaderSheetHeader } from "./ReaderSheetHeader"
import {
  ReaderStepSlider,
  SizeGlyph,
  SpacingGlyph,
  type ReaderStepSliderProps,
} from "./ReaderStepSlider"

type SettingsKey = UiMessageKey<"BibleReaderSettings">

const MODE_KEYS: Record<ReaderMode, SettingsKey> = {
  system: "modeSystem",
  light: "modeLight",
  dark: "modeDark",
  trueDark: "modeTrueDark",
}

const TYPEFACE_KEYS: Record<ReaderTypeface, SettingsKey> = {
  serif: "typefaceSerif",
  sans: "typefaceSans",
}

// The screen reader says each spacing as a percent of the text size.
const LINE_SPACING_PERCENTS = READER_LINE_SPACING_STEPS.map((factor) =>
  Math.round(factor * 100),
)

/** Option labels stop growing here, so a row of four still fits a phone. */
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

// R33's six settings and the "About the text" credits (KTD6). Each change
// goes to the settings store, which the reader and this sheet both read.
export function ReaderSettingsSheet({
  tokens,
  settings,
  layout,
  currentCredit,
  onChange,
  onClose,
}: ReaderSettingsSheetProps) {
  const t = useT("BibleReaderSettings")
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const height = useSheetListHeight(windowHeight)
  const secondary = { color: tokens.secondaryText }
  const glyph = readerSheetControlColors(tokens).text

  return (
    <View
      testID="reader-settings-sheet"
      style={[styles.root, { height, backgroundColor: tokens.background }]}
    >
      <View style={styles.header}>
        <ReaderSheetHeader
          tokens={tokens}
          title={t("title")}
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
          label={t("mode")}
          actionName="bible-settings-mode"
          value={settings.mode}
          options={READER_MODES.map((mode) => ({
            value: mode,
            label: t(MODE_KEYS[mode]),
          }))}
          onSelect={(mode) => onChange({ mode })}
        />
        <SliderGroup
          testID="reader-text-size-slider"
          tokens={tokens}
          label={t("textSize")}
          spokenValues={READER_TEXT_SIZE_STEPS}
          unit={t("textSizeAriaUnit")}
          value={settings.textSizeStep}
          onChange={(textSizeStep) => onChange({ textSizeStep })}
          start={<SizeGlyph size={13} color={glyph} />}
          end={<SizeGlyph size={24} color={glyph} />}
        />
        <SliderGroup
          testID="reader-line-spacing-slider"
          tokens={tokens}
          label={t("lineSpacing")}
          spokenValues={LINE_SPACING_PERCENTS}
          unit={t("lineSpacingAriaUnit")}
          value={settings.lineSpacingStep}
          onChange={(lineSpacingStep) => onChange({ lineSpacingStep })}
          start={<SpacingGlyph gap={2} color={glyph} />}
          end={<SpacingGlyph gap={5} color={glyph} />}
        />
        <OptionGroup
          tokens={tokens}
          label={t("typeface")}
          actionName="bible-settings-typeface"
          value={settings.typeface}
          options={READER_TYPEFACES.map((typeface) => ({
            value: typeface,
            label: t(TYPEFACE_KEYS[typeface]),
            // Each option shows in its own face.
            textStyle: {
              fontFamily: readingFontFamily(
                typeface,
                t(TYPEFACE_KEYS[typeface]),
                Platform.OS,
              ),
            },
          }))}
          onSelect={(typeface) => onChange({ typeface })}
        />
        <SwitchRow
          tokens={tokens}
          label={t("verseNumbers")}
          actionName="bible-settings-verse-numbers"
          value={settings.verseNumbers}
          onChange={(verseNumbers) => onChange({ verseNumbers })}
        />
        {layout === "phone" && (
          <SwitchRow
            tokens={tokens}
            label={t("showArrows")}
            actionName="bible-settings-show-arrows"
            hint={t("showArrowsHint")}
            value={settings.showArrows}
            onChange={(showArrows) => onChange({ showArrows })}
          />
        )}
        <View style={styles.about}>
          <Text
            accessibilityRole="header"
            style={[styles.groupLabel, secondary]}
          >
            {t("aboutTitle")}
          </Text>
          {/* KTD17: the notices stay English, marked for a screen reader. */}
          {currentCredit && (
            <Text
              style={[styles.credit, { color: tokens.text }]}
              accessibilityLanguage={BIBLE_NOTICE_LANGUAGE}
            >
              {BIBLE_NOTICES.currentCredit(
                currentCredit.name,
                currentCredit.credit,
              )}
            </Text>
          )}
          {[
            BIBLE_NOTICES.bsbCredit,
            BIBLE_NOTICES.catalogCredit,
            BIBLE_NOTICES.versificationCredit,
          ].map((notice) => (
            <Text
              key={notice}
              style={[styles.credit, secondary]}
              accessibilityLanguage={BIBLE_NOTICE_LANGUAGE}
            >
              {notice}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

type Option<T> = {
  value: T
  label: string
  textStyle?: TextStyle
}

type OptionGroupProps<T> = {
  tokens: ReaderTokens
  label: string
  /** The Datadog tap name for every option; the labels are translated. */
  actionName: string
  value: T
  options: Option<T>[]
  onSelect: (value: T) => void
}

function OptionGroup<T extends string>({
  tokens,
  label,
  actionName,
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
              accessibilityLabel={option.label}
              {...{ "dd-action-name": `${actionName}-${option.value}` }}
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

function SliderGroup(props: ReaderStepSliderProps) {
  return (
    <View style={styles.group}>
      {/* The slider carries the same name, so a screen reader skips this. */}
      <Text
        style={[styles.groupLabel, { color: props.tokens.secondaryText }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {props.label}
      </Text>
      <ReaderStepSlider {...props} />
    </View>
  )
}

type SwitchRowProps = {
  tokens: ReaderTokens
  label: string
  actionName: string
  hint?: string
  value: boolean
  onChange: (value: boolean) => void
}

function SwitchRow({
  tokens,
  label,
  actionName,
  hint,
  value,
  onChange,
}: SwitchRowProps) {
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
        {...{ "dd-action-name": actionName }}
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
    writingDirection: "ltr",
  },
})
