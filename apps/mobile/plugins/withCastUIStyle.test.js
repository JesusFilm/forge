const {
  insertCastUIStyle,
  CAST_UI_STYLE_MARKER_PREFIX,
  CAST_UI_STYLE_MARKER_END,
  castUIStyleBeginMarker,
} = require("./withCastUIStyle")
const { insertVolumeFlag } = require("./withCastOptionsVolume")

// Real producer symbol: the vendor's own Swift injector builds the fixture, so
// a vendor bump that changes the injected block fails this suite, not prebuild.
const {
  addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions,
} = require("react-native-google-cast/lib/commonjs/plugin/withIosGoogleCast")

// The Expo SDK 57 AppDelegate.swift, verbatim from this repo's real
// `expo prebuild` output (expo ~57.0.12, captured 2026-08-13). Re-capture on
// every SDK bump. Kept in sync with withCastOptionsVolume.test.js.
const APP_DELEGATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }
}
`

// The vendor injection with this app's app.json plugin config. expandedController
// is true because withGoogleCast coerces `props.expandedController ?? true` on
// iOS and app.json omits the prop — which is why the expanded controller is a
// live surface here and gets styled.
const INJECTED = addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions(
  APP_DELEGATE,
  {
    startDiscoveryAfterFirstTapOnCastButton: false,
    suspendSessionsWhenBackgrounded: false,
    expandedController: true,
  },
).contents

const ANCHOR = "GCKCastContext.setSharedInstanceWith(options)"
const VOLUME_FLAG =
  "options.physicalVolumeButtonsWillControlDeviceVolume = true"

describe("vendor fixture sanity", () => {
  it("contains the anchor the transform inserts after", () => {
    expect(INJECTED).toContain(ANCHOR)
  })

  it("keeps the anchor inside a canImport(GoogleCast) guard", () => {
    const guardIdx = INJECTED.indexOf("#if canImport(GoogleCast) && os(iOS)")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(INJECTED.indexOf(ANCHOR)).toBeGreaterThan(guardIdx)
  })

  it("enables the expanded controller, so that surface is worth styling", () => {
    expect(INJECTED).toContain(
      "GCKCastContext.sharedInstance().useDefaultExpandedMediaControls = true",
    )
  })
})

describe("insertCastUIStyle placement", () => {
  it("inserts the style block AFTER setSharedInstanceWith", () => {
    const out = insertCastUIStyle(INJECTED)
    const markerIdx = out.indexOf(CAST_UI_STYLE_MARKER_PREFIX)
    expect(markerIdx).toBeGreaterThan(-1)
    expect(markerIdx).toBeGreaterThan(out.indexOf(ANCHOR))
  })

  it("keeps the whole block inside the GoogleCast canImport guard", () => {
    const out = insertCastUIStyle(INJECTED)
    const guardIdx = out.indexOf(
      "#if canImport(GoogleCast) && os(iOS)",
      out.indexOf(ANCHOR) - 600,
    )
    const endifIdx = out.indexOf("#endif", guardIdx)
    const markerIdx = out.indexOf(CAST_UI_STYLE_MARKER_PREFIX)
    const applyIdx = out.indexOf("GCKUIStyle.sharedInstance().apply()")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(markerIdx).toBeGreaterThan(guardIdx)
    expect(applyIdx).toBeGreaterThan(markerIdx)
    expect(applyIdx).toBeLessThan(endifIdx)
  })

  it("indents the block to match the anchor line", () => {
    const out = insertCastUIStyle(INJECTED)
    expect(out).toContain(`    ${CAST_UI_STYLE_MARKER_PREFIX}`)
    expect(out).toContain("    GCKUIStyle.sharedInstance().apply()")
  })

  it("applies the attributes before calling apply", () => {
    const out = insertCastUIStyle(INJECTED)
    expect(out.indexOf("forgeApplyCastBase(forgeAttributes)")).toBeLessThan(
      out.indexOf("GCKUIStyle.sharedInstance().apply()"),
    )
  })

  it("is idempotent — applying twice equals applying once", () => {
    const once = insertCastUIStyle(INJECTED)
    const twice = insertCastUIStyle(once)
    expect(twice).toBe(once)
    expect(twice.split(CAST_UI_STYLE_MARKER_PREFIX).length - 1).toBe(1)
  })

  it("throws when the vendor injection is absent (drift must fail prebuild)", () => {
    expect(() => insertCastUIStyle(APP_DELEGATE)).toThrow(
      /react-native-google-cast/,
    )
  })
})

// `expo prebuild` REUSES an existing ios/ rather than recreating it, so the
// transform routinely runs against an AppDelegate that already carries a block.
// A name-only sentinel made an edited block look already-applied and kept
// building the previous palette. The sentinel carries a content hash for this.
describe("re-running against an already-injected AppDelegate", () => {
  const injected = insertCastUIStyle(INJECTED)

  it("emits a hashed begin marker and an end marker", () => {
    expect(injected).toContain(castUIStyleBeginMarker())
    expect(castUIStyleBeginMarker()).toMatch(/sync-[0-9a-f]{12}$/)
    expect(injected).toContain(CAST_UI_STYLE_MARKER_END)
  })

  // Mutate OUR begin marker by name. The vendor's own @generated header also
  // carries a `sync-<hash>` and sits earlier in the file, so a bare
  // /sync-[0-9a-f]+/ replace rewrites the VENDOR's hash and proves nothing.
  const STALE_MARKER = `${CAST_UI_STYLE_MARKER_PREFIX}000000000000`
  const goStale = (src) => src.replace(castUIStyleBeginMarker(), STALE_MARKER)

  it("the stale fixture rewrites this plugin's marker, not the vendor's", () => {
    const stale = goStale(injected)
    expect(stale).toContain(STALE_MARKER)
    expect(stale).not.toContain(castUIStyleBeginMarker())
    expect(stale).toContain(
      "react-native-google-cast-didFinishLaunchingWithOptions",
    )
  })

  // The discriminating case. Stand in for "someone edited STYLE_BODY" by
  // corrupting the emitted block, then staling the hash: a correct transform
  // must replace it. A name-only sentinel returns the corrupted block as-is.
  it("replaces a block whose hash no longer matches its content", () => {
    const corrupted = injected.replace(
      "forgeCastColor(0xCB333B)",
      "forgeCastColor(0xD0021B)",
    )
    expect(corrupted).not.toBe(injected)

    const repaired = insertCastUIStyle(goStale(corrupted))
    expect(repaired).toContain("forgeCastColor(0xCB333B)")
    expect(repaired).not.toContain("forgeCastColor(0xD0021B)")
    expect(repaired).toContain(castUIStyleBeginMarker())
    expect(repaired).not.toContain(STALE_MARKER)
  })

  it("leaves exactly one block behind after a replacement", () => {
    const repaired = insertCastUIStyle(goStale(injected))
    expect(repaired.split(CAST_UI_STYLE_MARKER_PREFIX).length - 1).toBe(1)
    expect(repaired.split(CAST_UI_STYLE_MARKER_END).length - 1).toBe(1)
    expect(repaired).toBe(injected)
  })

  it("keeps the replacement inside the canImport guard", () => {
    const repaired = insertCastUIStyle(goStale(injected))
    const guardIdx = repaired.indexOf("#if canImport(GoogleCast) && os(iOS)")
    const endifIdx = repaired.indexOf("#endif", guardIdx)
    expect(repaired.indexOf(CAST_UI_STYLE_MARKER_END)).toBeLessThan(endifIdx)
  })

  it("throws on a begin marker with no end marker rather than splicing blind", () => {
    const truncated = goStale(injected).replace(CAST_UI_STYLE_MARKER_END, "")
    expect(() => insertCastUIStyle(truncated)).toThrow(/end marker/)
  })

  it("does not disturb the sibling volume flag when it replaces a block", () => {
    const repaired = insertCastUIStyle(goStale(insertVolumeFlag(injected)))
    expect(repaired).toContain(VOLUME_FLAG)
    expect(repaired.indexOf(VOLUME_FLAG)).toBeLessThan(repaired.indexOf(ANCHOR))
  })
})

// The Swift compiler catches a misspelled ATTRIBUTE. Nothing catches a wrong
// COLOR, so the token values are pinned here: a silent revert to Google's
// palette would otherwise ship with CI green.
describe("token pin", () => {
  const out = insertCastUIStyle(INJECTED)

  it("carries the app's own palette", () => {
    expect(out).toContain("forgeCastColor(0x1C1917)") // BG_COLOR
    expect(out).toContain("forgeCastColor(0xF5F5F4)") // TEXT_PRIMARY
    expect(out).toContain("forgeCastColor(0xA8A29E)") // TEXT_SECONDARY
    expect(out).toContain("forgeCastColor(0xD6D3D1)") // TEXT_BODY
    expect(out).toContain("forgeCastColor(0xCB333B)") // ACCENT
    expect(out).toContain("forgeCastColor(0xE96067)") // ACCENT_ON_DARK
  })

  // Not every cast surface is a sheet. The expanded controls are a full-screen
  // player, which is the case BLACK exists for; the mini controller is a bar
  // docked over content, which is what SURFACE_COLOR is for.
  it("grounds each surface in the token its own docblock names", () => {
    expect(out).toContain("forgeCastColor(0x000000)") // BLACK
    expect(out).toContain("forgeCastColor(0x292524)") // SURFACE_COLOR
    expect(out).toContain("forgeExpanded.backgroundColor = forgeBlack")
    expect(out).toContain("forgeMini.backgroundColor = forgeSurface")
    expect(out).toContain("forgeChooser,")
  })

  it("carries no stock cast or iOS system color", () => {
    // #D0021B is the Cast SDK's own red and #0A84FF the iOS system blue. Both
    // are close enough to pass a glance and fail the design system.
    expect(out).not.toContain("0xD0021B")
    expect(out).not.toContain("0x0A84FF")
    expect(out).not.toContain("0xE11D48") // not an app token; an earlier draft's
  })

  it("recedes the Cancel button rather than accenting it", () => {
    expect(out).toContain(
      "forgeNavigation.buttonTextColor = forgeTextSecondary",
    )
  })

  // Measured on device: without this split the connected sheet's play/pause
  // rendered at TEXT_SECONDARY, the same muted grey as a decorative row glyph.
  // The base pass sets every node to secondary, so the primary transport
  // control needs an explicit override after it.
  it("separates the primary transport glyph from decorative row glyphs", () => {
    expect(out).toContain("forgeConnection.iconTintColor = forgeTextPrimary")
    expect(out).not.toContain("forgeChooser.iconTintColor = forgeTextPrimary")
    expect(out.indexOf("forgeConnection.iconTintColor")).toBeGreaterThan(
      out.indexOf("forgeApplyCastBase(forgeAttributes)"),
    )
  })

  // The whole point of ACCENT_ON_DARK: ACCENT is ~3.4:1 on BG_COLOR, which
  // clears 3:1 for fills but fails 4.5:1 for normal text. "Stop casting" is
  // bare text, so accenting it with ACCENT would be a legibility regression.
  it("uses ACCENT_ON_DARK for the toolbar's bare text button", () => {
    expect(out).toContain("forgeToolbar.buttonTextColor = forgeAccentOnDark")
    expect(out).not.toContain("forgeToolbar.buttonTextColor = forgeAccent\n")
  })

  it("uses ACCENT for slider fills and thumbs, where 3:1 is the bar", () => {
    expect(out).toContain(
      "forgeVolumeHost.volumeSliderMinimumTrackTintColor = forgeAccent",
    )
    expect(out).toContain(
      "forgeVolumeHost.volumeSliderThumbTintColor = forgeAccent",
    )
    expect(out).toContain("forgeSeekHost.sliderProgressColor = forgeAccent")
  })
})

// Asserting a colour CONSTANT only pins its `let` declaration. The assignments
// were unpinned, so gutting forgeApplyCastBase — or swapping which attribute
// gets which colour — left this suite green while every cast surface silently
// reverted to Google's palette, and the emitted Swift still compiled.
describe("emitted assignment pin", () => {
  const out = insertCastUIStyle(INJECTED)

  // Every surface inherits these six, so losing the body is the widest regression.
  it.each([
    "attributes.backgroundColor = forgeBackground",
    "attributes.headingTextColor = forgeTextPrimary",
    "attributes.bodyTextColor = forgeTextPrimary",
    "attributes.captionTextColor = forgeTextSecondary",
    "attributes.iconTintColor = forgeTextSecondary",
    "attributes.buttonTextColor = forgeAccentOnDark",
  ])("pins the base pass write %s", (line) => {
    expect(out).toContain(line)
  })

  it.each([
    // The unfilled volume track: the one attribute in the trio whose value
    // differs from its siblings, and the one that had no assertion at all.
    "forgeVolumeHost.volumeSliderMaximumTrackTintColor = forgeTrack",
    "forgeSeekHost.sliderSecondaryProgressColor = forgeTrackBuffered",
    "forgeSeekHost.sliderUnseekableProgressColor = forgeTrackUnseekable",
    "forgeSeekHost.sliderTooltipBackgroundColor = forgeAccent",
    "forgeSeekHost.liveIndicatorColor = forgeAccent",
    "forgeExpanded.iconTintColor = forgeTextOnOverlay",
    "forgeExpanded.bodyTextColor = forgeTextBody",
    "forgeMini.bodyTextColor = forgeTextBody",
    "forgeNoDevices.bodyTextColor = forgeTextSecondary",
  ])("pins the per-surface write %s", (line) => {
    expect(out).toContain(line)
  })

  // Anti-vacuous: the assertions above must be able to fail. A colour swapped
  // between two attributes keeps every forgeCastColor(0x…) token present.
  it("would catch a colour swapped between two attributes", () => {
    const swapped = out.replace(
      "attributes.iconTintColor = forgeTextSecondary",
      "attributes.iconTintColor = forgeAccent",
    )
    expect(swapped).toContain("forgeCastColor(0xA8A29E)")
    expect(swapped).not.toContain(
      "attributes.iconTintColor = forgeTextSecondary",
    )
  })

  it("sets no font attribute — Dynamic Type resets those", () => {
    expect(out).not.toMatch(/TextFont\s*=/)
  })
})

// The user's ask was every surface the SDK can present, not only the two on
// screen today. This enumeration is the record of that scope; a surface added
// to the SDK later still inherits the palette through the root node.
describe("surface coverage", () => {
  const out = insertCastUIStyle(INJECTED)
  const SURFACES = [
    "forgeCastViews,",
    "forgeCastViews.deviceControl,",
    "forgeCastViews.mediaControl,",
    "forgeChooser,",
    "forgeConnection,",
    "forgeNoDevices,",
    "forgeNavigation,",
    "forgeToolbar,",
    "forgeExpanded,",
    "forgeMini,",
    "forgeTracks,",
    "forgeInstructions,",
  ]

  it.each(SURFACES)("styles %s", (surface) => {
    expect(out).toContain(surface)
  })

  it("resolves each surface from the documented attribute path", () => {
    expect(out).toContain(
      "let forgeChooser = forgeCastViews.deviceControl.deviceChooser",
    )
    expect(out).toContain(
      "let forgeConnection = forgeCastViews.deviceControl.connectionController",
    )
    expect(out).toContain(
      "let forgeNoDevices = forgeCastViews.deviceControl.noDevicesAvailableController",
    )
    expect(out).toContain("let forgeNavigation = forgeConnection.navigation")
    expect(out).toContain("let forgeToolbar = forgeConnection.toolbar")
    expect(out).toContain(
      "let forgeExpanded = forgeCastViews.mediaControl.expandedController",
    )
    expect(out).toContain(
      "let forgeMini = forgeCastViews.mediaControl.miniController",
    )
    expect(out).toContain(
      "let forgeTracks = forgeCastViews.mediaControl.trackSelector",
    )
    expect(out).toContain("let forgeInstructions = forgeCastViews.instructions")
  })
})
