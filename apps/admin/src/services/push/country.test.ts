import { describe, expect, it } from "vitest"

import { readPushEdgeCountry, resolvePushCountry } from "./country"

function headers(init: Record<string, string>): Headers {
  return new Headers(init)
}

describe("reading the edge country header", () => {
  it("reads Cloudflare's own header", () => {
    expect(readPushEdgeCountry(headers({ "cf-ipcountry": "NZ" }))).toBe("NZ")
  })

  it("uppercases and trims the value", () => {
    expect(readPushEdgeCountry(headers({ "cf-ipcountry": " nz " }))).toBe("NZ")
  })

  it("ignores the client-settable country headers the web reader accepts", () => {
    expect(
      readPushEdgeCountry(
        headers({
          "x-vercel-ip-country": "US",
          "x-country-code": "US",
        }),
      ),
    ).toBeNull()
  })

  it("drops the placeholder and anonymised values", () => {
    expect(readPushEdgeCountry(headers({ "cf-ipcountry": "XX" }))).toBeNull()
    expect(readPushEdgeCountry(headers({ "cf-ipcountry": "T1" }))).toBeNull()
    expect(readPushEdgeCountry(headers({ "cf-ipcountry": "" }))).toBeNull()
  })

  it("is null when the header is absent", () => {
    expect(readPushEdgeCountry(headers({}))).toBeNull()
  })
})

describe("resolving a registration's country", () => {
  it("takes the edge value first", () => {
    expect(
      resolvePushCountry({ edgeCountry: "NZ", phoneLocale: "fr-FR" }),
    ).toEqual({ country: "NZ", source: "EDGE" })
  })

  it("falls to the region subtag of the phone's locale", () => {
    expect(
      resolvePushCountry({ edgeCountry: null, phoneLocale: "fr-FR" }),
    ).toEqual({ country: "FR", source: "PHONE_REGION" })
  })

  it("reads the region past a script subtag", () => {
    expect(
      resolvePushCountry({ edgeCountry: null, phoneLocale: "zh-Hant-TW" }),
    ).toEqual({ country: "TW", source: "PHONE_REGION" })
  })

  it("is unknown when the locale carries no region", () => {
    expect(
      resolvePushCountry({ edgeCountry: null, phoneLocale: "en" }),
    ).toEqual({ country: null, source: "UNKNOWN" })
  })

  it("is unknown when the locale is absent", () => {
    expect(
      resolvePushCountry({ edgeCountry: null, phoneLocale: null }),
    ).toEqual({ country: null, source: "UNKNOWN" })
  })

  it("refuses a placeholder region in the locale", () => {
    expect(
      resolvePushCountry({ edgeCountry: null, phoneLocale: "en-XX" }),
    ).toEqual({ country: null, source: "UNKNOWN" })
  })

  it("ignores a numeric UN region subtag", () => {
    expect(
      resolvePushCountry({ edgeCountry: null, phoneLocale: "es-419" }),
    ).toEqual({ country: null, source: "UNKNOWN" })
  })
})
