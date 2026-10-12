import { decideDirection, type DirectionInputs } from "../layoutDirection"

// One base fixture: a matched Android start with mirroring on. Each test
// changes one axis, so each branch has a test that only it can satisfy.
const BASE: DirectionInputs = {
  platform: "android",
  uiTag: "ar",
  mirroringEnabled: true,
  localeReadFailed: false,
  inUseRTL: true,
  record: {
    nativeMode: "rtl",
    reloadCount: 0,
    reloadBundle: null,
    reportedFault: null,
  },
  bundle: "build:7",
}

function decide(change: Partial<DirectionInputs>) {
  return decideDirection({ ...BASE, ...change })
}

function withRecord(change: Partial<DirectionInputs["record"]>) {
  return decide({ record: { ...BASE.record, ...change } })
}

describe("decideDirection", () => {
  it("does nothing on a matched start with the same native mode", () => {
    expect(decide({})).toEqual({
      kind: "matched",
      nativeMode: "rtl",
      saveNativeMode: false,
      clearRecord: false,
    })
  })

  it("covers AE1 on iOS: an Arabic UI in a right-to-left runtime stays", () => {
    expect(decide({ platform: "ios" })).toMatchObject({ kind: "matched" })
  })

  it("clears the record on the matched start after a direction reload", () => {
    expect(withRecord({ reloadCount: 1, reloadBundle: "build:7" })).toEqual({
      kind: "matched",
      nativeMode: "rtl",
      saveNativeMode: false,
      clearRecord: true,
    })
  })

  it("clears a reported fault on a matched start", () => {
    expect(withRecord({ reportedFault: "ltr:build:7" })).toMatchObject({
      kind: "matched",
      clearRecord: true,
    })
  })

  it("covers AE1 on Android: reloads an Arabic UI in a left-to-right runtime", () => {
    expect(decide({ inUseRTL: false })).toEqual({
      kind: "reload",
      wantedRTL: true,
      nativeMode: "rtl",
    })
  })

  it("covers AE2: reloads an English UI in a right-to-left runtime", () => {
    expect(decide({ uiTag: "en", inUseRTL: true })).toEqual({
      kind: "reload",
      wantedRTL: false,
      nativeMode: "ltr",
    })
  })

  it("covers AE3: keeps an English UI in a left-to-right runtime", () => {
    expect(
      decide({
        uiTag: "en",
        inUseRTL: false,
        record: { ...BASE.record, nativeMode: "ltr" },
      }),
    ).toMatchObject({ kind: "matched", nativeMode: "ltr" })
  })

  it.each(["ar", "az-Arab", "ckb", "dv", "fa", "he", "ms-Arab", "ps", "sd"])(
    "wants right-to-left for the %s catalog",
    (uiTag) => {
      expect(decide({ uiTag, inUseRTL: false })).toMatchObject({
        kind: "reload",
        wantedRTL: true,
      })
    },
  )

  it.each(["ug", "ur", "uz-Arab"])(
    "wants right-to-left for the %s catalog",
    (uiTag) => {
      expect(decide({ uiTag, inUseRTL: false })).toMatchObject({
        wantedRTL: true,
      })
    },
  )

  it.each(["en", "az", "ms", "uz", "fr"])(
    "wants left-to-right for the %s catalog",
    (uiTag) => {
      expect(decide({ uiTag, inUseRTL: true })).toMatchObject({
        kind: "reload",
        wantedRTL: false,
      })
    },
  )

  it("covers AE7: does not reload again on the same bundle, and reports", () => {
    expect(
      decide({
        inUseRTL: false,
        record: { ...BASE.record, reloadCount: 1, reloadBundle: "build:7" },
      }),
    ).toEqual({
      kind: "stuck",
      nativeMode: "ltr",
      fault: "rtl:build:7",
      report: true,
    })
  })

  it("does not report a second stuck start for the same fault", () => {
    expect(
      decide({
        inUseRTL: false,
        record: {
          ...BASE.record,
          reloadCount: 1,
          reloadBundle: "build:7",
          reportedFault: "rtl:build:7",
        },
      }),
    ).toMatchObject({ kind: "stuck", report: false })
  })

  it("reports a stuck start whose wanted direction changed", () => {
    expect(
      decide({
        uiTag: "en",
        inUseRTL: true,
        record: {
          ...BASE.record,
          reloadCount: 1,
          reloadBundle: "build:7",
          reportedFault: "rtl:build:7",
        },
      }),
    ).toMatchObject({ kind: "stuck", fault: "ltr:build:7", report: true })
  })

  it("retries once after a new update on a stuck device", () => {
    expect(
      decide({
        inUseRTL: false,
        bundle: "update:abc",
        record: {
          ...BASE.record,
          reloadCount: 1,
          reloadBundle: "build:7",
          reportedFault: "rtl:build:7",
        },
      }),
    ).toEqual({ kind: "reload", wantedRTL: true, nativeMode: "rtl" })
  })

  it("keeps the direction in use when the locale read failed", () => {
    expect(decide({ localeReadFailed: true, uiTag: "en" })).toEqual({
      kind: "keep",
      nativeMode: "rtl",
    })
  })

  it("covers AE8: the off switch reloads an Arabic UI to left-to-right", () => {
    expect(decide({ mirroringEnabled: false })).toEqual({
      kind: "reload",
      wantedRTL: false,
      nativeMode: "none",
    })
  })

  it("gives iOS native mode ltr when the switch is off", () => {
    expect(decide({ mirroringEnabled: false, platform: "ios" })).toEqual({
      kind: "reload",
      wantedRTL: false,
      nativeMode: "ltr",
    })
  })

  it("saves native mode none on a matched Android start with the switch off", () => {
    expect(
      decide({ mirroringEnabled: false, uiTag: "ar", inUseRTL: false }),
    ).toEqual({
      kind: "matched",
      nativeMode: "none",
      saveNativeMode: true,
      clearRecord: false,
    })
  })

  it("saves native mode ltr on a matched start with no saved mode (ks phone)", () => {
    expect(
      decide({
        uiTag: "en",
        inUseRTL: false,
        record: { ...BASE.record, nativeMode: null },
      }),
    ).toEqual({
      kind: "matched",
      nativeMode: "ltr",
      saveNativeMode: true,
      clearRecord: false,
    })
  })

  it("saves native mode ltr on a matched iOS upgrade (ks phone)", () => {
    expect(
      decide({
        platform: "ios",
        uiTag: "en",
        inUseRTL: false,
        record: { ...BASE.record, nativeMode: null },
      }),
    ).toMatchObject({
      kind: "matched",
      nativeMode: "ltr",
      saveNativeMode: true,
    })
  })
})
