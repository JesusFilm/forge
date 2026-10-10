import {
  resolveExploreAvailable,
  type ExploreAvailabilityInputs,
} from "../availabilityState"

// A release bundle with every opt-in set. Each case changes one input, so a
// case that expects "hidden" fails for the one reason it names.
const OPEN_RELEASE: ExploreAvailabilityInputs = {
  overTheAirEnabled: true,
  isDev: false,
  platform: "ios",
  flagValue: "1",
  androidFlagValue: "1",
}

function resolve(overrides: Partial<ExploreAvailabilityInputs>): boolean {
  return resolveExploreAvailable({ ...OPEN_RELEASE, ...overrides })
}

// An opt-in gate, not a boolean parser: every value but these two stays off.
const OFF_VALUES = [
  undefined,
  "",
  "0",
  "false",
  "TRUE",
  "True",
  "yes",
  " 1",
  "1\n",
]

describe("resolveExploreAvailable", () => {
  describe("a development bundle", () => {
    it.each(["ios", "android"])(
      "shows the tab on %s whatever the variables say",
      (platform) => {
        for (const flagValue of [...OFF_VALUES, "1"]) {
          for (const androidFlagValue of [undefined, "0", "1"]) {
            expect(
              resolve({ isDev: true, platform, flagValue, androidFlagValue }),
            ).toBe(true)
          }
        }
      },
    )
  })

  describe("a release iOS bundle", () => {
    it.each(["1", "true"])("shows the tab for %p", (flagValue) => {
      expect(resolve({ flagValue })).toBe(true)
    })

    it.each(OFF_VALUES)("hides the tab for %p", (flagValue) => {
      expect(resolve({ flagValue })).toBe(false)
    })

    it.each([undefined, "", "0", "yes"])(
      "ignores an Android variable of %p",
      (androidFlagValue) => {
        expect(resolve({ androidFlagValue })).toBe(true)
      },
    )

    it("stays hidden when only the Android variable is set", () => {
      expect(resolve({ flagValue: undefined, androidFlagValue: "1" })).toBe(
        false,
      )
    })
  })

  describe("a release Android bundle", () => {
    it.each([
      ["1", "1"],
      ["1", "true"],
      ["true", "1"],
      ["true", "true"],
    ])(
      "shows the tab when the variable is %p and the Android variable is %p",
      (flagValue, androidFlagValue) => {
        expect(
          resolve({ platform: "android", flagValue, androidFlagValue }),
        ).toBe(true)
      },
    )

    it.each(OFF_VALUES)(
      "hides the tab when the variable is 1 and the Android variable is %p",
      (androidFlagValue) => {
        expect(
          resolve({ platform: "android", flagValue: "1", androidFlagValue }),
        ).toBe(false)
      },
    )

    it.each(OFF_VALUES)(
      "hides the tab when the Android variable is 1 and the variable is %p",
      (flagValue) => {
        expect(
          resolve({ platform: "android", flagValue, androidFlagValue: "1" }),
        ).toBe(false)
      },
    )
  })

  describe("the over-the-air constant", () => {
    it("hides the tab in every case when it is off", () => {
      let cases = 0
      for (const isDev of [true, false]) {
        for (const platform of ["ios", "android"]) {
          for (const flagValue of [undefined, "1", "true"]) {
            for (const androidFlagValue of [undefined, "1", "true"]) {
              cases += 1
              expect(
                resolveExploreAvailable({
                  overTheAirEnabled: false,
                  isDev,
                  platform,
                  flagValue,
                  androidFlagValue,
                }),
              ).toBe(false)
            }
          }
        }
      }
      // Anti-vacuous: an empty loop passes every expectation inside it.
      expect(cases).toBe(36)
    })
  })

  // The plan's KTD16 decision table, one row per line, in the plan's order.
  describe("the KTD16 decision table", () => {
    it.each<[string, Partial<ExploreAvailabilityInputs>, boolean]>([
      [
        "development, any values",
        { isDev: true, flagValue: undefined, androidFlagValue: undefined },
        true,
      ],
      [
        "release iOS, 1, any",
        { platform: "ios", flagValue: "1", androidFlagValue: undefined },
        true,
      ],
      [
        "release Android, 1, 1",
        { platform: "android", flagValue: "1", androidFlagValue: "1" },
        true,
      ],
      [
        "release Android, 1, unset",
        { platform: "android", flagValue: "1", androidFlagValue: undefined },
        false,
      ],
      [
        "release iOS, unset, any",
        { platform: "ios", flagValue: undefined, androidFlagValue: "1" },
        false,
      ],
      [
        "release Android, unset, any",
        { platform: "android", flagValue: undefined, androidFlagValue: "1" },
        false,
      ],
      [
        "any bundle, constant off",
        { overTheAirEnabled: false, isDev: true },
        false,
      ],
    ])("%s", (_row, overrides, expected) => {
      expect(resolve(overrides)).toBe(expected)
    })
  })
})
