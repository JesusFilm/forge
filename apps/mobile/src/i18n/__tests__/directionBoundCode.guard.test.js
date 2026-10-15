// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs, path, and the TypeScript compiler.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")
const ts = require("typescript")

// Guard (feat-695 R19, KTD10): React Native mirrors `left` and `right` styles
// by itself, but not icon names, horizontal transforms, touch or scroll x math,
// or measured x values in side styles. Each such site is mirrored or excepted.
const MOBILE_ROOT = path.join(__dirname, "..", "..", "..")
const ROOTS = ["app", "src"]
// The one reviewed home for direction-bound code; its own tests prove it.
const LAYOUT_HELPER = "src/i18n/layoutRtl.ts"

const DIRECTIONAL_ICONS = new Set([
  "chevron-back",
  "chevron-forward",
  "arrow-back",
  "arrow-forward",
])
const HORIZONTAL_TRANSFORMS = new Set(["translateX", "scaleX"])
const HORIZONTAL_READS = new Set(["dx", "moveX", "x0", "pageX", "locationX"])
const SIDE_STYLES = new Set([
  "left",
  "right",
  "paddingLeft",
  "paddingRight",
  "marginLeft",
  "marginRight",
])
const MEASURED_X = new Set(["x", "pageX", "locationX"])

// Each entry is a deliberate site. `text` is the node's source text with its
// white space collapsed; one entry covers every match of it in the file.
const entries = (file, rule, texts, reason) =>
  texts.map((text) => ({ file, rule, text, reason }))

const PLAYBACK =
  "A playback control inside a left-to-right container (R12, KTD7)"
const PLAYER_LAYER =
  "It draws at a measured window x inside the left-to-right player layer (KTD7)"
const SIGNED_CHAPTER = "The chapter axis takes the layout sign (R14)"
const MAGNITUDE = "It compares magnitudes only, so the sign does not matter"

const ALLOWED = [
  ...entries(
    "src/components/bible/ReaderGestures.tsx",
    "horizontal-read",
    ["gesture.moveX"],
    "The start x for the edge-strip check is physical; mayStartScrub measures it from the strip's side (U3)",
  ),
  ...entries(
    "src/components/bible/ReaderGestures.tsx",
    "horizontal-read",
    ["gesture.dx", "current.dx"],
    "Claims compare magnitudes; the preview and the release pass dx through chapterDirection with the layout sign (R14)",
  ),
  ...entries(
    "src/components/bible/SwipeDemo.tsx",
    "horizontal-transform",
    ["translateX: chapter.travel"],
    "partTravelKeyframes gives the demo travel the layout sign (R14)",
  ),
  ...entries(
    "src/components/bible/VerseScrubber.tsx",
    "horizontal-read",
    ["event.nativeEvent.pageX"],
    "The touch x for the edge-strip check is physical (U3)",
  ),
  ...entries(
    "src/components/bible/VerseScrubber.tsx",
    "horizontal-read",
    ["gesture.dx"],
    "The drag math multiplies dx by the layout sign (R11)",
  ),
  ...entries(
    "src/components/bible/VerseSlider.tsx",
    "horizontal-transform",
    ["translateX: along(layer.translateX)"],
    SIGNED_CHAPTER,
  ),
  ...entries(
    "src/components/explore/ClipOverlay.tsx",
    "physical-side",
    ["left: railLeft + frame.x", "right: railLeft + frame.x + frame.width"],
    "Physical caption boxes that captionMeetsBox compares in the left-to-right caption layer (KTD7)",
  ),
  ...entries(
    "src/components/explore/ClipProgressBar.tsx",
    "horizontal-read",
    ["e.nativeEvent.locationX", "g.dx"],
    PLAYBACK,
  ),
  ...entries(
    "src/components/explore/ClipProgressBar.tsx",
    "horizontal-transform",
    ["scaleX: progress", "translateX: thumbX", "translateX: pillX"],
    PLAYBACK,
  ),
  ...entries(
    "src/components/explore/ClipProgressBar.tsx",
    "transform-origin",
    ['transformOrigin: "left center"'],
    PLAYBACK,
  ),
  ...entries(
    "src/components/explore/ExplorePager.tsx",
    "horizontal-read",
    ["gesture.dx"],
    MAGNITUDE,
  ),
  ...entries(
    "src/components/home/HomeScreen.tsx",
    "horizontal-read",
    ["gesture.dx"],
    "The claim compares magnitudes; the release goes through heroSwipeTarget with the layout sign (R11)",
  ),
  ...entries(
    "src/components/sections/CuratedHomeLayout.tsx",
    "physical-side",
    ["left: muteButtonRect.x"],
    "The mute target draws at a measured x inside a left-to-right layer (KTD7)",
  ),
  ...entries(
    "src/components/splash/SplashSequence.tsx",
    "physical-side",
    [
      "left: dissolveCentre.x - dissolveWidth / 2",
      "left: apex.x - rayLength",
      "left: wordCenter.x - mark.width",
    ],
    "The animated splash is off since 2026-09-15 and is not mirrored (plan scope)",
  ),
  ...entries(
    "src/components/splash/SplashSequence.tsx",
    "horizontal-transform",
    ["translateX: band.length / 2", "translateX: -band.length / 2"],
    "The animated splash is off since 2026-09-15 and is not mirrored (plan scope)",
  ),
  ...entries(
    "src/components/watch/MiniPlayerWindow.tsx",
    "horizontal-read",
    ["gesture.dx"],
    PLAYER_LAYER,
  ),
  ...entries(
    "src/components/watch/PlaybackHost.tsx",
    "physical-side",
    ["right: insets.right", "left: insets.left", "left: geometry.x"],
    PLAYER_LAYER,
  ),
  ...entries(
    "src/components/watch/PlaybackHost.tsx",
    "horizontal-transform",
    [
      "translateX: ramp(0, to.x - from.x)",
      "translateX: ramp(from.x - to.x, 0)",
      "translateX: drag.x",
    ],
    PLAYER_LAYER,
  ),
  ...entries(
    "src/components/watch/PlayerControls.tsx",
    "physical-side",
    [
      "paddingLeft: Math.max(insets.left, 12)",
      "paddingRight: Math.max(insets.right, 12)",
    ],
    "The fullscreen bar is left to right, so each inset stays on its physical side (R12, KTD7)",
  ),
  ...entries(
    "src/components/watch/Scrubber.tsx",
    "horizontal-read",
    ["e.nativeEvent.pageX", "g.dx", "g.x0", "g.moveX"],
    PLAYBACK,
  ),
  ...entries(
    "src/components/watch/Scrubber.tsx",
    "horizontal-transform",
    ["scaleX: progress", "translateX: thumbTranslateX"],
    PLAYBACK,
  ),
  ...entries(
    "src/components/watch/Scrubber.tsx",
    "transform-origin",
    ['transformOrigin: "left center"'],
    PLAYBACK,
  ),
  ...entries(
    "src/components/watch/VideoPlayer.tsx",
    "horizontal-read",
    ["locationX"],
    "The seek flash shows on the tapped side in the left-to-right player root (R12)",
  ),
  ...entries(
    "src/components/watch/VideoPlayer.tsx",
    "physical-side",
    [
      "left: seekFlashInset(insets.left)",
      "right: seekFlashInset(insets.right)",
    ],
    "The seek flash clears the notch on its own physical side in the left-to-right player root (R12)",
  ),
  ...entries(
    "src/lib/bible/movement/gesture.ts",
    "horizontal-read",
    ["delta.dx"],
    MAGNITUDE,
  ),
  ...entries(
    "src/lib/bible/movement/gesture.ts",
    "horizontal-read",
    ["total.dx"],
    "releaseSwipe passes the chapter distance through chapterDirection with the layout sign (R14)",
  ),
  ...entries(
    "src/lib/bible/movement/verseStage.ts",
    "horizontal-transform",
    [
      "translateX: vertical ? still(across) : outgoingAlong",
      "translateX: vertical ? still(0) : incomingAlong",
    ],
    SIGNED_CHAPTER,
  ),
  ...entries(
    "src/lib/horizontalPaging.ts",
    "horizontal-read",
    ["dx", "metrics.contentOffset.x"],
    "The paging helper turns these into the reading direction with layoutSign and isLayoutRtl (R11)",
  ),
  ...entries(
    "src/lib/miniPlayer/layout.ts",
    "physical-side",
    [
      "left: config.insets.left + margin",
      "right: config.screen.width - config.insets.right - margin - width",
    ],
    "Corner frames are physical inside the left-to-right player layer (KTD7)",
  ),
]

function propertyName(node) {
  const name = node.name
  if (name == null) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return null
}

function isDirectionalIconArgument(node) {
  const call = node.parent
  if (call == null || !ts.isCallExpression(call)) return false
  if (!call.arguments.includes(node)) return false
  const callee = call.expression
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : null
  return name === "directionalIcon"
}

/** A measured x, or a safe-area inset side, anywhere inside `node`. */
function readsPhysicalX(node) {
  let found = false
  ;(function visit(child) {
    if (found) return
    if (ts.isPropertyAccessExpression(child)) {
      const name = child.name.text
      if (MEASURED_X.has(name)) found = true
      const owner = child.expression.getText()
      if ((name === "left" || name === "right") && /insets?$/i.test(owner)) {
        found = true
      }
    }
    ts.forEachChild(child, visit)
  })(node)
  return found
}

function analyzeSource(file, source) {
  if (file === LAYOUT_HELPER) return []
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const offenders = []
  const report = (node, rule) =>
    offenders.push({
      file,
      rule,
      text: node.getText(sf).replace(/\s+/g, " "),
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    })

  ;(function visit(node) {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      DIRECTIONAL_ICONS.has(node.text) &&
      !isDirectionalIconArgument(node)
    ) {
      report(node, "directional-icon")
    }
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      HORIZONTAL_TRANSFORMS.has(propertyName(node))
    ) {
      report(node, "horizontal-transform")
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node) === "transformOrigin" &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      /\b(?:left|right)\b/.test(node.initializer.text)
    ) {
      report(node, "transform-origin")
    }
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text
      const contentOffsetX =
        name === "x" &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "contentOffset"
      if (HORIZONTAL_READS.has(name) || contentOffsetX) {
        report(node, "horizontal-read")
      }
    }
    if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name
      if (ts.isIdentifier(key) && HORIZONTAL_READS.has(key.text)) {
        report(node, "horizontal-read")
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      SIDE_STYLES.has(propertyName(node)) &&
      readsPhysicalX(node.initializer)
    ) {
      report(node, "physical-side")
    }
    ts.forEachChild(node, visit)
  })(sf)
  return offenders
}

const rulesOf = (file, source) =>
  analyzeSource(file, source).map((offender) => offender.rule)

/** Every source file under app/ and src/, without tests or generated code. */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const skipped = ["node_modules", "__tests__", "__mocks__", "test-utils"]
    if (skipped.includes(entry.name)) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (/\.(?:test|spec)\.|\.generated\.|\.d\.ts$/.test(entry.name)) return []
    return [path.relative(MOBILE_ROOT, full).split(path.sep).join("/")]
  })
}

function scanTree() {
  const files = ROOTS.flatMap((root) =>
    sourceFiles(path.join(MOBILE_ROOT, root)),
  )
  const offenders = files.flatMap((file) =>
    analyzeSource(file, fs.readFileSync(path.join(MOBILE_ROOT, file), "utf8")),
  )
  return { files, offenders }
}

const matches = (entry, offender) =>
  entry.file === offender.file &&
  entry.rule === offender.rule &&
  entry.text === offender.text

const describeOffender = (offender) =>
  `${offender.file}:${offender.line} ${offender.rule} ${JSON.stringify(offender.text)}`

const FIXTURE = "src/components/Fixture.tsx"

describe("no direction-bound code that the layout does not mirror (R19, KTD10)", () => {
  describe("positive controls", () => {
    it.each([
      [
        "a directional icon literal",
        `export const A = () => <Ionicons name="chevron-back" />`,
        "directional-icon",
      ],
      [
        "an icon literal in a constant",
        `const NEXT = "arrow-forward"`,
        "directional-icon",
      ],
      [
        "a horizontal translate",
        `const s = { transform: [{ translateX: offset }] }`,
        "horizontal-transform",
      ],
      [
        "a shorthand horizontal translate",
        `const s = { transform: [{ translateX }] }`,
        "horizontal-transform",
      ],
      [
        "a horizontal scale",
        `const s = { transform: [{ scaleX: -1 }] }`,
        "horizontal-transform",
      ],
      [
        "a transform origin that names a side",
        `const s = { transformOrigin: "left center" }`,
        "transform-origin",
      ],
      ["a gesture dx read", `const go = (g) => g.dx > 40`, "horizontal-read"],
      [
        "a page x read",
        `const at = (e) => e.nativeEvent.pageX`,
        "horizontal-read",
      ],
      [
        "a destructured location x",
        `const at = ({ nativeEvent: { locationX } }) => locationX`,
        "horizontal-read",
      ],
      [
        "a scroll x read",
        `const at = (e) => e.nativeEvent.contentOffset.x`,
        "horizontal-read",
      ],
      [
        "a safe-area inset in a side style",
        `const s = { left: insets.left }`,
        "physical-side",
      ],
      [
        "a measured x in a side style",
        `const s = { paddingRight: rect.x + 8 }`,
        "physical-side",
      ],
    ])("finds %s", (_label, source, rule) => {
      expect(rulesOf(FIXTURE, source)).toContain(rule)
    })
  })

  describe("negative controls", () => {
    it.each([
      [
        "an icon through the helper",
        `export const A = () => <Ionicons name={directionalIcon("chevron-back")} />`,
      ],
      [
        "a vertical icon",
        `export const A = () => <Ionicons name="chevron-down" />`,
      ],
      [
        "a playback icon",
        `export const A = () => <Ionicons name="play-back" />`,
      ],
      ["a vertical translate", `const s = { transform: [{ translateY: y }] }`],
      [
        "a centered transform origin",
        `const s = { transformOrigin: "center" }`,
      ],
      ["a vertical gesture read", `const go = (g) => g.dy > 40`],
      ["a scroll y read", `const at = (e) => e.nativeEvent.contentOffset.y`],
      [
        "a symmetric inset",
        `const s = { paddingHorizontal: Math.max(insets.left, insets.right) }`,
      ],
      ["a constant side style", `const s = { left: 0, right: 16 }`],
      [
        "an icon name in a comment",
        `// "chevron-back" points back\nconst a = 1`,
      ],
    ])("passes %s", (_label, source) => {
      expect(rulesOf(FIXTURE, source)).toEqual([])
    })

    it("lets the layout helper hold direction-bound code", () => {
      expect(
        rulesOf(
          LAYOUT_HELPER,
          `const M = { "chevron-back": "chevron-forward" }
          const p = { paddingLeft: insets.right }`,
        ),
      ).toEqual([])
      // The same source elsewhere is direction-bound.
      expect(
        rulesOf(FIXTURE, `const p = { paddingLeft: insets.right }`),
      ).toEqual(["physical-side"])
    })
  })

  describe("the source tree", () => {
    const tree = scanTree()

    it("scans the app (not vacuous)", () => {
      expect(tree.files.length).toBeGreaterThan(100)
    })

    it("has no direction-bound site outside the exception list", () => {
      const offenders = tree.offenders.filter(
        (offender) => !ALLOWED.some((entry) => matches(entry, offender)),
      )
      expect(offenders.map(describeOffender)).toEqual([])
    })

    it("uses every exception", () => {
      const unused = ALLOWED.filter(
        (entry) => !tree.offenders.some((offender) => matches(entry, offender)),
      )
      expect(unused).toEqual([])
    })

    it("names only files that exist, each with a reason", () => {
      const broken = ALLOWED.filter(
        (entry) =>
          !fs.existsSync(path.join(MOBILE_ROOT, entry.file)) ||
          typeof entry.reason !== "string" ||
          entry.reason.trim() === "",
      )
      expect(broken).toEqual([])
    })
  })
})
