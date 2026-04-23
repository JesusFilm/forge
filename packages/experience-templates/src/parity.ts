import type { SectionContent, TopLevelBlock } from "./types"

/**
 * Parity diff — compares an expected structural template against a generated
 * tree and reports every mismatch without throwing. Pure, dependency-free.
 *
 * We walk top-level blocks, then recurse into `sections.section.content[]`
 * and `sections.container.slots[].content[]` where relevant. We also surface
 * two cross-cutting invariants required by the CMS:
 *   1. Every `sections.video` / `sections.video-hero` must carry a sectionKey.
 *   2. Every `sections.video` must have a non-zero `video` relation id.
 */

export type DiffMismatchKind =
  | "block-count"
  | "component-mismatch"
  | "nested-count-mismatch"
  | "missing-section-key"
  | "missing-video-relation"

export type DiffMismatch = {
  path: (string | number)[]
  kind: DiffMismatchKind
  expected?: unknown
  actual?: unknown
  message: string
}

export type DiffReport = {
  ok: boolean
  mismatches: DiffMismatch[]
}

type AnyBlock = { __component?: string; [key: string]: unknown }

function componentOf(block: unknown): string | undefined {
  if (block && typeof block === "object") {
    const c = (block as AnyBlock).__component
    if (typeof c === "string") return c
  }
  return undefined
}

function pathString(path: (string | number)[]): string {
  return path.length === 0 ? "<root>" : path.join(".")
}

export function parityDiff(
  expected: TopLevelBlock[],
  actual: TopLevelBlock[],
): DiffReport {
  const mismatches: DiffMismatch[] = []

  // 1. Top-level block count
  if (expected.length !== actual.length) {
    mismatches.push({
      path: ["blocks"],
      kind: "block-count",
      expected: expected.length,
      actual: actual.length,
      message: `Expected ${expected.length} top-level blocks, got ${actual.length}.`,
    })
  }

  const shared = Math.min(expected.length, actual.length)
  for (let i = 0; i < shared; i++) {
    const exp = expected[i]
    const act = actual[i]
    const expComp = componentOf(exp)
    const actComp = componentOf(act)

    if (expComp !== actComp) {
      mismatches.push({
        path: [i],
        kind: "component-mismatch",
        expected: expComp,
        actual: actComp,
        message: `Block ${i}: expected ${expComp ?? "<missing>"}, got ${actComp ?? "<missing>"}.`,
      })
    }

    // 2. If this is a wrapper, recurse into content
    if (expComp === "sections.section" && actComp === "sections.section") {
      const expContent =
        ((exp as { content?: SectionContent[] }).content as SectionContent[]) ??
        []
      const actContent =
        ((act as { content?: SectionContent[] }).content as SectionContent[]) ??
        []
      if (expContent.length !== actContent.length) {
        mismatches.push({
          path: [i, "content"],
          kind: "nested-count-mismatch",
          expected: expContent.length,
          actual: actContent.length,
          message: `Block ${i}: expected ${expContent.length} content items, got ${actContent.length}.`,
        })
      }
      const nestedShared = Math.min(expContent.length, actContent.length)
      for (let j = 0; j < nestedShared; j++) {
        const expNested = componentOf(expContent[j])
        const actNested = componentOf(actContent[j])
        if (expNested !== actNested) {
          mismatches.push({
            path: [i, "content", j],
            kind: "component-mismatch",
            expected: expNested,
            actual: actNested,
            message: `Block ${i}.content[${j}]: expected ${expNested ?? "<missing>"}, got ${actNested ?? "<missing>"}.`,
          })
        }
      }
    }
  }

  // 3. Cross-cutting invariants: walk the actual tree for missing keys/relations
  walk(actual, [], (node, path) => {
    const comp = componentOf(node)
    if (comp === "sections.video" || comp === "sections.video-hero") {
      const key = (node as { sectionKey?: unknown }).sectionKey
      if (typeof key !== "string" || key.length === 0) {
        mismatches.push({
          path,
          kind: "missing-section-key",
          actual: key,
          message: `${pathString(path)}: ${comp} is missing a sectionKey.`,
        })
      }
    }
    if (comp === "sections.video") {
      const videoId = (node as { video?: unknown }).video
      if (
        videoId === null ||
        videoId === undefined ||
        videoId === 0 ||
        (typeof videoId !== "number" && typeof videoId !== "object")
      ) {
        mismatches.push({
          path,
          kind: "missing-video-relation",
          actual: videoId,
          message: `${pathString(path)}: sections.video is missing a video relation.`,
        })
      }
    }
  })

  return { ok: mismatches.length === 0, mismatches }
}

type Walker = (node: unknown, path: (string | number)[]) => void

function walk(
  blocks: unknown[],
  basePath: (string | number)[],
  visit: Walker,
): void {
  blocks.forEach((block, i) => {
    const path = [...basePath, i]
    visit(block, path)
    const comp = componentOf(block)
    if (comp === "sections.section") {
      const content =
        (block as { content?: unknown[] }).content ?? ([] as unknown[])
      walk(content, [...path, "content"], visit)
    } else if (comp === "sections.container") {
      const slots = (block as { slots?: unknown[] }).slots ?? []
      slots.forEach((slot, s) => {
        const content =
          (slot as { content?: unknown[] }).content ?? ([] as unknown[])
        walk(content, [...path, "slots", s, "content"], visit)
      })
    } else if (comp === "sections.video-carousel") {
      const items = (block as { items?: unknown[] }).items ?? []
      walk(items, [...path, "items"], (itemNode, itemPath) => {
        // Carousel items aren't full components, but they carry sectionKey +
        // video relations, so normalize them into a synthetic sections.video
        // shape for invariant checks.
        visit(
          { __component: "sections.video", ...(itemNode as object) },
          itemPath,
        )
      })
    }
  })
}
