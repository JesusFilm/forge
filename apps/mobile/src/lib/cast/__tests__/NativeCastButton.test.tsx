/**
 * Android's cast control is the SDK's own button. Only three props reach it and
 * all three were verified on an emulator (2026-08-21): the size must match the
 * AirPlay picker so both sit identically in the shared Frosted backplate, the
 * tint is the only styling lever the SDK exposes, and the accessibility label
 * does reach the native view (`content-desc="Cast"`).
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
// View carrying a marker keeps the rendered button findable.
jest.mock("react-native-google-cast", () => {
  const reactModule = require("react")
  const { View } = require("react-native")
  return {
    CastButton: (props: Record<string, unknown>) =>
      reactModule.createElement(View, { ...props, testID: MARKER }),
  }
})

import { act } from "react"

import { NativeCastButton } from "../NativeCastButton"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const MARKER = "native-cast-button"

function render(label = "Cast", tint = "#ffffff"): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      <NativeCastButton accessibilityLabel={label} tintColor={tint} />,
    )
  })
  return renderer
}

// A component and its host view both carry props, so filter on HOST nodes to
// make "exactly one" meaningful.
function button(renderer: TestInstance) {
  const nodes = renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === MARKER,
  )
  expect(nodes).toHaveLength(1)
  return nodes[0]
}

describe("NativeCastButton", () => {
  it("renders exactly one SDK button", () => {
    expect(button(render())).toBeDefined()
  })

  // 44pt matches PlayerControls' airPlayPicker. A mismatch puts the two native
  // route buttons at different sizes inside identical backplates.
  it("matches the AirPlay picker's 44pt box", () => {
    const style = button(render()).props.style as {
      width?: number
      height?: number
    }
    expect(style.width).toBe(44)
    expect(style.height).toBe(44)
  })

  it("forwards the tint, the only styling lever the SDK exposes", () => {
    expect(button(render("Cast", "#f5f5f4")).props.tintColor).toBe("#f5f5f4")
  })

  it("forwards the accessibility label", () => {
    expect(
      button(render("Casting to Living Room TV")).props.accessibilityLabel,
    ).toBe("Casting to Living Room TV")
  })

  // The platform split lives in PlayerControls, which renders this only on
  // Android. A second gate here would be a silent no-op on the platform that
  // needs it, so this component must stay unconditional.
  it("does not gate on platform itself", () => {
    expect(render().toJSON()).not.toBeNull()
  })
})
