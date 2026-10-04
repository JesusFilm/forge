import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui"
import {
  containerBackground,
  font,
  foregroundStyle,
  kerning,
  lineLimit,
  truncationMode,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers"
import { createWidget, type WidgetEnvironment } from "expo-widgets"

import type { DailyPauseWidgetProps } from "../lib/dailyPause/widgetTimeline"

/** KTD14, KTD18, R9, R38. The extension runs this from a string, so the body
 *  copies the Pass 2 colors of `theme.ts` and cannot read module scope. Each
 *  part checks its own prop, because the system placeholder passes none. */
const DailyPauseWidgetLayout = (
  props: DailyPauseWidgetProps,
  environment: WidgetEnvironment,
) => {
  "widget"
  const background = "#0c0b0a"
  const ink = "#f4efe6"
  const accent = "#f2c46b"
  const muted = "#b7a99a"
  const questionSize = environment.widgetFamily === "systemMedium" ? 21 : 17
  const root = [containerBackground(background, "widget")]
  if (props.url) root.push(widgetURL(props.url))
  return (
    <HStack modifiers={root}>
      <VStack alignment="leading" spacing={0}>
        {props.label ? (
          <Text
            modifiers={[
              font({ size: 11, weight: "semibold" }),
              kerning(1.5),
              foregroundStyle(accent),
              lineLimit(1),
            ]}
          >
            {props.label}
          </Text>
        ) : null}
        <Spacer minLength={8} />
        {props.state === "question" ? (
          <HStack alignment="firstTextBaseline" spacing={6}>
            {props.done ? (
              <Image
                systemName="checkmark"
                size={questionSize - 3}
                color={accent}
              />
            ) : null}
            <Text
              modifiers={[
                font({ design: "serif", size: questionSize }),
                foregroundStyle(ink),
                lineLimit(3),
                truncationMode("tail"),
              ]}
            >
              {props.question}
            </Text>
          </HStack>
        ) : null}
        {props.state === "off" ? (
          <Text
            modifiers={[
              font({ design: "serif", size: 15 }),
              foregroundStyle(muted),
              lineLimit(1),
            ]}
          >
            {props.message}
          </Text>
        ) : null}
      </VStack>
      <Spacer minLength={0} />
    </HStack>
  )
}

/** The app writes the timeline (`DailyPauseWidgetTimeline`); the require of
 *  this module stores the layout in the App Group. */
export const dailyPauseWidget = createWidget<DailyPauseWidgetProps>(
  "DailyPauseWidget",
  DailyPauseWidgetLayout,
)
