/**
 * Admin-side normalizer.
 *
 * Takes an admin `experienceBySlug` response shape and emits the shared
 * `NormalizedExperienceRoute`. Differences from the Strapi normalizer:
 *
 * - The `blocks` field arrives as an opaque `JSON` scalar from admin's
 *   GraphQL endpoint. The normalizer runs `BlocksSchema.parse(...)`
 *   from `@forge/admin/domain/blocks` to recover the discriminated
 *   union and surface validation errors as typed
 *   `AdminBlocksValidationError`s.
 * - Container shape is already flat on admin (`container.content[]`
 *   with sibling `containerSlot` markers) — the normalizer passes
 *   content through unchanged. No flatten step.
 * - Resolved-locale comes from `ExperienceLocale.locale` directly.
 * - ogImage admin emits `ogImageUrl: String` only; the normalizer
 *   fills `width`/`height`/`alt` with `null` so the shape lines up
 *   with Strapi's normalizer output (the lossless superset).
 * - Optional fields normalize to `null` on absence.
 *
 * The input type is hand-defined to match what admin's `experienceBySlug`
 * resolver returns at the GraphQL surface — `blocks` is `unknown`
 * because admin exposes it as the generic JSON scalar.
 */

import { BlocksSchema } from "@forge/admin/domain/blocks"
import { ZodError } from "zod"

import { canonicalizeUrl } from "./canonicalize-url"
import type {
  NormalizedBlock,
  NormalizedExperienceRoute,
  NormalizedMeta,
  NormalizedOgImage,
} from "./shared-shape"

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export type AdminExperienceLocaleInput = {
  readonly id: string
  readonly slug: string
  readonly locale: string
  readonly title: string
  readonly description: string | null | undefined
  readonly ogImageUrl: string | null | undefined
  /**
   * Admin exposes blocks as the generic `JSON` scalar — typed as
   * `unknown` here. The normalizer parses via `BlocksSchema` to
   * recover the discriminated union.
   */
  readonly blocks: unknown
}

export type NormalizeAdminOptions = {
  readonly urlLocale: string
  /** Origin for URL canonicalization. Admin URLs are typically absolute already. */
  readonly baseOrigin: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AdminBlocksValidationError extends Error {
  override readonly name = "AdminBlocksValidationError"
  readonly issues: ZodError["issues"]
  constructor(message: string, issues: ZodError["issues"]) {
    super(message)
    this.issues = issues
  }
}

export class AdminNormalizationError extends Error {
  override readonly name = "AdminNormalizationError"
  readonly missingField: string
  constructor(message: string, missingField: string) {
    super(message)
    this.missingField = missingField
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function normalizeAdmin(
  input: AdminExperienceLocaleInput,
  options: NormalizeAdminOptions,
): NormalizedExperienceRoute {
  if (!input.id) {
    throw new AdminNormalizationError(
      "normalizeAdmin: required field 'id' is missing or empty",
      "id",
    )
  }
  if (!input.slug) {
    throw new AdminNormalizationError(
      "normalizeAdmin: required field 'slug' is missing or empty",
      "slug",
    )
  }
  if (!input.locale) {
    throw new AdminNormalizationError(
      "normalizeAdmin: required field 'locale' is missing or empty",
      "locale",
    )
  }
  if (typeof input.title !== "string") {
    throw new AdminNormalizationError(
      "normalizeAdmin: required field 'title' is missing",
      "title",
    )
  }

  // Parse the opaque JSON `blocks` payload via admin's authoritative Zod
  // schema. Validation failures throw with structured issue context so
  // the harness reports them as a typed surface, not opaque structural
  // diff entries.
  const rawBlocks = input.blocks ?? []
  const parsed = BlocksSchema.safeParse(rawBlocks)
  if (!parsed.success) {
    throw new AdminBlocksValidationError(
      `normalizeAdmin: blocks payload failed BlocksSchema validation (${parsed.error.issues.length} issues)`,
      parsed.error.issues,
    )
  }

  const rawUrls: Record<string, string> = {}
  const ogImage = normalizeAdminOgImage(
    input.ogImageUrl ?? null,
    options.baseOrigin,
    rawUrls,
  )

  const normalizedBlocks = parsed.data.map((block) =>
    normalizeAdminBlock(block, options.baseOrigin, rawUrls),
  )

  const meta: NormalizedMeta = {
    source: "admin",
    // Admin doesn't have Strapi's pagination cap. Truncation only
    // surfaces if upstream signals it, which admin currently doesn't.
    potentiallyTruncated: false,
    rawUrls: Object.freeze({ ...rawUrls }),
  }

  return {
    id: input.id,
    slug: input.slug,
    locale: input.locale,
    title: input.title,
    description: nullify(input.description),
    ogImage,
    blocks: Object.freeze(normalizedBlocks) as ReadonlyArray<NormalizedBlock>,
    meta,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nullify<T>(value: T | null | undefined): T | null {
  if (value === undefined || value === null) return null
  return value
}

function normalizeAdminOgImage(
  raw: string | null,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): NormalizedOgImage | null {
  if (raw === null || raw === "") return null
  const result = canonicalizeUrl(raw, { schema: "admin", baseOrigin })
  if (result.canonical === null) {
    return { url: raw, width: null, height: null, alt: null }
  }
  rawUrls[result.canonical] = result.raw
  return { url: result.canonical, width: null, height: null, alt: null }
}

/**
 * Normalize a single parsed admin block. Admin's flat container shape
 * (with sibling containerSlot markers) is preserved as-is in the
 * normalized output; the differ walks `data.content[]` like any other
 * ordered array.
 */
function normalizeAdminBlock(
  block: unknown,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): NormalizedBlock {
  const b = block as { t: string; id?: string } & Record<string, unknown>

  // Synthetic containerSlot is allowed inside container.content; the
  // top-level BlocksSchema doesn't include it, but the discriminated
  // recursion via container will. Type the marker shape conservatively.
  if (b.t === "containerSlot") {
    return {
      kind: "containerSlot",
      id: typeof b.id === "string" ? b.id : "",
      gridSpan: typeof b.gridSpan === "number" ? b.gridSpan : null,
      spans: Array.isArray(b.spans)
        ? Object.freeze([...(b.spans as number[])])
        : null,
    }
  }

  // For container blocks, recursively normalize their content array so
  // nested blocks (and slot markers) are themselves canonicalized.
  if (b.t === "container") {
    const innerContent = Array.isArray(b.content)
      ? (b.content as unknown[]).map((c) =>
          normalizeAdminBlock(c, baseOrigin, rawUrls),
        )
      : []
    return {
      kind: "container",
      id: typeof b.id === "string" ? b.id : "",
      data: {
        ...stripBlockMeta(b),
        content: innerContent,
      },
    }
  }

  // Section blocks also carry a content[] of nested blocks.
  if (b.t === "section") {
    const innerContent = Array.isArray(b.content)
      ? (b.content as unknown[]).map((c) =>
          normalizeAdminBlock(c, baseOrigin, rawUrls),
        )
      : []
    return {
      kind: "section",
      id: typeof b.id === "string" ? b.id : "",
      data: {
        ...stripBlockMeta(b),
        content: innerContent,
      },
    }
  }

  // Generic kinds: canonicalize URL-shaped fields in the payload.
  const stripped = stripBlockMeta(b)
  const dataWithCanonicalUrls = canonicalizeNestedUrls(
    stripped,
    baseOrigin,
    rawUrls,
  ) as Readonly<Record<string, unknown>>

  return {
    kind: b.t as Exclude<NormalizedBlock["kind"], "containerSlot">,
    id: typeof b.id === "string" ? b.id : "",
    data: dataWithCanonicalUrls,
  }
}

function stripBlockMeta(
  block: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block)) {
    if (key === "t" || key === "id" || key === "content") continue
    out[key] = value
  }
  return out
}

function canonicalizeNestedUrls(
  value: unknown,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== "object") return value
  if (Array.isArray(value)) {
    return value.map((v) => canonicalizeNestedUrls(v, baseOrigin, rawUrls))
  }
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && looksLikeUrlKey(key) && child !== "") {
      const result = canonicalizeUrl(child, { schema: "admin", baseOrigin })
      if (result.canonical !== null) {
        out[key] = result.canonical
        rawUrls[result.canonical] = result.raw
      } else {
        out[key] = child
      }
    } else if (child === undefined || child === null) {
      out[key] = null
    } else {
      out[key] = canonicalizeNestedUrls(child, baseOrigin, rawUrls)
    }
  }
  return out
}

function looksLikeUrlKey(key: string): boolean {
  return /^(url|.*Url|.*URL|.*Link|.*Href)$/.test(key)
}
