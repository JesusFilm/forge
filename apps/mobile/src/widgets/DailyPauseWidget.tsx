import { Text, VStack } from "@expo/ui/swift-ui"
import {
  containerBackground,
  font,
  foregroundStyle,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers"
import { createWidget, type WidgetEnvironment } from "expo-widgets"

const DailyPauseWidgetLayout = (
  _props: object,
  _environment: WidgetEnvironment,
) => {
  "widget"
  return (
    <VStack
      modifiers={[
        containerBackground("#1c1917", "widget"),
        widgetURL("forgemobile://daily-pause"),
      ]}
    >
      <Text
        modifiers={[
          font({ design: "serif", size: 17 }),
          foregroundStyle("#f5f5f4"),
        ]}
      >
        Daily Bible Pause
      </Text>
    </VStack>
  )
}

export const dailyPauseWidget = createWidget(
  "DailyPauseWidget",
  DailyPauseWidgetLayout,
)

// The widget's timeline holds only the entries that the app stores, so the
// widget has no entry to draw until this call.
dailyPauseWidget.updateSnapshot({})
