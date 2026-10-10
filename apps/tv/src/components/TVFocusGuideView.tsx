import type { ComponentType } from "react"
import * as ReactNative from "react-native"
import type { ViewProps } from "react-native"

type TVFocusGuideViewProps = ViewProps & {
  autoFocus?: boolean
  destinations?: unknown[]
  trapFocusDown?: boolean
  trapFocusLeft?: boolean
  trapFocusRight?: boolean
  trapFocusUp?: boolean
}

export const TVFocusGuideView = (
  ReactNative as typeof ReactNative & {
    TVFocusGuideView: ComponentType<TVFocusGuideViewProps>
  }
).TVFocusGuideView
