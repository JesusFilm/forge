// tsconfig maps `react` to its .d.ts, and jest-expo copies that mapping into
// jest, so the mocks below re-point `react` at the real package (apps/mobile
// CLAUDE.md, "Component render tests").
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
// The mock logs the props of each render, so a case can read the blur and the
// box that would reach the native view.
const mockImageProps: Record<string, unknown>[] = []
jest.mock("expo-image", () => ({
  Image: (props: Record<string, unknown>) => {
    mockImageProps.push(props)
    return null
  },
}))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))

import { act } from "react"
import { Dimensions, Platform, StyleSheet } from "react-native"

import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { WatchAmbient } from "../WatchAmbient"

const POSTER = "https://example.com/poster.jpg"
const TOP_INSET = 47

type Box = {
  position?: string
  top?: number
  left?: number
  width?: number
  height?: number
  transform?: { scale?: number }[]
}

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}

let renderer: TestInstance | null = null

async function render(): Promise<{
  image: Record<string, unknown>
  frame: { width: number; height: number }
}> {
  await act(async () => {
    renderer = TestRenderer.create(
      <WatchAmbient posterUrl={POSTER} topInset={TOP_INSET} />,
    )
  })
  const root = renderer!.toJSON() as { props: { style: unknown } }
  const wrapper = StyleSheet.flatten(root.props.style as never) as Box
  const image = mockImageProps.at(-1)
  if (!image) throw new Error("WatchAmbient rendered no poster image")
  return {
    image,
    // The wrapper spans the window width; its height is the frame to cover.
    frame: {
      width: Dimensions.get("window").width,
      height: wrapper.height ?? 0,
    },
  }
}

beforeEach(() => {
  mockImageProps.length = 0
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
})

// feat-784: on Android, expo-image blurs with RenderScript, and two blurs at
// the same time can crash the app. A poster swap can start a second blur.
describe("WatchAmbient poster blur", () => {
  it("sends no blurRadius on Android, and stretches a small decode instead", async () => {
    setPlatform("android")
    const { image, frame } = await render()

    expect(image.source).toBe(POSTER)
    expect(image.blurRadius).toBeUndefined()

    // Glide decodes to the view's size, so the box sets the bitmap size. The
    // box must be small, and its scale must cover the frame with no seam.
    const box = StyleSheet.flatten(image.style as never) as Box
    const scale = box.transform?.[0]?.scale ?? 1
    expect(frame.height).toBeGreaterThan(TOP_INSET)
    expect(box).toMatchObject({
      position: "absolute",
      width: expect.any(Number),
      height: expect.any(Number),
    })
    expect(box.width!).toBeLessThanOrEqual(frame.width / 40)
    expect(box.height!).toBeLessThanOrEqual(frame.height / 40)
    expect(box.width! * scale).toBeGreaterThan(frame.width)
    expect(box.height! * scale).toBeGreaterThan(frame.height)
    // The scale grows from the box center, so the box sits at the frame center.
    expect(box.left! + box.width! / 2).toBeCloseTo(frame.width / 2)
    expect(box.top! + box.height! / 2).toBeCloseTo(frame.height / 2)
  })

  it("keeps the iOS blur and full-frame art unchanged", async () => {
    setPlatform("ios")
    const { image } = await render()

    expect(image.source).toBe(POSTER)
    expect(image.blurRadius).toBe(50)
    expect(StyleSheet.flatten(image.style as never)).toEqual({
      ...StyleSheet.absoluteFill,
      transform: [{ scale: 1.1 }],
    })
  })
})
