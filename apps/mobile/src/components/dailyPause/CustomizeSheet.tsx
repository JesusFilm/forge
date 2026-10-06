// The Customize sheet (R27-R37, R43, R47; KTD17, KTD18). Each control writes
// the settings record at once, and the reminder lifecycle reschedules from it.
// The widget row only shows how to add the widget; it changes no setting.
import Ionicons from "@expo/vector-icons/Ionicons"
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker"
import { useState } from "react"
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useSheetListHeight } from "../../hooks/useSheetListHeight"
import { usePauseFonts } from "../../lib/dailyPause/fonts"
import {
  openNotificationSettings,
  turnOnDailyPauseReminders,
} from "../../lib/dailyPause/reminders"
import {
  MEDITATION_LENGTHS,
  getPauseSettingsStore,
  usePauseSettings,
  type MeditationLength,
  type ReminderTime,
} from "../../lib/dailyPause/settings"
import {
  pauseColors,
  pauseRadii,
  pauseSizes,
  pauseSpacing,
} from "../../lib/dailyPause/theme"
import { feedback } from "../../styles/shared"

const CUSTOMIZE_COPY = {
  title: "Customize devotional",
  meditation: "MEDITATION",
  meditationGroup: "Meditation length",
  notifications: "Notifications",
  reminderOff: "A daily reminder",
  reminderOn: (time: string) => `A daily reminder at ${time}`,
  reminderTime: (time: string) => `Reminder time, ${time}`,
  reminderTimeHint: "Changes the time of the daily reminder",
  denied: (place: string) => `Notifications are off in ${place}.`,
  openSettings: "Open Settings",
  howToRow: "How to add the widget",
  howToLead: "To add the widget:",
  howToSteps: [
    "1. Touch and hold an empty area of your Home Screen.",
    "2. Tap Edit, then tap Add Widget.",
    "3. Search for Jesus Film Watch, then add Daily Bible Pause.",
  ],
  done: "Done",
} as const

const MIN_TARGET = 44
/** The frame's drawn heights. Hit slop takes each one to MIN_TARGET. */
const SEGMENT_HEIGHT = 42
const ROW_HEIGHT = 40
const SUBTITLE_LINE_HEIGHT = 18

function slopTo(height: number) {
  const slop = Math.max(0, (MIN_TARGET - height) / 2)
  return { top: slop, bottom: slop }
}

function lengthSpoken(length: MeditationLength): string {
  return length === 1 ? "1 minute" : `${length} minutes`
}

/** "7:00 AM", the frame's form. */
function formatReminderTime({ hour, minute }: ReminderTime): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const period = hour < 12 ? "AM" : "PM"
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`
}

// A fixed day with no clock change, so every wall-clock time exists on it.
function reminderDate({ hour, minute }: ReminderTime): Date {
  return new Date(2000, 0, 1, hour, minute)
}

function reminderTimeOf(date: Date): ReminderTime {
  return { hour: date.getHours(), minute: date.getMinutes() }
}

/** "asking" holds the switch on while the permission flow runs. */
type ReminderRequest = "idle" | "asking" | "denied"

type CustomizeSheetProps = {
  onDone: () => void
}

export function CustomizeSheet({ onDone }: CustomizeSheetProps) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const height = useSheetListHeight(windowHeight)
  const { ready, font } = usePauseFonts()
  const settings = usePauseSettings()
  const store = getPauseSettingsStore()
  const [request, setRequest] = useState<ReminderRequest>("idle")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)

  const isIos = Platform.OS === "ios"
  const time = formatReminderTime(settings.reminderTime)
  const reminderSwitchOn = settings.reminderOn || request === "asking"
  const denied = request === "denied" && !settings.reminderOn
  const deniedLine = CUSTOMIZE_COPY.denied(isIos ? "iOS Settings" : "Settings")

  function onReminderSwitch(next: boolean) {
    if (!next) {
      setRequest("idle")
      setPickerOpen(false)
      store.update({ reminderOn: false })
      return
    }
    setRequest("asking")
    turnOnDailyPauseReminders().then(
      (result) => setRequest(result === "denied" ? "denied" : "idle"),
      () => setRequest("idle"),
    )
  }

  function pickTime(date: Date) {
    store.update({ reminderTime: reminderTimeOf(date) })
  }

  function onReminderRow() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: reminderDate(settings.reminderTime),
        mode: "time",
        onValueChange: (_event, date) => pickTime(date),
      })
      return
    }
    setPickerOpen((open) => !open)
  }

  const rowTitle = [font("sansSemiBold"), styles.rowTitle]
  const subtitle = [font("sansRegular"), styles.subtitle]

  return (
    <View
      testID="daily-pause-customize-sheet"
      style={[styles.root, { height }]}
    >
      {ready && (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + pauseSpacing.sheetPaddingBottom },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[font("sansSemiBold"), styles.title]}
          >
            {CUSTOMIZE_COPY.title}
          </Text>
          <Text style={[font("sansSemiBold"), styles.sectionLabel]}>
            {CUSTOMIZE_COPY.meditation}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={CUSTOMIZE_COPY.meditationGroup}
            style={styles.segments}
          >
            {MEDITATION_LENGTHS.map((length) => {
              const selected = length === settings.meditationLength
              return (
                <Pressable
                  key={length}
                  accessibilityRole="radio"
                  accessibilityLabel={lengthSpoken(length)}
                  accessibilityState={{ selected }}
                  hitSlop={slopTo(SEGMENT_HEIGHT)}
                  onPress={() => {
                    if (!selected) store.update({ meditationLength: length })
                  }}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      backgroundColor: selected
                        ? pauseColors.ink
                        : pauseColors.raised,
                    },
                    pressed && feedback.pressed,
                  ]}
                >
                  <Text
                    style={[
                      font("sansSemiBold"),
                      styles.segmentText,
                      {
                        color: selected
                          ? pauseColors.background
                          : pauseColors.ink,
                      },
                    ]}
                  >
                    {`${length} min`}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <View style={styles.row}>
            {settings.reminderOn ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={CUSTOMIZE_COPY.reminderTime(time)}
                accessibilityHint={CUSTOMIZE_COPY.reminderTimeHint}
                accessibilityState={isIos ? { expanded: pickerOpen } : {}}
                hitSlop={slopTo(ROW_HEIGHT)}
                onPress={onReminderRow}
                style={({ pressed }) => [
                  styles.copy,
                  styles.timeButton,
                  pressed && feedback.pressed,
                ]}
              >
                <Text style={rowTitle}>{CUSTOMIZE_COPY.notifications}</Text>
                <Text style={subtitle}>{CUSTOMIZE_COPY.reminderOn(time)}</Text>
              </Pressable>
            ) : (
              <View style={styles.copy}>
                <Text style={rowTitle}>{CUSTOMIZE_COPY.notifications}</Text>
                {denied ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${deniedLine} ${CUSTOMIZE_COPY.openSettings}`}
                    hitSlop={slopTo(SUBTITLE_LINE_HEIGHT)}
                    onPress={() => void openNotificationSettings()}
                    style={({ pressed }) => [
                      styles.settingsLine,
                      pressed && feedback.pressed,
                    ]}
                  >
                    <Text style={subtitle}>
                      <Text>{deniedLine}</Text>{" "}
                      <Text style={[font("sansSemiBold"), styles.link]}>
                        {CUSTOMIZE_COPY.openSettings}
                      </Text>
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={subtitle}>{CUSTOMIZE_COPY.reminderOff}</Text>
                )}
              </View>
            )}
            <PauseSwitch
              label={CUSTOMIZE_COPY.notifications}
              value={reminderSwitchOn}
              onValueChange={onReminderSwitch}
            />
          </View>
          {isIos && pickerOpen && settings.reminderOn && (
            <DateTimePicker
              testID="daily-pause-reminder-time-picker"
              value={reminderDate(settings.reminderTime)}
              mode="time"
              display="spinner"
              themeVariant="dark"
              textColor={pauseColors.ink}
              onValueChange={(_event, date) => pickTime(date)}
            />
          )}

          {/* R37, R43: only iOS shows the row; this build has no Android
              widget. */}
          {isIos && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={CUSTOMIZE_COPY.howToRow}
              accessibilityState={{ expanded: howToOpen }}
              onPress={() => setHowToOpen((open) => !open)}
              style={({ pressed }) => [
                styles.row,
                styles.howToRow,
                pressed && feedback.pressed,
              ]}
            >
              <Text style={[rowTitle, styles.copy]}>
                {CUSTOMIZE_COPY.howToRow}
              </Text>
              <Ionicons
                name={howToOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={pauseColors.muted}
              />
            </Pressable>
          )}
          {isIos && howToOpen && (
            <View style={styles.howTo}>
              <Text style={[font("sansSemiBold"), styles.howToLead]}>
                {CUSTOMIZE_COPY.howToLead}
              </Text>
              {CUSTOMIZE_COPY.howToSteps.map((step) => (
                <Text key={step} style={subtitle}>
                  {step}
                </Text>
              ))}
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={CUSTOMIZE_COPY.done}
            onPress={onDone}
            style={({ pressed }) => [styles.done, pressed && feedback.pressed]}
          >
            <Text style={[font("sansSemiBold"), styles.doneText]}>
              {CUSTOMIZE_COPY.done}
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  )
}

type PauseSwitchProps = {
  label: string
  value: boolean
  onValueChange: (next: boolean) => void
}

// The frame's own switch, drawn from the tokens. It moves with no animation,
// so a change is instant with Reduce Motion on or off.
function PauseSwitch({ label, value, onValueChange }: PauseSwitchProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={slopTo(pauseSizes.switchHeight)}
      onPress={() => onValueChange(!value)}
      style={[
        styles.switchTrack,
        { backgroundColor: value ? pauseColors.accent : pauseColors.raised },
      ]}
    >
      <View
        style={[
          styles.switchKnob,
          value
            ? {
                left:
                  pauseSizes.switchWidth -
                  pauseSizes.switchKnobInset -
                  pauseSizes.switchKnob,
                backgroundColor: pauseColors.background,
              }
            : {
                left: pauseSizes.switchKnobInset,
                backgroundColor: pauseColors.white,
              },
        ]}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: pauseColors.sheet,
    overflow: "hidden",
  },
  // The native grabber takes the place of the frame's handle row.
  content: {
    paddingHorizontal: pauseSpacing.sheetPaddingX,
    paddingTop:
      pauseSpacing.sheetPaddingTop +
      pauseSizes.handleHeight +
      pauseSpacing.sheetGap,
    gap: pauseSpacing.sheetGap,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    color: pauseColors.ink,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.3,
    color: pauseColors.accent,
  },
  segments: {
    flexDirection: "row",
    gap: pauseSpacing.segmentGap,
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    paddingVertical: pauseSpacing.segmentPaddingY,
    borderRadius: pauseRadii.segment,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 15,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  copy: {
    flex: 1,
    gap: pauseSpacing.rowCopyGap,
  },
  timeButton: {
    minHeight: ROW_HEIGHT,
    justifyContent: "center",
  },
  rowTitle: {
    fontSize: 16,
    color: pauseColors.ink,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: SUBTITLE_LINE_HEIGHT,
    color: pauseColors.muted,
  },
  settingsLine: {
    minHeight: SUBTITLE_LINE_HEIGHT,
  },
  link: {
    color: pauseColors.accent,
  },
  howToRow: { minHeight: MIN_TARGET },
  howTo: {
    gap: pauseSpacing.rowCopyGap,
  },
  howToLead: {
    fontSize: 13,
    lineHeight: SUBTITLE_LINE_HEIGHT,
    color: pauseColors.ink,
  },
  switchTrack: {
    width: pauseSizes.switchWidth,
    height: pauseSizes.switchHeight,
    borderRadius: pauseRadii.switchTrack,
  },
  switchKnob: {
    position: "absolute",
    top: pauseSizes.switchKnobInset,
    width: pauseSizes.switchKnob,
    height: pauseSizes.switchKnob,
    borderRadius: pauseSizes.switchKnob / 2,
  },
  done: {
    minHeight: MIN_TARGET,
    paddingVertical: pauseSpacing.doneButtonPaddingY,
    borderRadius: pauseRadii.button,
    backgroundColor: pauseColors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: {
    fontSize: 16,
    color: pauseColors.background,
  },
})
