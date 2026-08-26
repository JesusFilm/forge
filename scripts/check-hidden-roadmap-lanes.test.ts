import assert from "node:assert/strict"
import test from "node:test"

import type { Feature } from "../apps/roadmap/lib/features"
import { assertHiddenLanesStayHidden } from "./check-hidden-roadmap-lanes"

const visibleFeature = {
  filePath: "docs/roadmap/platform/feat-001.md",
} as Feature

test("rejects the link shape emitted by the README generator", () => {
  assert.throws(
    () =>
      assertHiddenLanesStayHidden(
        [visibleFeature],
        "[visible](platform/feat-001.md)",
        "[hidden](rag/feat-423-rag-scaffold-and-roadmap.md)",
      ),
    /expected to not match/,
  )
})

test("rejects a hidden feature loaded by the public roadmap", () => {
  const hiddenFeature = {
    filePath: "docs/roadmap/rag/feat-423.md",
  } as Feature

  assert.throws(
    () => assertHiddenLanesStayHidden([visibleFeature, hiddenFeature], "", ""),
    /rag must not be loaded/,
  )
})
