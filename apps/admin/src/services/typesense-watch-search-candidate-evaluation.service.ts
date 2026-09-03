import { createHash, randomUUID } from "node:crypto"

import { env } from "@/config/env"
import { prisma } from "@/db/client"

import { TypesenseClient } from "./typesense-client"
import { resolveTypesenseWatchSearchApiKey } from "./typesense-client-config"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import {
  candidateWatchSearchIndexContractRevision,
  candidateWatchSearchRankingRevision,
} from "./typesense-watch-search-candidate-identity"
import { resolveEvaluationCandidateWatchSearchProfile } from "./typesense-watch-search-comparison.service"
import { resolveCurrentWatchSearchTranscriptCompatibility } from "./typesense-watch-search-transcript-compatibility"
import {
  assertQualificationProfilesMatchLease,
  freezeCurrentWatchSearchProfile,
  resolveCandidateWatchSearchProfile,
  type TypesenseWatchSearchProfile,
  type TypesenseWatchSearchQualificationLeaseIdentity,
  watchSearchBindingMembers,
} from "./typesense-watch-search-profile"
import {
  type TypesenseWatchSearchDiagnostics,
  TypesenseWatchSearchService,
} from "./typesense-watch-search.service"
import type {
  WatchSearchInput,
  WatchSearchResponse,
} from "./watch-search.service"

const EVALUATION_LEASE_TTL_MS = 30_000
const EVALUATION_LEASE_RELEASE_TIMEOUT_MS = 2_000
const EVALUATION_RESOURCE_PREFIX = "watch-search-candidate-eval"

export type CandidateSearchEvaluationSource = "EVALUATION" | "SERVING"

type SearchExecutor = Pick<TypesenseWatchSearchService, "searchWithDiagnostics">

type CandidateEvaluationLease =
  TypesenseWatchSearchQualificationLeaseIdentity & {
    resourceKey: string
    holderToken: string
  }

export type CandidateEvaluationErrorCode =
  | "profile_unavailable"
  | "lease_unavailable"
  | "lease_lost"
  | "identity_mismatch"
  | "search_failed"

export class CandidateSearchEvaluationError extends Error {
  constructor(readonly code: CandidateEvaluationErrorCode) {
    super(code)
    this.name = "CandidateSearchEvaluationError"
  }
}

export type CandidateSearchEvaluationDeps = {
  source: CandidateSearchEvaluationSource
  resolveCurrentProfile(): Promise<TypesenseWatchSearchProfile>
  resolveCandidateProfile(
    currentProfile: TypesenseWatchSearchProfile,
  ): Promise<TypesenseWatchSearchProfile>
  createSearch(profile: TypesenseWatchSearchProfile): SearchExecutor
  acquireLease(input: {
    source: CandidateSearchEvaluationSource
    evaluationId: string
    current: TypesenseWatchSearchProfile
    candidate: TypesenseWatchSearchProfile
  }): Promise<CandidateEvaluationLease | null>
  renewLease(lease: CandidateEvaluationLease): Promise<boolean>
  releaseLease(lease: CandidateEvaluationLease): Promise<boolean>
  verifyCandidateProfile(profile: TypesenseWatchSearchProfile): Promise<boolean>
  rankingRevision(): string
  leaseReleaseTimeoutMs?: number
  onCleanupFailure?(failure: {
    resourceKey: string
    reason: "release_failed" | "release_timeout"
    error?: unknown
  }): void
}

function assertCandidateDiagnostics(
  profile: TypesenseWatchSearchProfile,
  diagnostics: TypesenseWatchSearchDiagnostics,
  rankingRevision: string,
): void {
  if (
    profile.kind !== "CANDIDATE" ||
    diagnostics.profile !== "CANDIDATE" ||
    diagnostics.generationId !== profile.generationId ||
    diagnostics.indexContractRevision !== profile.indexContractRevision ||
    diagnostics.contentEmbeddingContractId !==
      profile.contentEmbeddingContractId ||
    diagnostics.transcriptChunkingVersion !==
      profile.transcriptChunkingVersion ||
    diagnostics.transcriptProjectionRevision !==
      profile.transcriptProjectionRevision ||
    diagnostics.rankingImplementation !== rankingRevision ||
    Object.entries(profile.binding).some(
      ([role, collection]) =>
        diagnostics.binding[
          role as keyof TypesenseWatchSearchProfile["binding"]
        ] !== collection,
    )
  ) {
    throw new CandidateSearchEvaluationError("identity_mismatch")
  }
}

type ServingCandidateGenerationResolver = {
  getPointer(kind: "SERVING"): Promise<{ generationId: string | null }>
  resolveGeneration: Parameters<
    typeof resolveCandidateWatchSearchProfile
  >[0]["generations"]["resolveGeneration"]
}

/**
 * Resolve the immutable generation currently pinned to Serving. This deliberately
 * does not accept a selector or generation id from callers and never consults
 * the mutable Evaluation pointer.
 */
export async function resolveServingCandidateWatchSearchProfile(input: {
  generations: ServingCandidateGenerationResolver
  currentProfile: TypesenseWatchSearchProfile
  indexContractRevision: string | null
  rankingRevision: string | null
  transcriptCompatibility: {
    contentEmbeddingContractId: string
    transcriptChunkingVersion: string
  } | null
  qrelsRevision: string | null
}): Promise<TypesenseWatchSearchProfile> {
  if (
    input.currentProfile.kind !== "CURRENT" ||
    input.currentProfile.allowCompatibilityFallback ||
    !input.indexContractRevision ||
    !input.rankingRevision ||
    !input.transcriptCompatibility ||
    !input.qrelsRevision
  ) {
    throw new CandidateSearchEvaluationError("profile_unavailable")
  }

  try {
    const pointer = await input.generations.getPointer("SERVING")
    if (!pointer.generationId) {
      throw new CandidateSearchEvaluationError("profile_unavailable")
    }
    return await resolveCandidateWatchSearchProfile({
      generations: input.generations,
      generationId: pointer.generationId,
      indexContractRevision: input.indexContractRevision,
      transcriptCollection: input.currentProfile.binding.transcript,
      contentEmbeddingContractId:
        input.transcriptCompatibility.contentEmbeddingContractId,
      transcriptChunkingVersion:
        input.transcriptCompatibility.transcriptChunkingVersion,
      requireQualified: true,
      currentBindings: watchSearchBindingMembers(input.currentProfile),
      qrelsRevision: input.qrelsRevision,
      rankingRevision: input.rankingRevision,
    })
  } catch (error) {
    if (error instanceof CandidateSearchEvaluationError) throw error
    throw new CandidateSearchEvaluationError("profile_unavailable")
  }
}

function assertLeaseIdentity(input: {
  current: TypesenseWatchSearchProfile
  candidate: TypesenseWatchSearchProfile
  lease: CandidateEvaluationLease
}): void {
  try {
    assertQualificationProfilesMatchLease(input)
  } catch {
    throw new CandidateSearchEvaluationError("identity_mismatch")
  }
}

export function candidateSearchEvaluationRevision(input: {
  profile: TypesenseWatchSearchProfile
  currentProfile: TypesenseWatchSearchProfile
  rankingRevision: string
}): string {
  const profile = input.profile
  if (
    profile.kind !== "CANDIDATE" ||
    !profile.generationId ||
    !profile.indexContractRevision ||
    !profile.contentEmbeddingContractId ||
    !profile.transcriptChunkingVersion ||
    profile.transcriptProjectionRevision == null
  ) {
    throw new CandidateSearchEvaluationError("profile_unavailable")
  }
  if (
    input.currentProfile.kind !== "CURRENT" ||
    input.currentProfile.allowCompatibilityFallback
  ) {
    throw new CandidateSearchEvaluationError("profile_unavailable")
  }
  const identity = {
    generationId: profile.generationId,
    indexContractRevision: profile.indexContractRevision,
    contentEmbeddingContractId: profile.contentEmbeddingContractId,
    transcriptChunkingVersion: profile.transcriptChunkingVersion,
    rankingRevision: input.rankingRevision,
    transcriptProjectionRevision:
      profile.transcriptProjectionRevision.toString(),
    evaluationRevision: profile.qrelsRevision ?? null,
    collections: {
      catalog: profile.binding.catalog,
      availability: profile.binding.availability,
      lexical: profile.binding.lexical,
      transcript: profile.binding.transcript,
    },
    currentCollections: {
      catalog: input.currentProfile.binding.catalog,
      availability: input.currentProfile.binding.availability,
      lexical: input.currentProfile.binding.lexical,
      transcript: input.currentProfile.binding.transcript,
    },
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
  return `watch-search-candidate:${digest}`
}

export class TypesenseWatchSearchCandidateEvaluationService {
  constructor(private readonly deps: CandidateSearchEvaluationDeps) {}

  private async releaseLease(lease: CandidateEvaluationLease): Promise<void> {
    const configuredTimeout = this.deps.leaseReleaseTimeoutMs
    const timeoutMs =
      configuredTimeout != null &&
      Number.isSafeInteger(configuredTimeout) &&
      configuredTimeout > 0
        ? configuredTimeout
        : EVALUATION_LEASE_RELEASE_TIMEOUT_MS
    let timeout: ReturnType<typeof setTimeout> | undefined
    const release = this.deps.releaseLease(lease).then(
      (released) => ({ kind: "released" as const, released }),
      (error: unknown) => ({ kind: "failed" as const, error }),
    )
    const result = await Promise.race([
      release,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
      }),
    ])
    if (timeout) clearTimeout(timeout)

    if (result.kind === "released" && result.released) return
    const failure =
      result.kind === "timeout"
        ? {
            resourceKey: lease.resourceKey,
            reason: "release_timeout" as const,
          }
        : {
            resourceKey: lease.resourceKey,
            reason: "release_failed" as const,
            ...(result.kind === "failed" ? { error: result.error } : {}),
          }
    try {
      this.deps.onCleanupFailure?.(failure)
    } catch {
      // Cleanup reporting must never mask the search result or typed failure.
    }
  }

  async search(input: WatchSearchInput): Promise<{
    response: WatchSearchResponse
    revision: string
  }> {
    const evaluationId = randomUUID()
    let current: TypesenseWatchSearchProfile
    let candidate: TypesenseWatchSearchProfile
    try {
      current = await this.deps.resolveCurrentProfile()
      candidate = await this.deps.resolveCandidateProfile(current)
    } catch {
      throw new CandidateSearchEvaluationError("profile_unavailable")
    }

    let lease: CandidateEvaluationLease | null = null
    try {
      lease = await this.deps.acquireLease({
        source: this.deps.source,
        evaluationId,
        current,
        candidate,
      })
      if (!lease) {
        throw new CandidateSearchEvaluationError("lease_unavailable")
      }
      assertLeaseIdentity({ current, candidate, lease })
      if (!(await this.deps.renewLease(lease))) {
        throw new CandidateSearchEvaluationError("lease_lost")
      }
      assertLeaseIdentity({ current, candidate, lease })

      const rankingRevision = this.deps.rankingRevision()
      const result = await this.deps
        .createSearch(candidate)
        .searchWithDiagnostics(input)
      assertCandidateDiagnostics(candidate, result.diagnostics, rankingRevision)
      const [leaseRenewed, profileVerified] = await Promise.all([
        this.deps.renewLease(lease),
        this.deps.verifyCandidateProfile(candidate),
      ])
      if (!leaseRenewed) {
        throw new CandidateSearchEvaluationError("lease_lost")
      }
      assertLeaseIdentity({ current, candidate, lease })
      if (!profileVerified) {
        throw new CandidateSearchEvaluationError("identity_mismatch")
      }
      return {
        response: result.response,
        revision: candidateSearchEvaluationRevision({
          profile: candidate,
          currentProfile: current,
          rankingRevision,
        }),
      }
    } catch (error) {
      if (error instanceof CandidateSearchEvaluationError) throw error
      if (lease == null) {
        throw new CandidateSearchEvaluationError("lease_unavailable")
      }
      throw new CandidateSearchEvaluationError("search_failed")
    } finally {
      if (lease) await this.releaseLease(lease)
    }
  }
}

/** Production factory with a fixed, server-selected pointer source. */
export function createTypesenseWatchSearchCandidateEvaluationService(
  source: CandidateSearchEvaluationSource,
): TypesenseWatchSearchCandidateEvaluationService {
  const host = env.TYPESENSE_HOST
  const apiKey = resolveTypesenseWatchSearchApiKey({
    searchApiKey: env.TYPESENSE_SEARCH_API_KEY,
    legacyApiKey: env.TYPESENSE_API_KEY,
    allowLegacyFallback: false,
  })
  if (!host || !apiKey) {
    throw new CandidateSearchEvaluationError("profile_unavailable")
  }

  const typesense = new TypesenseClient({ host, apiKey, timeoutMs: 2_000 })
  const generations = new TypesenseWatchSearchCandidateGenerationService(
    prisma,
    typesense,
  )

  return new TypesenseWatchSearchCandidateEvaluationService({
    source,
    resolveCurrentProfile: () => freezeCurrentWatchSearchProfile(typesense),
    resolveCandidateProfile: async (currentProfile) => {
      const profile =
        source === "EVALUATION"
          ? await resolveEvaluationCandidateWatchSearchProfile(generations)
          : await resolveServingCandidateWatchSearchProfile({
              generations,
              currentProfile,
              indexContractRevision:
                candidateWatchSearchIndexContractRevision(),
              rankingRevision: candidateWatchSearchRankingRevision(),
              transcriptCompatibility:
                await resolveCurrentWatchSearchTranscriptCompatibility(prisma),
              qrelsRevision: env.WATCH_SEARCH_SERVING_QRELS_REVISION ?? null,
            })
      if (
        profile.indexContractRevision !==
        candidateWatchSearchIndexContractRevision()
      ) {
        throw new CandidateSearchEvaluationError("profile_unavailable")
      }
      return profile
    },
    createSearch: (profile) =>
      new TypesenseWatchSearchService(prisma, typesense, { profile }),
    acquireLease: async ({
      source: leaseSource,
      evaluationId,
      current,
      candidate,
    }) => {
      if (
        !candidate.generationId ||
        !candidate.indexContractRevision ||
        !candidate.contentEmbeddingContractId ||
        !candidate.transcriptChunkingVersion ||
        candidate.transcriptProjectionRevision == null
      ) {
        throw new CandidateSearchEvaluationError("profile_unavailable")
      }
      const resourceKey = `${EVALUATION_RESOURCE_PREFIX}:${leaseSource.toLowerCase()}:${evaluationId}`
      const holderToken = randomUUID()
      const currentBindings = watchSearchBindingMembers(current)
      let lease = null
      for (let attempt = 0; attempt < 4 && lease == null; attempt += 1) {
        lease = await generations.acquireLease({
          resourceKey,
          kind: "EVALUATION",
          holderToken,
          ttlMs: EVALUATION_LEASE_TTL_MS,
          generationId: candidate.generationId,
          indexContractRevision: candidate.indexContractRevision,
          transcriptCollection: candidate.binding.transcript,
          contentEmbeddingContractId: candidate.contentEmbeddingContractId,
          transcriptChunkingVersion: candidate.transcriptChunkingVersion,
          transcriptProjectionRevision: candidate.transcriptProjectionRevision,
          currentBindings,
        })
        if (lease == null && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 5))
        }
      }
      if (!lease) return null
      return {
        resourceKey,
        holderToken: lease.holderToken,
        generationId: lease.generationId,
        indexContractRevision: lease.indexContractRevision,
        transcriptCollection: lease.transcriptCollection,
        contentEmbeddingContractId: lease.contentEmbeddingContractId,
        transcriptChunkingVersion: lease.transcriptChunkingVersion,
        transcriptProjectionRevision: lease.transcriptProjectionRevision,
        currentBindings,
        expiresAt: lease.expiresAt,
      }
    },
    renewLease: (lease) =>
      generations.renewLease({
        resourceKey: lease.resourceKey,
        holderToken: lease.holderToken,
        ttlMs: EVALUATION_LEASE_TTL_MS,
      }),
    releaseLease: (lease) =>
      generations.releaseLease({
        resourceKey: lease.resourceKey,
        holderToken: lease.holderToken,
      }),
    verifyCandidateProfile: async (profile) => {
      const pointer = await generations.getPointer(source)
      return (
        profile.kind === "CANDIDATE" &&
        profile.generationId != null &&
        pointer.generationId === profile.generationId
      )
    },
    rankingRevision: candidateWatchSearchRankingRevision,
    leaseReleaseTimeoutMs: EVALUATION_LEASE_RELEASE_TIMEOUT_MS,
    onCleanupFailure: ({ resourceKey, reason, error }) => {
      console.warn(
        "[watch-search-candidate-evaluation] event=lease_cleanup_failed",
        {
          source,
          resourceKey,
          reason,
          ...(error
            ? {
                error: error instanceof Error ? error.message : String(error),
              }
            : {}),
        },
      )
    },
  })
}
