import { createHash, randomUUID } from "node:crypto"

import { prisma } from "@/db/client"
import { incrementFixedWindow } from "@/auth/rate-limit"
import { env } from "@/config/env"

import {
  assertQualificationProfilesMatchLease,
  createCandidateWatchSearchProfile,
  freezeCurrentWatchSearchProfile,
  type ResolvedCandidateWatchSearchGeneration,
  type TypesenseWatchSearchProfile,
  type TypesenseWatchSearchQualificationLeaseIdentity,
  watchSearchBindingMembers,
} from "./typesense-watch-search-profile"
import { TypesenseClient } from "./typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import { candidateWatchSearchApplicationRevision } from "./typesense-watch-search-candidate-identity"
import {
  recordSearchTraceSafely,
  recordWatchSearchTraceSafely,
} from "./search-trace.service"
import type { TypesenseWatchSearchDiagnostics } from "./typesense-watch-search.service"
import {
  resolveTypesenseWatchSearchApiKey,
  TypesenseWatchSearchService,
} from "./typesense-watch-search.service"
import type {
  WatchSearchInput,
  WatchSearchResponse,
} from "./watch-search.service"

type SearchExecutor = Pick<TypesenseWatchSearchService, "searchWithDiagnostics">

export type WatchSearchComparisonLease =
  TypesenseWatchSearchQualificationLeaseIdentity & {
    holderToken: string
  }

export type WatchSearchComparisonSuccess = {
  status: "success"
  response: WatchSearchResponse
  diagnostics: TypesenseWatchSearchDiagnostics
}

export type WatchSearchComparisonError = {
  status: "error"
  error: {
    code: ComparisonErrorCode
    errorClass: string
  }
}

export type WatchSearchComparisonSide =
  | WatchSearchComparisonSuccess
  | WatchSearchComparisonError

export type WatchSearchComparisonResult = {
  comparisonId: string
  input: WatchSearchInput
  current: WatchSearchComparisonSide
  candidate: WatchSearchComparisonSide
}

type ComparisonErrorCode =
  | "invalid_input"
  | "admission_denied"
  | "candidate_disabled"
  | "lease_unavailable"
  | "lease_lost"
  | "profile_unavailable"
  | "search_failed"

type ComparisonTraceEvent = {
  comparisonId: string
  actorKey: string
  side: "current" | "candidate"
  input: WatchSearchInput
  outcome: WatchSearchComparisonSide
  startedAt: Date
  completedAt: Date
}

export type TypesenseWatchSearchComparisonDeps = {
  resolveCurrentProfile(): Promise<TypesenseWatchSearchProfile>
  resolveCandidateProfile(): Promise<TypesenseWatchSearchProfile>
  createSearch(profile: TypesenseWatchSearchProfile): SearchExecutor
  acquireLease(input: {
    comparisonId: string
    current: TypesenseWatchSearchProfile
    candidate: TypesenseWatchSearchProfile
  }): Promise<WatchSearchComparisonLease | null>
  renewLease(lease: WatchSearchComparisonLease): Promise<boolean>
  releaseLease(lease: WatchSearchComparisonLease): Promise<boolean>
  candidateEnabled(): boolean
  admitActor(actorKey: string): Promise<boolean>
  recordTrace?(event: ComparisonTraceEvent): Promise<void>
  now?: () => Date
}

class ComparisonError extends Error {
  constructor(readonly code: ComparisonErrorCode) {
    super(code)
    this.name = "ComparisonError"
  }
}

function normalizedString(value: string | null | undefined, max: number) {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function normalizeInput(input: WatchSearchInput, comparisonId: string) {
  const query = input.query.trim().slice(0, 200)
  if (!query) throw new ComparisonError("invalid_input")
  const limit =
    input.limit == null || !Number.isFinite(input.limit)
      ? undefined
      : Math.min(50, Math.max(1, Math.trunc(input.limit)))
  const offset =
    input.offset == null || !Number.isFinite(input.offset)
      ? undefined
      : Math.max(0, Math.trunc(input.offset))
  return Object.freeze({
    query,
    clientRequestId: comparisonId,
    targetLanguageSlug: normalizedString(input.targetLanguageSlug, 128),
    queryLanguageSlug: normalizedString(input.queryLanguageSlug, 128),
    queryNamedLanguageSlug: normalizedString(input.queryNamedLanguageSlug, 128),
    displayLanguageSlug: normalizedString(input.displayLanguageSlug, 128),
    routeLanguageSlug: normalizedString(input.routeLanguageSlug, 128),
    currentWatchLanguageSlug: normalizedString(
      input.currentWatchLanguageSlug,
      128,
    ),
    acceptLanguage: normalizedString(input.acceptLanguage, 512),
    limit,
    offset,
    resultTypes: input.resultTypes
      ? Object.freeze([...input.resultTypes])
      : undefined,
  } satisfies WatchSearchInput)
}

function errorOutcome(error: unknown): WatchSearchComparisonError {
  return {
    status: "error",
    error: {
      code: error instanceof ComparisonError ? error.code : "search_failed",
      errorClass:
        error instanceof Error ? error.constructor.name : "UnknownError",
    },
  }
}

async function execute(
  service: SearchExecutor,
  input: WatchSearchInput,
): Promise<WatchSearchComparisonSide> {
  try {
    const result = await service.searchWithDiagnostics(input)
    return { status: "success", ...result }
  } catch (error) {
    return errorOutcome(error)
  }
}

export class TypesenseWatchSearchComparisonService {
  private readonly now: () => Date

  constructor(private readonly deps: TypesenseWatchSearchComparisonDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async compare(input: {
    actorKey: string
    input: WatchSearchInput
  }): Promise<WatchSearchComparisonResult> {
    const comparisonId = randomUUID()
    const normalizedInput = normalizeInput(input.input, comparisonId)
    let currentProfile: TypesenseWatchSearchProfile | null = null
    let candidateProfile: TypesenseWatchSearchProfile | null = null
    let lease: WatchSearchComparisonLease | null = null
    let candidateSetupError: unknown = null

    try {
      currentProfile = await this.deps.resolveCurrentProfile()
    } catch (error) {
      candidateSetupError = error
    }
    try {
      if (!this.deps.candidateEnabled()) {
        throw new ComparisonError("candidate_disabled")
      }
      if (!(await this.deps.admitActor(input.actorKey))) {
        throw new ComparisonError("admission_denied")
      }
      candidateProfile = await this.deps.resolveCandidateProfile()
      if (!currentProfile) throw new ComparisonError("profile_unavailable")
      lease = await this.deps.acquireLease({
        comparisonId,
        current: currentProfile,
        candidate: candidateProfile,
      })
      if (!lease) throw new ComparisonError("lease_unavailable")
      assertQualificationProfilesMatchLease({
        current: currentProfile,
        candidate: candidateProfile,
        lease,
        now: this.now(),
      })
    } catch (error) {
      candidateSetupError = error
    }

    const currentStartedAt = this.now()
    const current = currentProfile
      ? await execute(this.deps.createSearch(currentProfile), normalizedInput)
      : errorOutcome(new ComparisonError("profile_unavailable"))
    await this.trace({
      comparisonId,
      actorKey: input.actorKey,
      side: "current",
      input: normalizedInput,
      outcome: current,
      startedAt: currentStartedAt,
      completedAt: this.now(),
    })

    let candidate: WatchSearchComparisonSide
    const candidateStartedAt = this.now()
    try {
      if (candidateSetupError) throw candidateSetupError
      if (!candidateProfile || !lease) {
        throw new ComparisonError("profile_unavailable")
      }
      if (!this.deps.candidateEnabled()) {
        throw new ComparisonError("candidate_disabled")
      }
      if (!(await this.deps.renewLease(lease))) {
        throw new ComparisonError("lease_lost")
      }
      assertQualificationProfilesMatchLease({
        current: currentProfile!,
        candidate: candidateProfile,
        lease,
        now: this.now(),
      })
      candidate = await execute(
        this.deps.createSearch(candidateProfile),
        normalizedInput,
      )
    } catch (error) {
      candidate = errorOutcome(error)
    } finally {
      if (lease) await this.deps.releaseLease(lease).catch(() => false)
    }
    await this.trace({
      comparisonId,
      actorKey: input.actorKey,
      side: "candidate",
      input: normalizedInput,
      outcome: candidate,
      startedAt: candidateStartedAt,
      completedAt: this.now(),
    })

    return {
      comparisonId,
      input: normalizedInput,
      current,
      candidate,
    }
  }

  private async trace(event: ComparisonTraceEvent): Promise<void> {
    await this.deps.recordTrace?.(event).catch(() => undefined)
  }
}

const COMPARISON_RESOURCE_KEY = "watch-search-candidate-comparison"
const COMPARISON_LEASE_TTL_MS = 30_000
const ACTOR_RATE_LIMIT = 10
const ACTOR_RATE_WINDOW_MS = 60_000

type EvaluationCandidateGenerationResolver = {
  getPointer(kind: "EVALUATION"): Promise<{ generationId: string | null }>
  getGeneration(generationId: string): Promise<{
    id: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
  }>
  resolveGeneration(
    input: Parameters<
      TypesenseWatchSearchCandidateGenerationService["resolveGeneration"]
    >[0],
  ): Promise<ResolvedCandidateWatchSearchGeneration>
}

export async function resolveEvaluationCandidateWatchSearchProfile(
  generations: EvaluationCandidateGenerationResolver,
): Promise<TypesenseWatchSearchProfile> {
  const pointer = await generations.getPointer("EVALUATION")
  if (!pointer.generationId) throw new ComparisonError("profile_unavailable")
  const generation = await generations.getGeneration(pointer.generationId)
  const resolved = await generations.resolveGeneration({
    generationId: generation.id,
    applicationRevision: candidateWatchSearchApplicationRevision(),
    transcriptCollection: generation.transcriptCollection,
    transcriptProjectionRevision: generation.transcriptProjectionRevision,
    requireQualified: false,
  })
  return createCandidateWatchSearchProfile(resolved)
}

/** Production fixed-semantics factory. Callers cannot provide profile identity. */
export function createTypesenseWatchSearchComparisonService(): TypesenseWatchSearchComparisonService {
  const host = process.env.TYPESENSE_HOST
  const apiKey = resolveTypesenseWatchSearchApiKey({
    searchApiKey: env.TYPESENSE_SEARCH_API_KEY,
    legacyApiKey: process.env.TYPESENSE_API_KEY,
    allowLegacyFallback: false,
  })
  if (!host || !apiKey) throw new ComparisonError("profile_unavailable")

  const typesense = new TypesenseClient({ host, apiKey, timeoutMs: 2_000 })
  const generations = new TypesenseWatchSearchCandidateGenerationService(
    prisma,
    typesense,
  )

  return new TypesenseWatchSearchComparisonService({
    resolveCurrentProfile: () => freezeCurrentWatchSearchProfile(typesense),
    resolveCandidateProfile: () =>
      resolveEvaluationCandidateWatchSearchProfile(generations),
    createSearch: (profile) =>
      new TypesenseWatchSearchService(prisma, typesense, { profile }),
    acquireLease: async ({ comparisonId, current, candidate }) => {
      if (
        !candidate.generationId ||
        !candidate.applicationRevision ||
        candidate.transcriptProjectionRevision == null
      ) {
        throw new ComparisonError("profile_unavailable")
      }
      const lease = await generations.acquireLease({
        resourceKey: COMPARISON_RESOURCE_KEY,
        kind: "COMPARISON",
        holderToken: comparisonId,
        ttlMs: COMPARISON_LEASE_TTL_MS,
        generationId: candidate.generationId,
        applicationRevision: candidate.applicationRevision,
        transcriptCollection: candidate.binding.transcript,
        transcriptProjectionRevision: candidate.transcriptProjectionRevision,
        currentBindings: watchSearchBindingMembers(current),
      })
      if (!lease) return null
      return {
        holderToken: lease.holderToken,
        generationId: lease.generationId,
        applicationRevision: lease.applicationRevision,
        transcriptCollection: lease.transcriptCollection,
        transcriptProjectionRevision: lease.transcriptProjectionRevision,
        currentBindings: watchSearchBindingMembers(current),
        expiresAt: lease.expiresAt,
      }
    },
    renewLease: (lease) =>
      generations.renewLease({
        resourceKey: COMPARISON_RESOURCE_KEY,
        holderToken: lease.holderToken,
        ttlMs: COMPARISON_LEASE_TTL_MS,
      }),
    releaseLease: (lease) =>
      generations.releaseLease({
        resourceKey: COMPARISON_RESOURCE_KEY,
        holderToken: lease.holderToken,
      }),
    candidateEnabled: () => env.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED,
    admitActor: async (actorKey) => {
      const admission = await incrementFixedWindow(
        `watch-search-candidate-comparison:${actorKey}`,
        ACTOR_RATE_LIMIT,
        ACTOR_RATE_WINDOW_MS,
      )
      // A local fallback cannot coordinate a fleet-wide no-queue lease.
      return admission.source === "redis" && admission.allowed
    },
    recordTrace: async (event) => {
      const traceRole =
        event.side === "current" ? "comparison_current" : "comparison_candidate"
      if (event.outcome.status === "success") {
        await recordWatchSearchTraceSafely(
          {
            input: event.input,
            response: event.outcome.response,
            startedAt: event.startedAt,
            completedAt: event.completedAt,
            traceRole,
            shadowOfRequestId: event.comparisonId,
          },
          prisma,
        )
        return
      }
      await recordSearchTraceSafely(
        {
          requestId: event.comparisonId,
          query: event.input.query,
          locale:
            event.input.targetLanguageSlug ??
            event.input.displayLanguageSlug ??
            "und",
          routeSource: "graphql",
          requestedMode: "modern",
          searchMode: `watch-search-${traceRole}`,
          resultCount: 0,
          outcome: "failed",
          traceClass: event.outcome.error.code,
          startedAt: event.startedAt,
          completedAt: event.completedAt,
          metadata: {
            version: "watch-search-comparison/v1",
            comparisonId: event.comparisonId,
            traceRole,
            actorFingerprint: createHash("sha256")
              .update(event.actorKey)
              .digest("hex")
              .slice(0, 16),
            errorCode: event.outcome.error.code,
          },
          storeAggregate: false,
          sampleEligible: false,
        },
        prisma,
      )
    },
  })
}
