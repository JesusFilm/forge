// Where the Watch screen puts Continue. Jest has no layout, so the test reads
// the shape (the owner, 2026-10-12).
import { act } from "react"

import { pauseSpacing } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  buttonPlacement,
  pauseTestFont as font,
} from "../../../test-utils/dailyPause"
import { WatchScreen } from "../WatchScreen"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
}))

let renderer: TestInstance | null = null

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
})

// Before 2026-10-12 Continue sat 40 pt below Reflect's Continue on the
// iPhone 17 Pro Max simulator.
it("puts Continue at the height of the Reflect and Pray buttons", async () => {
  await act(async () => {
    renderer = TestRenderer.create(
      <WatchScreen meditationLength={3} font={font} onContinue={() => {}} />,
    )
  })
  expect(buttonPlacement(renderer!, "Continue")).toEqual({
    lift: pauseSpacing.buttonLift,
    inLastChild: true,
    spaceAbove: true,
  })
})
