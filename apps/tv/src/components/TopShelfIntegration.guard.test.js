/* global require, test, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const root = path.resolve(__dirname, "../..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

test("shelf publishing stays off the initial render and startup intro path", () => {
  expect(read("app/index.tsx")).toContain(
    'usePathname() === "/" && !introActive',
  )
  expect(read("src/lib/topShelf/useTopShelfSync.ts")).toContain(
    "previewOnly ? 0 : 4000",
  )
})

test("cold Top Shelf Play waits for the original intro, preferences and preferred dub", () => {
  const route = read("app/watch/[slug].tsx")
  expect(route).toContain(
    'topShelfParam === "1" && (!preferencesReady || loading || introActive)',
  )
  expect(route).toContain("topShelfAutoplayDecision({")
  expect(route).toContain("setActiveVariantIndex(targetIndex, false)")
  expect(route).toContain("await getResumePosition(videoId)")
  expect(route).toContain('if (Platform.OS !== "ios" || !Platform.isTV) return')
  expect(route).toContain("watchPlaybackLinkIntent(url, decodedSlug)")
})

test("the merged animation restart action and independent dots preference remain intact", () => {
  expect(read("src/contexts/WatchPreferencesProvider.tsx")).toContain(
    "await restartWatchForPreview(prefs)",
  )
  expect(read("src/lib/watchPreferences.ts")).toContain(
    "loadingAnimationId: parseLoadingAnimationId(",
  )
})
