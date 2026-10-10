import { describe, expect, it } from "vitest"

import {
  collapsedStyles,
  type CollapsedStyles,
} from "./sidebar-collapsed-styles"

// Drive the slot list off the function's own output, not a hand-listed array:
// the return type forces every CollapsedStyles key to be present, so a newly
// added slot is covered automatically with no list to drift out of sync.
const SLOTS = Object.keys(collapsedStyles(true)) as (keyof CollapsedStyles)[]

describe("collapsedStyles", () => {
  it("applies no collapsed styling when the rail is expanded", () => {
    const styles = collapsedStyles(false)
    // Expanded: every slot short-circuits to false so `cn()` drops it and the
    // rail renders in its full form.
    for (const slot of SLOTS) {
      expect(styles[slot]).toBe(false)
    }
  })

  it("emits a non-empty class fragment for every slot when collapsed", () => {
    const styles = collapsedStyles(true)
    for (const slot of SLOTS) {
      expect(typeof styles[slot]).toBe("string")
      expect(styles[slot]).not.toBe("")
    }
  })

  it("scopes every collapsed class to the md breakpoint (collapse is desktop-only)", () => {
    // The load-bearing invariant: the mobile drawer must always show full
    // content, so each collapsed fragment must be `md:`-prefixed on every token.
    // A stray unprefixed utility here would leak the icon-rail into the drawer.
    const styles = collapsedStyles(true)
    for (const slot of SLOTS) {
      const tokens = (styles[slot] as string).split(/\s+/).filter(Boolean)
      for (const token of tokens) {
        expect(token.startsWith("md:")).toBe(true)
      }
    }
  })
})
