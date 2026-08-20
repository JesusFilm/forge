/**
 * The invisible Android cast button. Every assertion here guards a property
 * whose loss is SILENT: no crash, no log — just `showCastDialog()` quietly
 * resolving false again and an Android cast glyph that does nothing.
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
// requireNativeComponent("RNGoogleCastButton") has no jest host component; a
// View carrying a marker keeps the mounted button findable.
jest.mock("react-native-google-cast", () => {
  const reactModule = require("react")
  const { View } = require("react-native")
  return {
    CastButton: (props: Record<string, unknown>) =>
      reactModule.createElement(View, { ...props, testID: NATIVE_MARKER }),
  }
})

import { act } from "react"
import { Platform } from "react-native"

import { CastRouteButton, CAST_ROUTE_BUTTON_TEST_ID } from "../CastRouteButton"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const NATIVE_MARKER = "native-cast-route-button"

// Platform.OS is an object-literal getter (configurable), so a data-property
// override works; the saved descriptor restores the real getter after each test.
const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
})

function render(): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(<CastRouteButton />)
  })
  return renderer
}

// A component and its host view both carry testID, so a mounted button matches
// more than one node (same reason PlayerControls.test.tsx counts labels this
// way). Counting HOST nodes only is what makes "exactly one" meaningful.
function nativeButtonHostCount(renderer: TestInstance): number {
  return renderer.root.findAll(
    (node) =>
      node.props.testID === NATIVE_MARKER && typeof node.type === "string",
  ).length
}

describe("CastRouteButton", () => {
  it("mounts exactly one native button on Android", () => {
    setPlatform("android")
    expect(nativeButtonHostCount(render())).toBe(1)
  })

  // iOS presents the dialog straight from GCKCastContext (RNGCCastContext.m:78),
  // so a GCKUICastButton here would change a platform that already works.
  it("renders nothing on iOS", () => {
    setPlatform("ios")
    expect(nativeButtonHostCount(render())).toBe(0)
    expect(render().toJSON()).toBeNull()
  })
})

describe("the properties that make it invisible AND attached", () => {
  // Asserting on the HOST node (not the composite) is what proves these props
  // actually reach the platform view.
  function host(renderer: TestInstance) {
    const nodes = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === CAST_ROUTE_BUTTON_TEST_ID,
    )
    expect(nodes).toHaveLength(1)
    return nodes[0]
  }

  // RN Android flattens views that draw nothing. A flattened wrapper never
  // reaches onAttachedToWindow, which is the one thing this component is for.
  it("opts out of Android view flattening", () => {
    setPlatform("android")
    expect(host(render()).props.collapsable).toBe(false)
  })

  // The visible cast glyph is a sibling Pressable. A hit-testable phantom on
  // top of it would swallow taps and look like a dead button.
  it("takes no touches", () => {
    setPlatform("android")
    expect(host(render()).props.pointerEvents).toBe("none")
  })

  it("is invisible and outside the layout flow", () => {
    setPlatform("android")
    const style = host(render()).props.style as {
      opacity?: number
      position?: string
      width?: number
      height?: number
    }
    expect(style.opacity).toBe(0)
    expect(style.position).toBe("absolute")
    // 1pt, not 0: size is irrelevant to attachment, but a zero-size view is
    // more likely to be optimised away by a future RN release.
    expect(style.width).toBe(1)
    expect(style.height).toBe(1)
  })

  it("is hidden from assistive technology", () => {
    setPlatform("android")
    const wrapper = host(render())
    expect(wrapper.props.accessibilityElementsHidden).toBe(true)
    expect(wrapper.props.importantForAccessibility).toBe("no-hide-descendants")
  })
})
