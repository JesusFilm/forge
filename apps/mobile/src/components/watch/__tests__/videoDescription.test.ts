/**
 * SOURCE-SHAPE assertions, so these pin structure, not layout. They predate
 * the component-render harness this app now has (apps/mobile/CLAUDE.md,
 * "Component render tests"). Both directions were checked in the simulator: a
 * truncated description keeps "Read more", a 3-line one drops it.
 *
 * The failure this guards is asymmetric and easy to ship. If the measurement
 * silently never fires, `overflows` stays null and the toggle disappears for
 * EVERY description — including the long ones that need it. A screenshot of a
 * short description looks correct in exactly that case.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "VideoDescription.tsx"),
  "utf8",
)

describe("VideoDescription read-more toggle", () => {
  it("shows the toggle only once overflow is MEASURED true", () => {
    // Not a truthy check: `overflows` is null until measured, and null must
    // render nothing rather than flashing a toggle a short description never
    // needs. `=== true` is what makes the null state hide it.
    expect(SOURCE).toContain("overflows === true && (")
  })

  it("measures the text unconstrained, in a second copy", () => {
    // The visible Text carries numberOfLines, so RN reports exactly that many
    // lines whether the text was truncated or simply that long. Overflow is
    // therefore unknowable from the visible copy alone.
    expect(SOURCE).toContain("onTextLayout={handleMeasureLayout}")
    expect(SOURCE).toContain("e.nativeEvent.lines.length > COLLAPSED_LINES")
    // The measuring copy must NOT be capped, or it reports the cap back.
    const measure = SOURCE.slice(SOURCE.indexOf("styles.measure"))
    const upToClose = measure.slice(0, measure.indexOf("</View>"))
    expect(upToClose).not.toContain("numberOfLines")
  })

  it("keeps the measuring copy out of layout, touch and accessibility", () => {
    expect(SOURCE).toContain('pointerEvents="none"')
    expect(SOURCE).toContain("accessibilityElementsHidden")
    expect(SOURCE).toContain('importantForAccessibility="no-hide-descendants"')
    expect(SOURCE).toMatch(/measure: \{[^}]*height: 0/)
    expect(SOURCE).toMatch(/measure: \{[^}]*overflow: "hidden"/)
  })

  it("re-measures when the description changes", () => {
    // A mounted instance goes partial -> full under cache-first. Without the
    // reset a stale `true` keeps a dead toggle up over shorter text.
    expect(SOURCE).toContain("setOverflows(null)")
    expect(SOURCE).toContain("}, [description])")
  })
})
