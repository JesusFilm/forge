// SYNTHETIC native layout for react-test-renderer suites, after Fabric on
// Android (react-native 0.86). The renderer has no layout, so a suite gives
// each view's frame, and this driver reports it the way the native side does.

import { act } from "react"

import type { RenderedNode, TestInstance } from "./rnTestRenderer"

export type NativeFrame = {
  x: number
  y: number
  width: number
  height: number
}

/** The frame of a view the suite lays out; null for any other view. */
export type FrameOf = (node: RenderedNode) => NativeFrame | null

export type NativeLayout = {
  /** One event flush: each frame not yet reported, then `during` (such as a
   *  touch in the same flush). Returns the number of onLayout reports. */
  beat(renderer: TestInstance, during?: () => void): Promise<number>
  /** Beats until a flush reports nothing. */
  settle(renderer: TestInstance): Promise<void>
}

const SETTLE_BEATS = 8

export function createNativeLayout(frameOf: FrameOf): NativeLayout {
  // Keyed on the renderer's wrapper, which lives as long as the host view.
  const reported = new WeakMap<RenderedNode, string>()

  async function beat(
    renderer: TestInstance,
    during?: () => void,
  ): Promise<number> {
    const due: { node: RenderedNode; layout: NativeFrame }[] = []
    const views = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.onLayout === "function",
    )
    for (const node of views) {
      const frame = frameOf(node)
      if (!frame) continue
      // Android keeps a frame in 32-bit floats (Float.h: `using Float = float`).
      const layout = {
        x: Math.fround(frame.x),
        y: Math.fround(frame.y),
        width: Math.fround(frame.width),
        height: Math.fround(frame.height),
      }
      const id = `${layout.x}|${layout.y}|${layout.width}|${layout.height}`
      // BaseViewEventEmitter::onLayout reports a frame to a view only once.
      if (reported.get(node) === id) continue
      reported.set(node, id)
      due.push({ node, layout })
    }
    // Layout is a Default-priority event: every handler in one flush runs
    // before React renders any of their updates (EventQueueProcessor).
    await act(async () => {
      for (const { node, layout } of due) {
        const onLayout = node.props.onLayout as (event: unknown) => void
        onLayout({ nativeEvent: { layout } })
      }
      during?.()
    })
    return due.length
  }

  async function settle(renderer: TestInstance): Promise<void> {
    for (let pass = 0; pass < SETTLE_BEATS; pass += 1) {
      if ((await beat(renderer)) === 0) return
    }
  }

  return { beat, settle }
}
