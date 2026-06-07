/**
 * Experience chat snapshot diff/apply/revert utility.
 *
 * Pure functions that compute hybrid diffs for editable-locale snapshots:
 *   - Scalars (`title`, `metaDescription`, `ogImageUrl`) are recorded as
 *     `{before, after}` pairs so we can detect drift on revert.
 *   - `blocks` (an opaque JSON array) is captured as an RFC 6902 JSON Patch.
 *
 * RFC 6902 patches are not automatically invertible (a `replace` op throws
 * away the old value), so `computeDiff` stashes a deep clone of the
 * pre-image `blocks` on the returned diff under a non-enumerable symbol
 * key. `revertDiff` uses this stash to (a) reconstruct the pre-image and
 * (b) detect block-side drift by simulating the forward patch and
 * verifying the result equals the supplied state.
 *
 * The module is DB-agnostic and side-effect free. The service layer is
 * responsible for stripping `embedding` fields from snapshots before they
 * reach this module — but as a defensive guard, `computeDiff` throws if it
 * sees an `embedding` key on either input.
 */

import { applyPatch, createPatch, type Operation } from "rfc6902"

export type EditableLocaleState = {
  title: string
  metaDescription: string | null
  blocks: unknown[]
  ogImageUrl: string | null
}

type ScalarDiff<T> = { before: T; after: T }

export type ExperienceChatDiff = {
  scalars: {
    title?: ScalarDiff<string>
    metaDescription?: ScalarDiff<string | null>
    ogImageUrl?: ScalarDiff<string | null>
  }
  blocks?: ReadonlyArray<Operation>
}

export class RevertConflictError extends Error {
  readonly field: string
  constructor(opts: { field: string; message?: string }) {
    super(opts.message ?? `Revert conflict on field "${opts.field}"`)
    this.name = "RevertConflictError"
    this.field = opts.field
  }
}

export class InvariantError extends Error {
  readonly reason: string
  constructor(opts: { reason: string }) {
    super(opts.reason)
    this.name = "InvariantError"
    this.reason = opts.reason
  }
}

const BEFORE_BLOCKS = Symbol("experienceChatDiff.beforeBlocks")

type DiffWithStash = ExperienceChatDiff & {
  [BEFORE_BLOCKS]?: unknown[]
}

/* ------------------------------------------------------------------ */
/*  Internals                                                           */
/* ------------------------------------------------------------------ */

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function hasEmbeddingKey(state: EditableLocaleState): boolean {
  return Object.prototype.hasOwnProperty.call(state, "embedding")
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

export function computeDiff(
  before: EditableLocaleState,
  after: EditableLocaleState,
): ExperienceChatDiff {
  if (hasEmbeddingKey(before) || hasEmbeddingKey(after)) {
    throw new InvariantError({
      reason: "embedding field must be stripped before diff computation",
    })
  }

  const scalars: ExperienceChatDiff["scalars"] = {}

  if (before.title !== after.title) {
    scalars.title = { before: before.title, after: after.title }
  }
  if (before.metaDescription !== after.metaDescription) {
    scalars.metaDescription = {
      before: before.metaDescription,
      after: after.metaDescription,
    }
  }
  if (before.ogImageUrl !== after.ogImageUrl) {
    scalars.ogImageUrl = { before: before.ogImageUrl, after: after.ogImageUrl }
  }

  const diff: DiffWithStash = { scalars }
  if (!deepEqual(before.blocks, after.blocks)) {
    diff.blocks = createPatch(
      before.blocks,
      after.blocks,
    ) as ReadonlyArray<Operation>
    Object.defineProperty(diff, BEFORE_BLOCKS, {
      value: deepClone(before.blocks),
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }
  return diff
}

export function applyDiff(
  state: EditableLocaleState,
  diff: ExperienceChatDiff,
): EditableLocaleState {
  const next: EditableLocaleState = {
    title: state.title,
    metaDescription: state.metaDescription,
    ogImageUrl: state.ogImageUrl,
    blocks: deepClone(state.blocks),
  }

  if (diff.scalars.title) next.title = diff.scalars.title.after
  if (diff.scalars.metaDescription) {
    next.metaDescription = diff.scalars.metaDescription.after
  }
  if (diff.scalars.ogImageUrl) next.ogImageUrl = diff.scalars.ogImageUrl.after

  if (diff.blocks && diff.blocks.length > 0) {
    const blocksMutable = next.blocks
    const results = applyPatch(blocksMutable, [...diff.blocks])
    const firstError = results.find((r) => r !== null)
    if (firstError) throw firstError
  }

  return next
}

export function revertDiff(
  state: EditableLocaleState,
  diff: ExperienceChatDiff,
): EditableLocaleState {
  // Validate scalars first: state must equal `.after` for each present scalar.
  if (
    diff.scalars.title !== undefined &&
    state.title !== diff.scalars.title.after
  ) {
    throw new RevertConflictError({ field: "title" })
  }
  if (
    diff.scalars.metaDescription !== undefined &&
    state.metaDescription !== diff.scalars.metaDescription.after
  ) {
    throw new RevertConflictError({ field: "metaDescription" })
  }
  if (
    diff.scalars.ogImageUrl !== undefined &&
    state.ogImageUrl !== diff.scalars.ogImageUrl.after
  ) {
    throw new RevertConflictError({ field: "ogImageUrl" })
  }

  const next: EditableLocaleState = {
    title: state.title,
    metaDescription: state.metaDescription,
    ogImageUrl: state.ogImageUrl,
    blocks: deepClone(state.blocks),
  }

  if (diff.scalars.title) next.title = diff.scalars.title.before
  if (diff.scalars.metaDescription) {
    next.metaDescription = diff.scalars.metaDescription.before
  }
  if (diff.scalars.ogImageUrl) next.ogImageUrl = diff.scalars.ogImageUrl.before

  if (diff.blocks && diff.blocks.length > 0) {
    const stash = (diff as DiffWithStash)[BEFORE_BLOCKS]
    if (stash === undefined) {
      throw new RevertConflictError({
        field: "blocks",
        message:
          "blocks revert requires the before-snapshot stash that computeDiff attaches",
      })
    }
    // Verify state.blocks corresponds to the post-apply image: simulate
    // forward-apply from the stash and assert the result deep-equals state.
    const simulated = deepClone(stash)
    const simResults = applyPatch(simulated, [...diff.blocks])
    const simErr = simResults.find((r) => r !== null)
    if (simErr) {
      throw new RevertConflictError({ field: "blocks" })
    }
    if (!deepEqual(simulated, state.blocks)) {
      throw new RevertConflictError({ field: "blocks" })
    }
    next.blocks = deepClone(stash)
  }

  return next
}

export function isEmptyDiff(diff: ExperienceChatDiff): boolean {
  if (Object.keys(diff.scalars).length > 0) return false
  if (diff.blocks && diff.blocks.length > 0) return false
  return true
}
