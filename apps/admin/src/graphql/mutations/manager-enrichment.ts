// `triggerManagerEnrichment` GraphQL mutation (feat-119 PR2).
//
// First admin → manager outbound dispatch in the repo. Until now the
// boundary was read-only-S3 (admin reads manager's
// `{assetId}/scene-analysis.json` + transcript source artifacts). This mutation
// is the deliberate seam where admin asks manager to PRODUCE upstream
// pipeline output for a list of cms videos, typically after an
// operator has reviewed PR1's `missingArtifacts` projection.
//
// Wire shape: parallel `assetIds: [Int!]!` + `coreIds: [String!]!`
// arrays plus a `kind: String!` enum-shaped arg. Pairs are matched
// positionally so `assetIds[i]` corresponds to `coreIds[i]`. This
// keeps the mutation argument list simple — Pothos input-object
// types would force a top-level type definition for a single
// per-mutation shape.
//
// Returns the JSON scalar (consistent with the other trigger
// mutations in this app — `triggerTranscriptEmbeddingBackfill` and
// `triggerExperienceContentDump` — per plan D9).

import { z } from "zod"
import { builder } from "@/graphql/builder"
import {
  triggerManagerEnrichment,
  type ManagerEnrichmentDispatchResult,
  type ManagerEnrichmentKind,
  type ManagerEnrichmentTriggerItem,
} from "@/services/manager-trigger.service"

const KindSchema = z.enum(["scene-analysis", "transcript"])

export class ManagerEnrichmentArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ManagerEnrichmentArgsError"
  }
}

/**
 * Resolver-internal: validate the (assetIds, coreIds, kind) args
 * and pair them positionally into items the service consumes.
 * Throws `ManagerEnrichmentArgsError` on any validation failure;
 * the builder's `validate` arg-schema lifts those into structured
 * GraphQL errors at the boundary.
 *
 * Exported for test access without going through the Pothos schema
 * (fast feedback on argument-pairing edge cases).
 */
export function pairAndValidateArgs(args: {
  assetIds: readonly number[]
  coreIds: readonly string[]
  kind: string
  targetLocales?: readonly string[] | null
}): {
  kind: ManagerEnrichmentKind
  items: ManagerEnrichmentTriggerItem[]
} {
  const kind = KindSchema.safeParse(args.kind)
  if (!kind.success) {
    throw new ManagerEnrichmentArgsError(
      `kind must be one of "scene-analysis" | "transcript"`,
    )
  }
  if (args.assetIds.length === 0) {
    throw new ManagerEnrichmentArgsError("assetIds must not be empty")
  }
  if (args.assetIds.length !== args.coreIds.length) {
    throw new ManagerEnrichmentArgsError(
      `assetIds (${args.assetIds.length}) and coreIds (${args.coreIds.length}) must have the same length`,
    )
  }
  if (args.assetIds.length > 100) {
    throw new ManagerEnrichmentArgsError("max 100 items per call")
  }
  for (const id of args.assetIds) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new ManagerEnrichmentArgsError(
        `assetIds entries must be positive integers (got ${id})`,
      )
    }
  }
  for (const cid of args.coreIds) {
    if (typeof cid !== "string" || cid.length === 0) {
      throw new ManagerEnrichmentArgsError(
        "coreIds entries must be non-empty strings",
      )
    }
  }
  const targetLocales = normalizeTargetLocales(args.targetLocales)
  const expandedCount = args.assetIds.length * (targetLocales?.length ?? 1)
  if (expandedCount > 100) {
    throw new ManagerEnrichmentArgsError("max 100 items per call")
  }
  const baseItems = args.assetIds.map((assetId, idx) => ({
    assetId,
    coreId: args.coreIds[idx]!,
  }))
  const items: ManagerEnrichmentTriggerItem[] = targetLocales
    ? baseItems.flatMap((item) =>
        targetLocales.map((targetLocale) => ({
          ...item,
          targetLocale,
        })),
      )
    : baseItems
  return { kind: kind.data, items }
}

function normalizeTargetLocales(
  targetLocales: readonly string[] | null | undefined,
): string[] | null {
  if (targetLocales == null) return null
  if (targetLocales.length === 0) {
    throw new ManagerEnrichmentArgsError(
      "targetLocales must be omitted or contain at least one locale",
    )
  }
  return targetLocales.map((locale) => {
    const normalized = locale.trim()
    if (normalized.length === 0) {
      throw new ManagerEnrichmentArgsError(
        "targetLocales entries must be non-empty strings",
      )
    }
    return normalized.toLowerCase()
  })
}

/**
 * Dispatch helper exported separately from the resolver so tests
 * can assert dispatch shape without building the Pothos schema.
 * Mirrors the workflow-dispatch helper pattern used by embedding backfills.
 */
export async function dispatchManagerEnrichment(args: {
  assetIds: readonly number[]
  coreIds: readonly string[]
  kind: string
  targetLocales?: readonly string[] | null
}): Promise<ManagerEnrichmentDispatchResult[]> {
  const { items, kind } = pairAndValidateArgs(args)
  return triggerManagerEnrichment(items, kind)
}

builder.mutationFields((t) => ({
  triggerManagerEnrichment: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:manager-enrichment-trigger" },
    description:
      "Dispatch apps/manager's enrichment pipeline (scene-analysis or transcript-only) for a list of cms videos. Forwards to manager's `/api/admin-trigger/{kind}` endpoint and returns one outcome per requested assetId. Operator-driven: typically called after reading the `missingArtifacts` projection emitted by `triggerTranscriptEmbeddingBackfill`. ADMIN-only.",
    args: {
      assetIds: t.arg.intList({
        required: true,
        description:
          "Strapi numeric PKs of the cms videos to enrich. Used by manager as the storage-key prefix when writing produced artifacts. Length must match coreIds.",
      }),
      coreIds: t.arg.stringList({
        required: true,
        description:
          "Per-id Core identifiers, paired positionally with assetIds. Manager filters cms by `coreId` (Strapi v5 GraphQL exposes no numeric-id filter on Video). Length must match assetIds.",
      }),
      kind: t.arg.string({
        required: true,
        description:
          'Enrichment kind. Must be "scene-analysis" or "transcript".',
      }),
      targetLocales: t.arg.stringList({
        required: false,
        description:
          "Optional target locales/languages to run for each requested video. When supplied, Admin expands every asset/core pair across these locales and Manager must resolve matching localized media.",
      }),
    },
    resolve: async (_root, args) => {
      return dispatchManagerEnrichment({
        assetIds: args.assetIds,
        coreIds: args.coreIds,
        kind: args.kind,
        targetLocales: args.targetLocales,
      })
    },
  }),
}))
