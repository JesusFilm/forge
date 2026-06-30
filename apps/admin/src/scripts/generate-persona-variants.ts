/**
 * Operator script: generate persona-tailored experience variants for one topic.
 *
 *   CI=true DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
 *     pnpm --filter @forge/admin exec tsx src/scripts/generate-persona-variants.ts \
 *       --topic "Easter" --persona grieving --persona family --persona seeker-skeptic
 *
 * Loads video candidates once, fans out one `/forge-experience-variant` call per
 * persona under bounded concurrency, runs each result through the same block
 * gate the editor uses (`normalizeExperienceDraft`, R11), and stages each as a
 * DRAFT experience (slug `<topic>-<persona>`) for review in the dashboard. One
 * persona's failure never drops the others. Auto-routing, grouping, and the
 * editor UI are Phase B.
 *
 * Safety: refuses production-like DATABASE_URL hosts.
 */

import pLimit from "p-limit"

import type { PrismaClient } from "@prisma/client"
import type { DraftExperience, VideoCandidate } from "@forge/experience-schema"

import type { Principal } from "@/auth/principal"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
  type NormalizedExperienceDraft,
} from "@/services/experience-ai/experience-ai-normalize"
import { loadExperienceAiVideoCandidates } from "@/services/experience-ai/experience-ai.service"
import {
  launchMastraExperienceVariant,
  type MastraExperienceVariantLaunchResult,
} from "@/services/experience-ai/mastra-experience-variant-client"

// ---------------------------------------------------------------------------
// Prod-URL guard (fail-closed) — exported for tests
// ---------------------------------------------------------------------------

const PROD_DENY = new Set([
  "admin.jesusfilm.org",
  "www.jesusfilm.org",
  "jesusfilm.org",
  "manager.jesusfilm.org",
  "web.jesusfilm.org",
])

export function assertNotProdUrl(raw: string | undefined): void {
  if (!raw) throw new Error("DATABASE_URL is required")
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    throw new Error("DATABASE_URL is not a parseable URL")
  }
  if (
    host.endsWith(".railway.app") ||
    host.endsWith(".jesusfilm.org") ||
    PROD_DENY.has(host)
  ) {
    throw new Error(`Refusing to run against production-like host: ${host}`)
  }
}

/** Slug for a persona variant of a topic, e.g. ("Easter","grieving") → easter-grieving. */
export function variantSlug(topic: string, personaId: string): string {
  const base = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${base || "experience"}-${personaId}`
}

// ---------------------------------------------------------------------------
// Injectable core — fan-out + R11 gate (DB- and network-free; unit-testable)
// ---------------------------------------------------------------------------

export type VariantOutcome =
  | {
      personaId: string
      status: "succeeded"
      slug: string
      experienceId: string
      localeId: string
    }
  | { personaId: string; status: "failed"; reason: string }

export type RunPersonaVariantsArgs = {
  topic: string
  locale: string
  personaIds: readonly string[]
  concurrency: number
}

export type RunPersonaVariantsDeps = {
  candidates: readonly VideoCandidate[]
  launchVariant: (input: {
    topic: string
    locale: string
    personaId: string
    candidates: readonly VideoCandidate[]
  }) => Promise<MastraExperienceVariantLaunchResult>
  /** Wraps `normalizeExperienceDraft(draft, candidates)` (the R11 gate). */
  normalize: (draft: DraftExperience) => NormalizedExperienceDraft
  /** Persists one staged DRAFT experience; returns its ids. */
  persist: (args: {
    slug: string
    title: string
    metaDescription: string
    blocks: NormalizedExperienceDraft["blocks"]
    locale: string
  }) => Promise<{ experienceId: string; localeId: string }>
}

export async function runPersonaVariants(
  args: RunPersonaVariantsArgs,
  deps: RunPersonaVariantsDeps,
): Promise<{ outcomes: VariantOutcome[]; observedMaxInFlight: number }> {
  const limit = pLimit(Math.max(1, args.concurrency))
  let inFlight = 0
  let observedMaxInFlight = 0

  const settled = await Promise.allSettled(
    args.personaIds.map((personaId) =>
      limit(async (): Promise<VariantOutcome> => {
        inFlight += 1
        observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
        try {
          const launched = await deps.launchVariant({
            topic: args.topic,
            locale: args.locale,
            personaId,
            candidates: deps.candidates,
          })
          if (!launched.ok) {
            return { personaId, status: "failed", reason: launched.reason }
          }

          let normalized: NormalizedExperienceDraft
          try {
            normalized = deps.normalize(launched.draft)
          } catch (error) {
            return {
              personaId,
              status: "failed",
              reason:
                error instanceof ExperienceAiNormalizationError
                  ? error.code
                  : "normalize_failed",
            }
          }

          try {
            const { experienceId, localeId } = await deps.persist({
              slug: variantSlug(args.topic, personaId),
              title: normalized.title,
              metaDescription: normalized.metaDescription,
              blocks: normalized.blocks,
              locale: args.locale,
            })
            return {
              personaId,
              status: "succeeded",
              slug: variantSlug(args.topic, personaId),
              experienceId,
              localeId,
            }
          } catch {
            return { personaId, status: "failed", reason: "persist_failed" }
          }
        } finally {
          inFlight -= 1
        }
      }),
    ),
  )

  // Every thunk returns a VariantOutcome and never throws, so all settle
  // fulfilled; the defensive map keeps the contract explicit.
  const outcomes = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : ({
          personaId: args.personaIds[i] ?? "?",
          status: "failed",
          reason: "unexpected_rejection",
        } satisfies VariantOutcome),
  )
  return { outcomes, observedMaxInFlight }
}

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): RunPersonaVariantsArgs {
  let topic = ""
  let locale = "en"
  let concurrency = 3
  const personaIds: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === "--topic" && value) {
      topic = value
      i += 1
    } else if (flag === "--persona" && value) {
      personaIds.push(value)
      i += 1
    } else if (flag === "--locale" && value) {
      locale = value
      i += 1
    } else if (flag === "--concurrency" && value) {
      concurrency = Number(value) || concurrency
      i += 1
    }
  }
  if (!topic) throw new Error("--topic is required")
  if (personaIds.length === 0)
    throw new Error("at least one --persona is required")
  return { topic, locale, personaIds, concurrency }
}

/**
 * Bounded retry around one variant launch. The route marks `generation_failed`
 * and transport hiccups `retryable: true`, and the generator is
 * non-deterministic — a fresh attempt frequently produces a conformant draft
 * where the prior one slipped a schema violation. Retries only while the result
 * is `retryable`; fail-fast reasons (`config_missing`, `auth_failed`,
 * `invalid_input`) return on the first attempt. Override the cap with
 * `VARIANT_GENERATION_ATTEMPTS` (default 3).
 */
async function launchVariantWithRetry(
  input: Parameters<typeof launchMastraExperienceVariant>[0],
  attempts: number,
): Promise<MastraExperienceVariantLaunchResult> {
  let result = await launchMastraExperienceVariant(input)
  for (
    let attempt = 2;
    attempt <= attempts && !result.ok && result.retryable;
    attempt += 1
  ) {
    process.stdout.write(
      `  … retry ${attempt - 1}/${attempts - 1} for ${input.personaId} (was ${result.reason})\n`,
    )
    result = await launchMastraExperienceVariant(input)
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  assertNotProdUrl(process.env.DATABASE_URL)
  const generationAttempts = Math.max(
    1,
    Number(process.env.VARIANT_GENERATION_ATTEMPTS) || 3,
  )

  const { prisma } = await import("@/db/client")
  const { ExperienceService } = await import("@/services/experience.service")
  const admin: Principal = { id: null, role: "ADMIN" }
  const service = new ExperienceService(prisma)

  try {
    const candidates = await loadExperienceAiVideoCandidates(
      prisma as PrismaClient,
      { locale: args.locale, prompt: args.topic },
    )
    process.stdout.write(
      `Loaded ${candidates.length} candidate(s) for "${args.topic}"; generating ${args.personaIds.length} variant(s)\n`,
    )

    const { outcomes, observedMaxInFlight } = await runPersonaVariants(args, {
      candidates,
      launchVariant: (input) =>
        launchVariantWithRetry(input, generationAttempts),
      normalize: (draft) => normalizeExperienceDraft(draft, [...candidates]),
      persist: async ({ slug, title, metaDescription, blocks, locale }) => {
        // Idempotent: drop a prior staged variant with the same slug.
        const prior = await prisma.experienceLocale.findMany({
          where: { slug },
          select: { experienceId: true },
        })
        const priorIds = [...new Set(prior.map((p) => p.experienceId))]
        if (priorIds.length) {
          await prisma.experience.deleteMany({
            where: { id: { in: priorIds } },
          })
        }
        const created = await service.create({
          input: { locale, slug, title, blocks },
          user: admin,
        })
        const localeId = created.locales[0]!.id
        if (metaDescription) {
          await service.updateLocale({
            input: { id: localeId, metaDescription },
            user: admin,
          })
        }
        return { experienceId: created.id, localeId }
      },
    })

    const succeeded = outcomes.filter((o) => o.status === "succeeded")
    const failed = outcomes.filter((o) => o.status === "failed")
    process.stdout.write(
      `\nDone — ${succeeded.length} staged, ${failed.length} failed (max in-flight ${observedMaxInFlight}).\n`,
    )
    for (const o of outcomes) {
      if (o.status === "succeeded") {
        process.stdout.write(
          `  ✓ ${o.personaId}  http://localhost:3000/watch/${o.slug}.html/english.html\n`,
        )
      } else {
        process.stdout.write(`  ✗ ${o.personaId}  ${o.reason}\n`)
      }
    }
    process.stdout.write(
      "\nReview the staged DRAFT experiences in the dashboard, then publish the ones you want.\n",
    )
  } finally {
    await prisma.$disconnect()
  }
}

const isDirect =
  typeof process !== "undefined" &&
  !!process.argv[1] &&
  process.argv[1].endsWith("generate-persona-variants.ts")

if (isDirect) {
  main().catch((err) => {
    process.stderr.write(
      `[generate-persona-variants] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(1)
  })
}
