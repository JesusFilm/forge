import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import type { RenderedNode } from "./rnTestRenderer"

/** The direction the node's parent lays it out in: the nearest `direction`
 *  set above it. Undefined means the app's own layout direction. */
export function directionAbove(node: RenderedNode): unknown {
  for (let n = node.parent; n != null; n = n.parent) {
    if (typeof n.type !== "string") continue
    const direction = StyleSheet.flatten(
      n.props.style as StyleProp<ViewStyle>,
    )?.direction
    if (direction != null) return direction
  }
  return undefined
}
