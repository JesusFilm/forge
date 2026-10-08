/* global require, test, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const { Buffer } = require("buffer")
const path = require("path")
const root = path.join(__dirname, "../..")
const read = (name) => fs.readFileSync(path.join(root, name), "utf8")

test("all ten effects are bundled, bounded in size and use no movie decoder", () => {
  const component = read("src/components/LogoAnimation.tsx")
  expect(component).not.toMatch(/expo-video|WebView|fetch\(/)
  expect(component).toContain('cachePolicy="none"')
  let total = 0
  for (let index = 1; index <= 10; index++) {
    const id = String(index).padStart(2, "0")
    expect(component).toContain(`${id}.webp`)
    const asset = fs.readFileSync(
      path.join(root, `assets/logo-motion/${id}.webp`),
    )
    expect(asset.subarray(8, 12).toString()).toBe("WEBP")
    expect(asset.includes(Buffer.from("ANIM"))).toBe(true)
    total += asset.length
  }
  expect(total).toBeLessThan(4 * 1024 * 1024)
})

test("reduced motion and actual background use a static original mark", () => {
  const component = read("src/components/LogoAnimation.tsx")
  expect(component).toContain("!reduceMotion")
  expect(component).toContain('next !== "background"')
  expect(component).toContain("source={animate ? sources[id] : still}")
})

test("startup freezes the displayed frame without remounting or swapping the image", () => {
  const component = read("src/components/LogoAnimation.tsx")
  expect(component).toContain(
    "const animate = active && foreground && !reduceMotion",
  )
  expect(component).toContain("key={`${id}-${animate}`}")
  expect(component).toContain("ref={imageRef}")
  expect(component).toContain("imageRef.current?.stopAnimating()")
  expect(component).not.toMatch(/setHold|!hold/)
  expect(component).toContain('id !== "09"')
  expect(component).toContain("4400")
  expect(component).toContain("clearTimeout(timer)")
})

test("settings retain independent saved choices and time-bound silent previews", () => {
  const settings = read("src/components/settings/AnimationSettingsScreen.tsx")
  expect(settings).toContain("LOGO_ANIMATIONS.map")
  expect(settings).toContain("setStartupAnimationId(id)")
  expect(settings).toContain("setLoadingAnimationId(id)")
  expect(settings).toContain("LOGO_PREVIEW_DURATION_MS")
  expect(settings).toContain("active={focused && previewing}")
  expect(read("src/components/settings/SettingsScreen.tsx")).toContain(
    'router.push("/settings/animations")',
  )
})

test("loading follows existing pending-work branches without artificial waits", () => {
  const home = read("app/index.tsx")
  expect(home).toMatch(/screenState === "loading"[\s\S]*<BrandedLoading/)
  expect(read("src/components/ScreenStateView.tsx")).toMatch(
    /kind === "loading"[\s\S]*<LogoAnimation/,
  )
  expect(read("src/components/BrandedLoading.tsx")).not.toMatch(
    /setTimeout|play\(/,
  )
  expect(read("src/components/ScreenStateView.tsx")).toContain(
    'accessibilityLabel={message ?? "Loading"}',
  )
  expect(read("src/components/ScreenStateView.tsx")).toContain(
    "accessibilityState={{ busy: true }}",
  )
})

test("restart preview waits for the selected preferences to save before reloading the current app", () => {
  const provider = read("src/contexts/WatchPreferencesProvider.tsx")
  expect(provider).toMatch(
    /await getStorage\(\)\.setItem\([\s\S]*serializeWatchPreferences\(prefs\)[\s\S]*await reloadAppAsync\("Preview selected startup animation"\)/,
  )
  const settings = read("src/components/settings/AnimationSettingsScreen.tsx")
  expect(settings).toContain('testID="animations-restart"')
  expect(settings).toContain('"Restart app & preview"')
  expect(settings).toContain("await restartAppForPreview()")
  expect(settings).toContain("disabled={!hydrated || restarting}")
})
