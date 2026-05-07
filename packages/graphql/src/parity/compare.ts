/**
 * Four-class response parity differ.
 *
 * Takes two `NormalizedExperienceRoute` values (one per source) and
 * returns a deterministic, JSON-serializable `DiffReport` classified
 * across five channels:
 *
 *   - structural: field-presence asymmetries
 *   - value:      deep-equality mismatches on present fields
 *   - order:      ordered-collection identity mismatches
 *   - semantic:   locale-mismatch, URL-canonicalization residual
 *   - potentiallyTruncated: missing-tail entries on a side flagged
 *                  with `meta.potentiallyTruncated: true`
 *
 * Determinism: every channel's entries are sorted by RFC6901 JSON
 * Pointer with numeric-aware segment sort (per `path-pointer.ts`).
 * Two consecutive runs over identical inputs produce byte-identical
 * `JSON.stringify(report)`.
 *
 * Absent-field equivalence: `null` and missing-key are equivalent
 * post-normalization (per plan Key Decisions). Only true presence /
 * absence on one side surfaces in the structural channel.
 */

import {
  DEFAULT_ALLOW_LIST,
  indexAllowList,
  type AllowListEntry,
  type AppliedAllowListEntry,
  type AllowListChannel,
} from "./allow-list"
import { comparePointer, encodePointer } from "./path-pointer"
import type { NormalizedExperienceRoute } from "./shared-shape"

// ---------------------------------------------------------------------------
// Diff record types
// ---------------------------------------------------------------------------

export type StructuralDiff = {
  readonly path: string
  readonly side: "strapi" | "admin"
  readonly message: string
}

export type ValueDiff = {
  readonly path: string
  readonly strapi: unknown
  readonly admin: unknown
}

export type OrderDiff = {
  readonly path: string
  readonly strapiOrder: ReadonlyArray<string | number>
  readonly adminOrder: ReadonlyArray<string | number>
}

export type SemanticSubclass = "locale-mismatch" | "url-canonicalization"

export type SemanticDiff = {
  readonly path: string
  readonly subclass: SemanticSubclass
  readonly strapi: unknown
  readonly admin: unknown
}

export type PotentialTruncationDiff = {
  readonly path: string
  readonly side: "strapi" | "admin"
  readonly message: string
}

export type DiffReport = {
  readonly structural: ReadonlyArray<StructuralDiff>
  readonly value: ReadonlyArray<ValueDiff>
  readonly order: ReadonlyArray<OrderDiff>
  readonly semantic: ReadonlyArray<SemanticDiff>
  readonly potentiallyTruncated: ReadonlyArray<PotentialTruncationDiff>
  readonly meta: {
    readonly appliedAllowList: ReadonlyArray<AppliedAllowListEntry>
  }
}

export type CompareOptions = {
  /** URL locale the request asked for. Drives the locale semantic check. */
  readonly urlLocale: string
  /** Override the default allow-list. Pass an empty array to disable suppression. */
  readonly allowList?: ReadonlyArray<AllowListEntry>
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  comparePointer(a.path, b.path)

const byPathThenChannel = (
  a: { path: string; channel: string },
  b: { path: string; channel: string },
): number => byPath(a, b) || a.channel.localeCompare(b.channel)

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function compareNormalizedRoutes(
  strapi: NormalizedExperienceRoute,
  admin: NormalizedExperienceRoute,
  options: CompareOptions,
): DiffReport {
  const ctx: DiffContext = {
    structural: [],
    value: [],
    order: [],
    semantic: [],
    potentiallyTruncated: [],
    strapiTruncated: strapi.meta.potentiallyTruncated,
    adminTruncated: admin.meta.potentiallyTruncated,
  }

  // Resolved-locale equality — semantic class. Both sides' locale must
  // equal the URL locale. Kept BEFORE the structural walk so the
  // locale path is treated as semantic, not value-class.
  if (
    strapi.locale !== options.urlLocale ||
    admin.locale !== options.urlLocale
  ) {
    ctx.semantic.push({
      path: "/locale",
      subclass: "locale-mismatch",
      strapi: strapi.locale,
      admin: admin.locale,
    })
  }

  // Walk both normalized routes in lockstep, skipping `meta` (per-source
  // metadata) and `locale` (handled above).
  const skipKeys = new Set(["meta", "locale"])
  walkObjects(strapi, admin, [], ctx, skipKeys)

  // Apply allow-list suppression.
  const allowList = options.allowList ?? DEFAULT_ALLOW_LIST
  const allowIndex = indexAllowList(allowList)
  const applied: AppliedAllowListEntry[] = []
  const filterChannel = <T extends { path: string }>(
    channel: AllowListChannel,
    entries: T[],
  ): T[] =>
    entries.filter((e) => {
      const key = `${channel}:${e.path}`
      const match = allowIndex.get(key)
      if (match) {
        applied.push({
          path: match.path,
          channel: match.channel,
          rationale: match.rationale,
        })
        return false
      }
      return true
    })

  const structural = filterChannel("structural", ctx.structural)
  const valueChannel = filterChannel("value", ctx.value)
  const order = filterChannel("order", ctx.order)
  const semantic = filterChannel("semantic", ctx.semantic)

  // Sort each channel by JSON-Pointer numeric-aware order — determinism.
  structural.sort(byPath)
  valueChannel.sort(byPath)
  order.sort(byPath)
  semantic.sort(byPath)
  ctx.potentiallyTruncated.sort(byPath)
  applied.sort(byPathThenChannel)

  return {
    structural: Object.freeze(structural),
    value: Object.freeze(valueChannel),
    order: Object.freeze(order),
    semantic: Object.freeze(semantic),
    potentiallyTruncated: Object.freeze(ctx.potentiallyTruncated),
    meta: {
      appliedAllowList: Object.freeze(applied),
    },
  }
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

type DiffContext = {
  structural: StructuralDiff[]
  value: ValueDiff[]
  order: OrderDiff[]
  semantic: SemanticDiff[]
  potentiallyTruncated: PotentialTruncationDiff[]
  strapiTruncated: boolean
  adminTruncated: boolean
}

function walkObjects(
  strapi: unknown,
  admin: unknown,
  segments: ReadonlyArray<string | number>,
  ctx: DiffContext,
  skipKeys: ReadonlySet<string>,
): void {
  const path = encodePointer(segments)

  // Treat null and undefined-or-missing as equivalent post-normalization.
  const sNull = strapi === null || strapi === undefined
  const aNull = admin === null || admin === undefined
  if (sNull && aNull) return
  if (sNull && !aNull) {
    ctx.structural.push({
      path,
      side: "strapi",
      message: "missing on strapi (admin has value)",
    })
    return
  }
  if (!sNull && aNull) {
    ctx.structural.push({
      path,
      side: "admin",
      message: "missing on admin (strapi has value)",
    })
    return
  }

  // Primitives → value compare.
  if (typeof strapi !== "object" || typeof admin !== "object") {
    if (strapi !== admin) {
      ctx.value.push({ path, strapi, admin })
    }
    return
  }

  // Arrays → order + element walk.
  const sArr = Array.isArray(strapi)
  const aArr = Array.isArray(admin)
  if (sArr || aArr) {
    if (!sArr || !aArr) {
      ctx.value.push({ path, strapi, admin })
      return
    }
    walkArrays(
      strapi as ReadonlyArray<unknown>,
      admin as ReadonlyArray<unknown>,
      segments,
      ctx,
      skipKeys,
    )
    return
  }

  // Objects → field-by-field.
  const sObj = strapi as Record<string, unknown>
  const aObj = admin as Record<string, unknown>
  const allKeys = new Set<string>([...Object.keys(sObj), ...Object.keys(aObj)])
  for (const key of allKeys) {
    if (segments.length === 0 && skipKeys.has(key)) continue
    walkObjects(sObj[key], aObj[key], [...segments, key], ctx, skipKeys)
  }
}

function walkArrays(
  strapi: ReadonlyArray<unknown>,
  admin: ReadonlyArray<unknown>,
  segments: ReadonlyArray<string | number>,
  ctx: DiffContext,
  skipKeys: ReadonlySet<string>,
): void {
  const path = encodePointer(segments)

  // Order check via stable identity if elements are identifiable. For
  // now, compare by id when present; fall back to structural element-
  // by-element walk.
  const strapiIds = identifierSequence(strapi)
  const adminIds = identifierSequence(admin)
  if (
    strapiIds &&
    adminIds &&
    !arraysEqual(strapiIds, adminIds) &&
    sameSet(strapiIds, adminIds)
  ) {
    ctx.order.push({
      path,
      strapiOrder: Object.freeze([...strapiIds]),
      adminOrder: Object.freeze([...adminIds]),
    })
    // Emit element walk too for value diffs at matching positions —
    // by id, not by raw index.
    const adminById = new Map(admin.map((el) => [getId(el), el] as const))
    for (let i = 0; i < strapi.length; i++) {
      const id = getId(strapi[i])
      const matchedAdmin = id !== null ? adminById.get(id) : undefined
      if (matchedAdmin === undefined) continue
      walkObjects(strapi[i], matchedAdmin, [...segments, i], ctx, skipKeys)
    }
    return
  }

  // No id-driven order tracking — walk by index. Handle length mismatch
  // with truncation downgrade if appropriate.
  const maxLen = Math.max(strapi.length, admin.length)
  for (let i = 0; i < maxLen; i++) {
    if (i >= strapi.length) {
      // Admin has more entries.
      const tailPath = encodePointer([...segments, i])
      if (ctx.strapiTruncated && i >= strapi.length) {
        ctx.potentiallyTruncated.push({
          path: tailPath,
          side: "strapi",
          message:
            "admin has more entries than strapi at this index; strapi side flagged potentiallyTruncated",
        })
        continue
      }
      ctx.structural.push({
        path: tailPath,
        side: "strapi",
        message: "missing on strapi (admin tail)",
      })
      continue
    }
    if (i >= admin.length) {
      // Strapi has more entries.
      const tailPath = encodePointer([...segments, i])
      if (ctx.adminTruncated) {
        ctx.potentiallyTruncated.push({
          path: tailPath,
          side: "admin",
          message:
            "strapi has more entries than admin at this index; admin side flagged potentiallyTruncated",
        })
        continue
      }
      ctx.structural.push({
        path: tailPath,
        side: "admin",
        message: "missing on admin (strapi tail)",
      })
      continue
    }
    walkObjects(strapi[i], admin[i], [...segments, i], ctx, skipKeys)
  }
}

function identifierSequence(
  arr: ReadonlyArray<unknown>,
): ReadonlyArray<string> | null {
  const out: string[] = []
  for (const el of arr) {
    const id = getId(el)
    if (id === null || id === "") return null
    out.push(id)
  }
  return out
}

function getId(el: unknown): string | null {
  if (el === null || typeof el !== "object") return null
  const v = (el as Record<string, unknown>).id
  return typeof v === "string" ? v : null
}

function arraysEqual(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  for (const v of b) {
    if (!setA.has(v)) return false
  }
  return true
}
