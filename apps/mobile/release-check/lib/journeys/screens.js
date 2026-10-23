"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The screen list check (KTD11, R19, R22, AE4, AE13). A journey covers a
// screen only by asserting its root testID, or a hand-list entry's text, on a
// platform where the settings show that screen.

const fs = require("node:fs")
const path = require("node:path")

const { EXIT } = require("../contract")
const {
  CONFIG_DIR,
  JOURNEYS_DIR,
  LIST_FILES,
  MOBILE_DIR,
  readJson,
  screenInventory,
} = require("../lists")
const { PLATFORMS, assertedScreens, parseFlow } = require("./flow")

// A wrong app folder or a broken route scan must not pass with no screens.
// The app has 25 route screens (2026-10-22).
const MIN_ROUTE_SCREENS = 20

function settingValue(settings, key) {
  if (Object.hasOwn(settings?.testValue ?? {}, key)) {
    return settings.testValue[key]
  }
  if (Object.hasOwn(settings?.copiedFromProduction ?? {}, key)) {
    return settings.copiedFromProduction[key]
  }
  return null
}

function hidingRule(screensConfig, settings, screen, platform) {
  for (const rule of screensConfig?.reach ?? []) {
    if (rule?.screen !== screen || rule.platform !== platform) continue
    if (rule.hidden === true) return { setting: null }
    const want = rule.hiddenUnless
    const values = Array.isArray(want?.values) ? want.values : []
    if (want && !values.includes(settingValue(settings, want.key))) {
      return { setting: want.key }
    }
  }
  return null
}

function handEntries(screensConfig) {
  return Array.isArray(screensConfig?.hand) ? screensConfig.hand : []
}

function shownPlatforms(screensConfig, settings, screen) {
  const hand = handEntries(screensConfig).find((entry) => entry.id === screen)
  const base = hand ? hand.platforms : PLATFORMS
  return base.filter(
    (platform) => !hidingRule(screensConfig, settings, screen, platform),
  )
}

function journeyScreens(flow, screensConfig) {
  const asserted = assertedScreens(flow)
  const fromText = handEntries(screensConfig)
    .filter((entry) => asserted.texts.includes(entry.match))
    .map((entry) => entry.id)
  return [...new Set([...asserted.screens, ...fromText])].sort()
}

function journeyPlatforms(flow, screens, screensConfig, settings) {
  return PLATFORMS.filter((platform) => {
    if (
      flow.pinnedPlatforms.length > 0 &&
      !flow.pinnedPlatforms.includes(platform)
    ) {
      return false
    }
    return screens.every((screen) =>
      shownPlatforms(screensConfig, settings, screen).includes(platform),
    )
  })
}

function readJourneys(journeysDir = JOURNEYS_DIR) {
  if (!fs.existsSync(journeysDir)) return []
  return fs
    .readdirSync(journeysDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => {
      const file = path.join(journeysDir, name)
      try {
        return {
          id: name.replace(/\.ya?ml$/, ""),
          file,
          flow: parseFlow(fs.readFileSync(file, "utf8")),
        }
      } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    })
}

function planJourneys(journeys, screensConfig, settings) {
  return journeys.map((journey) => {
    const screens = journeyScreens(journey.flow, screensConfig)
    return {
      id: journey.id,
      screens,
      platforms: journeyPlatforms(
        journey.flow,
        screens,
        screensConfig,
        settings,
      ),
    }
  })
}

function notTestedOn(notTested, screen, platform) {
  return (notTested?.entries ?? []).some(
    (entry) =>
      entry?.kind === "screen" &&
      entry.target === screen &&
      Array.isArray(entry.platforms) &&
      entry.platforms.includes(platform),
  )
}

function screenCoverage({
  inventory,
  screensConfig,
  settings,
  notTested,
  plan,
  platforms = PLATFORMS,
}) {
  const gaps = []
  const skippedPlatforms = []
  for (const screen of [...inventory.ids].sort()) {
    const hand = handEntries(screensConfig).find((e) => e.id === screen)
    for (const platform of platforms) {
      if (hand && !hand.platforms.includes(platform)) continue
      const rule = hidingRule(screensConfig, settings, screen, platform)
      if (rule) {
        skippedPlatforms.push({ screen, platform, setting: rule.setting })
        continue
      }
      const covered = plan.some(
        (journey) =>
          journey.platforms.includes(platform) &&
          journey.screens.includes(screen),
      )
      if (!covered && !notTestedOn(notTested, screen, platform)) {
        gaps.push({ screen, platform })
      }
    }
  }
  return { gaps, skippedPlatforms }
}

function notReachedScreens(attempts, plan) {
  const byDevice = new Map()
  for (const attempt of attempts) {
    const entry = byDevice.get(attempt.deviceId) ?? {
      expected: new Set(),
      reached: new Set(),
    }
    const planned = plan.find((journey) => journey.id === attempt.journey)
    for (const screen of planned?.screens ?? []) entry.expected.add(screen)
    for (const screen of attempt.screensReached) entry.reached.add(screen)
    byDevice.set(attempt.deviceId, entry)
  }
  const notReached = []
  for (const [deviceId, entry] of [...byDevice.entries()].sort()) {
    for (const screen of [...entry.expected].sort()) {
      if (!entry.reached.has(screen)) notReached.push({ screen, deviceId })
    }
  }
  return notReached
}

class ScreensRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = "ScreensRefusal"
  }
}

function loadScreenInputs(options = {}) {
  const configDir = options.configDir ?? CONFIG_DIR
  const mobileDir = options.mobileDir ?? MOBILE_DIR
  const read = (name) => {
    try {
      return readJson(path.join(configDir, LIST_FILES[name]))
    } catch (error) {
      throw new ScreensRefusal(
        `cannot read ${LIST_FILES[name]}: ${error.message}`,
      )
    }
  }
  const screensConfig = read("screens")
  const settings = read("testSettings")
  const notTested = read("notTested")
  let inventory
  try {
    inventory = screenInventory(screensConfig, mobileDir)
  } catch (error) {
    throw new ScreensRefusal(`cannot build the screen list: ${error.message}`)
  }
  if (inventory.routes.length < MIN_ROUTE_SCREENS) {
    throw new ScreensRefusal(
      `the scan of ${path.join(mobileDir, "app")} found ${inventory.routes.length} route screens, fewer than ${MIN_ROUTE_SCREENS}, so it did not read the app`,
    )
  }
  let journeys
  try {
    journeys = readJourneys(options.journeysDir ?? JOURNEYS_DIR)
  } catch (error) {
    throw new ScreensRefusal(`cannot read a journey: ${error.message}`)
  }
  return { screensConfig, settings, notTested, inventory, journeys }
}

function runCheckScreens(options = {}) {
  const inputs = loadScreenInputs(options)
  const plan = planJourneys(
    inputs.journeys,
    inputs.screensConfig,
    inputs.settings,
  )
  const coverage = screenCoverage({ ...inputs, plan })
  return {
    passed: coverage.gaps.length === 0,
    gaps: coverage.gaps,
    skippedPlatforms: coverage.skippedPlatforms,
    journeys: plan.map(({ id, platforms }) => ({ id, platforms })),
    counts: {
      screens: inputs.inventory.ids.size,
      routes: inputs.inventory.routes.length,
      journeys: plan.length,
    },
  }
}

function gapText(gap) {
  return `${gap.screen} on ${gap.platform}: no journey on ${gap.platform} asserts it, and the Not-Tested List has no entry for it`
}

/** The mode handler for `check-screens [--json]`: 0 no gap, 1 gaps, 2 refused. */
function checkScreensCommand(command, options = {}) {
  const out = options.out ?? console.log
  const err = options.err ?? console.error
  let result
  try {
    result = runCheckScreens(options)
  } catch (error) {
    if (!(error instanceof ScreensRefusal)) throw error
    err(`release-check refused: check-screens ${error.message}.`)
    return EXIT.refused
  }
  if (command.flags.json) {
    out(JSON.stringify({ mode: "check-screens", ...result }, null, 2))
  } else {
    const head = result.passed
      ? `check-screens passed (${result.counts.screens} screens, ${result.counts.journeys} journeys).`
      : `check-screens failed with ${result.gaps.length} gap(s):`
    out(head)
    for (const gap of result.gaps) out(`- ${gapText(gap)}`)
    for (const skip of result.skippedPlatforms) {
      const why = skip.setting
        ? `the test settings hide it (${skip.setting})`
        : "screens.json hides it"
      out(`Skipped: ${skip.screen} on ${skip.platform}, because ${why}.`)
    }
  }
  return result.passed ? EXIT.passed : EXIT.failed
}

module.exports = {
  checkScreensCommand,
  notReachedScreens,
  planJourneys,
  readJourneys,
  runCheckScreens,
  screenCoverage,
  shownPlatforms,
}
