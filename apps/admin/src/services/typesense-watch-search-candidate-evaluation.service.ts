import { createHash, randomUUID } from "node:crypto"

import { env } from "@/config/env"
import { prisma } from "@/db/client"

import { TypesenseClient } from "./typesense-client"
import { resolveTypesenseWatchSearchApiKey } from "./typesense-client-config"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import {
  candidateWatchSearchApplicationRevision,
  candidateWatchSearchRankingRevision,
} from "./typesense-watch-search-candidate-identity"
import { resolveEvaluationCandidateWatchSearchProfile } from "./typesense-watch-search-comparison.service"
import {
  assertQualificationProfilesMatchLease,
  freezeCurrentWatchSearchProfile,
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
const EVALUATION_RESOURCE_PREFIX = "watch-search-candidate-eval"

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
  resolveCurrentProfile(): Promise<TypesenseWatchSearchProfile>
  resolveCandidateProfile(): Promise<TypesenseWatchSearchProfile>
  createSearch(profile: TypesenseWatchSearchProfile): SearchExecutor
  acquireLease(input: {
    evaluationId: string
    current: TypesenseWatchSearchProfile
    candidate: TypesenseWatchSearchProfile
  }): Promise<CandidateEvaluationLease | null>
  renewLease(lease: CandidateEvaluationLease): Promise<boolean>
  releaseLease(lease: CandidateEvaluationLease): Promise<boolean>
  rankingRevision(): string
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
    diagnostics.applicationRevision !== profile.applicationRevision ||
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
    !profile.applicationRevision ||
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
    applicationRevision: profile.applicationRevision,
    rankingRevision: input.rankingRevision,
    transcriptProjectionRevision:
      profile.transcriptProjectionRevision.toString(),
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

  async search(input: WatchSearchInput): Promise<{
    response: WatchSearchResponse
    revision: string
  }> {
    const evaluationId = randomUUID()
    let current: TypesenseWatchSearchProfile
    let candidate: TypesenseWatchSearchProfile
    try {
      const profiles = await Promise.all([
        this.deps.resolveCurrentProfile(),
        this.deps.resolveCandidateProfile(),
      ])
      current = profiles[0]
      candidate = profiles[1]
    } catch {
      throw new CandidateSearchEvaluationError("profile_unavailable")
    }

    let lease: CandidateEvaluationLease | null = null
    try {
      lease = await this.deps.acquireLease({ evaluationId, current, candidate })
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
      if (lease) await this.deps.releaseLease(lease).catch(() => false)
    }
  }
}

/** Production factory with fixed Evaluation-pointer semantics. */
export function createTypesenseWatchSearchCandidateEvaluationService(): TypesenseWatchSearchCandidateEvaluationService {
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
    resolveCurrentProfile: () => freezeCurrentWatchSearchProfile(typesense),
    resolveCandidateProfile: async () => {
      const profile =
        await resolveEvaluationCandidateWatchSearchProfile(generations)
      if (
        profile.applicationRevision !==
        candidateWatchSearchApplicationRevision()
      ) {
        throw new CandidateSearchEvaluationError("profile_unavailable")
      }
      return profile
    },
    createSearch: (profile) =>
      new TypesenseWatchSearchService(prisma, typesense, { profile }),
    acquireLease: async ({ evaluationId, current, candidate }) => {
      if (
        !candidate.generationId ||
        !candidate.applicationRevision ||
        candidate.transcriptProjectionRevision == null
      ) {
        throw new CandidateSearchEvaluationError("profile_unavailable")
      }
      const resourceKey = `${EVALUATION_RESOURCE_PREFIX}:${evaluationId}`
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
          applicationRevision: candidate.applicationRevision,
          transcriptCollection: candidate.binding.transcript,
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
        applicationRevision: lease.applicationRevision,
        transcriptCollection: lease.transcriptCollection,
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
    rankingRevision: candidateWatchSearchRankingRevision,
  })
}
