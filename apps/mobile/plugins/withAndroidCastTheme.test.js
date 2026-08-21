const {
  applyCastStyles,
  applyCastColors,
  CAST_THEME_NAMES,
  CAST_COLORS,
} = require("./withAndroidCastTheme")

// The styles.xml / colors.xml shape `expo prebuild` produces, as the
// xml2js-backed AndroidConfig parsers hand it to a mod. Captured from this
// repo's real android/app/src/main/res/values output (expo ~57.0.12,
// 2026-08-20). Re-capture on every SDK bump.
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
        item: [{ $: { name: "postSplashScreenTheme" }, _: "@style/AppTheme" }],
      },
    ],
  }
}

function prebuiltColors() {
  return {
    color: [
      { $: { name: "splashscreen_background" }, _: "#1c1917" },
      { $: { name: "iconBackground" }, _: "#191513" },
      { $: { name: "colorPrimary" }, _: "#023c69" },
    ],
  }
}

const byName = (list, name) => list.find((entry) => entry.$?.name === name)
const itemValue = (style, name) => byName(style.item, name)?._

describe("fixture sanity", () => {
  it("starts from the untouched Expo default that causes the blue", () => {
    // #023c69 is what currently tints the Android cast dialogs. If this ever
    // stops being the starting point, the premise of this plugin changed.
    expect(
      itemValue(byName(prebuiltStyles().style, "AppTheme"), "colorPrimary"),
    ).toBe("@color/colorPrimary")
    expect(byName(prebuiltColors().color, "colorPrimary")._).toBe("#023c69")
  })

  it("declares no cast theming yet", () => {
    const appTheme = byName(prebuiltStyles().style, "AppTheme")
    expect(itemValue(appTheme, "mediaRouteTheme")).toBeUndefined()
    expect(itemValue(appTheme, "castExpandedControllerStyle")).toBeUndefined()
  })
})

// A bare parent compiles, ships, and silently drops every SDK default — the
// MediaRouter drawables, or all 27 CastExpandedController transport items.
// Nothing at runtime announces it, so it is pinned here.
describe("style parents", () => {
  const resources = applyCastStyles(prebuiltStyles())

  it("inherits a Theme.MediaRouter variant for the dialogs", () => {
    const style = byName(resources.style, CAST_THEME_NAMES.MEDIA_ROUTER_STYLE)
    expect(style).toBeDefined()
    expect(style.$.parent).toMatch(/^Theme\.MediaRouter/)
  })

  it("inherits CastExpandedController for the expanded controls", () => {
    expect(
      byName(resources.style, CAST_THEME_NAMES.EXPANDED_STYLE).$.parent,
    ).toBe("CastExpandedController")
  })

  it("inherits CastMiniController and CastIntroOverlay", () => {
    expect(byName(resources.style, CAST_THEME_NAMES.MINI_STYLE).$.parent).toBe(
      "CastMiniController",
    )
    expect(byName(resources.style, CAST_THEME_NAMES.INTRO_STYLE).$.parent).toBe(
      "CastIntroOverlay",
    )
  })
})

describe("AppTheme wiring", () => {
  const resources = applyCastStyles(prebuiltStyles())
  const appTheme = byName(resources.style, "AppTheme")

  // mediaRouteTheme is the ONLY route into the chooser and controller dialogs:
  // MediaRouteChooserDialogFragment builds from the Activity context, so a style
  // that is not named here reaches nothing at all.
  it("points mediaRouteTheme at the new style", () => {
    expect(itemValue(appTheme, "mediaRouteTheme")).toBe(
      `@style/${CAST_THEME_NAMES.MEDIA_ROUTER_STYLE}`,
    )
  })

  it("points each cast widget attribute at its style", () => {
    expect(itemValue(appTheme, "castExpandedControllerStyle")).toBe(
      `@style/${CAST_THEME_NAMES.EXPANDED_STYLE}`,
    )
    expect(itemValue(appTheme, "castMiniControllerStyle")).toBe(
      `@style/${CAST_THEME_NAMES.MINI_STYLE}`,
    )
    expect(itemValue(appTheme, "castIntroOverlayStyle")).toBe(
      `@style/${CAST_THEME_NAMES.INTRO_STYLE}`,
    )
  })

  // castExpandedControllerToolbarStyle is consumed as android:theme=, so a
  // widget style there produces an unthemed toolbar with no error.
  it("gives the toolbar attribute a theme OVERLAY, not a widget style", () => {
    expect(itemValue(appTheme, "castExpandedControllerToolbarStyle")).toMatch(
      /^@style\/ThemeOverlay\./,
    )
  })

  it("leaves the rest of AppTheme alone", () => {
    expect(itemValue(appTheme, "colorPrimary")).toBe("@color/colorPrimary")
    expect(itemValue(appTheme, "android:statusBarColor")).toBe(
      "@android:color/transparent",
    )
    expect(appTheme.$.parent).toBe("Theme.AppCompat.DayNight.NoActionBar")
  })

  it("throws when AppTheme is gone (a renamed template must fail prebuild)", () => {
    const renamed = prebuiltStyles()
    renamed.style = renamed.style.filter((s) => s.$.name !== "AppTheme")
    expect(() => applyCastStyles(renamed)).toThrow(/AppTheme not found/)
  })
})

describe("dialog and transport colours", () => {
  const resources = applyCastStyles(prebuiltStyles())
  const router = byName(resources.style, CAST_THEME_NAMES.MEDIA_ROUTER_STYLE)
  const expanded = byName(resources.style, CAST_THEME_NAMES.EXPANDED_STYLE)

  it("repaints the dialog ground and text", () => {
    expect(itemValue(router, "android:colorBackground")).toBe(
      "@color/forge_cast_background",
    )
    expect(itemValue(router, "android:textColorPrimary")).toBe(
      "@color/forge_cast_text_primary",
    )
    expect(itemValue(router, "mediaRouteDividerColor")).toBe(
      "@color/forge_cast_divider",
    )
  })

  it("moves the dialog tint off the Expo default", () => {
    expect(itemValue(router, "colorPrimary")).toBe("@color/forge_cast_accent")
    expect(itemValue(router, "colorPrimary")).not.toBe("@color/colorPrimary")
  })

  it("repaints the seek bar off the stock cast red", () => {
    expect(itemValue(expanded, "castSeekBarProgressAndThumbColor")).toBe(
      "@color/forge_cast_accent",
    )
  })
})

// Style existence and parent were pinned; the item VALUES mostly were not, so a
// value swapped between two keys passed aapt2 and jest alike. aapt2 validates
// that a @color reference resolves, never that it is the RIGHT one.
describe("every theme item value", () => {
  const resources = applyCastStyles(prebuiltStyles())
  const value = (styleName, item) =>
    itemValue(byName(resources.style, styleName), item)

  it.each([
    ["colorPrimary", "@color/forge_cast_accent"],
    ["colorAccent", "@color/forge_cast_accent"],
    ["android:colorBackground", "@color/forge_cast_background"],
    ["android:textColorPrimary", "@color/forge_cast_text_primary"],
    ["android:textColorSecondary", "@color/forge_cast_text_secondary"],
    ["mediaRouteDividerColor", "@color/forge_cast_divider"],
  ])("dialog theme %s -> %s", (item, expected) => {
    expect(value(CAST_THEME_NAMES.MEDIA_ROUTER_STYLE, item)).toBe(expected)
  })

  it.each([
    ["castButtonColor", "@color/forge_cast_text_primary"],
    ["castSeekBarProgressAndThumbColor", "@color/forge_cast_accent"],
    ["castSeekBarSecondaryProgressColor", "@color/forge_cast_track_buffered"],
    [
      "castSeekBarUnseekableProgressColor",
      "@color/forge_cast_track_unseekable",
    ],
    ["castSeekBarTooltipBackgroundColor", "@color/forge_cast_accent"],
    ["castExpandedControllerLoadingIndicatorColor", "@color/forge_cast_accent"],
    ["castLiveIndicatorColor", "@color/forge_cast_accent"],
  ])("expanded controller %s -> %s", (item, expected) => {
    expect(value(CAST_THEME_NAMES.EXPANDED_STYLE, item)).toBe(expected)
  })

  it.each([
    ["castBackground", "@color/forge_cast_surface"],
    ["castButtonColor", "@color/forge_cast_text_primary"],
    ["castProgressBarColor", "@color/forge_cast_accent"],
    ["castMiniControllerLoadingIndicatorColor", "@color/forge_cast_accent"],
  ])("mini controller %s -> %s", (item, expected) => {
    expect(value(CAST_THEME_NAMES.MINI_STYLE, item)).toBe(expected)
  })

  it.each([
    ["castBackgroundColor", "@color/forge_cast_background"],
    ["castButtonBackgroundColor", "@color/forge_cast_accent"],
  ])("intro overlay %s -> %s", (item, expected) => {
    expect(value(CAST_THEME_NAMES.INTRO_STYLE, item)).toBe(expected)
  })

  // Anti-vacuous: the tables above must be able to fail. Swapping two values
  // keeps every @color name present and every style parent intact.
  it("would catch a value swapped between two keys", () => {
    const swapped = applyCastStyles(prebuiltStyles())
    const style = byName(swapped.style, CAST_THEME_NAMES.MINI_STYLE)
    byName(style.item, "castBackground")._ = "@color/forge_cast_accent"
    expect(itemValue(style, "castBackground")).not.toBe(
      "@color/forge_cast_surface",
    )
  })

  // Every referenced colour must exist, or aapt2 fails the build. This is the
  // seam between the two mods, which run on separate resource files.
  // Dead config is the other half of the same seam: a declared colour nothing
  // points at reads as an enforced rule that does not exist.
  it("declares no colour that nothing references", () => {
    const declared = applyCastColors(prebuiltColors())
      .color.map((c) => c.$.name)
      .filter((n) => n.startsWith("forge_cast_"))
    const referenced = new Set()
    for (const style of resources.style) {
      for (const item of style.item ?? []) {
        const match = /^@color\/(forge_cast_\w+)$/.exec(item._ ?? "")
        if (match) referenced.add(match[1])
      }
    }
    expect(declared.length).toBeGreaterThan(5)
    expect(declared.filter((n) => !referenced.has(n))).toEqual([])
  })

  it("references only colours the colors mod writes", () => {
    const declared = new Set(
      applyCastColors(prebuiltColors()).color.map((c) => c.$.name),
    )
    const referenced = new Set()
    for (const style of resources.style) {
      for (const item of style.item ?? []) {
        const match = /^@color\/(forge_cast_\w+)$/.exec(item._ ?? "")
        if (match) referenced.add(match[1])
      }
    }
    expect(referenced.size).toBeGreaterThan(5)
    for (const name of referenced) expect(declared).toContain(name)
  })
})

describe("colour resources", () => {
  const resources = applyCastColors(prebuiltColors())
  const value = (name) => byName(resources.color, name)._

  it("carries the app's own palette", () => {
    expect(value("forge_cast_background")).toBe("#1c1917") // BG_COLOR
    expect(value("forge_cast_surface")).toBe("#292524") // SURFACE_COLOR
    expect(value("forge_cast_text_primary")).toBe("#f5f5f4") // TEXT_PRIMARY
    expect(value("forge_cast_text_secondary")).toBe("#a8a29e") // TEXT_SECONDARY
    expect(value("forge_cast_accent")).toBe("#cb333b") // ACCENT
  })

  it("carries no stock cast red and no Expo default blue", () => {
    // #d0021b is the Cast SDK's own seek-bar red — close enough to #cb333b to
    // pass a glance and fail the design system.
    const values = Object.values(CAST_COLORS).map((v) => v.toLowerCase())
    expect(values).not.toContain("#d0021b")
    expect(values).not.toContain("#023c69")
  })

  it("leaves the app's existing colours untouched", () => {
    expect(value("splashscreen_background")).toBe("#1c1917")
    expect(value("colorPrimary")).toBe("#023c69")
  })

  it("is idempotent — applying twice equals applying once", () => {
    const once = applyCastColors(prebuiltColors())
    const twice = applyCastColors(applyCastColors(prebuiltColors()))
    expect(twice).toEqual(once)
    expect(
      twice.color.filter((c) => c.$.name === "forge_cast_accent"),
    ).toHaveLength(1)
  })
})

describe("style idempotence", () => {
  it("applying twice equals applying once", () => {
    const once = applyCastStyles(prebuiltStyles())
    const twice = applyCastStyles(applyCastStyles(prebuiltStyles()))
    expect(twice).toEqual(once)
  })

  it("adds each style exactly once", () => {
    const resources = applyCastStyles(applyCastStyles(prebuiltStyles()))
    for (const name of [
      CAST_THEME_NAMES.MEDIA_ROUTER_STYLE,
      CAST_THEME_NAMES.EXPANDED_STYLE,
      CAST_THEME_NAMES.MINI_STYLE,
      CAST_THEME_NAMES.INTRO_STYLE,
    ]) {
      expect(resources.style.filter((s) => s.$.name === name)).toHaveLength(1)
    }
  })

  it("adds each AppTheme item exactly once", () => {
    const resources = applyCastStyles(applyCastStyles(prebuiltStyles()))
    const appTheme = byName(resources.style, "AppTheme")
    expect(
      appTheme.item.filter((i) => i.$.name === "mediaRouteTheme"),
    ).toHaveLength(1)
  })
})
