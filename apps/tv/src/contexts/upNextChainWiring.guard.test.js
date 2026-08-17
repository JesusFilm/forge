// Plain JS: the RN tsconfig has no Node types, and this guard needs fs/path to
// read source files (same precedent as accountSyncWiring.guard.test.js).
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The Up Next chain fix lives at three seams no render harness can reach
// (apps/tv has none for app/ routes), and each is a one-line revert surface
// that compiles, typechecks, and leaves the whole suite green while breaking
// every binge chain after exactly one hop — the simulator-verified failure
// (2026-08-14, tvOS 4K sim): Day 5 → Day 6 played, Day 6 → Day 7 stranded the
// viewer on Home, because Day 6's route was autoplay-entered and its pop-back
// effect fired on the hop's own dismiss.
//
//   1. _layout.tsx onPlayNext dropping markUpNextChain(), or calling it after
//      dismissVideo() — the mark must exist before the dismiss lands.
//   2. [slug].tsx pop-back effect dropping the consumeUpNextChain() gate
//      before router.back().
//   3. VideoPlayerContext playVideo dropping the latch clear() — a hop whose
//      screen unmounted before consuming would poison the next genuine
//      back-out.
const LAYOUT_ROUTE = path.resolve(__dirname, "../../app/_layout.tsx")
const WATCH_ROUTE = path.resolve(__dirname, "../../app/watch/[slug].tsx")
const CONTEXT = path.resolve(__dirname, "./VideoPlayerContext.tsx")

describe("up next chain wiring", () => {
  it("overlay host marks the chain BEFORE dismissing on onPlayNext", () => {
    const src = fs.readFileSync(LAYOUT_ROUTE, "utf8")
    const handlerStart = src.indexOf("onPlayNext={")
    expect(handlerStart).toBeGreaterThan(-1)
    const slice = src.slice(handlerStart, handlerStart + 800)
    const markAt = slice.indexOf("markUpNextChain()")
    const dismissAt = slice.indexOf("dismissVideo()")
    const replaceAt = slice.indexOf("router.replace(")
    expect(markAt).toBeGreaterThan(-1)
    expect(dismissAt).toBeGreaterThan(markAt)
    expect(replaceAt).toBeGreaterThan(dismissAt)
  })

  it("pass-through pop-back consumes the chain mark before router.back()", () => {
    const src = fs.readFileSync(WATCH_ROUTE, "utf8")
    const latchAt = src.indexOf("if (consumeUpNextChain()) return")
    const backAt = src.indexOf("router.back()")
    expect(latchAt).toBeGreaterThan(-1)
    expect(backAt).toBeGreaterThan(latchAt)
    // Anti-vacuous companion: the guarded back() is still present at all —
    // deleting the pop-back entirely would strand Back on pages the viewer
    // never chose (the behavior the effect exists to prevent).
    expect(src.includes("router.back()")).toBe(true)
  })

  it("playVideo clears the latch so a stale mark cannot survive a hop", () => {
    const src = fs.readFileSync(CONTEXT, "utf8")
    const playVideoAt = src.indexOf("const playVideo = useCallback(")
    expect(playVideoAt).toBeGreaterThan(-1)
    const slice = src.slice(playVideoAt, playVideoAt + 800)
    expect(slice.includes(".clear()")).toBe(true)
  })
})
