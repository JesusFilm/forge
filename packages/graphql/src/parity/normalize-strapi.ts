/**
 * Strapi-side normalizer.
 *
 * Takes a Strapi `Experience` response shape and emits the shared
 * `NormalizedExperienceRoute`. Handles:
 *
 * - Discriminator translation (`__typename` → admin-canonical `kind`)
 *   via `discriminator-map.ts`. Unknown typenames surface as
 *   `kind: "unknown"` blocks; the differ flags them as structural.
 * - Container flatten: `Container { slots[] { content[] } }` flattens
 *   into a single `content[]` array with synthetic `containerSlot`
 *   markers preserving slot metadata at boundaries (per plan Key
 *   Decisions). Same rule applies to Section.
 * - URL canonicalization via `canonicalize-url.ts`. Raw forms are
 *   captured in `meta.rawUrls`.
 * - Resolved-locale stored verbatim on `normalized.locale` — locale
 *   correctness is checked by the differ as a field comparison.
 * - Truncation detection via response metadata (`pagination.total >
 *   returned.length`). Length-based heuristics are NOT triggers.
 * - Optional fields normalize to `null` on absence (null /
 *   undefined / missing key all map to null).
 *
 * The input type is hand-defined here at the structural level needed
 * for normalization. The actual gql.tada query (with `pagination:
 * { limit: -1 }` overrides) lives with U6's capture script.
 */

import { canonicalizeUrl } from "./canonicalize-url"
import { strapiTypenameToAdminKind } from "./discriminator-map"
import {
  canonicalizeNestedUrls,
  nullify,
  stripBlockMeta,
} from "./normalize-shared"
import type {
  NormalizedBlock,
  NormalizedExperienceRoute,
  NormalizedMeta,
  NormalizedOgImage,
} from "./shared-shape"

const STRAPI_BLOCK_SKIP_KEYS: ReadonlySet<string> = new Set([
  "__typename",
  "id",
])

// ---------------------------------------------------------------------------
// Input shape — what the parity Strapi query returns at the structural
// level the normalizer consumes. Block components are typed as a
// discriminated union on `__typename` with the open-ended `data` payload.
// ---------------------------------------------------------------------------

export type StrapiOgImage = {
  readonly url: string
  readonly width: number | null
  readonly height: number | null
  readonly alternativeText: string | null
} | null

export type StrapiExperienceInput = {
  readonly documentId: string
  readonly slug: string
  readonly locale: string
  readonly title: string
  readonly metaDescription: string | null | undefined
  readonly ogImage: StrapiOgImage | undefined
  readonly blocks: ReadonlyArray<StrapiBlockInput> | null | undefined
  /** Optional response-meta surface for live-mode truncation detection. */
  readonly _meta?: {
    readonly pagination?: {
      readonly total?: number
      readonly returned?: number
    }
  }
}

export type StrapiBlockInput =
  | StrapiContainerBlock
  | StrapiSectionBlock
  | StrapiGenericBlock

export type StrapiContainerBlock = {
  readonly __typename: "ComponentSectionsContainer"
  readonly id: string
  readonly slots:
    | ReadonlyArray<{
        readonly id: string
        readonly gridSpan: number | null | undefined
        readonly spans: ReadonlyArray<number> | null | undefined
        readonly content: ReadonlyArray<StrapiBlockInput> | null | undefined
      }>
    | null
    | undefined
  readonly [field: string]: unknown
}

export type StrapiSectionBlock = {
  readonly __typename: "ComponentSectionsSection"
  readonly id: string
  readonly content: ReadonlyArray<StrapiBlockInput> | null | undefined
  readonly [field: string]: unknown
}

export type StrapiGenericBlock = {
  readonly __typename: string
  readonly id: string
  readonly [field: string]: unknown
}

export type NormalizeStrapiOptions = {
  /** URL locale the request asked for. Carried into NormalizedMeta context. */
  readonly urlLocale: string
  /** Origin used to resolve Strapi root-relative URLs. */
  readonly baseOrigin: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StrapiNormalizationError extends Error {
  override readonly name = "StrapiNormalizationError"
  readonly missingField: string
  constructor(message: string, missingField: string) {
    super(message)
    this.missingField = missingField
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function normalizeStrapi(
  input: StrapiExperienceInput,
  options: NormalizeStrapiOptions,
): NormalizedExperienceRoute {
  if (!input.documentId) {
    throw new StrapiNormalizationError(
      "normalizeStrapi: required field 'documentId' is missing or empty",
      "documentId",
    )
  }
  if (!input.slug) {
    throw new StrapiNormalizationError(
      "normalizeStrapi: required field 'slug' is missing or empty",
      "slug",
    )
  }
  if (!input.locale) {
    throw new StrapiNormalizationError(
      "normalizeStrapi: required field 'locale' is missing or empty",
      "locale",
    )
  }
  if (typeof input.title !== "string") {
    throw new StrapiNormalizationError(
      "normalizeStrapi: required field 'title' is missing",
      "title",
    )
  }

  const rawUrls: Record<string, string> = {}
  const ogImage = normalizeOgImage(
    input.ogImage ?? null,
    options.baseOrigin,
    rawUrls,
  )

  const flatBlocks = flattenAndNormalizeBlocks(
    input.blocks ?? [],
    options.baseOrigin,
    rawUrls,
  )

  const meta: NormalizedMeta = {
    source: "strapi",
    potentiallyTruncated: detectTruncation(input._meta),
    rawUrls: Object.freeze({ ...rawUrls }),
  }

  return {
    id: input.documentId,
    slug: input.slug,
    locale: input.locale,
    title: input.title,
    description: nullify(input.metaDescription),
    ogImage,
    blocks: Object.freeze(flatBlocks) as ReadonlyArray<NormalizedBlock>,
    meta,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectTruncation(
  responseMeta: StrapiExperienceInput["_meta"],
): boolean {
  const pagination = responseMeta?.pagination
  if (!pagination) return false
  const total = pagination.total
  const returned = pagination.returned
  if (typeof total !== "number" || typeof returned !== "number") return false
  return total > returned
}

function normalizeOgImage(
  raw: StrapiOgImage,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): NormalizedOgImage | null {
  if (raw === null || raw === undefined) return null
  if (!raw.url) return null
  const result = canonicalizeUrl(raw.url, { schema: "strapi", baseOrigin })
  if (result.canonical === null) {
    return {
      url: raw.url,
      width: nullify(raw.width),
      height: nullify(raw.height),
      alt: nullify(raw.alternativeText),
    }
  }
  rawUrls[result.canonical] = result.raw
  return {
    url: result.canonical,
    width: nullify(raw.width),
    height: nullify(raw.height),
    alt: nullify(raw.alternativeText),
  }
}

/**
 * Walk the Strapi blocks array and flatten container.slots[].content[]
 * into the admin-canonical flat shape. Section blocks containing nested
 * content arrays are also flattened the same way.
 */
function flattenAndNormalizeBlocks(
  blocks: ReadonlyArray<StrapiBlockInput>,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): NormalizedBlock[] {
  const out: NormalizedBlock[] = []
  for (const block of blocks) {
    // Discriminator narrowing on a `string`-typed __typename can't
    // exclude StrapiGenericBlock at type level — assert through the
    // runtime check.
    if (block.__typename === "ComponentSectionsContainer") {
      out.push(
        ...flattenContainer(block as StrapiContainerBlock, baseOrigin, rawUrls),
      )
      continue
    }
    if (block.__typename === "ComponentSectionsSection") {
      out.push(
        normalizeSection(block as StrapiSectionBlock, baseOrigin, rawUrls),
      )
      continue
    }
    out.push(normalizeGenericBlock(block, baseOrigin, rawUrls))
  }
  return out
}

function flattenContainer(
  container: StrapiContainerBlock,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): NormalizedBlock[] {
  // Emit the container itself with empty content[]; slot markers and
  // their inner blocks are appended as siblings inside content[].
  const containerContent: NormalizedBlock[] = []
  const slots = container.slots ?? []
  for (const slot of slots) {
    containerContent.push({
      kind: "containerSlot",
      id: slot.id,
      gridSpan: nullify(slot.gridSpan),
      spans: slot.spans ? Object.freeze([...slot.spans]) : null,
    })
    const innerBlocks = slot.content ?? []
    for (const inner of innerBlocks) {
      containerContent.push(normalizeGenericBlock(inner, baseOrigin, rawUrls))
    }
  }
  // Container itself is a normalized block whose `data.content` carries
  // the flattened sequence. The differ walks data.content[] like any
  // other ordered array.
  return [
    {
      kind: "container",
      id: container.id,
      data: {
        content: containerContent,
      },
    },
  ]
}

function normalizeSection(
  section: StrapiSectionBlock,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): NormalizedBlock {
  const innerBlocks = section.content ?? []
  const normalizedInner: NormalizedBlock[] = []
  for (const inner of innerBlocks) {
    normalizedInner.push(normalizeGenericBlock(inner, baseOrigin, rawUrls))
  }
  return {
    kind: "section",
    id: section.id,
    data: {
      content: normalizedInner,
      ...stripBlockMeta(
        section as Record<string, unknown>,
        STRAPI_BLOCK_SKIP_KEYS,
      ),
    },
  }
}

function normalizeGenericBlock(
  block: StrapiGenericBlock | StrapiBlockInput,
  baseOrigin: string,
  rawUrls: Record<string, string>,
): NormalizedBlock {
  const typename = block.__typename
  const mapped = strapiTypenameToAdminKind(typename)
  if (typeof mapped === "object" && mapped.kind === "unknown") {
    return {
      kind: "section", // placeholder routed through structural diff via id+data
      id: block.id ?? "",
      data: {
        _unknownTypename: typename,
      },
    } as NormalizedBlock
  }
  const rest = stripBlockMeta(
    block as Record<string, unknown>,
    STRAPI_BLOCK_SKIP_KEYS,
  )
  const dataWithCanonicalUrls = canonicalizeNestedUrls(
    rest,
    "strapi",
    baseOrigin,
    rawUrls,
  )
  return {
    kind: mapped as Exclude<NormalizedBlock["kind"], "containerSlot">,
    id: block.id,
    data: dataWithCanonicalUrls as Readonly<Record<string, unknown>>,
  }
}
