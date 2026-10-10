import {
  errorMessageOf,
  mapNativeError,
  telemetryErrorMessage,
} from "../downloadErrors"

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

describe("telemetryErrorMessage", () => {
  // The one path a caught error may take to Datadog. Composing the read and
  // the redaction here is what stops a call site logging raw text by omission.
  it("redacts a signed media URL", () => {
    const raw =
      "Download failed for https://cdn.example.com/v/abc.mp4?Policy=eyJTdA&Signature=SECRETSIG&Key-Pair-Id=APKA1"

    const sent = telemetryErrorMessage(new Error(raw))

    expect(sent).toBe("Download failed for <url>")
    expect(sent).not.toContain("Signature")
    expect(sent).not.toContain("cdn.example.com")
  })

  it("redacts a staged filesystem path", () => {
    const sent = telemetryErrorMessage(
      new Error("ENOENT /var/mobile/Containers/Data/raw-exports/x/Jesus.mp4"),
    )

    expect(sent).toBe("ENOENT <path>")
    expect(sent).not.toContain("raw-exports")
  })

  it("reads a non-Error rejection, which still carries text", () => {
    expect(errorMessageOf("plain string")).toBe("plain string")
    expect(errorMessageOf(new Error("boom"))).toBe("boom")
    expect(telemetryErrorMessage("https://cdn.example.com/a.mp4?sig=x")).toBe(
      "<url>",
    )
  })
})
