// Plain JS (like the other guards here): the RN tsconfig has no Node types,
// and this guard reads source files off disk and walks the source tree.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: the lifecycle below the provider is pure and injected, which is what
// makes the whole schedule pass unit-testable without a native mock. The cost
// of that design is that ALL of it stays green when the composition root stops
// mounting the provider — the suite proves the decisions, never the runtime.
//
// The foreground handler is the sharpest case. KTD1 registers it at the
// ADAPTER's module scope and requires the adapter from the root layout's
// guarded require block, so a reminder that fires while the app is open shows
// nothing. Nothing else in this app would notice that require going away: the
// provider would still mount, every pass would still schedule, and the only
// symptom is a banner over a viewer who is already watching.
//
// Four properties below: the provider is mounted where KTD2 puts it, the
// adapter's registration is reachable from the guarded block, the provider
// wires the dependencies a pass cannot run without, and the adapter is the ONLY
// file in the app that names the notifications module.

const MOBILE = path.join(__dirname, "..", "..", "..")
const LAYOUT = path.join(MOBILE, "app", "_layout.tsx")
const PROVIDER = path.join(
  MOBILE,
  "src",
  "contexts",
  "LapseReminderProvider.tsx",
)
const ADAPTER = path.join(
  MOBILE,
  "src",
  "lib",
  "lapseReminders",
  "notificationsAdapter.ts",
)
const PUSH_HOST = path.join(MOBILE, "src", "lib", "push", "registrationHost.ts")
const WATCH_ROUTE = path.join(MOBILE, "app", "watch", "[slug].tsx")
const ROOTS = [path.join(MOBILE, "src"), path.join(MOBILE, "app")]

const SPECIFIER = "expo-notifications"

// A scan that finds nothing proves nothing. The app carries far more than this.
const SOURCE_FILE_FLOOR = 100

// Every dependency the pass cannot run without. Dropping any one of them
// typechecks nowhere, but dropping the CLEAR listener or the APP STATE seam
// leaves a provider that mounts, passes once, and then never again.
const PROVIDER_WIRING = [
  "createLapseReminderLifecycle(",
  "lapseReminderNotifications",
  "LAPSE_REMINDERS_ENABLED",
  "subscribeToClear(",
  'AppState.addEventListener("change"',
  "attachLastWatchedWriter(",
  // The sink is passed WHOLE, and its name is load-bearing: the repo-wide
  // reserved-attribute sweep keys on `telemetry`, so a dep renamed to `log`
  // would take every emit site out of that sweep with this suite still green.
  "telemetry: datadogLog",
  "createLapseReminderTapHandler(",
  // Without the selection bridge a cold tap still lands, but only after its
  // deadline: every reminder launch would sit on Home for three seconds.
  "selectionChanged(",
  // By the validated slug. Dropping this loses `content.deep_link_open` for
  // every reminder return, and navigation keeps working, so nothing says so.
  "registerDeepLinkSlug(",
  // U7. Each one is silent when it goes: the reminders keep working, every
  // mobile suite stays green, and the phone simply never joins an audience.
  "getPushRegistration()",
  // The pass's own permission read, which is the only thing that starts a
  // registration (R1, R5).
  "onPermissionRead:",
  // R3's three refresh triggers.
  "subscribeToTokenRotation(",
  "getRecommendationViewerStore().subscribe(",
  "publishPushAppLanguageSlug(",
  // KTD9's announcements channel, on the same upsert as the reminder one.
  "ensureAnnouncementsChannel()",
  // The preference the payload carries (R2). Without it the language is read
  // from storage alone, which can lag a pick by a whole write.
  "useWatchPreferences()",
]

/**
 * The push host's own wiring. The kill switch and the sink name are the
 * one-line reverts: `enabled: true` there arms push in a build that meant to
 * ship it dark, and a renamed sink takes every push emit out of the repo-wide
 * reserved-attribute sweep. Neither changes a single test result.
 */
const PUSH_HOST_WIRING = [
  "enabled: PUSH_REGISTRATION_ENABLED",
  "telemetry: datadogLog",
  "store: getPushRegistrationStore()",
  "register: registerPushDevice",
  "lapseReminderNotifications.getPushToken()",
  "readAppLanguageSlug: readPushAppLanguageSlug",
  "readEnvironment: readPushDeviceEnvironment",
]

function read(file) {
  const content = fs.readFileSync(file, "utf8")
  // A broken path resolution must not vacuously pass every assertion below.
  expect(content.length).toBeGreaterThan(400)
  return content
}

/** Whatever each `enabled:` call site is given, in source order. */
function enabledSources(source) {
  return [...source.matchAll(/\benabled:\s*([^,\n]+)/g)].map((m) => m[1].trim())
}

/** Strip comments so a mention inside prose cannot satisfy an assertion. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** Pure detector, so a control can prove it reads code and not prose. */
function missingWiring(source, required) {
  const stripped = stripComments(source)
  return required.filter((token) => !stripped.includes(token))
}

/** The body of the root layout's module-scope guarded require block. */
function guardedRequireBlock(content) {
  const start = content.indexOf("try {")
  const end = content.indexOf("} catch (e: unknown) {")
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return content.slice(start, end)
}

/** Where each root-layout element sits, as source offsets. */
function placement(content) {
  return {
    datadogOpen: content.indexOf("<MobileDatadogProvider>"),
    preferencesOpen: content.indexOf("<WatchPreferencesProvider>"),
    reminderOpen: content.indexOf("<LapseReminderProvider>"),
    reminderClose: content.indexOf("</LapseReminderProvider>"),
    splashHost: content.indexOf("<SplashHost"),
    preferencesClose: content.indexOf("</WatchPreferencesProvider>"),
    datadogClose: content.indexOf("</MobileDatadogProvider>"),
  }
}

/**
 * Every placement rule KTD2 and KTD9 impose, as fault names. Pure, so a control
 * can prove it flags a real move rather than passing on any input.
 */
function placementFaults(at) {
  const missing = Object.entries(at)
    .filter(([, index]) => index === -1)
    .map(([name]) => `missing:${name}`)
  if (missing.length > 0) return missing

  const faults = []
  // KTD9: every event comes from inside the provider tree, which must
  // therefore sit inside the Datadog provider.
  if (at.reminderOpen < at.datadogOpen || at.reminderClose > at.datadogClose) {
    faults.push("outside-datadog")
  }
  // KTD6: an ancestor of SplashHost, because effects run children-first, so
  // the splash host lowers the native hold before the first pass runs.
  if (at.splashHost < at.reminderOpen || at.splashHost > at.reminderClose) {
    faults.push("not-above-splash-host")
  }
  // U7: the provider reads the dub-language preference for the push payload,
  // and `useWatchPreferences` THROWS outside its provider — so a reorder here
  // is not a lost registration, it is a crashed app.
  if (
    at.reminderOpen < at.preferencesOpen ||
    at.reminderClose > at.preferencesClose
  ) {
    faults.push("outside-watch-preferences")
  }
  return faults
}

/** Every `.ts`/`.tsx` file under the roots, tests excluded. */
function sourceFiles() {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules")
          continue
        walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full)
      }
    }
  }
  for (const root of ROOTS) walk(root)
  return found
}

/**
 * The context literal of the watch route's deep-link attribution event. The
 * object has no nested braces, so the first `})` after it closes it.
 */
function deepLinkOpenContext(source) {
  const start = source.indexOf('"content.deep_link_open"')
  if (start === -1) return null
  const open = source.indexOf("{", start)
  const close = source.indexOf("})", open)
  if (open === -1 || close === -1) return null
  return source.slice(open + 1, close)
}

/** True when a source imports or requires the notifications module itself. */
function namesNotificationsModule(source) {
  const stripped = stripComments(source)
  return (
    new RegExp(`from\\s+["']${SPECIFIER}["']`).test(stripped) ||
    new RegExp(`require\\s*\\(\\s*["']${SPECIFIER}["']`).test(stripped) ||
    new RegExp(`^\\s*import\\s+["']${SPECIFIER}["']`, "m").test(stripped)
  )
}

describe("the lapse reminder composition root", () => {
  it("mounts the provider inside Datadog and above the splash host", () => {
    expect(placementFaults(placement(read(LAYOUT)))).toEqual([])
  })

  it("requires the provider and the adapter from the guarded block", () => {
    const block = guardedRequireBlock(read(LAYOUT))

    // The provider require: a static import would crash the whole module graph
    // on a throwing require instead of landing on the Startup Error panel.
    expect(block).toContain('require("../src/contexts/LapseReminderProvider")')
    // The adapter require IS the foreground handler's registration (KTD1).
    expect(block).toContain(
      'require("../src/lib/lapseReminders/notificationsAdapter")',
    )
  })

  it("registers the foreground handler at the adapter's module scope", () => {
    const source = stripComments(read(ADAPTER))

    // Inside a function the handler would register only once something called
    // it, which is after the first reminder could already have been presented.
    expect(source).toMatch(/^Notifications\.setNotificationHandler\(/m)
    expect(source).toContain("shouldShowBanner: false")
    expect(source).toContain("shouldShowList: false")
  })

  it("wires every dependency a pass cannot run without", () => {
    expect(missingWiring(read(PROVIDER), PROVIDER_WIRING)).toEqual([])
  })

  it("wires the push host's gate, sink and ports (U7)", () => {
    expect(missingWiring(read(PUSH_HOST), PUSH_HOST_WIRING)).toEqual([])
  })

  it("positive control: a reverted push host dependency is caught", () => {
    for (const token of PUSH_HOST_WIRING) {
      const gutted = stripComments(read(PUSH_HOST)).split(token).join("noop(")
      expect(missingWiring(gutted, PUSH_HOST_WIRING)).toEqual([token])
    }
  })

  it("threads the kill switch into EVERY consumer, never a literal", () => {
    // The gate reaches three independent consumers — the schedule pass, the
    // permission prompt and the tap handler. A `includes()` check passes with
    // one of the three present, so a one-line `enabled: true` at either of the
    // others is the OTA-proof revert this counts instead.
    const source = stripComments(read(PROVIDER))

    expect(enabledSources(source)).toEqual([
      "LAPSE_REMINDERS_ENABLED",
      "LAPSE_REMINDERS_ENABLED",
      "LAPSE_REMINDERS_ENABLED",
    ])
  })

  it("reads each enabled: source the way the rule intends (positive control)", () => {
    // Proves the reader counts call sites rather than matching the file once,
    // and that a hardcoded literal at ANY position is visible.
    const threeGood =
      "enabled: LAPSE_REMINDERS_ENABLED,\nenabled: LAPSE_REMINDERS_ENABLED,\nenabled: LAPSE_REMINDERS_ENABLED,"
    expect(enabledSources(threeGood)).toHaveLength(3)

    const oneReverted =
      "enabled: LAPSE_REMINDERS_ENABLED,\nenabled: true,\nenabled: LAPSE_REMINDERS_ENABLED,"
    expect(enabledSources(oneReverted)).toEqual([
      "LAPSE_REMINDERS_ENABLED",
      "true",
      "LAPSE_REMINDERS_ENABLED",
    ])
    expect(enabledSources("enabled: !__DEV__,")).toEqual(["!__DEV__"])
    expect(enabledSources("")).toEqual([])
  })

  it("lets only the adapter name the notifications module (KTD1)", () => {
    const files = sourceFiles()

    expect(files.length).toBeGreaterThan(SOURCE_FILE_FLOOR)
    const naming = files.filter((file) =>
      namesNotificationsModule(fs.readFileSync(file, "utf8")),
    )
    expect(naming).toEqual([ADAPTER])
  })

  it("carries the arrival origin on the watch route's deep-link event", () => {
    // The registry now records WHY a slug arrived, and the route is the only
    // reader. Dropping the key leaves reminder returns inside the share-link
    // counts, with every test on both sides still green.
    const context = deepLinkOpenContext(stripComments(read(WATCH_ROUTE)))

    expect(context).not.toBeNull()
    expect(context).toContain("content_id:")
    expect(context).toContain("entry:")
    expect(context).toContain("origin:")
  })

  it("positive control: a deep-link event without the origin is caught", () => {
    const source = stripComments(read(WATCH_ROUTE))
    const stripped = source.replace("origin: arrival.origin,", "")

    expect(stripped).not.toBe(source)
    expect(deepLinkOpenContext(stripped)).not.toContain("origin:")
    // And the detector finds a real context rather than passing on anything.
    expect(deepLinkOpenContext("nothing here")).toBeNull()
  })

  it("positive control: a dropped provider dependency is caught", () => {
    for (const token of PROVIDER_WIRING) {
      const gutted = stripComments(read(PROVIDER)).split(token).join("noop(")
      // Through the SAME detector the real assertion uses: asserting only that
      // the deleted string is gone is a tautology that cannot fail.
      expect(missingWiring(gutted, PROVIDER_WIRING)).toEqual([token])
    }
  })

  it("positive control: the real layout with the provider moved out is caught", () => {
    // The real file with the two opening tags swapped through a sentinel. A
    // plain pair of replaces swaps the first tag back onto itself, which is
    // how this control passed on an unchanged file before.
    const moved = read(LAYOUT)
      .replace("<MobileDatadogProvider>", "@@SENTINEL@@")
      .replace("<LapseReminderProvider>", "<MobileDatadogProvider>")
      .replace("@@SENTINEL@@", "<LapseReminderProvider>")

    expect(placementFaults(placement(moved))).toContain("outside-datadog")
  })

  it("positive control: the detector separates ancestor from sibling", () => {
    const ancestor =
      "<MobileDatadogProvider><WatchPreferencesProvider>" +
      "<LapseReminderProvider><SplashHost />" +
      "</LapseReminderProvider></WatchPreferencesProvider>" +
      "</MobileDatadogProvider>"
    const sibling =
      "<MobileDatadogProvider><WatchPreferencesProvider>" +
      "<LapseReminderProvider></LapseReminderProvider><SplashHost />" +
      "</WatchPreferencesProvider></MobileDatadogProvider>"
    // U7: outside the preferences provider `useWatchPreferences` throws, so
    // this order is a crash rather than a missing registration.
    const outsidePreferences =
      "<MobileDatadogProvider><LapseReminderProvider><SplashHost />" +
      "</LapseReminderProvider><WatchPreferencesProvider>" +
      "</WatchPreferencesProvider></MobileDatadogProvider>"

    expect(placementFaults(placement(ancestor))).toEqual([])
    expect(placementFaults(placement(sibling))).toEqual([
      "not-above-splash-host",
    ])
    expect(placementFaults(placement(outsidePreferences))).toEqual([
      "outside-watch-preferences",
    ])
    // And a layout with no provider at all names what is absent.
    expect(placementFaults(placement("<MobileDatadogProvider>"))).toEqual([
      "missing:preferencesOpen",
      "missing:reminderOpen",
      "missing:reminderClose",
      "missing:splashHost",
      "missing:preferencesClose",
      "missing:datadogClose",
    ])
  })

  it("reads an import the way the module rule intends (positive control)", () => {
    expect(
      namesNotificationsModule('import * as N from "expo-notifications"'),
    ).toBe(true)
    expect(
      namesNotificationsModule('const N = require("expo-notifications")'),
    ).toBe(true)
    expect(namesNotificationsModule('import "expo-notifications"')).toBe(true)
    // A near miss must not count as the module itself.
    expect(
      namesNotificationsModule(
        'import { x } from "./expo-notificationsHelper"',
      ),
    ).toBe(false)
  })

  it("negative control: wiring named only in prose does not satisfy it", () => {
    const prose = PROVIDER_WIRING.map((token) => `// ${token}`).join("\n")

    expect(missingWiring(prose, PROVIDER_WIRING)).toEqual(PROVIDER_WIRING)
    expect(namesNotificationsModule('// import "expo-notifications"')).toBe(
      false,
    )
  })
})
