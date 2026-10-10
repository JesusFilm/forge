// Loaded defensively: Expo config plugins are only resolvable in prebuild
// contexts. On resolution failure, no-op rather than crash Metro/jest — the
// prebuilt android/ resources are already patched.
let withAndroidStyles = null
let withAndroidColors = null
try {
  ;({ withAndroidStyles, withAndroidColors } = require("expo/config-plugins"))
} catch {
  withAndroidStyles = null
  withAndroidColors = null
}

const { setItem, getRequiredStyle } = require("./androidStyleXml")

/**
 * The Android half of the cast restyle. Android has no GCKUIStyle: the cast
 * dialogs read their colours from THEME ATTRIBUTES resolved off the Activity
 * theme, so the levers are items on AppTheme.
 *
 * Two parent styles are mandatory, not stylistic:
 *
 *  - Theme.Forge.MediaRouter MUST inherit a Theme.MediaRouter* variant.
 *    MediaRouterThemeHelper.createThemedDialogContext reads mediaRouteTheme and
 *    expects the MediaRouter drawable and text-appearance set to be present.
 *  - Forge.CastExpandedController MUST inherit CastExpandedController, which
 *    declares 27 items (every transport drawable). A bare parent drops them all.
 *
 * Deliberately NOT overridden: the expanded controller's root background. It is
 * `@color/cast_expanded_controller_background_color` = #000000, referenced from
 * the vendor's layout rather than a theme attribute, so the only lever is a
 * same-name resource override. #000000 already IS the app's BLACK token, whose
 * docblock names the player surface, so the fragile lever buys nothing.
 *
 * The expanded controller only RENDERS because app.json sets
 * `expandedController: true`. The vendor passes that prop bare on Android
 * (`?? true` on iOS only), so without it the Activity is never declared and
 * every item in Forge.CastExpandedController is dead configuration.
 */

// From src/lib/color.ts. Prefixed so a name collision with an app colour is
// impossible; AGP merges app resources over library ones by name.
const COLORS = {
  forge_cast_background: "#1c1917", // BG_COLOR
  forge_cast_surface: "#292524", // SURFACE_COLOR
  forge_cast_text_primary: "#f5f5f4", // TEXT_PRIMARY
  forge_cast_text_secondary: "#a8a29e", // TEXT_SECONDARY
  // ACCENT only. Android's mediarouter hardcodes its text-button colour, so
  // there is no attribute to point ACCENT_ON_DARK at — see iOS for that pair.
  forge_cast_accent: "#cb333b",
  forge_cast_divider: "#1affffff", // white 10%, the app's hairline recipe
  forge_cast_track_buffered: "#59ffffff", // white 35%
  forge_cast_track_unseekable: "#26ffffff", // white 15%
}

const MEDIA_ROUTER_STYLE = "Theme.Forge.MediaRouter"
const MEDIA_ROUTER_PARENT = "Theme.MediaRouter"
const EXPANDED_STYLE = "Forge.CastExpandedController"
const EXPANDED_PARENT = "CastExpandedController"
const MINI_STYLE = "Forge.CastMiniController"
const MINI_PARENT = "CastMiniController"
const INTRO_STYLE = "Forge.CastIntroOverlay"
const INTRO_PARENT = "CastIntroOverlay"

// The chooser and controller dialogs. colorPrimary is what currently tints them
// — it is Expo's untouched #023c69 default, which is where the blue comes from.
const MEDIA_ROUTER_ITEMS = {
  colorPrimary: "@color/forge_cast_accent",
  colorAccent: "@color/forge_cast_accent",
  // The dialog's GROUND is windowBackground, not colorBackground. Both are set
  // to #303030 by ThemeOverlay.AppCompat.Dark; setting only the latter left the
  // measured ground stock while our text colours landed. Stock is a flat
  // colour, so overriding it costs no dialog inset or corner radius.
  "android:windowBackground": "@color/forge_cast_background",
  "android:colorBackground": "@color/forge_cast_background",
  "android:textColorPrimary": "@color/forge_cast_text_primary",
  "android:textColorSecondary": "@color/forge_cast_text_secondary",
  mediaRouteDividerColor: "@color/forge_cast_divider",
}

const EXPANDED_ITEMS = {
  castButtonColor: "@color/forge_cast_text_primary",
  castSeekBarProgressAndThumbColor: "@color/forge_cast_accent",
  castSeekBarSecondaryProgressColor: "@color/forge_cast_track_buffered",
  castSeekBarUnseekableProgressColor: "@color/forge_cast_track_unseekable",
  castSeekBarTooltipBackgroundColor: "@color/forge_cast_accent",
  castExpandedControllerLoadingIndicatorColor: "@color/forge_cast_accent",
  castLiveIndicatorColor: "@color/forge_cast_accent",
}

const MINI_ITEMS = {
  castBackground: "@color/forge_cast_surface",
  castButtonColor: "@color/forge_cast_text_primary",
  castProgressBarColor: "@color/forge_cast_accent",
  castMiniControllerLoadingIndicatorColor: "@color/forge_cast_accent",
}

const INTRO_ITEMS = {
  castBackgroundColor: "@color/forge_cast_background",
  castButtonBackgroundColor: "@color/forge_cast_accent",
}

// Items added to AppTheme itself. mediaRouteTheme is the ONLY route into the two
// dialogs: MediaRouteChooserDialogFragment builds from the Activity context, not
// from the cast button's ContextThemeWrapper.
const APP_THEME_ITEMS = {
  mediaRouteTheme: `@style/${MEDIA_ROUTER_STYLE}`,
  castExpandedControllerStyle: `@style/${EXPANDED_STYLE}`,
  castMiniControllerStyle: `@style/${MINI_STYLE}`,
  castIntroOverlayStyle: `@style/${INTRO_STYLE}`,
  // Consumed as android:theme=, so this must be a theme OVERLAY, not a widget
  // style. A widget style here silently produces an unthemed toolbar.
  castExpandedControllerToolbarStyle:
    "@style/ThemeOverlay.AppCompat.Dark.ActionBar",
}

/** Replace-or-append a whole <style>, returning the style object. */
function upsertStyle(resources, name, parent) {
  if (!Array.isArray(resources.style)) resources.style = []
  let style = resources.style.find((entry) => entry.$?.name === name)
  if (!style) {
    style = { $: { name, parent }, item: [] }
    resources.style.push(style)
  }
  style.$.parent = parent
  return style
}

/**
 * Add the cast styles and wire them onto AppTheme.
 * Throws when AppTheme is missing — every cast dialog resolves its theme off the
 * Activity, so without that item the styles exist and reach nothing.
 */
function applyCastStyles(resources) {
  const appTheme = getRequiredStyle(
    resources,
    "AppTheme",
    "[withAndroidCastTheme] AppTheme not found in android styles.xml. The " +
      "Expo template renamed the application theme; every cast dialog " +
      "resolves its theme off the Activity, so mediaRouteTheme must land on " +
      "the real one. Failing prebuild instead of shipping unstyled cast " +
      "dialogs.",
  )

  const targets = [
    [MEDIA_ROUTER_STYLE, MEDIA_ROUTER_PARENT, MEDIA_ROUTER_ITEMS],
    [EXPANDED_STYLE, EXPANDED_PARENT, EXPANDED_ITEMS],
    [MINI_STYLE, MINI_PARENT, MINI_ITEMS],
    [INTRO_STYLE, INTRO_PARENT, INTRO_ITEMS],
  ]
  for (const [name, parent, items] of targets) {
    const style = upsertStyle(resources, name, parent)
    for (const [item, value] of Object.entries(items)) {
      setItem(style, item, value)
    }
  }

  for (const [item, value] of Object.entries(APP_THEME_ITEMS)) {
    setItem(appTheme, item, value)
  }
  return resources
}

/** Add the cast colour resources, replacing any same-name entry. */
function applyCastColors(resources) {
  if (!Array.isArray(resources.color)) resources.color = []
  for (const [name, value] of Object.entries(COLORS)) {
    const existing = resources.color.find((entry) => entry.$?.name === name)
    if (existing) existing._ = value
    else resources.color.push({ $: { name }, _: value })
  }
  return resources
}

module.exports = function withAndroidCastTheme(config) {
  if (!withAndroidStyles || !withAndroidColors) {
    console.warn(
      "[withAndroidCastTheme] expo/config-plugins not resolvable; skipping the " +
        "Android cast theme. Run `pnpm install` so apps/mobile has expo, then " +
        "re-run `expo prebuild`.",
    )
    return config
  }
  config = withAndroidColors(config, (cfg) => {
    cfg.modResults.resources = applyCastColors(cfg.modResults.resources ?? {})
    return cfg
  })
  return withAndroidStyles(config, (cfg) => {
    cfg.modResults.resources = applyCastStyles(cfg.modResults.resources ?? {})
    return cfg
  })
}

// Exported for unit tests — the transforms are pure. A wrong PARENT here loses
// every SDK default silently, which no runtime error would announce.
module.exports.applyCastStyles = applyCastStyles
module.exports.applyCastColors = applyCastColors
module.exports.CAST_THEME_NAMES = {
  MEDIA_ROUTER_STYLE,
  MEDIA_ROUTER_PARENT,
  EXPANDED_STYLE,
  EXPANDED_PARENT,
  MINI_STYLE,
  MINI_PARENT,
  INTRO_STYLE,
  INTRO_PARENT,
}
module.exports.CAST_COLORS = COLORS
