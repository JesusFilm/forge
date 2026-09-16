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
]

function read(file) {
  const content = fs.readFileSync(file, "utf8")
  // A broken path resolution must not vacuously pass every assertion below.
  expect(content.length).toBeGreaterThan(400)
  return content
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
    reminderOpen: content.indexOf("<LapseReminderProvider>"),
    reminderClose: content.indexOf("</LapseReminderProvider>"),
    splashHost: content.indexOf("<SplashHost"),
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

  it("lets only the adapter name the notifications module (KTD1)", () => {
    const files = sourceFiles()

    expect(files.length).toBeGreaterThan(SOURCE_FILE_FLOOR)
    const naming = files.filter((file) =>
      namesNotificationsModule(fs.readFileSync(file, "utf8")),
    )
    expect(naming).toEqual([ADAPTER])
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
      "<MobileDatadogProvider><LapseReminderProvider><SplashHost />" +
      "</LapseReminderProvider></MobileDatadogProvider>"
    const sibling =
      "<MobileDatadogProvider><LapseReminderProvider>" +
      "</LapseReminderProvider><SplashHost /></MobileDatadogProvider>"

    expect(placementFaults(placement(ancestor))).toEqual([])
    expect(placementFaults(placement(sibling))).toEqual([
      "not-above-splash-host",
    ])
    // And a layout with no provider at all names what is absent.
    expect(placementFaults(placement("<MobileDatadogProvider>"))).toEqual([
      "missing:reminderOpen",
      "missing:reminderClose",
      "missing:splashHost",
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
