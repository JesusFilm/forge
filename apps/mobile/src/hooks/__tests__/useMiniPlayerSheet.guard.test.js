// SOURCE-SHAPE guard for R11's two non-route sheets. `presentationFor` cannot
// see either of them, so the ONLY thing that suppresses the window over them is
// the call site itself. Deleting one line compiles, typechecks, and leaves the
// whole suite green — the window then paints through an iOS formSheet.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "../..", "..")

function readSource(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), "utf8")
}

describe("the non-route sheets report to the mini player counter", () => {
  it("library's delete-confirm sheet reports its own visibility", () => {
    const source = readSource("app", "(tabs)", "library.tsx")

    expect(source).toContain("useMiniPlayerSheet(confirmVisible)")
    expect(source).toContain(
      'import { useMiniPlayerSheet } from "../../src/hooks/useMiniPlayerSheet"',
    )
  })

  it("the quiz modal reports its own visibility", () => {
    const source = readSource(
      "src",
      "components",
      "sections",
      "QuizButtonRenderer.tsx",
    )

    expect(source).toContain("useMiniPlayerSheet(modalVisible)")
    expect(source).toContain(
      'import { useMiniPlayerSheet } from "../../hooks/useMiniPlayerSheet"',
    )
  })

  it("positive control: the state each call site names is the one the sheet renders on", () => {
    // Pins that the two calls above are not passing a dead variable. A renamed
    // state that only the call site kept would otherwise still read as covered.
    const library = readSource("app", "(tabs)", "library.tsx")
    const quiz = readSource(
      "src",
      "components",
      "sections",
      "QuizButtonRenderer.tsx",
    )

    expect(library).toContain("visible={confirmVisible}")
    expect(quiz).toContain("{modalVisible && (")
  })
})
