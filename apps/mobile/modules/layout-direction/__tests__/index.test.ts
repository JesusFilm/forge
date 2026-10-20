// The mock stands in for the native lookup; each test sets what it returns.
const mockNative: { current: unknown; throws: boolean } = {
  current: null,
  throws: false,
}
jest.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) => {
    if (mockNative.throws) throw new Error("no expo")
    return name === "LayoutDirection" ? mockNative.current : null
  },
}))

type Entry = typeof import("../index")

function loadEntry(): Entry {
  let entry: Entry | undefined
  // A fresh registry per test, because the entry caches its lookup.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    entry = require("../index") as Entry
  })
  return entry!
}

beforeEach(() => {
  mockNative.current = null
  mockNative.throws = false
})

describe("getLayoutDirectionModule", () => {
  it.each([
    ["missing", () => {}],
    ["unloadable", () => (mockNative.throws = true)],
  ])(
    "returns an inert module when the native module is %s",
    async (_, arrange) => {
      arrange()
      const layout = loadEntry().getLayoutDirectionModule()
      expect(layout.available).toBe(false)
      expect(layout.getState()).toEqual({
        nativeMode: null,
        reloadCount: 0,
        reloadKind: null,
        reloadBundle: null,
        reportedFault: null,
      })
      await expect(
        layout.saveDirection({
          isRTL: true,
          nativeMode: "rtl",
          reloadCount: 1,
          reloadKind: "start",
          reloadBundle: "update-1",
        }),
      ).resolves.toBeUndefined()
      await expect(layout.saveNativeMode("ltr")).resolves.toBeUndefined()
      await expect(layout.applyNativeMode("ltr")).resolves.toBeUndefined()
      await expect(layout.saveReportedFault("rtl:x")).resolves.toBeUndefined()
      await expect(layout.clearReloadRecord()).resolves.toBeUndefined()
    },
  )

  it("sends saveDirection to native in its argument order", async () => {
    const saveDirection = jest.fn().mockResolvedValue(undefined)
    mockNative.current = { saveDirection }
    const layout = loadEntry().getLayoutDirectionModule()
    expect(layout.available).toBe(true)
    await layout.saveDirection({
      isRTL: true,
      nativeMode: "rtl",
      reloadCount: 1,
      reloadKind: "return",
      reloadBundle: "build-42",
    })
    expect(saveDirection).toHaveBeenCalledWith(
      true,
      "rtl",
      1,
      "return",
      "build-42",
    )
  })

  it("reads a valid native state as it is", () => {
    mockNative.current = {
      getState: () => ({
        nativeMode: "none",
        reloadCount: 1,
        reloadKind: "start",
        reloadBundle: "update-1",
        reportedFault: "rtl:update-1",
      }),
    }
    expect(loadEntry().getLayoutDirectionModule().getState()).toEqual({
      nativeMode: "none",
      reloadCount: 1,
      reloadKind: "start",
      reloadBundle: "update-1",
      reportedFault: "rtl:update-1",
    })
  })

  it("reads an unknown or malformed native state as empty", () => {
    mockNative.current = {
      getState: () => ({
        nativeMode: "sideways",
        reloadCount: -2,
        reloadKind: "later",
        reloadBundle: "",
        reportedFault: 7,
      }),
    }
    expect(loadEntry().getLayoutDirectionModule().getState()).toEqual({
      nativeMode: null,
      reloadCount: 0,
      reloadKind: null,
      reloadBundle: null,
      reportedFault: null,
    })
  })
})
