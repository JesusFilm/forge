// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the layout sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: iOS 26 defaults the stack back-swipe to FULL-WIDTH (react-native-
// screens enables it when the prop is unset), and a full-width pop claims
// rightward drags on the JS-PanResponder seek bar — dismissing it mid-scrub.

// The pop that dismisses the page belongs to the ROOT stack (nested options
// are inert against it); the nested [slug] entries cover episode→episode pops.

// gestureResponseDistance confines the pop to the left edge; the tempting
// fullScreenGestureEnabled:false instead KILLS all back-swipe on iOS 26.
const REQUIRED = [
  { file: "../_layout.tsx", screens: ["watch", "series"] },
  { file: "../watch/_layout.tsx", screens: ["[slug]"] },
  { file: "../series/_layout.tsx", screens: ["[slug]"] },
]

const OPT_OUT = /gestureResponseDistance:\s*BACK_SWIPE_RESPONSE_DISTANCE/

// Pinning only the identifier is vacuous: emptying the constant keeps every
// layout matching while the full-width pop comes back. Pin the VALUE too, and
// pin that the scrubber's guard reads the SAME width, since the whole design
// is "the pop owns this strip, the scrubber declines it".
const BACK_SWIPE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "lib", "backSwipe.ts"),
  "utf8",
)

// Pure detector over { content, screens } so a positive-control fixture can
// prove the mechanism flags a real omission, not just that today's tree passes.
function findScreensMissingOptOut(content, screens) {
  const segments = content
    .split("<Stack.Screen")
    .slice(1)
    .map((segment) => segment.split("/>")[0])
  return screens.filter(
    (screen) =>
      !segments.some(
        (segment) =>
          segment.includes(`name="${screen}"`) && OPT_OUT.test(segment),
      ),
  )
}

describe("full-width back-swipe opt-out on player stacks", () => {
  it("flags a screen whose entry lacks the opt-out (positive control)", () => {
    const fixture = `
      <Stack.Screen name="watch" options={{ headerShown: false }} />
      <Stack.Screen
        name="series"
        options={{
          headerShown: false,
          gestureResponseDistance: BACK_SWIPE_RESPONSE_DISTANCE,
        }}
      />
    `
    expect(findScreensMissingOptOut(fixture, ["watch", "series"])).toEqual([
      "watch",
    ])
  })

  it.each(REQUIRED)(
    "pins the edge-confined back-swipe distance in $file",
    ({ file, screens }) => {
      const content = fs.readFileSync(path.join(__dirname, file), "utf8")
      expect(findScreensMissingOptOut(content, screens)).toEqual([])
    },
  )

  it("pins the edge width itself, not just the identifier", () => {
    // Falsification: set BACK_SWIPE_EDGE_WIDTH to 0 and the pop is full-width
    // again while every layout still contains the token.
    expect(BACK_SWIPE_SOURCE).toMatch(/BACK_SWIPE_EDGE_WIDTH = 24\b/)
    // The rect must be built FROM that width, so the two cannot diverge.
    expect(BACK_SWIPE_SOURCE).toMatch(
      /BACK_SWIPE_RESPONSE_DISTANCE = \{\s*end: BACK_SWIPE_EDGE_WIDTH,?\s*\}/,
    )
  })

  it("feeds the same width to the scrubber's decline guard", () => {
    const controls = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "src",
        "components",
        "watch",
        "PlayerControls.tsx",
      ),
      "utf8",
    )
    // Fullscreen cannot pop, so it keeps the full-width bar; inline yields the
    // strip. A literal here instead of the constant is the drift this catches.
    //
    // And the guard is iOS-ONLY. react-native-screens discards
    // gestureResponseDistance on Android (ScreenViewManager.kt sets it to Unit
    // inside an "iOS-only" block) and react-navigation forces
    // gestureEnabled:false there, so Android has no competing recognizer to
    // yield to — an ungated guard would just delete ~6% of the timeline's
    // touch area for nothing.
    expect(controls).toContain(
      'Platform.OS === "ios" && !fullscreen ? BACK_SWIPE_EDGE_WIDTH : 0',
    )
    expect(controls).not.toContain(
      "edgeGuardWidth={fullscreen ? 0 : BACK_SWIPE_EDGE_WIDTH}",
    )
    const scrubber = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "src",
        "components",
        "watch",
        "Scrubber.tsx",
      ),
      "utf8",
    )
    // Both responder gates must decline, not just the start gate: a move-phase
    // capture would still steal a drag that began inside the strip.
    expect(scrubber).toContain(
      "mayStartScrub(e.nativeEvent.pageX, edgeGuardRef.current)",
    )
    // The move gate must read a RECORDED origin. PanResponder assigns
    // gestureState.x0 only at grant, so it is 0 in the move-capture phase and
    // `mayStartScrub(g.x0, ...)` would be a constant, not an origin test.
    expect(scrubber).toContain(
      "mayStartScrub(touchStartXRef.current, edgeGuardRef.current)",
    )
    expect(scrubber).toContain("touchStartXRef.current = e.nativeEvent.pageX")
    expect(scrubber).not.toContain("mayStartScrub(g.x0")
  })
})
