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
})
