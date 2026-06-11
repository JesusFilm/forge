import type { CSSProperties, ReactNode } from "react"
import { AbsoluteFill } from "remotion"

import { SHORT_SAFE_AREA } from "../../schema"

type SafeAreaProps = {
  children: ReactNode
  style?: CSSProperties
}

// Absolute container inset by the cross-platform safe area. Templates place
// captions/title inside it so the constraints are unviolatable by
// construction (plan decision 14).
export const SafeArea = ({ children, style }: SafeAreaProps) => (
  <AbsoluteFill
    style={{
      top: SHORT_SAFE_AREA.top,
      bottom: SHORT_SAFE_AREA.bottom,
      left: SHORT_SAFE_AREA.side,
      right: SHORT_SAFE_AREA.side,
      width: "auto",
      height: "auto",
      ...style,
    }}
  >
    {children}
  </AbsoluteFill>
)
