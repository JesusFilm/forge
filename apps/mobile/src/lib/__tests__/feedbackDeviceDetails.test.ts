import { Platform } from "react-native"

// KTD6: both modules answer null on a surface the app cannot read (a simulator
// build with no native build number, a device model the OS withholds), so the
// null case is the production shape R9 names, not a synthetic one.
const mockNative: {
  nativeApplicationVersion: string | null
  nativeBuildVersion: string | null
  modelName: string | null
} = {
  nativeApplicationVersion: null,
  nativeBuildVersion: null,
  modelName: null,
}

// Getters, not plain values: Babel's namespace interop COPIES the module at
// import time, so a mutable plain object freezes at its defaults and every
// case below silently re-tests the null one. A getter descriptor survives the
// copy, so each read reaches this object.
jest.mock("expo-application", () => ({
  __esModule: true,
  get nativeApplicationVersion() {
    return mockNative.nativeApplicationVersion
  },
  get nativeBuildVersion() {
    return mockNative.nativeBuildVersion
  },
}))

jest.mock("expo-device", () => ({
  __esModule: true,
  get modelName() {
    return mockNative.modelName
  },
}))

import {
  FEEDBACK_PLATFORM_LABEL,
  UNKNOWN_DEVICE_VALUE,
  getFeedbackPlatform,
  readFeedbackDeviceDetails,
} from "../feedbackDeviceDetails"
import { FEEDBACK_DEVICE_FIELD_MAX_LENGTH } from "../feedbackSubmission"

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
const platformVersionDescriptor = Object.getOwnPropertyDescriptor(
  Platform,
  "Version",
)!

function setPlatform(os: string, version: string | number | undefined): void {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
  Object.defineProperty(Platform, "Version", {
    value: version,
    configurable: true,
  })
}

afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  Object.defineProperty(Platform, "Version", platformVersionDescriptor)
  mockNative.nativeApplicationVersion = null
  mockNative.nativeBuildVersion = null
  mockNative.modelName = null
})

describe("getFeedbackPlatform", () => {
  // R9: the platform name is ALWAYS sent, so it has no "Unknown".
  it("sends IOS on iOS and ANDROID on Android", () => {
    setPlatform("ios", "26.0")
    expect(getFeedbackPlatform()).toBe("IOS")
    setPlatform("android", 36)
    expect(getFeedbackPlatform()).toBe("ANDROID")
  })

  it("labels each wire value the way admin's ticket does", () => {
    expect(FEEDBACK_PLATFORM_LABEL).toEqual({ IOS: "iOS", ANDROID: "Android" })
  })
})

describe("readFeedbackDeviceDetails", () => {
  it("reads every field when the phone can answer", () => {
    setPlatform("ios", "26.0")
    mockNative.nativeApplicationVersion = "1.0.0"
    mockNative.nativeBuildVersion = "7"
    mockNative.modelName = "iPhone 17 Pro Max"

    expect(readFeedbackDeviceDetails()).toEqual({
      appVersion: "1.0.0",
      appBuild: "7",
      osVersion: "26.0",
      deviceModel: "iPhone 17 Pro Max",
    })
  })

  // R9: "shows Unknown for any value the phone cannot read". The platform is
  // not in this object precisely because it is always readable.
  it("renders Unknown for every field the two modules cannot read", () => {
    setPlatform("android", undefined)

    expect(readFeedbackDeviceDetails()).toEqual({
      appVersion: UNKNOWN_DEVICE_VALUE,
      appBuild: UNKNOWN_DEVICE_VALUE,
      osVersion: UNKNOWN_DEVICE_VALUE,
      deviceModel: UNKNOWN_DEVICE_VALUE,
    })
    expect(getFeedbackPlatform()).toBe("ANDROID")
  })

  it("renders Unknown for a blank value, not an empty string", () => {
    setPlatform("ios", "26.0")
    mockNative.nativeApplicationVersion = "   "
    mockNative.nativeBuildVersion = ""
    mockNative.modelName = "  "

    const details = readFeedbackDeviceDetails()
    expect(details.appVersion).toBe(UNKNOWN_DEVICE_VALUE)
    expect(details.appBuild).toBe(UNKNOWN_DEVICE_VALUE)
    expect(details.deviceModel).toBe(UNKNOWN_DEVICE_VALUE)
  })

  it("stringifies Android's numeric API level", () => {
    setPlatform("android", 36)
    expect(readFeedbackDeviceDetails().osVersion).toBe("36")
  })

  // R18 has no inline fix for a field nobody typed, so the bound is enforced
  // here instead: admin caps each device field at 100 and would answer
  // INVALID_INPUT for the whole submission over a freak long model name.
  it("clamps a value longer than admin's bound", () => {
    setPlatform("android", 36)
    mockNative.modelName = "M".repeat(FEEDBACK_DEVICE_FIELD_MAX_LENGTH + 40)

    expect(readFeedbackDeviceDetails().deviceModel).toHaveLength(
      FEEDBACK_DEVICE_FIELD_MAX_LENGTH,
    )
  })
})
