import { describe, expect, it } from "vitest"

import { blurRegionFor, usesStableTopAnchor } from "./DevotionalVideo"
import { resolveDevotionalStyle } from "./styles"

// Every portrait reflection card blurred the TOP of the frame while its text
// sat in the lower half: the ground was above the words instead of behind
// them. The cause was two places computing "where does the text sit". The
// portrait stable-subtitle anchor pins reflection-focus at a fixed ~46% and
// grows DOWNWARD, but only the LAYOUT learned that; the blur region kept
// answering from `style.textBottom`, which stopped describing the text's
// position the moment the anchor was introduced.
//
// This pins the predicate both sides now share. Falsify by inlining
// `igSafe && !frosted` back into the layout: the layout and the blur can
// disagree again and nothing here goes red -- which is why the predicate is
// exported and consumed, not duplicated.
describe("usesStableTopAnchor", () => {
  const grounded = resolveDevotionalStyle("splittone", "grounded")
  const centered = resolveDevotionalStyle("splittone", "centered")
  const editorial = resolveDevotionalStyle("splittone", "editorial")

  it("holds for a portrait reflection-focus card, whatever the layout says about textBottom", () => {
    // The bug's own case: `centered` has textBottom false, which used to send
    // the blur to the top while the text sat at 46% and grew down.
    expect(usesStableTopAnchor("reflection-focus", centered, false)).toBe(true)
    expect(usesStableTopAnchor("reflection-focus", grounded, false)).toBe(true)
  })

  it("does not hold in landscape, which keeps its band/panel behaviour", () => {
    expect(usesStableTopAnchor("reflection-focus", centered, true)).toBe(false)
  })

  // A frosted layout puts the text in its own blurred rectangle, so the frame
  // behind it must stay clear and the fixed anchor does not apply.
  it("does not hold for a panel-frost layout", () => {
    expect(usesStableTopAnchor("reflection-focus", editorial, false)).toBe(
      false,
    )
  })

  // Only the one-sentence focus card uses the stable anchor. reflection-full
  // still anchors top or bottom from the layout.
  it("does not hold for other card kinds", () => {
    for (const kind of [
      "reflection-full",
      "scripture",
      "conclusion",
      "questions",
      "cover",
      "video",
    ]) {
      expect(usesStableTopAnchor(kind, centered, false), kind).toBe(false)
    }
  })
})

// The predicate above is inert unless the BLUR consumes it. Pinning only the
// predicate let the fix be reverted with every test still green -- so these
// assert the region itself, which is the thing the owner actually saw wrong.
describe("blurRegionFor", () => {
  const grounded = resolveDevotionalStyle("splittone", "grounded")
  const centered = resolveDevotionalStyle("splittone", "centered")
  const editorial = resolveDevotionalStyle("splittone", "editorial")

  // THE BUG: `centered` has textBottom false, so the region used to come back
  // "top" while the text sat at ~46% and grew down. Falsify by dropping the
  // stable-anchor line from `textAnchorFor` -- this returns "top" again.
  it("puts the ground UNDER a portrait reflection card, not above it", () => {
    expect(blurRegionFor("reflection-focus", centered, false)).toBe("bottom")
    expect(blurRegionFor("reflection-focus", grounded, false)).toBe("bottom")
  })

  it("leaves landscape reflections on their layout's own band", () => {
    expect(blurRegionFor("reflection-focus", centered, true)).toBe("top")
    expect(blurRegionFor("reflection-focus", grounded, true)).toBe("bottom")
  })

  // A frosted layout blurs inside its own rectangle, so the frame stays clear.
  it("adds no frame blur when the panel owns it", () => {
    expect(blurRegionFor("reflection-focus", editorial, false)).toBe("none")
  })

  // Untouched by this change: the cards that were already correct.
  it("keeps the whole-frame and no-blur cards as they were", () => {
    expect(blurRegionFor("video", centered, false)).toBe("none")
    expect(blurRegionFor("conclusion", centered, false)).toBe("whole")
    expect(blurRegionFor("questions", centered, false)).toBe("whole")
    expect(blurRegionFor("step", centered, false)).toBe("whole")
  })
})
