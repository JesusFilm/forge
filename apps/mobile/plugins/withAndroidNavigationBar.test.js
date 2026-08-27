/* global jest */

const {
  applyNavigationBarTheme,
  NAVIGATION_BAR_ITEMS,
  NAVIGATION_BAR_STYLES,
} = require("./withAndroidNavigationBar")

// The PRE-plugin styles.xml shape, as the xml2js-backed AndroidConfig parser
// hands it to a mod: the Expo template plus expo-splash-screen, and nothing
// this repo's own plugins add. It is deliberately NOT a copy of
// android/app/src/main/res/values/styles.xml — that file is prebuild OUTPUT and
// already contains this plugin's items, so copying it would make the sanity
// tests below fail for the wrong reason.
// To refresh: unregister ./plugins/withAndroidNavigationBar and
// ./plugins/withAndroidCastTheme from app.json, run
// `npx expo prebuild --clean -p android`, then read values/styles.xml.
function prebuiltStyles() {
  return {
    style: [
      {
        $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" },
        item: [
          {
            $: { name: "android:editTextBackground" },
            _: "@drawable/rn_edit_text_material",
          },
          { $: { name: "colorPrimary" }, _: "@color/colorPrimary" },
          {
            $: { name: "android:statusBarColor" },
            _: "@android:color/transparent",
          },
          {
            $: { name: "android:navigationBarColor" },
            _: "@android:color/transparent",
          },
        ],
      },
      {
        $: { name: "Theme.App.SplashScreen", parent: "Theme.SplashScreen" },
        item: [
          {
            $: { name: "windowSplashScreenBackground" },
            _: "@color/splashscreen_background",
          },
          {
            $: { name: "windowSplashScreenAnimatedIcon" },
            _: "@drawable/splashscreen_logo",
          },
          { $: { name: "postSplashScreenTheme" }, _: "@style/AppTheme" },
          {
            $: { name: "android:windowSplashScreenBehavior" },
            _: "icon_preferred",
          },
        ],
      },
    ],
  }
}

const byName = (list, name) => list.find((entry) => entry.$?.name === name)
const appTheme = (resources) => byName(resources.style, "AppTheme")
const splashTheme = (resources) =>
  byName(resources.style, "Theme.App.SplashScreen")
const itemValue = (style, name) => byName(style.item, name)?._
const itemCount = (style, name) =>
  style.item.filter((entry) => entry.$?.name === name).length

describe("fixture sanity", () => {
  it("starts from a prebuild that declares no navigation-bar contrast items", () => {
    // A red here has TWO possible causes and they need opposite responses:
    // either Expo's template now emits these itself (this plugin is redundant),
    // or the fixture was re-captured from post-plugin output. Check which.
    const theme = appTheme(prebuiltStyles())
    expect(
      itemValue(theme, "android:enforceNavigationBarContrast"),
    ).toBeUndefined()
    expect(itemValue(theme, "android:windowLightNavigationBar")).toBeUndefined()
  })

  it("starts with the transparent bar colour React Native overwrites anyway", () => {
    expect(
      itemValue(appTheme(prebuiltStyles()), "android:navigationBarColor"),
    ).toBe("@android:color/transparent")
  })

  it("models the splash theme that does NOT inherit AppTheme", () => {
    // The whole reason this plugin writes two styles: MainActivity's manifest
    // theme is this one, and its parent is Theme.SplashScreen, not AppTheme.
    const splash = splashTheme(prebuiltStyles())
    expect(splash.$.parent).toBe("Theme.SplashScreen")
    expect(itemValue(splash, "postSplashScreenTheme")).toBe("@style/AppTheme")
  })
})

describe("AppTheme wiring", () => {
  const applied = () => applyNavigationBarTheme(prebuiltStyles())
  const appliedTheme = () => appTheme(applied())

  it("turns the platform contrast scrim off", () => {
    // This is the load-bearing one. Left at its default the platform paints
    // #e9e8e8 over this app in light system appearance (measured, S20/API 33),
    // AND React Native overwrites the appearance item below on every launch.
    expect(
      itemValue(appliedTheme(), "android:enforceNavigationBarContrast"),
    ).toBe("false")
  })

  it("asks for light buttons by declaring the background NOT light", () => {
    expect(itemValue(appliedTheme(), "android:windowLightNavigationBar")).toBe(
      "false",
    )
  })

  it("writes exactly the two items it declares, and no others", () => {
    const before = appTheme(prebuiltStyles()).item.map((e) => e.$.name)
    const after = appliedTheme().item.map((e) => e.$.name)
    expect(after.filter((name) => !before.includes(name)).sort()).toEqual(
      Object.keys(NAVIGATION_BAR_ITEMS).sort(),
    )
  })

  it("pins every declared item to a string value", () => {
    // A boolean false would serialise as an empty <item/>, which aapt2 accepts
    // and the platform then reads as `true`. The failure is silent.
    for (const value of Object.values(NAVIGATION_BAR_ITEMS)) {
      expect(typeof value).toBe("string")
    }
  })

  it("leaves android:navigationBarColor alone", () => {
    // Deliberate: RN forces it to transparent at runtime regardless, and the
    // explicit transparent suppresses the framework's window-background match.
    expect(itemValue(appliedTheme(), "android:navigationBarColor")).toBe(
      "@android:color/transparent",
    )
  })

  it("leaves the rest of AppTheme alone", () => {
    const theme = appliedTheme()
    expect(itemValue(theme, "colorPrimary")).toBe("@color/colorPrimary")
    expect(itemValue(theme, "android:statusBarColor")).toBe(
      "@android:color/transparent",
    )
    expect(itemValue(theme, "android:editTextBackground")).toBe(
      "@drawable/rn_edit_text_material",
    )
    expect(theme.$.parent).toBe("Theme.AppCompat.DayNight.NoActionBar")
  })

  it("throws when AppTheme is gone (a renamed template must fail prebuild)", () => {
    const resources = prebuiltStyles()
    resources.style = resources.style.filter((e) => e.$.name !== "AppTheme")
    expect(() => applyNavigationBarTheme(resources)).toThrow(
      /AppTheme not found/,
    )
  })
})

describe("splash theme wiring", () => {
  const applied = () => applyNavigationBarTheme(prebuiltStyles())

  it("writes both items onto the launch theme too", () => {
    // MainActivity's manifest theme is this style. Without these items the
    // launch window keeps the platform scrim, and the whole result depends on
    // expo-splash-screen's generated postSplashScreenTheme swap.
    const splash = splashTheme(applied())
    expect(itemValue(splash, "android:enforceNavigationBarContrast")).toBe(
      "false",
    )
    expect(itemValue(splash, "android:windowLightNavigationBar")).toBe("false")
  })

  it("leaves the splash theme's own items alone", () => {
    const splash = splashTheme(applied())
    expect(itemValue(splash, "windowSplashScreenBackground")).toBe(
      "@color/splashscreen_background",
    )
    expect(itemValue(splash, "postSplashScreenTheme")).toBe("@style/AppTheme")
    expect(splash.$.parent).toBe("Theme.SplashScreen")
  })

  it("tolerates a config with no splash theme", () => {
    // expo-splash-screen is a separate plugin; a config without it emits no
    // such style. AppTheme alone must still succeed.
    const resources = prebuiltStyles()
    resources.style = resources.style.filter(
      (e) => e.$.name !== "Theme.App.SplashScreen",
    )
    expect(() => applyNavigationBarTheme(resources)).not.toThrow()
    expect(
      itemValue(appTheme(resources), "android:enforceNavigationBarContrast"),
    ).toBe("false")
  })

  it("names both target styles it writes", () => {
    expect(NAVIGATION_BAR_STYLES).toEqual({
      APP_THEME: "AppTheme",
      SPLASH_THEME: "Theme.App.SplashScreen",
    })
  })

  it("adds nothing to the splash theme beyond the two declared items", () => {
    // AppTheme has this guard; without the same one here a stray item written
    // onto the LAUNCH theme passes the whole suite — and below API 31 that
    // window still honours android:navigationBarColor.
    const before = splashTheme(prebuiltStyles()).item.map((e) => e.$.name)
    const after = splashTheme(applied()).item.map((e) => e.$.name)
    expect(after.filter((name) => !before.includes(name)).sort()).toEqual(
      Object.keys(NAVIGATION_BAR_ITEMS).sort(),
    )
  })

  it("survives the REAL expo-splash-screen mod only in the registered order", () => {
    // expo-splash-screen REPLACES Theme.App.SplashScreen rather than merging,
    // and Expo runs mods last-registered-first. This plugin must therefore be
    // registered BEFORE expo-splash-screen, so its mod runs AFTER.
    const {
      withAndroidSplashStyles,
    } = require("../node_modules/expo-splash-screen/plugin/build/withAndroidSplashStyles")
    expect(typeof withAndroidSplashStyles).toBe("function")

    let splashMod
    jest.isolateModules(() => {
      const actual = jest.requireActual("expo/config-plugins")
      jest.doMock("expo/config-plugins", () => ({
        ...actual,
        withAndroidColors: (config) => config,
        withAndroidStyles: (config, mod) => {
          splashMod = mod
          return config
        },
      }))
      require("../node_modules/expo-splash-screen/plugin/build/withAndroidSplashStyles").withAndroidSplashStyles(
        {},
        {},
      )
      jest.dontMock("expo/config-plugins")
    })

    const runSplash = (resources) =>
      splashMod({ modResults: { resources } }).modResults.resources

    // Correct order: expo-splash-screen first, this plugin after -> items kept.
    const kept = applyNavigationBarTheme(runSplash(prebuiltStyles()))
    expect(
      itemValue(splashTheme(kept), "android:enforceNavigationBarContrast"),
    ).toBe("false")

    // Reversed order -> expo-splash-screen replaces the style and wipes them.
    const wiped = runSplash(applyNavigationBarTheme(prebuiltStyles()))
    expect(
      itemValue(splashTheme(wiped), "android:enforceNavigationBarContrast"),
    ).toBeUndefined()
  })

  it("is registered before expo-splash-screen in app.json", () => {
    // The order the test above proves is load-bearing.
    const { expo } = require("../app.json")
    const nameOf = (p) => (Array.isArray(p) ? p[0] : p)
    const names = expo.plugins.map(nameOf)
    const self = names.indexOf("./plugins/withAndroidNavigationBar")
    const splash = names.indexOf("expo-splash-screen")
    expect(self).toBeGreaterThanOrEqual(0)
    expect(splash).toBeGreaterThanOrEqual(0)
    expect(self).toBeLessThan(splash)
  })
})

describe("idempotence", () => {
  it("applying twice equals applying once", () => {
    const once = applyNavigationBarTheme(prebuiltStyles())
    const twice = applyNavigationBarTheme(
      applyNavigationBarTheme(prebuiltStyles()),
    )
    expect(twice).toEqual(once)
  })

  it("adds each item exactly once to each target style", () => {
    // `expo prebuild` reuses an existing android/, so the mod runs against
    // already-patched styles.xml on every rebuild.
    const resources = applyNavigationBarTheme(
      applyNavigationBarTheme(prebuiltStyles()),
    )
    for (const style of [appTheme(resources), splashTheme(resources)]) {
      for (const name of Object.keys(NAVIGATION_BAR_ITEMS)) {
        expect(itemCount(style, name)).toBe(1)
      }
    }
  })

  it("overwrites a stale value rather than appending beside it", () => {
    const resources = prebuiltStyles()
    appTheme(resources).item.push({
      $: { name: "android:enforceNavigationBarContrast" },
      _: "true",
    })
    const theme = appTheme(applyNavigationBarTheme(resources))
    expect(itemCount(theme, "android:enforceNavigationBarContrast")).toBe(1)
    expect(itemValue(theme, "android:enforceNavigationBarContrast")).toBe(
      "false",
    )
  })
})

describe("composition with the sibling AppTheme writer", () => {
  // withAndroidCastTheme writes onto the SAME AppTheme in the same prebuild
  // pass. Neither suite used to run both, so a collision between them could
  // only be found on a device.
  const { applyCastStyles } = require("./withAndroidCastTheme")

  it("both plugins' items survive one shared resources object", () => {
    const resources = applyCastStyles(applyNavigationBarTheme(prebuiltStyles()))
    const theme = appTheme(resources)
    expect(itemValue(theme, "android:enforceNavigationBarContrast")).toBe(
      "false",
    )
    expect(itemValue(theme, "android:windowLightNavigationBar")).toBe("false")
    expect(itemValue(theme, "mediaRouteTheme")).toBe(
      "@style/Theme.Forge.MediaRouter",
    )
  })

  it("holds in the reverse order too", () => {
    const resources = applyNavigationBarTheme(applyCastStyles(prebuiltStyles()))
    const theme = appTheme(resources)
    expect(itemValue(theme, "android:enforceNavigationBarContrast")).toBe(
      "false",
    )
    expect(itemValue(theme, "mediaRouteTheme")).toBe(
      "@style/Theme.Forge.MediaRouter",
    )
  })

  it("the two plugins write disjoint item names", () => {
    // The only reason order does not matter. If a future item name appears in
    // both, this is where it surfaces.
    const navOnly = appTheme(
      applyNavigationBarTheme(prebuiltStyles()),
    ).item.map((e) => e.$.name)
    const castOnly = appTheme(applyCastStyles(prebuiltStyles())).item.map(
      (e) => e.$.name,
    )
    const base = appTheme(prebuiltStyles()).item.map((e) => e.$.name)
    const navAdded = navOnly.filter((n) => !base.includes(n))
    const castAdded = castOnly.filter((n) => !base.includes(n))
    expect(navAdded.filter((n) => castAdded.includes(n))).toEqual([])
  })
})

describe("plugin entry point", () => {
  // The pure transform above proves the VALUES. Only this case catches a
  // deleted `withAndroidStyles(...)` call, which would ship a white bar from an
  // otherwise fully green suite (falsified 2026-08-25: it is the sole failure).
  // It does NOT catch a dropped `cfg.modResults.resources =` assignment —
  // applyNavigationBarTheme mutates in place, so that assignment only matters
  // on the `?? {}` path and its removal is not a defect.
  it("runs the styles mod and assigns the result back", () => {
    jest.resetModules()
    const calls = []
    const fixture = { resources: prebuiltStyles() }
    jest.doMock("expo/config-plugins", () => ({
      withAndroidStyles: (config, mod) => {
        calls.push("withAndroidStyles")
        return mod({ ...config, modResults: fixture })
      },
    }))

    const plugin = require("./withAndroidNavigationBar")
    const result = plugin({})

    expect(calls).toEqual(["withAndroidStyles"])
    expect(
      itemValue(
        appTheme(result.modResults.resources),
        "android:enforceNavigationBarContrast",
      ),
    ).toBe("false")
    jest.dontMock("expo/config-plugins")
  })
})

describe("app.json wiring", () => {
  it("registers the plugin, or none of the above reaches a build", () => {
    const { expo } = require("../app.json")
    expect(expo.plugins).toContain("./plugins/withAndroidNavigationBar")
  })

  it("does not also carry the dead expo.androidNavigationBar key", () => {
    // Deprecated in SDK 57: @expo/config-plugins SystemBars.js warns
    // "`androidNavigationBar` is deprecated and has no effect".
    const { expo } = require("../app.json")
    expect(expo.androidNavigationBar).toBeUndefined()
  })
})
