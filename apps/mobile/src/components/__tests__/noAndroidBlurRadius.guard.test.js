// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (feat-784): on Android, expo-image turns `blurRadius` into a
// RenderScript blur, and two blurs at the same time can crash the app. So each
// site must be on this allow list, with a value that only iOS can receive.
const MOBILE_DIR = path.join(__dirname, "..", "..", "..")
const TOPIC_CARD = path.join("src", "components", "search", "TopicCard.tsx")
const WATCH_AMBIENT = path.join(
  "src",
  "components",
  "watch",
  "WatchAmbient.tsx",
)
const ALLOWED = {
  [TOPIC_CARD]: ["IOS_THUMBNAIL_BLUR_RADIUS"],
  [WATCH_AMBIENT]: ["IOS_AMBIENT_BLUR"],
}

const BLUR_TOKEN = /\bblurRadius\b/g
// `blurRadius={Platform.OS === "ios" ? NAME : undefined}`, with any spacing.
const IOS_ONLY_SITE =
  /\bblurRadius=\{\s*Platform\.OS\s*===\s*["']ios["']\s*\?\s*([A-Za-z_$][\w$]*)\s*:\s*undefined\s*\}/g

// A comment that names the prop is documentation, not a site. Only a whole
// comment line is stripped, so a trailing `//` cannot hide code before it.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "")
}

/** Every `blurRadius` in the code, and the iOS-only constants among them. */
function blurSites(source) {
  const code = stripComments(source)
  return {
    total: (code.match(BLUR_TOKEN) || []).length,
    iosOnly: [...code.matchAll(IOS_ONLY_SITE)].map((match) => match[1]),
  }
}

/** Why the file can send a blur to Android, or null when it cannot. */
function androidBlurProblem(relativeFile, source) {
  const { total, iosOnly } = blurSites(source)
  if (total === 0) return null
  if (iosOnly.length < total) return "a blurRadius value can reach Android"
  const allowed = ALLOWED[relativeFile] || []
  const unlisted = iosOnly.filter((name) => !allowed.includes(name))
  if (unlisted.length > 0)
    return `not on the allow list: ${unlisted.join(", ")}`
  return null
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [full]
      : []
  })
}

describe("no expo-image blurRadius reaches Android (feat-784)", () => {
  it.each([
    ["a literal", `<Image blurRadius={4} />`],
    // The two forms this fix removed: Android got 4 and 16.
    [
      "a platform ternary",
      `<Image blurRadius={Platform.OS === "ios" ? 12 : 4} />`,
    ],
    [
      "a constant that holds a platform ternary",
      `const BLUR = Platform.OS === "ios" ? 50 : 16
<Image blurRadius={BLUR} />`,
    ],
    [
      "an iOS name with an Android value",
      `<Image blurRadius={Platform.OS === "ios" ? IOS_AMBIENT_BLUR : 16} />`,
    ],
    [
      "an inverted test",
      `<Image blurRadius={Platform.OS !== "ios" ? IOS_AMBIENT_BLUR : undefined} />`,
    ],
    ["an object key", `const props = { blurRadius: 16 }`],
    ["a spread shorthand", `<Image {...{ blurRadius }} />`],
    ["a trailing comment", `<Image blurRadius={4} /> // iOS only`],
    [
      "a second site beside an iOS-only one",
      `<Image blurRadius={Platform.OS === "ios" ? IOS_AMBIENT_BLUR : undefined} />
<Image blurRadius={8} />`,
    ],
  ])("flags %s (positive control)", (_label, source) => {
    expect(androidBlurProblem(WATCH_AMBIENT, source)).toBe(
      "a blurRadius value can reach Android",
    )
  })

  it("flags an iOS-only site that is not on the allow list (positive control)", () => {
    const source = `<Image blurRadius={Platform.OS === "ios" ? IOS_BLUR : undefined} />`
    expect(androidBlurProblem(WATCH_AMBIENT, source)).toBe(
      "not on the allow list: IOS_BLUR",
    )
    expect(
      androidBlurProblem(
        path.join("src", "components", "home", "HomeCard.tsx"),
        `<Image blurRadius={Platform.OS === "ios" ? IOS_AMBIENT_BLUR : undefined} />`,
      ),
    ).toBe("not on the allow list: IOS_AMBIENT_BLUR")
  })

  it.each([
    [
      "the listed iOS-only form, as prettier wraps it",
      `<Image
  blurRadius={
    Platform.OS === "ios" ? IOS_THUMBNAIL_BLUR_RADIUS : undefined
  }
/>`,
    ],
    ["a comment line", `// blurRadius={4} is the form that crashed`],
    ["a block comment", `/* blurRadius={Platform.OS === "ios" ? 12 : 4} */`],
    ["no blur", `<Image source={url} contentFit="cover" />`],
  ])("passes %s (negative control)", (_label, source) => {
    expect(androidBlurProblem(TOPIC_CARD, source)).toBeNull()
  })

  it("finds none in app/ or src/", () => {
    const files = [
      ...sourceFiles(path.join(MOBILE_DIR, "app")),
      ...sourceFiles(path.join(MOBILE_DIR, "src")),
    ]
    // A floor, so a broken walk cannot pass by scanning nothing.
    expect(files.length).toBeGreaterThan(100)
    const offenders = files.flatMap((file) => {
      const relative = path.relative(MOBILE_DIR, file)
      const problem = androidBlurProblem(
        relative,
        fs.readFileSync(file, "utf8"),
      )
      return problem ? [`${relative}: ${problem}`] : []
    })
    expect(offenders).toEqual([])
  })

  it("keeps the allow list live: each entry is a real iOS-only site", () => {
    // A stale entry would admit a later site with that name without review.
    for (const [relative, names] of Object.entries(ALLOWED)) {
      const source = fs.readFileSync(path.join(MOBILE_DIR, relative), "utf8")
      expect(blurSites(source)).toEqual({ total: names.length, iosOnly: names })
    }
  })
})
