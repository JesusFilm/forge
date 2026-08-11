import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { getSeoConfig } from "../../config/seo"
import {
  minimizeSeoText,
  minimizeSeoUrl,
} from "../../services/seo-data-minimization"
import {
  digestSeoProposalPayload,
  digestSeoValue,
} from "../../services/seo-digest"
import { SeoEvidenceObservationSchema } from "../../services/seo-evidence"

export const SeoTargetSchema = z
  .object({
    targetId: z.string().min(1).max(200),
    targetType: z.enum(["watch", "experience"]),
    canonicalUrl: z.string().url(),
    locale: z.string().min(1).max(35),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/u),
    canonicalIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    preChangeSnapshot: z
      .object({ v: z.literal(1), data: z.record(z.string(), z.unknown()) })
      .strict(),
    supportedFields: z.array(z.string().max(191)).max(100),
    currentSnapshot: z
      .object({
        title: z.string().max(500).nullable(),
        description: z.string().max(2_000).nullable(),
        headings: z.array(z.string().max(500)).max(20).default([]),
      })
      .strict(),
  })
  .strict()

const CommonProposalSchema = z.object({
  proposalId: z.string().min(1).max(200),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  semanticConflictKey: z.string().min(1).max(500),
  canonicalUrl: z.string().url(),
  locale: z.string().max(35),
  targetId: z.string().max(200),
  targetType: z.enum(["watch", "experience"]),
  query: z.string().max(500),
  intent: z.string().max(1_000),
  persona: z.string().max(500),
  evidenceObservationIds: z.array(z.string()).min(1).max(50),
  caveats: z.array(z.string().max(500)).max(20),
  expectedOutcome: z.string().max(1_000),
  risk: z.string().max(1_000),
  verificationPlan: z.array(z.string().max(1_000)).min(1).max(20),
  baseHash: z.string().max(200),
  canonicalIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  preChangeSnapshot: z
    .object({ v: z.literal(1), data: z.record(z.string(), z.unknown()) })
    .strict(),
})

const EditorialProposalSchema = CommonProposalSchema.extend({
  lane: z.literal("editorial"),
  fieldDiff: z
    .array(
      z
        .object({
          field: z.enum([
            "title",
            "description",
            "headings",
            "pageCopy",
            "topics",
            "internalLinks",
            "pageStructure",
          ]),
          before: z.unknown(),
          after: z.unknown(),
        })
        .strict(),
    )
    .min(1)
    .max(20),
  rollbackSnapshot: z.record(z.string(), z.unknown()),
})

const EngineeringProposalSchema = CommonProposalSchema.extend({
  lane: z.literal("engineering"),
  ticketBrief: z
    .object({
      title: z.string().max(500),
      description: z.string().max(5_000),
      acceptanceCriteria: z.array(z.string().max(1_000)).min(1).max(20),
      affectedScope: z.array(z.string().max(500)).min(1).max(20),
    })
    .strict(),
  ticketOnly: z.boolean(),
  deploymentProbe: z
    .object({
      type: z.enum([
        "page_text_hash",
        "structured_data_path",
        "response_header",
        "performance_budget",
      ]),
      canonicalUrl: z.string().url(),
      expectedValue: z.string().max(1_000),
      canonicalizationVersion: z.string().max(100),
      timeoutMs: z.number().int().min(1_000).max(30_000),
      headerName: z
        .string()
        .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
        .max(191)
        .optional(),
    })
    .strict()
    .nullable(),
})

export const SeoProposalSchema = z.discriminatedUnion("lane", [
  EditorialProposalSchema.strict(),
  EngineeringProposalSchema.strict(),
])
export type SeoProposal = z.infer<typeof SeoProposalSchema>
export type SeoTarget = z.infer<typeof SeoTargetSchema>

const StructuralFindingSchema = z
  .object({
    targetId: z.string().max(200),
    kind: z.enum([
      "canonical",
      "structured_data",
      "rendering",
      "performance",
      "hierarchy",
    ]),
    summary: z.string().max(1_000),
    evidenceObservationId: z.string().max(200),
    probe: EngineeringProposalSchema.shape.deploymentProbe.optional(),
  })
  .strict()

const AnalyzeInputSchema = z
  .object({
    targets: z.array(SeoTargetSchema).max(10_000),
    observations: z.array(SeoEvidenceObservationSchema).max(20_000),
    structuralFindings: z.array(StructuralFindingSchema).max(100).default([]),
    maxProposals: z.number().int().min(1).max(50).optional(),
  })
  .strict()

const AnalyzeOutputSchema = z
  .object({
    proposals: z.array(SeoProposalSchema).max(50),
    coverage: z
      .object({
        targetCount: z.number().int().nonnegative(),
        observedTargetCount: z.number().int().nonnegative(),
        gscRowCount: z.number().int().nonnegative(),
        skippedTargetIds: z.array(z.string()),
      })
      .strict(),
  })
  .strict()

type GscCandidate = {
  observationId: string
  target: SeoTarget
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  score: number
  caveats: string[]
}

function canonical(value: string): string | null {
  const minimized = minimizeSeoUrl(value)
  return minimized ? minimized.replace(/\/$/u, "") : null
}

function gscCandidates(
  targets: SeoTarget[],
  observations: z.infer<typeof SeoEvidenceObservationSchema>[],
): GscCandidate[] {
  const targetByUrl = new Map(
    targets.map((target) => [canonical(target.canonicalUrl), target]),
  )
  const candidates: GscCandidate[] = []
  for (const observation of observations) {
    if (observation.provider !== "gsc") continue
    const dimensions = Array.isArray(observation.data.dimensions)
      ? observation.data.dimensions.filter(
          (item): item is string => typeof item === "string",
        )
      : []
    const rows = Array.isArray(observation.data.rows)
      ? observation.data.rows
      : []
    const pageIndex = dimensions.indexOf("page")
    const queryIndex = dimensions.indexOf("query")
    if (pageIndex < 0 || queryIndex < 0) continue
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue
      const record = row as Record<string, unknown>
      const keys = Array.isArray(record.keys) ? record.keys : []
      const page = keys[pageIndex]
      const query = keys[queryIndex]
      const impressions = Number(record.impressions)
      const clicks = Number(record.clicks)
      const ctr = Number(record.ctr)
      const position = Number(record.position)
      if (
        typeof page !== "string" ||
        typeof query !== "string" ||
        ![impressions, clicks, ctr, position].every(Number.isFinite)
      ) {
        continue
      }
      const target = targetByUrl.get(canonical(page))
      if (!target || impressions < 10 || ctr >= 0.2) continue
      candidates.push({
        observationId: observation.id,
        target,
        query: minimizeSeoText(query, 500),
        impressions,
        clicks,
        ctr,
        position,
        score:
          Math.log1p(impressions) *
          Math.max(0, 0.2 - ctr) *
          (1 + Math.min(position, 50) / 50),
        caveats: observation.quality.caveats,
      })
    }
  }
  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.impressions - a.impressions ||
      a.query.localeCompare(b.query),
  )
}

function editorialProposal(candidate: GscCandidate): SeoProposal {
  const currentTitle = candidate.target.currentSnapshot.title ?? ""
  const queryTitle = candidate.query
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
  const afterTitle = minimizeSeoText(
    currentTitle.toLowerCase().includes(candidate.query.toLowerCase())
      ? currentTitle
      : `${currentTitle} — ${queryTitle}`,
    120,
  )
  const draft = {
    lane: "editorial" as const,
    canonicalUrl: candidate.target.canonicalUrl,
    locale: candidate.target.locale,
    targetId: candidate.target.targetId,
    targetType: candidate.target.targetType,
    query: candidate.query,
    intent: `Improve the canonical result's relevance and click clarity for the observed query “${candidate.query}”.`,
    persona:
      "A searcher whose query intent is already observed in Search Console.",
    evidenceObservationIds: [candidate.observationId],
    caveats: candidate.caveats,
    expectedOutcome:
      "Improve qualified organic click-through without changing the canonical identity or publish state.",
    risk: "The expanded title may be redundant or truncate in search results; an editor must review language quality and tone.",
    verificationPlan: [
      "Publish only through the existing Admin editorial flow after human review.",
      "Wait for objective production title/hash activation before starting measurement.",
      "Compare matched final Search Console windows; treat absent rows as unobserved.",
    ],
    baseHash: candidate.target.baseHash,
    canonicalIdentityDigest: candidate.target.canonicalIdentityDigest,
    preChangeSnapshot: candidate.target.preChangeSnapshot,
    fieldDiff: [
      { field: "title" as const, before: currentTitle, after: afterTitle },
    ],
    rollbackSnapshot: candidate.target.preChangeSnapshot,
  }
  const semanticConflictKey = `${candidate.target.targetId}:${candidate.target.locale}:editorial:title`
  const payloadDigest = digestSeoProposalPayload(draft)
  return {
    ...draft,
    proposalId: `seo-${digestSeoValue(semanticConflictKey).slice(0, 24)}`,
    payloadDigest,
    semanticConflictKey,
  }
}

function engineeringProposal(
  target: SeoTarget,
  finding: z.infer<typeof StructuralFindingSchema>,
): SeoProposal {
  const ticketOnly = finding.probe == null
  const draft = {
    lane: "engineering" as const,
    canonicalUrl: target.canonicalUrl,
    locale: target.locale,
    targetId: target.targetId,
    targetType: target.targetType,
    query: "structural SEO",
    intent: finding.summary,
    persona: "Search crawlers and people landing on the canonical page.",
    evidenceObservationIds: [finding.evidenceObservationId],
    caveats: [
      "This is page-state evidence, not Google indexing proof.",
      ...(ticketOnly
        ? [
            "No objective deployment probe is available; the proposal is ticket-only and cannot activate an experiment.",
          ]
        : []),
    ],
    expectedOutcome:
      "Make the canonical page contract observable and technically consistent.",
    risk: "A shared-template change may affect other locales or canonical pages and needs normal engineering review.",
    verificationPlan: ticketOnly
      ? [
          "Validate the behavior in the engineering ticket before making it experiment-eligible.",
        ]
      : [
          "Run the immutable server-validated deployment probe against the allowlisted canonical.",
        ],
    baseHash: target.baseHash,
    canonicalIdentityDigest: target.canonicalIdentityDigest,
    preChangeSnapshot: target.preChangeSnapshot,
    ticketBrief: {
      title: minimizeSeoText(`SEO: ${finding.summary}`, 500),
      description: minimizeSeoText(finding.summary, 5_000),
      acceptanceCriteria: [
        "Preserve canonical and locale identity.",
        "Add or update focused regression coverage for the affected route/template contract.",
        "Provide objective production verification without claiming Search Console processing.",
      ],
      affectedScope: [finding.kind, target.targetType, target.canonicalUrl],
    },
    ticketOnly,
    deploymentProbe: finding.probe ?? null,
  }
  const semanticConflictKey = `${target.targetId}:${target.locale}:engineering:${finding.kind}`
  const payloadDigest = digestSeoProposalPayload(draft)
  return {
    ...draft,
    proposalId: `seo-${digestSeoValue(semanticConflictKey).slice(0, 24)}`,
    payloadDigest,
    semanticConflictKey,
  }
}

export function analyzeSeoEvidence(
  rawInput: z.input<typeof AnalyzeInputSchema>,
): z.infer<typeof AnalyzeOutputSchema> {
  const input = AnalyzeInputSchema.parse(rawInput)
  const maxProposals = input.maxProposals ?? getSeoConfig().maxProposals
  const observed = new Set<string>()
  const proposals: SeoProposal[] = []
  const candidates = gscCandidates(input.targets, input.observations)
  for (const candidate of candidates) {
    if (proposals.length >= maxProposals) break
    observed.add(candidate.target.targetId)
    proposals.push(editorialProposal(candidate))
  }
  const targetById = new Map(
    input.targets.map((target) => [target.targetId, target]),
  )
  for (const finding of input.structuralFindings) {
    if (proposals.length >= maxProposals) break
    const target = targetById.get(finding.targetId)
    if (!target) continue
    observed.add(target.targetId)
    proposals.push(engineeringProposal(target, finding))
  }
  const gscRowCount = input.observations
    .filter((item) => item.provider === "gsc")
    .reduce(
      (total, item) =>
        total + (Array.isArray(item.data.rows) ? item.data.rows.length : 0),
      0,
    )
  return AnalyzeOutputSchema.parse({
    proposals,
    coverage: {
      targetCount: input.targets.length,
      observedTargetCount: observed.size,
      gscRowCount,
      skippedTargetIds: input.targets
        .filter((target) => !observed.has(target.targetId))
        .map((target) => target.targetId),
    },
  })
}

export const seoAnalysisTool = createTool({
  id: "seoAnalyzeEvidence",
  description:
    "Deterministically rank retained SEO evidence into exact, bounded proposal candidates. It abstains without Search Console or explicit structural evidence and never writes state.",
  inputSchema: AnalyzeInputSchema,
  outputSchema: AnalyzeOutputSchema,
  execute: async (input) => analyzeSeoEvidence(input),
})
