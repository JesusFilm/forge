import type {
  TypesenseAlias,
  TypesenseClient,
  TypesenseCollectionField,
} from "./typesense-client"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CANDIDATE_PREFIX,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "./typesense-watch-search-schema"

export type TypesenseWatchSearchCollectionBinding = Readonly<{
  catalog: string
  availability: string
  lexical: string
  transcript: string
}>

export type TypesenseWatchSearchFieldManifests = Readonly<{
  catalog: readonly TypesenseCollectionField[]
  availability: readonly TypesenseCollectionField[]
  lexical: readonly TypesenseCollectionField[]
  transcript: readonly TypesenseCollectionField[]
}>

export type TypesenseWatchSearchProfile = Readonly<{
  kind: "CURRENT" | "CANDIDATE"
  binding: TypesenseWatchSearchCollectionBinding
  generationId: string | null
  applicationRevision: string | null
  transcriptProjectionRevision: bigint | null
  fieldManifests: TypesenseWatchSearchFieldManifests | null
  allowCompatibilityFallback: boolean
}>

export type ResolvedCandidateWatchSearchGeneration = {
  generationId: string
  applicationRevision: string
  transcriptProjectionRevision: bigint
  collections: TypesenseWatchSearchCollectionBinding
  fieldManifests: TypesenseWatchSearchFieldManifests
}

export type TypesenseWatchSearchQualificationLeaseIdentity = {
  generationId: string
  applicationRevision: string
  transcriptCollection: string
  transcriptProjectionRevision: bigint
  currentBindings: readonly string[]
  expiresAt: Date
}

type AliasReader = Pick<TypesenseClient, "getAlias">
type CandidateGenerationResolver = {
  resolveGeneration(input: {
    generationId: string
    applicationRevision: string
    transcriptCollection: string
    transcriptProjectionRevision: bigint
    requireQualified?: boolean
    currentBindings?: readonly string[]
    qrelsRevision?: string
    rankingRevision?: string
  }): Promise<ResolvedCandidateWatchSearchGeneration>
}

const CURRENT_ALIASES = Object.freeze({
  catalog: TYPESENSE_WATCH_CATALOG_ALIAS,
  availability: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  lexical: TYPESENSE_WATCH_LEXICAL_ALIAS,
  transcript: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
})

const CURRENT_ALIAS_NAMES = new Set<string>(Object.values(CURRENT_ALIASES))

export class TypesenseWatchSearchProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TypesenseWatchSearchProfileError"
  }
}

function required(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new TypesenseWatchSearchProfileError(`${name} is required`)
  }
  return normalized
}

function immutableProfile(
  profile: Omit<TypesenseWatchSearchProfile, "binding"> & {
    binding: TypesenseWatchSearchCollectionBinding
  },
): TypesenseWatchSearchProfile {
  const binding = Object.freeze({ ...profile.binding })
  const fieldManifests = profile.fieldManifests
    ? Object.freeze(
        Object.fromEntries(
          Object.entries(profile.fieldManifests).map(([role, fields]) => [
            role,
            Object.freeze(fields.map((field) => Object.freeze({ ...field }))),
          ]),
        ) as TypesenseWatchSearchFieldManifests,
      )
    : null
  return Object.freeze({ ...profile, binding, fieldManifests })
}

export function createCurrentWatchSearchProfile(): TypesenseWatchSearchProfile {
  return immutableProfile({
    kind: "CURRENT",
    binding: CURRENT_ALIASES,
    generationId: null,
    applicationRevision: null,
    transcriptProjectionRevision: null,
    fieldManifests: null,
    allowCompatibilityFallback: true,
  })
}

export function createCandidateWatchSearchProfile(
  generation: ResolvedCandidateWatchSearchGeneration,
): TypesenseWatchSearchProfile {
  const generationId = required(generation.generationId, "generation id")
  const applicationRevision = required(
    generation.applicationRevision,
    "application revision",
  )
  if (generation.transcriptProjectionRevision < 0n) {
    throw new TypesenseWatchSearchProfileError(
      "transcript projection revision cannot be negative",
    )
  }
  if (
    Object.values(generation.fieldManifests).some(
      (fields) => fields.length === 0,
    )
  ) {
    throw new TypesenseWatchSearchProfileError(
      "candidate field manifests cannot be empty",
    )
  }

  const binding = Object.fromEntries(
    Object.entries(generation.collections).map(([role, collection]) => [
      role,
      required(collection, `${role} collection`),
    ]),
  ) as TypesenseWatchSearchCollectionBinding
  const members = Object.values(binding)
  if (members.some((collection) => CURRENT_ALIAS_NAMES.has(collection))) {
    throw new TypesenseWatchSearchProfileError(
      "candidate binding must use exact physical collections, not current aliases",
    )
  }
  if (new Set(members).size !== members.length) {
    throw new TypesenseWatchSearchProfileError(
      "candidate binding members must be distinct",
    )
  }
  const candidatePrefix = `${TYPESENSE_WATCH_CANDIDATE_PREFIX}_${generationId}`
  for (const role of ["catalog", "availability", "lexical"] as const) {
    if (!binding[role].startsWith(`${candidatePrefix}_`)) {
      throw new TypesenseWatchSearchProfileError(
        `candidate ${role} collection does not belong to generation ${generationId}`,
      )
    }
  }

  return immutableProfile({
    kind: "CANDIDATE",
    binding,
    generationId,
    applicationRevision,
    transcriptProjectionRevision: generation.transcriptProjectionRevision,
    fieldManifests: generation.fieldManifests,
    allowCompatibilityFallback: false,
  })
}

export async function resolveCandidateWatchSearchProfile(input: {
  generations: CandidateGenerationResolver
  generationId: string
  applicationRevision: string
  transcriptCollection: string
  transcriptProjectionRevision: bigint
  requireQualified?: boolean
  currentBindings?: readonly string[]
  qrelsRevision?: string
  rankingRevision?: string
}): Promise<TypesenseWatchSearchProfile> {
  const generation = await input.generations.resolveGeneration({
    generationId: input.generationId,
    applicationRevision: input.applicationRevision,
    transcriptCollection: input.transcriptCollection,
    transcriptProjectionRevision: input.transcriptProjectionRevision,
    requireQualified: input.requireQualified,
    currentBindings: input.currentBindings,
    qrelsRevision: input.qrelsRevision,
    rankingRevision: input.rankingRevision,
  })
  return createCandidateWatchSearchProfile(generation)
}

export async function freezeCurrentWatchSearchProfile(
  typesense: AliasReader,
): Promise<TypesenseWatchSearchProfile> {
  const entries = await Promise.all(
    Object.entries(CURRENT_ALIASES).map(async ([role, alias]) => {
      const resolved = await typesense.getAlias(alias)
      return [role, exactAliasTarget(alias, resolved)] as const
    }),
  )
  const binding = Object.fromEntries(
    entries,
  ) as TypesenseWatchSearchCollectionBinding
  if (new Set(Object.values(binding)).size !== entries.length) {
    throw new TypesenseWatchSearchProfileError(
      "current aliases do not resolve to distinct physical collections",
    )
  }
  return immutableProfile({
    kind: "CURRENT",
    binding,
    generationId: null,
    applicationRevision: null,
    transcriptProjectionRevision: null,
    fieldManifests: null,
    allowCompatibilityFallback: false,
  })
}

function exactAliasTarget(alias: string, resolved: TypesenseAlias | undefined) {
  const target = resolved?.collection_name.trim()
  if (!target || target === alias || CURRENT_ALIAS_NAMES.has(target)) {
    throw new TypesenseWatchSearchProfileError(
      `current alias ${alias} does not resolve to an exact physical collection`,
    )
  }
  return target
}

export function watchSearchBindingMembers(
  profile: TypesenseWatchSearchProfile,
): readonly string[] {
  const { binding } = profile
  return Object.freeze([
    binding.catalog,
    binding.availability,
    binding.lexical,
    binding.transcript,
  ])
}

export function assertQualificationProfilesMatchLease(input: {
  current: TypesenseWatchSearchProfile
  candidate: TypesenseWatchSearchProfile
  lease: TypesenseWatchSearchQualificationLeaseIdentity
  now?: Date
}): void {
  const now = input.now ?? new Date()
  if (input.lease.expiresAt.getTime() <= now.getTime()) {
    throw new TypesenseWatchSearchProfileError(
      "qualification binding lease has expired",
    )
  }
  if (
    input.current.kind !== "CURRENT" ||
    input.current.allowCompatibilityFallback
  ) {
    throw new TypesenseWatchSearchProfileError(
      "qualification current profile must be frozen to physical collections",
    )
  }
  if (input.candidate.kind !== "CANDIDATE") {
    throw new TypesenseWatchSearchProfileError(
      "qualification candidate profile is required",
    )
  }
  const currentBindings = watchSearchBindingMembers(input.current)
  if (
    currentBindings.length !== input.lease.currentBindings.length ||
    currentBindings.some(
      (collection, index) => collection !== input.lease.currentBindings[index],
    )
  ) {
    throw new TypesenseWatchSearchProfileError(
      "qualification current binding drifted from its lease",
    )
  }
  if (
    input.candidate.generationId !== input.lease.generationId ||
    input.candidate.applicationRevision !== input.lease.applicationRevision ||
    input.candidate.binding.transcript !== input.lease.transcriptCollection ||
    input.candidate.transcriptProjectionRevision !==
      input.lease.transcriptProjectionRevision
  ) {
    throw new TypesenseWatchSearchProfileError(
      "qualification candidate binding drifted from its lease",
    )
  }
}
