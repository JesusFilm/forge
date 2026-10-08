/* global require, test, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const root = path.join(__dirname, "../")
const read = (name) => fs.readFileSync(path.join(root, name), "utf8")

test("startup mounts app data immediately while gating movie and hero playback", () => {
  const layout = read("../app/_layout.tsx")
  expect(layout).toMatch(
    /<ApolloProvider[\s\S]*<WatchPreferencesProvider>[\s\S]*<StartupIntroProvider>[\s\S]*<Stack/,
  )
  expect(layout).toContain("introActive || !state.isVisible")
  expect(read("components/watch/VideoBackdrop.tsx")).toContain(
    "overlayVisible: overlayVisible || introActive",
  )
})

test("both auto-start and direct Showcase entry wait for the intro", () => {
  expect(read("../app/index.tsx")).toMatch(
    /if \(introActive\) return[\s\S]*!shouldAutoStartShowcase/,
  )
  expect(read("../app/showcase.tsx")).toContain(
    "introActive ? null : <ShowcaseScreen />",
  )
})

test("intro is local, skippable, bounded and stops only on actual background", () => {
  const source = read("contexts/StartupIntroProvider.tsx")
  expect(source).toContain('require("../../assets/startup-audio-logo.wav")')
  expect(source).toContain('player.addListener("playToEnd", finish)')
  expect(source).toContain('if (state === "background") finish()')
  expect(source).toContain("setTimeout(finish, STARTUP_INTRO_TIMEOUT_MS)")
  expect(source).toContain("onPress={finish}")
  expect(source).not.toContain("Press Select to skip")
  expect(source).toContain('accessibilityLabel="Skip Watch intro"')
  expect(source).toContain("if (!hydrated) return")
  expect(source).toContain('AppState.currentState === "background"')
  expect(source).toContain("id={startupAnimationId}")
  expect(source).not.toMatch(/AsyncStorage|SecureStore|fetch\(/)
})
