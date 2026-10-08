import { describe, expect, it } from "vitest"

import { checkPushCountryCode, pushCountryCodeRefusal } from "./country-code"

// ISO 3166-1 alpha-2, copied from tzdata's iso3166.tab, a source independent of
// ICU. A narrower NOT_A_COUNTRY or a Node ICU change that drops one fails here.
const ISO_3166_ALPHA_2 = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI " +
  "BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
  "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
  "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
  "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
  "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
  "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP " +
  "NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
  "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
  "VN VU WF WS YE YT ZA ZM ZW"
).split(" ")

describe("checkPushCountryCode", () => {
  it.each([
    ["MX", "Mexico"],
    ["GB", "United Kingdom"],
    ["SA", "Saudi Arabia"],
  ])("names %s, a code that phones report", (code, name) => {
    expect(checkPushCountryCode(code)).toEqual({ kind: "country", name })
  })

  it("accepts every ISO 3166-1 country", () => {
    expect(ISO_3166_ALPHA_2).toHaveLength(249)
    const refused = ISO_3166_ALPHA_2.filter(
      (code) => checkPushCountryCode(code).kind !== "country",
    )
    expect(refused).toEqual([])
  })

  // The edge reports Kosovo as XK, so the user-assigned range keeps it.
  it("keeps XK, which the edge reports for Kosovo", () => {
    expect(checkPushCountryCode("XK")).toEqual({
      kind: "country",
      name: "Kosovo",
    })
  })

  it.each([
    ["UK", "GB", "United Kingdom"],
    ["DD", "DE", "Germany"],
    ["SU", "RU", "Russia"],
  ])(
    "calls %s an alias of %s, which no phone stores",
    (code, canonical, name) => {
      expect(checkPushCountryCode(code)).toEqual({
        kind: "alias",
        canonical,
        name,
      })
    },
  )

  it.each([
    "EU",
    "EZ",
    "UN",
    "ZZ",
    "XX",
    "AA",
    "QO",
    "QQ",
    "JJ",
    // Intl names these pseudo-locales, so only the X range refuses them.
    "XA",
    "XB",
    // An alias whose canonical code (EU) is itself a group code.
    "QU",
    "mx",
    "T1",
    "",
  ])("refuses %s, which names no country", (code) => {
    expect(checkPushCountryCode(code)).toEqual({ kind: "unknown" })
  })
})

describe("pushCountryCodeRefusal", () => {
  it("accepts a country", () => {
    expect(pushCountryCodeRefusal("FR")).toBeNull()
  })

  it("names the ISO code for an alias", () => {
    expect(pushCountryCodeRefusal("UK")).toBe(
      "UK is not an ISO country code. Use GB for United Kingdom",
    )
  })

  it("refuses a code that names no country", () => {
    expect(pushCountryCodeRefusal("EU")).toBe(
      "EU is not a country code that a phone reports",
    )
  })
})
