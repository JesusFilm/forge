// The Customize sheet (U13) against the REAL settings store, the real U12
// permission flow, and AsyncStorage's jest double. Only the router and the
// notifications adapter (the OS permission state) are modelled.

import { act } from "react"
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Linking, Platform, StyleSheet } from "react-native"

import CustomizeRoute from "../../../../app/pause/customize"
import {
  PAUSE_SETTINGS_STORAGE_KEY,
  getPauseSettingsStore,
  parseStoredPauseSettings,
  resetPauseSettingsStoreForTests,
} from "../../../lib/dailyPause/settings"
import {
  TestRenderer,
  hasText,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

// The double has no `default`, and the settings store reads `.default`, so
// without this wrapper the store never saves and R29 cannot be seen.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
}))
/* eslint-enable @typescript-eslint/no-require-imports */

const mockRouter = { back: jest.fn() }
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useNavigation: () => ({ addListener: () => () => {} }),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}))

type Permission = { granted: boolean; canAskAgain: boolean }
const mockPermission: {
  read: () => Promise<Permission>
  request: () => Promise<Permission>
} = {
  read: async () => ({ granted: true, canAskAgain: true }),
  request: async () => ({ granted: true, canAskAgain: true }),
}
jest.mock("../../../lib/lapseReminders/notificationsAdapter", () => ({
  lapseReminderNotifications: {
    ensureDailyPauseChannel: async () => {},
    getPermission: () => mockPermission.read(),
    requestPermission: () => mockPermission.request(),
  },
}))

const MIN_TARGET = 44

let mounted: TestInstance | null = null

async function render(): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(<CustomizeRoute />)
  })
  // The fonts and the stored settings settle on later turns.
  await act(async () => {})
  return mounted!
}

const platformOs = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  resetPauseSettingsStoreForTests()
  mockRouter.back.mockClear()
  mockPermission.read = async () => ({ granted: true, canAskAgain: true })
  mockPermission.request = async () => ({ granted: true, canAskAgain: true })
})

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
  Object.defineProperty(Platform, "OS", platformOs)
  jest.restoreAllMocks()
})

/** The composite control that a tap or a toggle reaches. */
function control(
  renderer: TestInstance,
  label: string,
): RenderedNode | undefined {
  return renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0]
}

async function tap(renderer: TestInstance, label: string): Promise<void> {
  const target = control(renderer, label)
  if (!target) throw new Error(`no control "${label}"`)
  await act(async () => {
    target.props.onPress?.()
  })
}

/** The host view a screen reader lands on. */
function host(renderer: TestInstance, label: string): RenderedNode {
  const [found] = renderer.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  )
  if (!found) throw new Error(`no host view "${label}"`)
  return found
}

type A11yState = { selected?: boolean; checked?: boolean }

function stateOf(renderer: TestInstance, label: string): A11yState {
  return (host(renderer, label).props.accessibilityState ?? {}) as A11yState
}

function picker(renderer: TestInstance): RenderedNode | undefined {
  return renderer.root.findAll((node) => node.type === DateTimePicker)[0]
}

function settings() {
  return getPauseSettingsStore().getSnapshot()
}

describe("CustomizeSheet", () => {
  it("shows the three lengths with 3 min selected, and 5 min applies and persists at once (F3)", async () => {
    const renderer = await render()

    expect(stateOf(renderer, "1 minute").selected).toBe(false)
    expect(stateOf(renderer, "3 minutes").selected).toBe(true)
    expect(stateOf(renderer, "5 minutes").selected).toBe(false)

    await tap(renderer, "5 minutes")

    expect(settings().meditationLength).toBe(5)
    expect(stateOf(renderer, "5 minutes").selected).toBe(true)
    expect(stateOf(renderer, "3 minutes").selected).toBe(false)
    const stored = parseStoredPauseSettings(
      await AsyncStorage.getItem(PAUSE_SETTINGS_STORAGE_KEY),
    )
    expect(stored?.meditationLength).toBe(5)
  })

  it("starts with both switches off and no reminder time (R47)", async () => {
    const renderer = await render()

    expect(stateOf(renderer, "Notifications").checked).toBe(false)
    expect(stateOf(renderer, "Home screen widget").checked).toBe(false)
    expect(hasText(renderer, "7:00 AM")).toBe(false)
  })

  it("turns Notifications on after a grant, shows the time, and a picked time applies at once (R32, R34, R35)", async () => {
    mockPermission.read = async () => ({ granted: false, canAskAgain: true })
    mockPermission.request = async () => ({ granted: true, canAskAgain: true })
    const renderer = await render()

    await tap(renderer, "Notifications")

    expect(settings().reminderOn).toBe(true)
    expect(stateOf(renderer, "Notifications").checked).toBe(true)
    expect(hasText(renderer, "A daily reminder at 7:00 AM")).toBe(true)

    expect(picker(renderer)).toBeUndefined()
    await tap(renderer, "Reminder time, 7:00 AM")
    const shown = picker(renderer)
    expect(shown).toBeDefined()
    expect(shown!.props.mode).toBe("time")

    const picked = new Date(2000, 0, 1, 6, 30)
    await act(async () => {
      ;(
        shown!.props.onValueChange as (
          event: { nativeEvent: { timestamp: number; utcOffset: number } },
          date: Date,
        ) => void
      )({ nativeEvent: { timestamp: picked.getTime(), utcOffset: 0 } }, picked)
    })

    expect(settings().reminderTime).toEqual({ hour: 6, minute: 30 })
    expect(hasText(renderer, "A daily reminder at 6:30 AM")).toBe(true)
  })

  it("picks the time in the native dialog on Android, and the time applies at once (R34)", async () => {
    setPlatform("android")
    getPauseSettingsStore().update({ reminderOn: true })
    const open = jest
      .spyOn(DateTimePickerAndroid, "open")
      .mockImplementation(() => {})
    const renderer = await render()

    await tap(renderer, "Reminder time, 7:00 AM")

    expect(picker(renderer)).toBeUndefined()
    expect(open).toHaveBeenCalledTimes(1)
    const params = open.mock.calls[0]![0]
    expect(params.mode).toBe("time")
    const picked = new Date(2000, 0, 1, 21, 15)
    await act(async () => {
      params.onValueChange?.(
        { nativeEvent: { timestamp: picked.getTime(), utcOffset: 0 } },
        picked,
      )
    })

    expect(settings().reminderTime).toEqual({ hour: 21, minute: 15 })
    expect(hasText(renderer, "A daily reminder at 9:15 PM")).toBe(true)
  })

  it("turns Notifications off at once and hides the time", async () => {
    getPauseSettingsStore().update({ reminderOn: true })
    const renderer = await render()

    await tap(renderer, "Notifications")

    expect(settings().reminderOn).toBe(false)
    expect(stateOf(renderer, "Notifications").checked).toBe(false)
    expect(hasText(renderer, "7:00 AM")).toBe(false)
  })

  it("returns the switch to off after a denial and shows the Settings line, which opens the app's settings (AE6)", async () => {
    let answer: (permission: Permission) => void = () => {}
    mockPermission.read = async () => ({ granted: false, canAskAgain: true })
    mockPermission.request = () =>
      new Promise<Permission>((resolve) => {
        answer = resolve
      })
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined)
    const renderer = await render()

    await tap(renderer, "Notifications")
    // The switch shows on while the system prompt is up.
    expect(stateOf(renderer, "Notifications").checked).toBe(true)

    await act(async () => {
      answer({ granted: false, canAskAgain: false })
    })

    expect(settings().reminderOn).toBe(false)
    expect(stateOf(renderer, "Notifications").checked).toBe(false)
    expect(hasText(renderer, "Notifications are off in iOS Settings.")).toBe(
      true,
    )

    await tap(renderer, "Notifications are off in iOS Settings. Open Settings")
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it("returns the switch to off when the permission read fails", async () => {
    mockPermission.read = () => Promise.reject(new Error("native failure"))
    const renderer = await render()

    await tap(renderer, "Notifications")

    expect(settings().reminderOn).toBe(false)
    expect(stateOf(renderer, "Notifications").checked).toBe(false)
    expect(hasText(renderer, "Notifications are off in iOS Settings.")).toBe(
      false,
    )
  })

  it("shows the widget how-to while the widget switch is on, and hides it when off (R37)", async () => {
    setPlatform("ios")
    const renderer = await render()
    expect(hasText(renderer, "Add Widget")).toBe(false)

    await tap(renderer, "Home screen widget")

    expect(settings().widgetOn).toBe(true)
    expect(stateOf(renderer, "Home screen widget").checked).toBe(true)
    expect(hasText(renderer, "Add Widget")).toBe(true)

    await tap(renderer, "Home screen widget")

    expect(settings().widgetOn).toBe(false)
    expect(hasText(renderer, "Add Widget")).toBe(false)
  })

  it("shows no widget row on Android (R43)", async () => {
    setPlatform("android")
    const renderer = await render()

    expect(control(renderer, "Home screen widget")).toBeUndefined()
    expect(hasText(renderer, "Home screen widget")).toBe(false)
    expect(control(renderer, "Notifications")).toBeDefined()
  })

  it("closes the sheet on Done (R27)", async () => {
    const renderer = await render()

    await tap(renderer, "Done")

    expect(mockRouter.back).toHaveBeenCalledTimes(1)
  })

  it("gives every control a label and a 44-point target", async () => {
    setPlatform("ios")
    getPauseSettingsStore().update({ reminderOn: true })
    const renderer = await render()

    expectLabelledTargets(renderer, [
      "1 minute",
      "3 minutes",
      "5 minutes",
      "Done",
      "Home screen widget",
      "Notifications",
      "Reminder time, 7:00 AM",
    ])

    mockPermission.read = async () => ({ granted: false, canAskAgain: false })
    await tap(renderer, "Notifications")
    await tap(renderer, "Notifications")

    expectLabelledTargets(renderer, [
      "1 minute",
      "3 minutes",
      "5 minutes",
      "Done",
      "Home screen widget",
      "Notifications",
      "Notifications are off in iOS Settings. Open Settings",
    ])
  })
})

const CONTROL_ROLES = new Set(["button", "link", "radio", "switch"])

type Box = { height?: number; minHeight?: number }
type Slop = { top?: number; bottom?: number }

function expectLabelledTargets(renderer: TestInstance, labels: string[]) {
  const controls = renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      CONTROL_ROLES.has(String(node.props.accessibilityRole)),
  )
  expect(
    controls.map((node) => String(node.props.accessibilityLabel)).sort(),
  ).toEqual([...labels].sort())
  for (const node of controls) {
    const box = (StyleSheet.flatten(node.props.style as never) ?? {}) as Box
    const slop = (node.props.hitSlop ?? {}) as Slop
    const drawn = box.minHeight ?? box.height ?? 0
    const target = drawn + (slop.top ?? 0) + (slop.bottom ?? 0)
    // The label rides along, so a failure names the short control.
    expect([node.props.accessibilityLabel, target >= MIN_TARGET]).toEqual([
      node.props.accessibilityLabel,
      true,
    ])
  }
}
