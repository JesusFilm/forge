/* eslint-disable max-lines -- pure scoring facets share one tested contract */
/**
 * Pure scoring + reporting logic for the eval harness, extracted from
 * scripts/eval.ts so it can be unit-tested without a DB, network, or env
 * (vitest includes `src/**` + `tests/**`, not `scripts/**`; the test lives in
 * tests/eval-metrics.test.ts and imports this module). eval.ts keeps all the
 * I/O — read the golden file, wire the Retriever, write the results markdown.
 *
 * Model (docs/eval-approach.md): a golden case is a **source-agnostic question**
 * plus a `relevant` map of `{ sourceKey: [doc pathnames] }` — every document,
 * across sources, that legitimately answers it. A hit is correct if it matches
 * ANY relevant `(sourceKey, pathname)` document identity. We report **recall**
 * (any relevant doc in top-k) AND
 * **coverage** (fraction of the relevant set returned), plus **per-source
 * coverage** (when source X has a relevant doc, does an X doc surface?). P@1/MRR
 * are secondary — ranking is the consumer's job (architecture §1). The relevant
 * set is *living*: re-reviewed each slice as sources are added.
 */
import { z } from "zod"

/**
 * How well the OPERATOR could see what they approved — not how good the case is.
 *
 * The multilingual campaign (#111) puts 45 languages in the corpus and no
 * reviewer reads most of them. `docs/eval-approach.md` already answers that:
 * candidates are presented with an English translation of the question AND of
 * the retrieved results, and the operator approves the translation. That flow
 * is sound, but it hides one real difference — for French the operator can spot
 * a bad translation, for Tigrinya they cannot. The approval is equally explicit
 * either way; the *evidence behind it* is not.
 *
 * So the tier records the reviewability of the evidence, and the report keeps
 * the buckets apart so a Tigrinya number is never averaged into a French one.
 * It is deliberately NOT a quality gate: no metric is discounted, nothing is
 * excluded. Operator decision, 2026-08-03 (campaign §7).
 */
export const EVIDENCE_TIERS = ["human-verified", "llm-translated"] as const

export const GoldenCaseSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    // Explicit retrieval language for this case (e.g. "en"). Optional: when
    // absent, caseLanguage() derives it from the relevant sources' registry
    // languages. Set it when derivation is ambiguous (a case whose only
    // relevant source is multilingual, e.g. familylife ["en","es"]).
    language: z.string().optional(),
    // Reviewability of the evidence the operator approved on (see above).
    // ABSENT IS NOT A DEFAULT: the 130 pre-campaign cases carry no tier and are
    // reported under "(untagged)" rather than being retro-labelled, because
    // nobody now can say which of them the reviewer could read unaided.
    evidence_tier: z.enum(EVIDENCE_TIERS).optional(),
    // sourceKey -> canonical-url pathnames. Every doc that legitimately answers
    // the question, grouped by its source (each source listed has >= 1 path).
    relevant: z.record(z.string(), z.array(z.string().min(1)).min(1)),
  })
  .refine((c) => Object.keys(c.relevant).length > 0, {
    message:
      "golden case needs at least one source in `relevant` — a question with no relevant doc always scores as a miss",
  })

export const GoldenFileSchema = z
  .object({ cases: z.array(GoldenCaseSchema) })
  .superRefine(({ cases }, ctx) => {
    const seen = new Set<string>()
    for (const [index, goldenCase] of cases.entries()) {
      if (seen.has(goldenCase.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "id"],
          message: `duplicate golden case id '${goldenCase.id}'`,
        })
      seen.add(goldenCase.id)
    }
  })

export type GoldenCase = z.infer<typeof GoldenCaseSchema>

export interface Hit {
  chunkId: string
  sourceKey: string
  docPath: string
  docUrl: string | null
  score: number
}

export interface CaseResult {
  case: GoldenCase
  hits: Hit[]
  matchedRank: number | null // 1-indexed rank of first hit matching ANY relevant document
  returnedRelevant: RelevantDocument[] // distinct relevant documents in the returned hits
  language: string | null // resolved retrieval language (caseLanguage), null = unscoped
}

export interface RelevantDocument {
  sourceKey: string
  docPath: string
}

export interface Metrics {
  cases: number
  recall_at_3: number
  recall_at_10: number
  coverage: number // mean per-case fraction of the relevant set returned
  mrr: number
  precision_at_1: number
}

export interface SourceCoverage {
  source: string
  cases: number // cases where this source has >= 1 relevant doc
  recall: number // fraction of those cases where >= 1 of its docs was returned
  coverage: number // mean fraction of its relevant docs returned
}

export interface LanguageCoverage {
  language: string // resolved case language, or "(unscoped)" when none was derivable
  cases: number
  recall_at_10: number
  coverage: number
}

export interface TierCoverage {
  tier: string // an EVIDENCE_TIERS value, or "(untagged)" for pre-campaign cases
  cases: number
  recall_at_10: number
  coverage: number
}

/** Pathname of a URL for matching against `relevant`; falls back to the raw string. */
export function safePathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/**
 * The retrieval language for a golden case. The eval must search **the case's
 * source language only** — results in other languages must not push out
 * retrieval of the language being evaluated (docs/eval-approach.md →
 * "Multilingual eval").
 *
 * Resolution: an explicit `language:` on the case wins; otherwise the
 * INTERSECTION of the relevant sources' registry `languages` arrays — a
 * multilingual source (familylife ["en","es"]) narrows to "en" when the case
 * also credits an en-only source. Returns null (no filter, logged by the
 * runner) when the intersection is empty or still ambiguous, or a source is
 * unknown — scoping would silently hide legitimate docs.
 */
export function caseLanguage(
  c: GoldenCase,
  languagesBySource: Record<string, string[]>,
): string | null {
  if (c.language) return c.language
  let common: Set<string> | null = null
  for (const sourceKey of Object.keys(c.relevant)) {
    const sourceLangs = languagesBySource[sourceKey]
    if (!sourceLangs || sourceLangs.length === 0) return null
    common = common
      ? new Set(sourceLangs.filter((l) => common!.has(l)))
      : new Set(sourceLangs)
  }
  return common && common.size === 1 ? [...common][0] : null
}

/**
 * Every relevant `(sourceKey, pathname)` pair, distinct. Source identity is
 * part of the document identity: two sources may legitimately publish the same
 * pathname, and a result from one must never certify retrieval from the other.
 */
export function allRelevantDocuments(c: GoldenCase): RelevantDocument[] {
  return Object.entries(c.relevant).flatMap(([sourceKey, paths]) =>
    [...new Set(paths)].map((docPath) => ({ sourceKey, docPath })),
  )
}

const documentKey = ({ sourceKey, docPath }: RelevantDocument): string =>
  `${sourceKey}\u0000${docPath}`

/** Distinct relevant document identities that appear among the hits. */
export function returnedRelevant(
  hits: Hit[],
  c: GoldenCase,
): RelevantDocument[] {
  const want = new Set(allRelevantDocuments(c).map(documentKey))
  const found = new Set<string>()
  const returned: RelevantDocument[] = []
  for (const hit of hits) {
    const document = { sourceKey: hit.sourceKey, docPath: hit.docPath }
    const key = documentKey(document)
    if (want.has(key) && !found.has(key)) {
      found.add(key)
      returned.push(document)
    }
  }
  return returned
}

/** 1-indexed rank of the first hit matching any relevant document, or null. */
export function firstMatchingRank(hits: Hit[], c: GoldenCase): number | null {
  const want = new Set(allRelevantDocuments(c).map(documentKey))
  for (let i = 0; i < hits.length; i++) {
    if (want.has(documentKey(hits[i]))) return i + 1
  }
  return null
}

/** recall@3 / recall@10 / coverage / MRR / P@1 over a set of case results. */
export function computeMetrics(results: CaseResult[]): Metrics {
  const n = results.length
  let r3 = 0
  let r10 = 0
  let cov = 0
  let mrr = 0
  let p1 = 0
  for (const r of results) {
    if (r.matchedRank !== null) {
      if (r.matchedRank <= 3) r3 += 1
      if (r.matchedRank <= 10) r10 += 1
      mrr += 1 / r.matchedRank
      if (r.matchedRank === 1) p1 += 1
    }
    const total = allRelevantDocuments(r.case).length
    cov += total ? r.returnedRelevant.length / total : 0
  }
  return {
    cases: n,
    recall_at_3: n ? r3 / n : 0,
    recall_at_10: n ? r10 / n : 0,
    coverage: n ? cov / n : 0,
    mrr: n ? mrr / n : 0,
    precision_at_1: n ? p1 / n : 0,
  }
}

/**
 * Per-source coverage: for cases where source X has a relevant doc, how often
 * does an X doc surface (recall) and what fraction of its docs come back
 * (coverage). Derived from the relevant docs' sources — no per-case "owner".
 * The signal for "did adding source X make its content findable, or buried?"
 */
export function coverageBySource(results: CaseResult[]): SourceCoverage[] {
  const sources = new Set<string>()
  for (const r of results) {
    for (const s of Object.keys(r.case.relevant)) sources.add(s)
  }
  return [...sources].sort().map((source) => {
    let cases = 0
    let recallHits = 0
    let covSum = 0
    for (const r of results) {
      const want = r.case.relevant[source]
      if (!want || want.length === 0) continue
      cases += 1
      const returned = new Set(
        r.returnedRelevant
          .filter((document) => document.sourceKey === source)
          .map(({ docPath }) => docPath),
      )
      const got = want.filter((path) => returned.has(path)).length
      if (got > 0) recallHits += 1
      covSum += got / want.length
    }
    return {
      source,
      cases,
      recall: cases ? recallHits / cases : 0,
      coverage: cases ? covSum / cases : 0,
    }
  })
}

/**
 * Per-language coverage, grouped by each case's RESOLVED retrieval language
 * (`CaseResult.language`, from caseLanguage()).
 *
 * Until ADR-0006 every non-English source was its own key (thelife-fr, thelife-zh),
 * so `--source <key>` doubled as the per-language view. ADR-0006 ("one domain =
 * one source") ended that: `cru` is a single key carrying en + es + fr, so a
 * per-source number now BLENDS its languages and can hide an unhealthy one. This
 * view is the per-source view's analogue — same derive-from-the-data principle,
 * grouped by language instead of source key.
 *
 * A case with no derivable language (searched unscoped) is grouped under
 * "(unscoped)" rather than dropped — silently omitting it would hide the very
 * misconfiguration the warning exists to surface.
 */
export function coverageByLanguage(results: CaseResult[]): LanguageCoverage[] {
  const byLanguage = new Map<string, CaseResult[]>()
  for (const r of results) {
    const key = r.language ?? "(unscoped)"
    const bucket = byLanguage.get(key)
    if (bucket) bucket.push(r)
    else byLanguage.set(key, [r])
  }
  return [...byLanguage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, rs]) => {
      const m = computeMetrics(rs)
      return {
        language,
        cases: m.cases,
        recall_at_10: m.recall_at_10,
        coverage: m.coverage,
      }
    })
}

/**
 * Per-evidence-tier coverage — the same shape as coverageByLanguage(), grouped
 * by how reviewable the operator's evidence was rather than by language.
 *
 * Why it exists: a whole-corpus mean silently blends cases the operator could
 * verify with cases they took on a machine translation's word. Reading them
 * apart is the entire point of the tier; a blended headline would defeat it.
 * "(untagged)" is a real bucket, not a gap to fill — see EVIDENCE_TIERS.
 */
export function coverageByTier(results: CaseResult[]): TierCoverage[] {
  const byTier = new Map<string, CaseResult[]>()
  for (const r of results) {
    const key = r.case.evidence_tier ?? "(untagged)"
    const bucket = byTier.get(key)
    if (bucket) bucket.push(r)
    else byTier.set(key, [r])
  }
  return [...byTier.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tier, rs]) => {
      const m = computeMetrics(rs)
      return {
        tier,
        cases: m.cases,
        recall_at_10: m.recall_at_10,
        coverage: m.coverage,
      }
    })
}

function escape(s: string): string {
  return s.replace(/[\\|]/g, "\\$&")
}

export interface RenderInput {
  modelId: string
  topK: number
  scope: string | null // source key for a scoped run, null for whole-corpus
  results: CaseResult[]
  metrics: Metrics
  perSource: SourceCoverage[]
  perLanguage: LanguageCoverage[]
  perTier: TierCoverage[]
}

/**
 * Markdown report: header + metrics + per-source coverage + per-language coverage
 * + per-case table.
 */
export function renderMarkdown(input: RenderInput): string {
  const {
    modelId,
    topK,
    scope,
    results,
    metrics,
    perSource,
    perLanguage,
    perTier,
  } = input

  const caseRows = results.map((r) => {
    const tick = r.matchedRank !== null ? "✓" : "✗"
    const total = allRelevantDocuments(r.case).length
    const top = r.hits[0]
    const topInfo = top ? `\`${top.docPath}\` (${top.score.toFixed(3)})` : "—"
    return `| ${tick} | \`${r.case.id}\` | ${escape(r.case.question)} | ${r.matchedRank ?? "miss"} | ${r.returnedRelevant.length}/${total} | ${topInfo} |`
  })

  const perSourceRows = perSource.map(
    (s) =>
      `| \`${s.source}\` | ${s.cases} | ${s.recall.toFixed(3)} | ${s.coverage.toFixed(3)} |`,
  )

  const perLanguageRows = perLanguage.map(
    (l) =>
      `| \`${l.language}\` | ${l.cases} | ${l.recall_at_10.toFixed(3)} | ${l.coverage.toFixed(3)} |`,
  )

  const perTierRows = perTier.map(
    (t) =>
      `| \`${t.tier}\` | ${t.cases} | ${t.recall_at_10.toFixed(3)} | ${t.coverage.toFixed(3)} |`,
  )

  return [
    `# Eval results — ${new Date().toISOString()}`,
    "",
    `**Model:** \`${modelId}\``,
    `**Top-k:** ${topK}`,
    `**Scope:** ${scope ? `\`${scope}\` (cases whose relevant set includes it; whole-corpus retrieval)` : "whole-corpus"}`,
    `**Cases:** ${metrics.cases}`,
    "",
    "## Metrics",
    "",
    "_recall + coverage lead; P@1/MRR secondary — see docs/eval-approach.md._",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| recall@3 | ${metrics.recall_at_3.toFixed(3)} |`,
    `| recall@10 | ${metrics.recall_at_10.toFixed(3)} |`,
    `| coverage | ${metrics.coverage.toFixed(3)} |`,
    `| MRR | ${metrics.mrr.toFixed(3)} |`,
    `| precision@1 | ${metrics.precision_at_1.toFixed(3)} |`,
    "",
    "## Per-source coverage",
    "",
    "(cases where the source has a relevant doc — recall = any of its docs returned; coverage = mean fraction returned)",
    "",
    "| source | cases | recall | coverage |",
    "|--------|------:|-------:|---------:|",
    ...perSourceRows,
    "",
    "## Per-language coverage",
    "",
    "(grouped by each case's resolved retrieval language. A multi-language source",
    "like `cru` blends its languages in the per-source view above — this splits them.",
    "`(unscoped)` means no language was derivable: the case searched the whole",
    "multilingual corpus, which is a case-configuration bug, not a result.)",
    "",
    "| language | cases | recall@10 | coverage |",
    "|----------|------:|----------:|---------:|",
    ...perLanguageRows,
    "",
    "## Per-evidence-tier coverage",
    "",
    "(how reviewable the OPERATOR's evidence was — not how good the case is.",
    "`human-verified` = approved on content a reviewer could read or check;",
    "`llm-translated` = approved on a machine translation nobody available can",
    "verify. `(untagged)` = authored before the tier existed. Kept apart so a",
    "machine-translated language's number is never averaged into a checked one.)",
    "",
    "| tier | cases | recall@10 | coverage |",
    "|------|------:|----------:|---------:|",
    ...perTierRows,
    "",
    "## Per-case",
    "",
    "| | id | question | first rank | coverage | top hit |",
    "|---|----|----------|-----------|----------|---------|",
    ...caseRows,
    "",
  ].join("\n")
}
