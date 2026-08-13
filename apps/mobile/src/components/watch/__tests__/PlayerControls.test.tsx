/**
 * Inline (portrait) vs fullscreen chrome: the volume control is gone from both,
 * and the two timestamps are one "0:00 / 2:00" pill.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (KTD11: no new test dependencies).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// The blur backplate is a native view; render its children so the controls it
// wraps stay findable.
jest.mock("expo-blur", () => {
  const { View } = require("react-native")
  return { BlurView: View }
})
// PlayerControls subscribes to the player's playingChange; return the seed.
jest.mock("expo", () => ({
  useEvent: (_player: unknown, _name: string, initial: unknown) => initial,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

import { act } from "react"

import { PlayerControls } from "../PlayerControls"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

// A player stopped at 0:00 of a two-minute video.
function makePlayer() {
  return {
    playing: false,
    muted: false,
    currentTime: 0,
    duration: 120,
    play: jest.fn(),
    pause: jest.fn(),
    addListener: () => ({ remove: () => {} }),
  }
}

async function render(fullscreen: boolean): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <PlayerControls
        player={makePlayer() as never}
        fullscreen={fullscreen}
        onFullscreen={() => {}}
      />,
    )
  })
  return renderer
}

// A Pressable and its host view both carry the label, so a present control
// matches more than one node — presence is "any", absence is "none".
function labelCount(renderer: TestInstance, label: string): number {
  return renderer.root.findAll((n) => n.props.accessibilityLabel === label)
    .length
}
function hasLabel(renderer: TestInstance, label: string): boolean {
  return labelCount(renderer, label) > 0
}

// The pill's children are an array ("0:00", " / ", "2:00"), so the shared
// hasText (string children only) cannot see it.
function hasJoinedText(renderer: TestInstance, needle: string): boolean {
  return (
    renderer.root.findAll((n) => {
      const c = n.props.children
      return Array.isArray(c) && c.every((p) => typeof p === "string")
        ? c.join("").includes(needle)
        : false
    }).length > 0
  )
}

describe("PlayerControls chrome", () => {
  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])("renders no volume control (%s)", async (_name, fullscreen) => {
    const renderer = await render(fullscreen as boolean)
    expect(labelCount(renderer, "Mute")).toBe(0)
    expect(labelCount(renderer, "Unmute")).toBe(0)
    await unmount(renderer)
  })

  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])(
    "shows one combined elapsed/total pill (%s)",
    async (_name, fullscreen) => {
      const renderer = await render(fullscreen as boolean)
      expect(hasJoinedText(renderer, "0:00 / 2:00")).toBe(true)
      // The old layout painted the total as its own node; one pill means the
      // total never stands alone.
      expect(
        renderer.root.findAll((n) => n.props.children === "2:00").length,
      ).toBe(0)
      await unmount(renderer)
    },
  )

  it("keeps the transport controls and offers fullscreen inline", async () => {
    const renderer = await render(false)
    expect(hasLabel(renderer, "Play")).toBe(true)
    expect(hasLabel(renderer, "Back 10 seconds")).toBe(true)
    expect(hasLabel(renderer, "Forward 10 seconds")).toBe(true)
    expect(hasLabel(renderer, "Fullscreen")).toBe(true)
    expect(labelCount(renderer, "Exit fullscreen")).toBe(0)
    await unmount(renderer)
  })

  it("flips the fullscreen control to an exit affordance", async () => {
    const renderer = await render(true)
    expect(hasLabel(renderer, "Exit fullscreen")).toBe(true)
    expect(labelCount(renderer, "Fullscreen")).toBe(0)
    await unmount(renderer)
  })
})
