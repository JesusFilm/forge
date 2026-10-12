// Drives the real start entry with mocks at its boundaries: the native module,
// the reload, the locale store, Datadog, and React Native. Each test loads a
// fresh registry, because the controller keeps per-runtime state (KTD3.5).
import type { LayoutDirectionState } from "../../../modules/layout-direction"

type Calls = string[]

const mock = {
  calls: [] as Calls,
  available: true,
  state: {
    nativeMode: null,
    reloadCount: 0,
    reloadKind: null,
    reloadBundle: null,
    reportedFault: null,
  } as LayoutDirectionState,
  saveArgs: [] as unknown[],
  stateThrows: false,
  reloadRejects: false,
  os: "android",
  isRTL: false,
  uiTag: "en",
  localeFailed: false,
  switchOn: true,
  updates: { isEnabled: false } as Record<string, unknown>,
  reports: [] as { error: unknown; context: Record<string, unknown> }[],
  localeListeners: [] as (() => void)[],
  appStateListeners: [] as ((state: string) => void)[],
}

jest.mock("../../../modules/layout-direction", () => ({
  getLayoutDirectionModule: () => ({
    get available() {
      return mock.available
    },
    getState: () => {
      if (mock.stateThrows) throw new Error("no react context")
      return mock.state
    },
    saveDirection: async (input: unknown) => {
      mock.calls.push("saveDirection")
      mock.saveArgs.push(input)
    },
    saveNativeMode: async (mode: string) => {
      mock.calls.push(`saveNativeMode:${mode}`)
    },
    applyNativeMode: async (mode: string) => {
      mock.calls.push(`applyNativeMode:${mode}`)
    },
    saveReportedFault: async (fault: string) => {
      mock.calls.push(`saveReportedFault:${fault}`)
    },
    clearReloadRecord: async () => {
      mock.calls.push("clearReloadRecord")
      mock.state = {
        ...mock.state,
        reloadCount: 0,
        reloadKind: null,
        reloadBundle: null,
        reportedFault: null,
      }
    },
  }),
}))
jest.mock("expo", () => ({
  reloadAppAsync: async () => {
    mock.calls.push("reload")
    if (mock.reloadRejects) throw new Error("reload refused")
  },
}))
// Getters: the controller requires expo-updates lazily, after the isolated
// registry closes, so the main registry keeps the first module it built.
jest.mock("expo-updates", () => ({
  get isEnabled() {
    return mock.updates.isEnabled
  },
  get isEmbeddedLaunch() {
    return mock.updates.isEmbeddedLaunch
  },
  get updateId() {
    return mock.updates.updateId
  },
}))
jest.mock("../../lib/appVersion", () => ({
  readAppVersionParts: () => ({ version: "1.0.0", build: "7" }),
}))
jest.mock("../../lib/datadog", () => ({
  reportDatadogError: (error: unknown, context: Record<string, unknown>) => {
    mock.reports.push({ error, context })
  },
}))
jest.mock("../localeStore", () => ({
  getCatalogTag: () => mock.uiTag,
  getLocaleResolution: () => ({
    match: mock.localeFailed ? "error" : "exact",
  }),
  subscribeLocale: (listener: () => void) => {
    mock.localeListeners.push(listener)
    return () => {}
  },
}))
jest.mock("../mirroredLayout", () => ({
  get MIRRORED_LAYOUT_ENABLED() {
    return mock.switchOn
  },
}))
jest.mock("react-native", () => ({
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      mock.appStateListeners.push(listener)
      return { remove: () => {} }
    },
  },
  I18nManager: {
    getConstants: () => ({ isRTL: mock.isRTL }),
  },
  Platform: {
    get OS() {
      return mock.os
    },
  },
}))

type Controller = typeof import("../layoutDirection")

function start(): Controller {
  let controller: Controller | undefined
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    controller = require("../layoutDirection") as Controller
  })
  controller!.startLayoutDirection()
  return controller!
}

/** Lets the save, reload, and catch chain settle. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function changeLocale(uiTag: string) {
  mock.uiTag = uiTag
  mock.localeListeners.forEach((listener) => listener())
}

function moveTo(state: string) {
  mock.appStateListeners.forEach((listener) => listener(state))
}

// Fake timers, because a start reload arms the gate's time-based release.
beforeEach(() => {
  jest.useFakeTimers()
  mock.calls = []
  mock.available = true
  mock.state = {
    nativeMode: "ltr",
    reloadCount: 0,
    reloadKind: null,
    reloadBundle: null,
    reportedFault: null,
  }
  mock.saveArgs = []
  mock.stateThrows = false
  mock.reloadRejects = false
  mock.os = "android"
  mock.isRTL = false
  mock.uiTag = "en"
  mock.localeFailed = false
  mock.switchOn = true
  mock.updates = { isEnabled: false }
  mock.reports = []
  mock.localeListeners = []
  mock.appStateListeners = []
})

afterEach(() => {
  jest.useRealTimers()
})

describe("startLayoutDirection at start", () => {
  it("covers AE1 on Android: saves the direction, then reloads, behind the gate", async () => {
    mock.uiTag = "ar"
    const controller = start()
    expect(controller.isDirectionReloadPending()).toBe(true)
    await settle()
    expect(mock.calls).toEqual(["saveDirection", "reload"])
    expect(mock.saveArgs).toEqual([
      {
        isRTL: true,
        nativeMode: "rtl",
        reloadCount: 1,
        reloadKind: "start",
        reloadBundle: "build:7",
      },
    ])
  })

  it("keys the reload record by the update id of a downloaded update", async () => {
    mock.uiTag = "ar"
    mock.updates = { isEnabled: true, isEmbeddedLaunch: false, updateId: "u1" }
    start()
    await settle()
    expect(mock.saveArgs).toMatchObject([{ reloadBundle: "update:u1" }])
  })

  it("covers AE1 on iOS: clears the record of the reload that started it", async () => {
    mock.os = "ios"
    mock.uiTag = "ar"
    mock.isRTL = true
    mock.state = {
      nativeMode: "rtl",
      reloadCount: 1,
      reloadKind: "start",
      reloadBundle: "build:7",
      reportedFault: null,
    }
    const controller = start()
    await settle()
    expect(mock.calls).toEqual(["clearReloadRecord"])
    expect(controller.isDirectionReloadPending()).toBe(false)
    expect(controller.directionReloadKind()).toBe("start")
  })

  it("keeps afterReturnReload after the same start clears the counter", async () => {
    mock.state = {
      nativeMode: "ltr",
      reloadCount: 1,
      reloadKind: "return",
      reloadBundle: "build:7",
      reportedFault: null,
    }
    const controller = start()
    await settle()
    expect(mock.calls).toEqual(["clearReloadRecord"])
    expect(mock.state.reloadCount).toBe(0)
    expect(controller.afterReturnReload()).toBe(true)
  })

  it("does not read a stuck cold start as a return reload", async () => {
    mock.uiTag = "ar"
    mock.state = {
      nativeMode: "ltr",
      reloadCount: 1,
      reloadKind: "return",
      reloadBundle: "build:7",
      reportedFault: "rtl:build:7",
    }
    const controller = start()
    expect(controller.afterReturnReload()).toBe(false)
    expect(controller.directionReloadKind()).toBeNull()
  })

  it("covers AE7: applies the direction in use and reports once", async () => {
    mock.uiTag = "ar"
    mock.state = {
      nativeMode: "rtl",
      reloadCount: 1,
      reloadKind: "start",
      reloadBundle: "build:7",
      reportedFault: null,
    }
    start()
    await settle()
    expect(mock.calls).toEqual([
      "saveNativeMode:ltr",
      "saveReportedFault:rtl:build:7",
    ])
    expect(mock.reports).toHaveLength(1)
    expect(mock.reports[0]!.context).toMatchObject({
      "layout_direction.fault": "stuck",
    })
  })

  it("sends no second report and writes nothing for a second stuck start on the same bundle", async () => {
    mock.uiTag = "ar"
    mock.state = {
      nativeMode: "ltr",
      reloadCount: 1,
      reloadKind: "start",
      reloadBundle: "build:7",
      reportedFault: "rtl:build:7",
    }
    start()
    await settle()
    expect(mock.calls).toEqual([])
    expect(mock.reports).toHaveLength(0)
  })

  it("keeps the direction in use after a failed locale read, and reports", async () => {
    mock.localeFailed = true
    mock.isRTL = true
    start()
    await settle()
    expect(mock.calls).toEqual(["applyNativeMode:rtl"])
    expect(mock.reports).toHaveLength(1)
    expect(mock.reports[0]!.context).toMatchObject({
      "layout_direction.fault": "locale_read_failed",
    })
  })

  it("restores the direction in use when the reload rejects", async () => {
    mock.uiTag = "ar"
    mock.reloadRejects = true
    const controller = start()
    await settle()
    // React Native's own direction goes back too: its layout reads it on each pass.
    expect(mock.calls).toEqual([
      "saveDirection",
      "reload",
      "saveDirection",
      "applyNativeMode:ltr",
    ])
    expect(mock.saveArgs[1]).toEqual({
      isRTL: false,
      nativeMode: "ltr",
      reloadCount: 0,
      reloadKind: null,
      reloadBundle: null,
    })
    expect(mock.reports).toHaveLength(1)
    expect(controller.isDirectionReloadPending()).toBe(false)
    jest.advanceTimersByTime(controller.RELOAD_DEADLINE_MS)
    await settle()
    expect(mock.reports).toHaveLength(1)
    expect(mock.calls).toHaveLength(4)
  })

  it("opens the gate and reports when the reload never ends this runtime", async () => {
    mock.uiTag = "ar"
    const controller = start()
    await settle()
    expect(mock.calls).toEqual(["saveDirection", "reload"])
    jest.advanceTimersByTime(controller.RELOAD_DEADLINE_MS - 1)
    expect(controller.isDirectionReloadPending()).toBe(true)
    jest.advanceTimersByTime(1)
    await settle()
    expect(controller.isDirectionReloadPending()).toBe(false)
    expect(
      mock.reports.map((r) => r.context["layout_direction.fault"]),
    ).toEqual(["reload_stalled"])
    expect(mock.calls).toEqual([
      "saveDirection",
      "reload",
      "saveDirection",
      "applyNativeMode:ltr",
    ])
    expect(mock.saveArgs[1]).toEqual({
      isRTL: false,
      nativeMode: "ltr",
      reloadCount: 0,
      reloadKind: null,
      reloadBundle: null,
    })
  })

  it("clears a reload record when the next start cannot read the locale", async () => {
    mock.localeFailed = true
    mock.state = {
      nativeMode: "ltr",
      reloadCount: 1,
      reloadKind: "return",
      reloadBundle: "build:7",
      reportedFault: null,
    }
    const controller = start()
    await settle()
    expect(controller.afterReturnReload()).toBe(true)
    expect(mock.calls).toEqual(["applyNativeMode:ltr", "clearReloadRecord"])
  })

  it("reads a failed native record as no record, reports it, and does not throw", async () => {
    mock.stateThrows = true
    const controller = start()
    await settle()
    expect(controller.afterReturnReload()).toBe(false)
    expect(controller.directionReloadKind()).toBeNull()
    expect(mock.reports[0]!.context).toMatchObject({
      "layout_direction.fault": "check_failed",
    })
  })

  it("does nothing, and does not throw, with no native module", async () => {
    mock.available = false
    mock.uiTag = "ar"
    const controller = start()
    await settle()
    expect(mock.calls).toEqual([])
    expect(controller.isDirectionReloadPending()).toBe(false)
  })

  it("reports a failed check and renders the app", async () => {
    mock.state = undefined as unknown as LayoutDirectionState
    const controller = start()
    await settle()
    expect(controller.isDirectionReloadPending()).toBe(false)
    expect(mock.reports[0]!.context).toMatchObject({
      "layout_direction.fault": "check_failed",
    })
  })

  it("saves native mode none on Android with the switch off", async () => {
    mock.switchOn = false
    mock.uiTag = "ar"
    start()
    await settle()
    expect(mock.calls).toEqual(["saveNativeMode:none"])
  })
})

describe("startLayoutDirection on an Android return (KTD3.3)", () => {
  it("covers AE4: a change that keeps the direction does not reload", async () => {
    mock.uiTag = "ar"
    mock.isRTL = true
    mock.state = { ...mock.state, nativeMode: "rtl" }
    start()
    await settle()
    moveTo("background")
    changeLocale("fa")
    moveTo("active")
    await settle()
    expect(mock.calls).toEqual([])
  })

  it("covers F2: a change of direction reloads once on the move to active", async () => {
    start()
    await settle()
    moveTo("background")
    changeLocale("ar")
    expect(mock.calls).toEqual([])
    moveTo("active")
    await settle()
    expect(mock.calls).toEqual(["saveDirection", "reload"])
    expect(mock.saveArgs).toMatchObject([{ isRTL: true, reloadKind: "return" }])
  })

  it("reloads on a return after a start reload, because it reads the live record", async () => {
    mock.state = {
      nativeMode: "ltr",
      reloadCount: 1,
      reloadKind: "start",
      reloadBundle: "build:7",
      reportedFault: null,
    }
    start()
    await settle()
    expect(mock.calls).toEqual(["clearReloadRecord"])
    moveTo("background")
    changeLocale("ar")
    moveTo("active")
    await settle()
    expect(mock.calls).toEqual(["clearReloadRecord", "saveDirection", "reload"])
    expect(mock.saveArgs).toMatchObject([{ isRTL: true, reloadKind: "return" }])
  })

  it("puts the direction in use back when a return reload never ends this runtime", async () => {
    const controller = start()
    await settle()
    moveTo("background")
    changeLocale("ar")
    moveTo("active")
    await settle()
    expect(mock.calls).toEqual(["saveDirection", "reload"])
    jest.advanceTimersByTime(controller.RELOAD_DEADLINE_MS)
    await settle()
    expect(mock.calls).toEqual([
      "saveDirection",
      "reload",
      "saveDirection",
      "applyNativeMode:ltr",
    ])
    expect(mock.saveArgs[1]).toEqual({
      isRTL: false,
      nativeMode: "ltr",
      reloadCount: 0,
      reloadKind: null,
      reloadBundle: null,
    })
    expect(
      mock.reports.map((r) => r.context["layout_direction.fault"]),
    ).toEqual(["reload_stalled"])
  })

  it("waits for the move to active, as in picture-in-picture", async () => {
    const controller = start()
    await settle()
    changeLocale("ar")
    moveTo("background")
    moveTo("inactive")
    await settle()
    expect(mock.calls).toEqual([])
    moveTo("active")
    await settle()
    expect(mock.calls).toEqual(["saveDirection", "reload"])
    expect(controller.isDirectionReloadPending()).toBe(false)
  })

  it("does not check on a move to active with no locale change", async () => {
    mock.uiTag = "ar"
    mock.isRTL = false
    mock.state = {
      nativeMode: "ltr",
      reloadCount: 1,
      reloadKind: "start",
      reloadBundle: "build:7",
      reportedFault: "rtl:build:7",
    }
    start()
    await settle()
    mock.calls = []
    moveTo("active")
    await settle()
    expect(mock.calls).toEqual([])
  })

  it("does not watch returns on iOS", () => {
    mock.os = "ios"
    start()
    expect(mock.appStateListeners).toHaveLength(0)
    expect(mock.localeListeners).toHaveLength(0)
  })
})
