import assert from "node:assert/strict"
import test from "node:test"

import { introducedCollisions, ticketId } from "./check-new-roadmap-ids.mjs"

test("reads only a ticket's frontmatter ID", () => {
  assert.equal(
    ticketId('---\nid: "feat-576"\n---\nMentions feat-572.'),
    "feat-576",
  )
  assert.equal(ticketId("Mentions feat-576."), undefined)
})

test("flags a newly introduced cross-lane duplicate", () => {
  const current = new Map([
    ["docs/roadmap/platform/feat-572-a.md", "feat-572"],
    ["docs/roadmap/rag/feat-572-b.md", "feat-572"],
  ])
  assert.deepEqual(
    introducedCollisions(
      ["docs/roadmap/rag/feat-572-b.md"],
      new Map(),
      current,
    ),
    [{ id: "feat-572", paths: [...current.keys()] }],
  )
})

test("ignores untouched historical duplicates and content-only edits", () => {
  const current = new Map([
    ["docs/roadmap/platform/feat-572-a.md", "feat-572"],
    ["docs/roadmap/platform/feat-572-b.md", "feat-572"],
  ])
  assert.deepEqual(introducedCollisions([], new Map(), current), [])
  assert.deepEqual(
    introducedCollisions(
      ["docs/roadmap/platform/feat-572-a.md"],
      new Map([["docs/roadmap/platform/feat-572-a.md", "feat-572"]]),
      current,
    ),
    [],
  )
})
