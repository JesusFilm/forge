/**
 * The pause route's fonts (R23, KTD16): every Figma face loads at run time
 * under its PostScript name, and a failed load still renders text, in the
 * system serif. jest-expo runs as iOS, so the serif fallback is Georgia.
 */

jest.mock("expo-font", () => ({
  loadAsync: jest.fn(),
  isLoaded: jest.fn(() => false),
}))

import * as Font from "expo-font"
import { StrictMode, act, type ReactElement } from "react"
import { Text } from "react-native"

import { usePauseFonts, type PauseFace } from "../fonts"
import { pauseColors } from "../theme"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockLoadAsync = Font.loadAsync as jest.Mock
const mockIsLoaded = Font.isLoaded as jest.Mock

const BUNDLED: Record<PauseFace, string> = {
  display: "InstrumentSerif-Regular",
  bodyLight: "SourceSerif4-Light",
  bodyLightItalic: "SourceSerif4-LightIt",
  bodyItalic: "SourceSerif4-It",
  sansRegular: "Inter-Regular",
  sansMedium: "Inter-Medium",
  sansSemiBold: "Inter-SemiBold",
  sansBold: "Inter-Bold",
}
const FACES = Object.keys(BUNDLED) as PauseFace[]

type Deferred = {
  promise: Promise<void>
  resolve: () => void
  reject: (e: Error) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Every `ready` value the screen saw, in render order. */
let readyLog: boolean[] = []

function PauseScreen() {
  const { ready, font } = usePauseFonts()
  readyLog.push(ready)
  if (!ready) return null
  return (
    <>
      {FACES.map((face) => (
        <Text key={face} testID={face} style={font(face)}>
          {face}
        </Text>
      ))}
    </>
  )
}

type FaceStyle = {
  fontFamily?: string
  fontStyle?: string
  fontWeight?: string
}

function styleOf(renderer: TestInstance, face: PauseFace): FaceStyle {
  const hosts = renderer.root.findAll(
    (node: RenderedNode) =>
      typeof node.type === "string" && node.props.testID === face,
  )
  expect(hosts).toHaveLength(1)
  return hosts[0].props.style as FaceStyle
}

function familiesOf(
  renderer: TestInstance,
): Record<string, string | undefined> {
  return Object.fromEntries(
    FACES.map((face) => [face, styleOf(renderer, face).fontFamily]),
  )
}

async function render(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  return renderer
}

beforeEach(() => {
  readyLog = []
  mockLoadAsync.mockReset()
  mockIsLoaded.mockReset()
  mockIsLoaded.mockReturnValue(false)
})

describe("usePauseFonts", () => {
  it("waits for every face, then gives the bundled PostScript names", async () => {
    const load = deferred()
    mockLoadAsync.mockReturnValue(load.promise)

    const renderer = await render(<PauseScreen />)
    expect(readyLog).not.toContain(true)
    // The family string the screens write must be the name expo-font registers.
    const registered = Object.keys(mockLoadAsync.mock.calls[0][0]).sort()
    expect(registered).toEqual(Object.values(BUNDLED).sort())

    await act(async () => {
      load.resolve()
    })

    expect(familiesOf(renderer)).toEqual(BUNDLED)
    // A static face is chosen by name, so no weight or style may synthesize.
    expect(styleOf(renderer, "bodyLightItalic")).toEqual({
      fontFamily: "SourceSerif4-LightIt",
    })
  })

  it("is ready on the first render when the faces are already loaded", async () => {
    mockIsLoaded.mockReturnValue(true)
    mockLoadAsync.mockReturnValue(deferred().promise)

    const renderer = await render(<PauseScreen />)

    expect(readyLog[0]).toBe(true)
    expect(familiesOf(renderer)).toEqual(BUNDLED)
  })

  it("renders text in the system serif when the load fails", async () => {
    const load = deferred()
    mockLoadAsync.mockReturnValue(load.promise)

    const renderer = await render(<PauseScreen />)
    await act(async () => {
      load.reject(new Error("font file missing"))
    })

    expect(readyLog[readyLog.length - 1]).toBe(true)
    expect(styleOf(renderer, "display").fontFamily).toBe("Georgia")
    expect(styleOf(renderer, "bodyLight")).toEqual({
      fontFamily: "Georgia",
      fontStyle: "normal",
      fontWeight: "300",
    })
    expect(styleOf(renderer, "bodyLightItalic")).toEqual({
      fontFamily: "Georgia",
      fontStyle: "italic",
      fontWeight: "300",
    })
    expect(styleOf(renderer, "bodyItalic")).toEqual({
      fontFamily: "Georgia",
      fontStyle: "italic",
      fontWeight: "400",
    })
    expect(styleOf(renderer, "sansBold")).toEqual({
      fontFamily: "System",
      fontStyle: "normal",
      fontWeight: "700",
    })
  })

  it("reaches ready once under StrictMode", async () => {
    const load = deferred()
    mockLoadAsync.mockReturnValue(load.promise)

    const renderer = await render(
      <StrictMode>
        <PauseScreen />
      </StrictMode>,
    )
    await act(async () => {
      load.resolve()
    })

    const firstReady = readyLog.indexOf(true)
    expect(firstReady).toBeGreaterThan(0)
    expect(readyLog.slice(firstReady)).not.toContain(false)
    expect(familiesOf(renderer)).toEqual(BUNDLED)
  })
})

describe("pauseColors", () => {
  it("matches the Pass 2 frame", () => {
    expect(pauseColors.background).toBe("#0c0b0a")
    expect(pauseColors.ink).toBe("#f4efe6")
    expect(pauseColors.accent).toBe("#f2c46b")
  })
})
