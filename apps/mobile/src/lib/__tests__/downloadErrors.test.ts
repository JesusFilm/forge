import { mapNativeError } from "../downloadErrors"

describe("mapNativeError", () => {
  it.each([400, 403, 404, 410, 500, 503])(
    "maps HTTP status %i to a terminal httpError",
    (status) => {
      expect(
        mapNativeError({ error: "request failed", errorCode: status }),
      ).toEqual({
        kind: "httpError",
        status,
      })
    },
  )

  it("maps an out-of-space message to storageFull", () => {
    expect(
      mapNativeError({
        error: "No space left on device (ENOSPC)",
        errorCode: 0,
      }),
    ).toEqual({ kind: "storageFull" })
  })

  it("maps an integrity/corruption message to integrity", () => {
    expect(
      mapNativeError({
        error: "checksum mismatch: file corrupt",
        errorCode: 0,
      }),
    ).toEqual({ kind: "integrity" })
  })

  it("maps an explicit cancel message to userCancel", () => {
    expect(
      mapNativeError({ error: "Download was cancelled", errorCode: 0 }),
    ).toEqual({ kind: "userCancel" })
  })

  it("defaults an unknown/blip error to a transient connectivity pause", () => {
    expect(
      mapNativeError({
        error: "The network connection was lost.",
        errorCode: -1009,
      }),
    ).toEqual({ kind: "connectivity" })
    expect(mapNativeError({ error: "", errorCode: 0 })).toEqual({
      kind: "connectivity",
    })
  })
})
