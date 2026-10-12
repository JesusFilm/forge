// Shared helpers for the Daily Bible Pause suites.
import { act } from "react"
import { StyleSheet, type ViewStyle } from "react-native"

import type { PauseFace } from "../lib/dailyPause/fonts"
import type { RenderedNode, TestInstance } from "./rnTestRenderer"

/** A font that names its face, so a suite can read which face a text uses. */
export const pauseTestFont = (face: PauseFace) => ({ fontFamily: face })

/** Small steps, so React commits between timers as it does on a phone. */
export function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) {
    act(() => {
      jest.advanceTimersByTime(Math.min(250, left))
    })
  }
}

/** The pulse wrappers that ask for a tap. */
export function pulses(root: TestInstance): RenderedNode[] {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.testID === "pause-pulse",
  )
}

export type ButtonPlacement = {
  /** The bottom margins from the button up to its `PauseBody`. */
  lift: number
  /** The button sits in the body's last child. */
  inLastChild: boolean
  /** An earlier child of the body takes the free space. */
  spaceAbove: boolean
}

/** Where a screen puts the button with this label. Jest has no layout, so
 *  this reads the shape; the same placement on two screens puts their
 *  buttons at one height, because every body has the same padding. */
export function buttonPlacement(
  root: TestInstance,
  label: string,
): ButtonPlacement {
  const [button] = root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  )
  if (button == null) throw new Error(`No button "${label}"`)
  let lift = marginBottom(button)
  let below: RenderedNode = button
  for (let node = button.parent; node != null; node = node.parent) {
    if (typeof node.type === "string") {
      const style = flatStyle(node)
      if (style.flex === 1 && typeof style.paddingBottom === "number") {
        const children = (node.children ?? []).filter(
          (child): child is RenderedNode => typeof child !== "string",
        )
        return {
          lift,
          inLastChild: children[children.length - 1] === below,
          spaceAbove: children.slice(0, -1).some(takesFreeSpace),
        }
      }
      lift += marginBottom(node)
    }
    below = node
  }
  throw new Error(`No PauseBody above "${label}"`)
}

function flatStyle(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle) ?? {}
}

function marginBottom(node: RenderedNode): number {
  const value = flatStyle(node).marginBottom
  return typeof value === "number" ? value : 0
}

function takesFreeSpace(node: RenderedNode): boolean {
  const style = flatStyle(node)
  return (style.flex ?? 0) >= 1 || (style.flexGrow ?? 0) >= 1
}
