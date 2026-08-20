import { randomUUID } from "node:crypto"
import { isIP } from "node:net"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { Pool } from "pg"
import { z } from "zod"

import {
  getSupportResearchConfig,
  type SupportResearchConfig,
} from "../../config/env"
import {
  analyzeSupportConversation,
  observationFingerprint,
  type SupportAnalyzer,
} from "../../services/support-research/analyze-support-conversation"
import { decideSupportAction } from "../../services/support-research/action-policy"
import {
  buildDailySummaryAction,
  buildSupportRunReport,
} from "../../services/support-research/daily-report"
import {
  HelpScoutClient,
  MAX_HELP_SCOUT_MAILBOXES,
} from "../../services/support-research/help-scout-client"
import {
  ingestSupportConversations,
  type SupportSourceClient,
} from "../../services/support-research/ingest-support-conversations"
import { LinearClient } from "../../services/support-research/linear-client"
import {
  dispatchDueSupportActions,
  type LinearActionClient,
} from "../../services/support-research/linear-dispatcher"
import {
  PostgresSupportResearchRepository,
  type SupportResearchRepository,
} from "../../services/support-research/repository"
import {
  getSupportResearchDatabaseReadiness,
  type SupportResearchDatabaseReadiness,
} from "../../services/support-research/database-readiness"
import {
  emptySupportRunCounters,
  supportRunReportSchema,
  type StoredSupportObservation,
  type SupportRunReport,
} from "../../services/support-research/schema"
import { validateWatchReport } from "../../services/support-research/watch-validator"

const OVERLAP_MS = 5 * 60_000
const LEASE_MS = 30 * 60_000

export const DailySupportResearchInputSchema = z
  .object({
    dryRun: z.boolean().default(false),
    maxConversations: z.number().int().positive().max(1_000).optional(),
    idempotencyKey: z.string().min(1).max(120).optional(),
  })
  .strict()

export type DailySupportResearchInput = z.infer<
  typeof DailySupportResearchInputSchema
>

export type DailySupportResearchDependencies = {
  config: SupportResearchConfig
  repository: SupportResearchRepository
  helpScout: SupportSourceClient
  linear: LinearActionClient
  analyzer: SupportAnalyzer
  validate?: typeof validateWatchReport
  now?: () => Date
  randomId?: () => string
  databaseReadiness?: () => Promise<SupportResearchDatabaseReadiness>
}

export type SupportResearchReadiness =
  | { ready: true }
  | { ready: false; reasons: string[] }

function expectedUrl(
  value: string,
  hostname: string,
  pathname: string,
): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.hostname === hostname &&
      url.pathname === pathname &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

function expectedPublicHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase()
  return (
    hostname === value &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(hostname) &&
    !hostname.includes("..") &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local") &&
    !hostname.endsWith(".internal") &&
    isIP(hostname) === 0
  )
}

export function getSupportResearchReadiness(
  config: SupportResearchConfig,
  dryRun: boolean,
): SupportResearchReadiness {
  const reasons: string[] = []
  if (!config.enabled) reasons.push("feature_disabled")
  if (!config.providerApproved) reasons.push("model_provider_not_approved")
  if (!config.helpScout.clientId) reasons.push("help_scout_client_id_missing")
  if (!config.helpScout.clientSecret)
    reasons.push("help_scout_client_secret_missing")
  if (config.helpScout.mailboxIds.length === 0) {
    reasons.push("help_scout_mailboxes_missing")
  } else if (config.helpScout.mailboxIds.length > MAX_HELP_SCOUT_MAILBOXES) {
    reasons.push("help_scout_mailbox_limit_exceeded")
  }
  if (
    !expectedUrl(config.helpScout.apiUrl, "api.helpscout.net", "/v2") ||
    !expectedUrl(
      config.helpScout.authUrl,
      "api.helpscout.net",
      "/v2/oauth2/token",
    )
  ) {
    reasons.push("help_scout_url_not_allowed")
  }
  if (config.allowedWatchHosts.length === 0) reasons.push("watch_hosts_missing")
  else if (!config.allowedWatchHosts.every(expectedPublicHostname)) {
    reasons.push("watch_hosts_invalid")
  }
  if (config.retentionDays < config.improvementWindowDays) {
    reasons.push("retention_window_too_short")
  }

  if (!dryRun) {
    if (!config.linear.apiKey) reasons.push("linear_api_key_missing")
    if (!config.linear.teamId) reasons.push("linear_team_id_missing")
    if (!config.linear.projectId) reasons.push("linear_project_id_missing")
    if (!config.linear.confirmedBugLabelId) {
      reasons.push("linear_confirmed_bug_label_missing")
    }
    if (!config.linear.needsValidationLabelId) {
      reasons.push("linear_needs_validation_label_missing")
    }
    if (!config.linear.uxLabelId) reasons.push("linear_ux_label_missing")
    if (!expectedUrl(config.linear.apiUrl, "api.linear.app", "/graphql")) {
      reasons.push("linear_url_not_allowed")
    }
  }
  return reasons.length === 0 ? { ready: true } : { ready: false, reasons }
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function failedObservation(
  source: StoredSupportObservation["source"],
  reason: string,
  analyzedAt: Date,
): StoredSupportObservation {
  const analysis = {
    relevant: false,
    kind: "other" as const,
    surface: "other_public_watch" as const,
    title: "Support conversation analysis unavailable",
    summary:
      "The sanitized source was preserved, but structured analysis failed.",
    reportedEvidence: [],
    themeKey: "analysis-unavailable",
    confidence: 0,
    actionability: 0,
    validationRecommended: false,
    validationTarget: "none" as const,
    inference: `Analysis failed with safe reason: ${reason}`.slice(0, 500),
  }
  return {
    source,
    analysis,
    validation: {
      state: "blocked",
      evidence: [],
      missingProof: "No classification was available for validation.",
      errorCode: reason.slice(0, 80),
    },
    fingerprint: observationFingerprint(analysis),
    analyzedAt: analyzedAt.toISOString(),
  }
}

async function purgeSupportResearchRetention(input: {
  dependencies: DailySupportResearchDependencies
  config: SupportResearchConfig
  now: Date
  counters: ReturnType<typeof emptySupportRunCounters>
  errors: string[]
}): Promise<void> {
  try {
    await input.dependencies.repository.purgeExpired(
      input.now,
      new Date(
        input.now.getTime() - input.config.retentionDays * 24 * 60 * 60_000,
      ),
    )
  } catch {
    input.counters.failures += 1
    input.errors.push("retention:purge_failed")
  }
}

export async function executeDailySupportResearch(
  rawInput: unknown,
  dependencies: DailySupportResearchDependencies,
  runId = dependencies.randomId?.() ?? randomUUID(),
): Promise<SupportRunReport> {
  const parsedInput = DailySupportResearchInputSchema.safeParse(rawInput)
  const now = dependencies.now?.() ?? new Date()
  const input = parsedInput.success
    ? parsedInput.data
    : { dryRun: true, idempotencyKey: `invalid-input:${runId}` }
  const config = {
    ...dependencies.config,
    maxConversations: Math.min(
      dependencies.config.maxConversations,
      input.maxConversations ?? dependencies.config.maxConversations,
    ),
  }
  const fallbackCursor = new Date(now.getTime() - 24 * 60 * 60_000)
  const runKey = input.dryRun
    ? `support-research:dry-run:${input.idempotencyKey ?? runId}`
    : `support-research:${input.idempotencyKey ?? dateKey(now)}`
  if (dependencies.databaseReadiness) {
    const databaseReadiness = await dependencies.databaseReadiness()
    if (!databaseReadiness.ready) {
      const configReadiness = getSupportResearchReadiness(config, input.dryRun)
      return buildSupportRunReport({
        runKey,
        status: config.enabled ? "failed" : "disabled",
        dryRun: input.dryRun,
        cutoff: now.toISOString(),
        cursorStart: fallbackCursor.toISOString(),
        cursorEnd: fallbackCursor.toISOString(),
        counters: emptySupportRunCounters(),
        observations: [],
        actionUrls: [],
        errors: [
          ...(configReadiness.ready ? [] : configReadiness.reasons),
          "database_migration_unavailable",
        ],
      })
    }
  }
  const cursorStart = await dependencies.repository.getCursor(
    "help_scout",
    fallbackCursor,
  )
  const leaseToken = dependencies.randomId?.() ?? randomUUID()
  const claim = await dependencies.repository.claimRun({
    runKey,
    dryRun: input.dryRun,
    cursorStart,
    cutoff: now,
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
  })
  if (!claim.claimed) {
    return buildSupportRunReport({
      runKey,
      status: "already_running",
      dryRun: input.dryRun,
      cutoff: now.toISOString(),
      cursorStart: cursorStart.toISOString(),
      cursorEnd: cursorStart.toISOString(),
      counters: emptySupportRunCounters(),
      observations: [],
      actionUrls: [],
      errors: [`run_not_claimed:${claim.status}`],
    })
  }

  const effectiveCursorStart = claim.cursorStart
  const cutoff = claim.cutoff

  const counters = emptySupportRunCounters()
  const observations: StoredSupportObservation[] = []
  const clusterKeys = new Set<string>()
  const errors: string[] = []
  let cursorProgress = effectiveCursorStart
  let partialReason: string | undefined
  let consecutiveAnalysisFailures = 0

  try {
    const readiness = getSupportResearchReadiness(config, input.dryRun)
    if (!parsedInput.success || !readiness.ready) {
      const readinessErrors = parsedInput.success
        ? readiness.ready
          ? []
          : readiness.reasons
        : ["invalid_input"]
      await purgeSupportResearchRetention({
        dependencies,
        config,
        now: cutoff,
        counters,
        errors: readinessErrors,
      })
      const report = buildSupportRunReport({
        runKey,
        status: "disabled",
        dryRun: input.dryRun,
        cutoff: cutoff.toISOString(),
        cursorStart: effectiveCursorStart.toISOString(),
        cursorEnd: effectiveCursorStart.toISOString(),
        counters,
        observations,
        actionUrls: [],
        errors: readinessErrors,
      })
      await dependencies.repository.finalizeRun(
        report,
        config.retentionDays,
        leaseToken,
      )
      return report
    }

    const ingestion = await ingestSupportConversations({
      client: dependencies.helpScout,
      config,
      createdAfter: new Date(
        Math.max(0, effectiveCursorStart.getTime() - OVERLAP_MS),
      ),
      createdBefore: cutoff,
    })
    counters.fetched =
      ingestion.conversations.length + ingestion.exclusions.length
    counters.pages = ingestion.pages
    counters.sanitized = ingestion.conversations.length
    counters.capped = ingestion.capped ? 1 : 0
    counters.redactions = ingestion.conversations.reduce(
      (total, conversation) => total + conversation.redactionCount,
      0,
    )
    for (const exclusion of ingestion.exclusions) {
      errors.push(`source_excluded:${exclusion.sourceId}:${exclusion.reason}`)
    }
    if (ingestion.failure) {
      errors.push(`help_scout:${ingestion.failure.reason}`)
      partialReason = `help_scout_${ingestion.failure.reason}`
    } else if (ingestion.capped) {
      partialReason = "source_cap_reached"
    }

    for (const source of ingestion.conversations) {
      await dependencies.repository.renewRunLease({
        runKey,
        leaseToken,
        leaseDurationMs: LEASE_MS,
      })
      const analysisResult = await analyzeSupportConversation({
        analyzer: dependencies.analyzer,
        conversation: source,
        abortSignal: AbortSignal.timeout(config.timeoutMs),
      })
      let observation: StoredSupportObservation
      if (!analysisResult.ok) {
        counters.failures += 1
        consecutiveAnalysisFailures += 1
        errors.push(`analysis:${source.sourceId}:${analysisResult.reason}`)
        if (analysisResult.retryable) {
          partialReason = `analysis_${analysisResult.reason}`
          break
        }
        observation = failedObservation(source, analysisResult.reason, now)
      } else {
        consecutiveAnalysisFailures = 0
        const validation =
          analysisResult.analysis.relevant &&
          analysisResult.analysis.kind === "bug" &&
          analysisResult.analysis.validationRecommended
            ? await (dependencies.validate ?? validateWatchReport)({
                urls: source.watchUrls,
                target: analysisResult.analysis.validationTarget,
                config,
              })
            : {
                state: "not_attempted" as const,
                evidence: [],
                missingProof:
                  "The observation did not require the first-release HTTP validator.",
              }
        observation = {
          source,
          analysis: analysisResult.analysis,
          validation,
          fingerprint: analysisResult.fingerprint,
          analyzedAt: now.toISOString(),
        }
      }

      const inserted =
        await dependencies.repository.recordObservation(observation)
      const durableObservation = inserted
        ? observation
        : await dependencies.repository.getObservation(source.sourceId)
      if (!durableObservation) {
        throw new Error("support observation conflict could not be reconciled")
      }
      if (!inserted) counters.duplicates += 1
      observations.push(durableObservation)
      cursorProgress = new Date(
        Math.max(
          cursorProgress.getTime(),
          new Date(source.createdAt).getTime(),
        ),
      )

      if (durableObservation.analysis.relevant) counters.relevant += 1
      if (durableObservation.analysis.kind === "bug") counters.bugs += 1
      else if (durableObservation.analysis.kind === "usability") {
        counters.usability += 1
      } else if (durableObservation.analysis.kind === "need") {
        counters.needs += 1
      } else counters.other += 1
      if (durableObservation.validation.state !== "not_attempted") {
        counters.validated += 1
      }
      if (durableObservation.validation.state === "confirmed") {
        counters.validationConfirmed += 1
      } else if (durableObservation.validation.state === "unverified") {
        counters.validationUnverified += 1
      } else if (durableObservation.validation.state === "blocked") {
        counters.validationBlocked += 1
      }
      await dependencies.repository.updateProgress({
        runKey,
        leaseToken,
        cursor: cursorProgress,
        counters,
        leaseDurationMs: LEASE_MS,
      })

      if (durableObservation.analysis.relevant) {
        const cluster =
          durableObservation.analysis.kind === "usability" ||
          durableObservation.analysis.kind === "need"
            ? await dependencies.repository.listThemeObservations({
                surface: durableObservation.analysis.surface,
                themeKey: durableObservation.analysis.themeKey,
                feedbackKinds: ["usability", "need"],
                since: new Date(
                  cutoff.getTime() -
                    config.improvementWindowDays * 24 * 60 * 60_000,
                ),
                limit: 50,
              })
            : [durableObservation]
        const clusterKey = `${durableObservation.analysis.surface}:${durableObservation.analysis.themeKey}`
        clusterKeys.add(clusterKey)
        counters.clusters = clusterKeys.size
        const decision = decideSupportAction({
          observation: durableObservation,
          cluster,
          config,
        })
        if (decision.action) {
          const inserted = await dependencies.repository.enqueueAction(
            decision.action,
            input.dryRun,
          )
          if (inserted) counters.actionsPlanned += 1
          else counters.actionsDeduplicated += 1
        } else {
          counters.reportOnly += 1
        }
      }

      if (
        consecutiveAnalysisFailures >= config.maxConsecutiveAnalysisFailures
      ) {
        partialReason = "analysis_error_budget_reached"
        break
      }
    }

    const fullyProcessed =
      !partialReason &&
      !ingestion.partial &&
      observations.length === ingestion.conversations.length
    if (fullyProcessed) cursorProgress = cutoff

    let actionUrls: string[] = []
    if (!input.dryRun) {
      const createdSince = new Date(`${dateKey(cutoff)}T00:00:00.000Z`)
      const heartbeat = () =>
        dependencies.repository.renewRunLease({
          runKey,
          leaseToken,
          leaseDurationMs: LEASE_MS,
        })
      const dispatchClock = dependencies.now ?? (() => new Date())
      const productDispatch = await dispatchDueSupportActions({
        repository: dependencies.repository,
        client: dependencies.linear,
        config: { maxActionsPerRun: config.maxActionsPerRun },
        actionTypes: ["confirmed_bug", "needs_validation", "ux_improvement"],
        createdSince,
        now: cutoff,
        token: leaseToken,
        clock: dispatchClock,
        heartbeat,
      })
      const summaryAction = buildDailySummaryAction({
        runKey,
        date: dateKey(cutoff),
        observations,
        createdIssueUrls: productDispatch.issueUrls,
      })
      if (summaryAction) {
        const inserted = await dependencies.repository.enqueueAction(
          summaryAction,
          false,
        )
        if (inserted) counters.actionsPlanned += 1
        else counters.actionsDeduplicated += 1
      }
      const dispatches = [productDispatch]
      if (summaryAction) {
        dispatches.push(
          await dispatchDueSupportActions({
            repository: dependencies.repository,
            client: dependencies.linear,
            config: { maxActionsPerRun: 1 },
            actionTypes: ["daily_summary"],
            createdSince,
            now: cutoff,
            token: leaseToken,
            clock: dispatchClock,
            heartbeat,
          }),
        )
      }
      for (const dispatch of dispatches) {
        counters.actionsCreated += dispatch.created
        counters.actionsDeduplicated += dispatch.deduplicated
        counters.actionsDeferred += dispatch.deferred
        counters.failures += dispatch.failed
        errors.push(...dispatch.errors.map((error) => `linear:${error}`))
        actionUrls.push(...dispatch.issueUrls)
      }
      actionUrls = actionUrls.slice(0, 25)
    } else {
      const summaryAction = buildDailySummaryAction({
        runKey,
        date: dateKey(cutoff),
        observations,
        createdIssueUrls: [],
      })
      if (summaryAction) {
        const inserted = await dependencies.repository.enqueueAction(
          summaryAction,
          true,
        )
        if (inserted) counters.actionsPlanned += 1
        else counters.actionsDeduplicated += 1
      }
    }

    await purgeSupportResearchRetention({
      dependencies,
      config,
      now: cutoff,
      counters,
      errors,
    })

    const report = buildSupportRunReport({
      runKey,
      status: fullyProcessed ? "complete" : "partial",
      dryRun: input.dryRun,
      cutoff: cutoff.toISOString(),
      cursorStart: effectiveCursorStart.toISOString(),
      cursorEnd: cursorProgress.toISOString(),
      counters,
      observations,
      actionUrls,
      errors: errors.slice(0, 50),
      partialReason,
    })
    await dependencies.repository.finalizeRun(
      report,
      config.retentionDays,
      leaseToken,
    )
    return report
  } catch {
    await purgeSupportResearchRetention({
      dependencies,
      config,
      now: cutoff,
      counters,
      errors,
    })
    const failedReport = buildSupportRunReport({
      runKey,
      status: "failed",
      dryRun: input.dryRun,
      cutoff: cutoff.toISOString(),
      cursorStart: effectiveCursorStart.toISOString(),
      cursorEnd: cursorProgress.toISOString(),
      counters,
      observations,
      actionUrls: [],
      errors: [...errors, "unexpected_failure"].slice(0, 50),
      partialReason,
    })
    try {
      await dependencies.repository.finalizeRun(
        failedReport,
        config.retentionDays,
        leaseToken,
      )
    } catch {
      throw new Error("support research failed report could not be finalized")
    }
    return failedReport
  }
}

const executeSupportResearchStep = createStep({
  id: "execute-daily-support-research",
  description:
    "Read and sanitize new Help Scout conversations, analyze Watch feedback, and dispatch bounded Linear actions.",
  inputSchema: DailySupportResearchInputSchema,
  outputSchema: supportRunReportSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const config = getSupportResearchConfig()
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: 2,
      allowExitOnIdle: true,
    })
    try {
      return await executeDailySupportResearch(
        inputData,
        {
          config,
          repository: new PostgresSupportResearchRepository(pool),
          helpScout: new HelpScoutClient(config),
          linear: new LinearClient(config),
          analyzer: mastra.getAgentById(
            "supportResearchAgent",
          ) as unknown as SupportAnalyzer,
          databaseReadiness: () => getSupportResearchDatabaseReadiness(pool),
        },
        runId,
      )
    } finally {
      await pool.end()
    }
  },
})

export const dailySupportResearchWorkflow = createWorkflow({
  id: "daily-support-research",
  description:
    "Analyze new Help Scout requests about the public Watch experience and create evidence-labeled Linear work.",
  inputSchema: DailySupportResearchInputSchema,
  outputSchema: supportRunReportSchema,
  schedule: {
    cron: "0 5 * * *",
    timezone: "UTC",
  },
})
  .then(executeSupportResearchStep)
  .commit()
