import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import {
  type CandidateAuthorizingQualificationStatus,
  type CandidateQualificationAudit,
  TypesenseWatchSearchCandidateGenerationService,
} from "@/services/typesense-watch-search-candidate-generation"
import {
  hasPassingCandidateQualificationEvidence,
  parseCandidateOperatorAcceptanceBundle,
  WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_MAX_BYTES,
  WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_SCHEMA,
} from "@/services/typesense-watch-search-candidate-qualification"
import {
  candidateWatchSearchIndexContractRevision,
  candidateWatchSearchRankingRevision,
} from "@/services/typesense-watch-search-candidate-identity"
import {
  freezeCurrentWatchSearchProfile,
  watchSearchBindingMembers,
} from "@/services/typesense-watch-search-profile"
import { TypesenseClient } from "@/services/typesense-client"

type QualificationGeneration = {
  id: string
  state: string
  indexContractRevision: string
  catalogCollection: string
  availabilityCollection: string
  lexicalCollection: string
  transcriptCollection: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
  transcriptProjectionRevision: bigint
}

type QualificationPointer = {
  generationId: string | null
  version: number
}

type RecordQualificationInput = {
  generationId: string
  status: CandidateAuthorizingQualificationStatus
  indexContractRevision: string
  rankingRevision: string
  transcriptCollection: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
  transcriptProjectionRevision: bigint
  qrelsRevision: string
  currentBindings: readonly string[]
  evidence: Record<string, unknown>
  qualificationAudit: CandidateQualificationAudit
}

type PinServingInput = {
  generationId: string
  indexContractRevision: string
  expectedPointerVersion: number
  currentBindings: readonly string[]
  qrelsRevision: string
  rankingRevision: string
  qualificationAudit: CandidateQualificationAudit
  qualificationStatus?: CandidateAuthorizingQualificationStatus
}

type QualificationOperatorService = {
  getGeneration(generationId: string): Promise<QualificationGeneration>
  getPointer(kind: "SERVING"): Promise<QualificationPointer>
  recordQualification(input: RecordQualificationInput): Promise<{ id: string }>
  pinServingGeneration(input: PinServingInput): Promise<QualificationPointer>
}

export type QualificationOperatorDependencies = {
  readFile(path: string): Promise<Buffer>
  freezeCurrentBindings(): Promise<readonly string[]>
  service: QualificationOperatorService
  operatorIdentity?: string
}

type ReportBinding = {
  catalog: string
  availability: string
  lexical: string
  transcript: string
}

type QualifiedReport = {
  raw: Record<string, unknown>
  authorizationStatus: CandidateAuthorizingQualificationStatus
  reviewerIdentity?: string
  identity: {
    generationId: string
    indexContractRevision: string
    rankingRevision: string
    transcriptCollection: string
    contentEmbeddingContractId: string
    transcriptChunkingVersion: string
    transcriptProjectionRevision: bigint
    qrelsRevision: string
    currentBindings: readonly string[]
    candidateBindings: ReportBinding
  }
}

type ParsedArguments = {
  action: "record" | "pin"
  reportPath: string
  expectedSha256: string
  expectedByteLength?: number
  reviewerIdentity?: string
  operatorIdentity?: string
  expectedPointerVersion?: number
}

export class QualificationOperatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QualificationOperatorError"
  }
}

async function readBoundedEvidenceFile(path: string): Promise<Buffer> {
  const file = await open(path, "r")
  const bytes = Buffer.allocUnsafe(
    WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_MAX_BYTES + 1,
  )
  let offset = 0
  try {
    while (offset < bytes.byteLength) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
  } finally {
    await file.close()
  }
  return bytes.subarray(0, offset)
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QualificationOperatorError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new QualificationOperatorError(`${name} is required`)
  }
  const normalized = value.trim()
  if (/\p{Cc}/u.test(normalized)) {
    throw new QualificationOperatorError(`${name} contains control characters`)
  }
  return normalized
}

function reportBinding(value: unknown, name: string): ReportBinding {
  const binding = objectValue(value, name)
  const expectedKeys = ["availability", "catalog", "lexical", "transcript"]
  if (Object.keys(binding).sort().join(",") !== expectedKeys.join(",")) {
    throw new QualificationOperatorError(
      `${name} must contain catalog, availability, lexical, and transcript`,
    )
  }
  return {
    catalog: requiredString(binding.catalog, `${name}.catalog`),
    availability: requiredString(binding.availability, `${name}.availability`),
    lexical: requiredString(binding.lexical, `${name}.lexical`),
    transcript: requiredString(binding.transcript, `${name}.transcript`),
  }
}

function bindingMembers(value: unknown, name: string): readonly string[] {
  const members = Array.isArray(value)
    ? value.map((member, index) => requiredString(member, `${name}[${index}]`))
    : Object.values(reportBinding(value, name))
  if (members.length !== 4 || new Set(members).size !== 4) {
    throw new QualificationOperatorError(
      `${name} must contain four distinct physical collections`,
    )
  }
  return members
}

function exactArrayMatch(
  actual: readonly string[],
  expected: readonly string[],
  name: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new QualificationOperatorError(`${name} does not match`)
  }
}

function parseReport(bytes: Buffer): QualifiedReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString("utf8"))
  } catch (error) {
    throw new QualificationOperatorError(
      `qualification report is not valid JSON: ${
        error instanceof Error ? error.message : "unknown parse failure"
      }`,
    )
  }
  const report = objectValue(parsed, "qualification report")
  if (
    report.schemaVersion === WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_SCHEMA
  ) {
    let bundle
    try {
      bundle = parseCandidateOperatorAcceptanceBundle(report)
    } catch (error) {
      throw new QualificationOperatorError(
        error instanceof Error
          ? error.message
          : "operator acceptance bundle is invalid",
      )
    }
    if (
      bundle.identity.indexContractRevision !==
      candidateWatchSearchIndexContractRevision()
    ) {
      throw new QualificationOperatorError(
        "operator acceptance index contract revision is incompatible with this application",
      )
    }
    if (
      bundle.identity.rankingRevision !== candidateWatchSearchRankingRevision()
    ) {
      throw new QualificationOperatorError(
        "operator acceptance ranking revision is incompatible with this application",
      )
    }
    return {
      raw: report,
      authorizationStatus: "OPERATOR_ACCEPTED",
      reviewerIdentity: bundle.userAcceptance.reviewerIdentity,
      identity: {
        generationId: bundle.identity.generationId,
        indexContractRevision: bundle.identity.indexContractRevision,
        rankingRevision: bundle.identity.rankingRevision,
        transcriptCollection: bundle.identity.transcriptCollection,
        contentEmbeddingContractId: bundle.identity.contentEmbeddingContractId,
        transcriptChunkingVersion: bundle.identity.transcriptChunkingVersion,
        transcriptProjectionRevision: BigInt(
          bundle.identity.transcriptProjectionRevision,
        ),
        qrelsRevision: bundle.identity.qrelsRevision,
        currentBindings: bundle.identity.currentBindings,
        candidateBindings: bundle.identity.candidateBindings,
      },
    }
  }
  if (
    report.schemaVersion !== "watch-search-candidate-qualification/v2" ||
    report.status !== "QUALIFIED" ||
    !Array.isArray(report.reasons) ||
    report.reasons.length !== 0
  ) {
    throw new QualificationOperatorError(
      "qualification report must be an exact QUALIFIED v2 report with no reasons",
    )
  }
  const generatedAt = requiredString(report.generatedAt, "report generatedAt")
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new QualificationOperatorError("report generatedAt is invalid")
  }
  if (!hasPassingCandidateQualificationEvidence(report.evidence)) {
    throw new QualificationOperatorError(
      "every qualification evidence gate and artifact must pass",
    )
  }
  if (report.audit !== undefined) {
    throw new QualificationOperatorError(
      "qualification report must not contain self-asserted audit fields",
    )
  }

  const identity = objectValue(report.identity, "qualification identity")
  const transcriptProjectionRevision = requiredString(
    identity.transcriptProjectionRevision,
    "transcript projection revision",
  )
  if (!/^\d+$/.test(transcriptProjectionRevision)) {
    throw new QualificationOperatorError(
      "transcript projection revision must be a non-negative integer",
    )
  }
  const indexContractRevision = requiredString(
    identity.indexContractRevision,
    "index contract revision",
  )
  if (indexContractRevision !== candidateWatchSearchIndexContractRevision()) {
    throw new QualificationOperatorError(
      "qualification report index contract revision is incompatible with this application",
    )
  }
  const rankingRevision = requiredString(
    identity.rankingRevision,
    "ranking revision",
  )
  if (rankingRevision !== candidateWatchSearchRankingRevision()) {
    throw new QualificationOperatorError(
      "qualification report ranking revision is incompatible with this application",
    )
  }
  return {
    raw: report,
    authorizationStatus: "PASSED",
    identity: {
      generationId: requiredString(identity.generationId, "generation id"),
      indexContractRevision,
      rankingRevision,
      transcriptCollection: requiredString(
        identity.transcriptCollection,
        "transcript collection",
      ),
      contentEmbeddingContractId: requiredString(
        identity.contentEmbeddingContractId,
        "content embedding contract id",
      ),
      transcriptChunkingVersion: requiredString(
        identity.transcriptChunkingVersion,
        "transcript chunking version",
      ),
      transcriptProjectionRevision: BigInt(transcriptProjectionRevision),
      qrelsRevision: requiredString(identity.qrelsRevision, "qrels revision"),
      currentBindings: bindingMembers(
        identity.currentBindings,
        "current bindings",
      ),
      candidateBindings: reportBinding(
        identity.candidateBindings,
        "candidate bindings",
      ),
    },
  }
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const [action, ...optionArguments] = argv
  if (action !== "record" && action !== "pin") {
    throw new QualificationOperatorError("action must be either record or pin")
  }
  const allowed = new Set([
    "report",
    "reviewer",
    "operator",
    "sha256",
    "byte-length",
    ...(action === "pin" ? ["expected-pointer-version"] : []),
  ])
  const options = new Map<string, string>()
  for (const argument of optionArguments) {
    const match = /^--([^=]+)=(.*)$/s.exec(argument)
    if (!match || !allowed.has(match[1]!) || options.has(match[1]!)) {
      throw new QualificationOperatorError(
        `unknown or duplicate qualification argument: ${argument}`,
      )
    }
    options.set(match[1]!, match[2]!)
  }
  if (!options.has("report") || !options.has("sha256")) {
    throw new QualificationOperatorError(
      `missing required ${action} qualification arguments`,
    )
  }

  const evidenceBundleSha256 = requiredString(
    options.get("sha256"),
    "evidence bundle SHA-256",
  ).toLowerCase()
  if (!/^sha256:[a-f0-9]{64}$/.test(evidenceBundleSha256)) {
    throw new QualificationOperatorError(
      "evidence bundle SHA-256 must use sha256:<64 lowercase hex characters>",
    )
  }

  const expectedPointerVersionRaw = options.get("expected-pointer-version")
  if (action === "pin" && expectedPointerVersionRaw === undefined) {
    throw new QualificationOperatorError(
      "missing required pin qualification arguments",
    )
  }
  if (
    expectedPointerVersionRaw !== undefined &&
    !/^(?:0|[1-9]\d*)$/.test(expectedPointerVersionRaw)
  ) {
    throw new QualificationOperatorError(
      "expected pointer version must be a canonical non-negative decimal safe integer",
    )
  }
  const expectedPointerVersion =
    expectedPointerVersionRaw === undefined
      ? undefined
      : Number(expectedPointerVersionRaw)
  if (
    expectedPointerVersion !== undefined &&
    (!Number.isSafeInteger(expectedPointerVersion) ||
      expectedPointerVersion < 0)
  ) {
    throw new QualificationOperatorError(
      "expected pointer version must be a non-negative safe integer",
    )
  }

  const expectedByteLengthRaw = options.get("byte-length")
  if (
    expectedByteLengthRaw !== undefined &&
    !/^[1-9]\d*$/.test(expectedByteLengthRaw)
  ) {
    throw new QualificationOperatorError(
      "evidence bundle byte length must be a canonical positive decimal safe integer",
    )
  }
  const expectedByteLength =
    expectedByteLengthRaw === undefined
      ? undefined
      : Number(expectedByteLengthRaw)
  if (
    expectedByteLength !== undefined &&
    !Number.isSafeInteger(expectedByteLength)
  ) {
    throw new QualificationOperatorError(
      "evidence bundle byte length must be a positive safe integer",
    )
  }

  return {
    action,
    reportPath: requiredString(options.get("report"), "report path"),
    expectedSha256: evidenceBundleSha256,
    expectedByteLength,
    reviewerIdentity: options.get("reviewer"),
    operatorIdentity: options.get("operator"),
    expectedPointerVersion,
  }
}

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

export function typesenseOperatorIdentity(apiKey: string): string {
  const credential = requiredString(apiKey, "TYPESENSE_OPERATOR_API_KEY")
  return `typesense-operator:sha256:${createHash("sha256")
    .update(credential)
    .digest("hex")}`
}

function assertGenerationMatches(
  generation: QualificationGeneration,
  report: QualifiedReport,
): void {
  const { identity } = report
  if (
    generation.id !== identity.generationId ||
    generation.state !== "READY" ||
    generation.indexContractRevision !== identity.indexContractRevision ||
    generation.transcriptCollection !== identity.transcriptCollection ||
    generation.contentEmbeddingContractId !==
      identity.contentEmbeddingContractId ||
    generation.transcriptChunkingVersion !==
      identity.transcriptChunkingVersion ||
    generation.transcriptProjectionRevision !==
      identity.transcriptProjectionRevision ||
    generation.catalogCollection !== identity.candidateBindings.catalog ||
    generation.availabilityCollection !==
      identity.candidateBindings.availability ||
    generation.lexicalCollection !== identity.candidateBindings.lexical ||
    generation.transcriptCollection !== identity.candidateBindings.transcript
  ) {
    throw new QualificationOperatorError(
      "qualification report does not match the exact READY Candidate generation",
    )
  }
}

export async function runWatchSearchCandidateQualificationOperator(
  argv: readonly string[],
  dependencies: QualificationOperatorDependencies,
) {
  const parsedArguments = parseArguments(argv)
  const reportBytes = await dependencies.readFile(parsedArguments.reportPath)
  if (
    reportBytes.byteLength >
    WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_MAX_BYTES
  ) {
    throw new QualificationOperatorError(
      "operator acceptance bundle exceeds the 8 MiB limit",
    )
  }
  if (
    parsedArguments.expectedByteLength !== undefined &&
    reportBytes.byteLength !== parsedArguments.expectedByteLength
  ) {
    throw new QualificationOperatorError(
      "evidence bundle byte length does not match the exact report bytes read",
    )
  }
  const observedDigest = digest(reportBytes)
  if (observedDigest !== parsedArguments.expectedSha256) {
    throw new QualificationOperatorError(
      "evidence bundle digest does not match the exact report bytes read",
    )
  }

  const report = parseReport(reportBytes)
  let qualificationAudit: CandidateQualificationAudit
  if (report.authorizationStatus === "OPERATOR_ACCEPTED") {
    if (parsedArguments.reviewerIdentity || parsedArguments.operatorIdentity) {
      throw new QualificationOperatorError(
        "operator acceptance rejects caller-supplied reviewer or operator identity",
      )
    }
    if (parsedArguments.expectedByteLength === undefined) {
      throw new QualificationOperatorError(
        "operator acceptance requires the exact evidence bundle byte length",
      )
    }
    qualificationAudit = {
      reviewerIdentity: report.reviewerIdentity!,
      operatorIdentity: requiredString(
        dependencies.operatorIdentity,
        "authenticated Typesense operator identity",
      ),
      evidenceBundleSha256: observedDigest,
      evidenceBundleByteLength: reportBytes.byteLength,
    }
  } else {
    if (parsedArguments.expectedByteLength !== undefined) {
      throw new QualificationOperatorError(
        "automated PASSED reports do not accept operator bundle byte length",
      )
    }
    qualificationAudit = {
      reviewerIdentity: requiredString(
        parsedArguments.reviewerIdentity,
        "reviewer identity",
      ),
      operatorIdentity: requiredString(
        parsedArguments.operatorIdentity,
        "operator identity",
      ),
      evidenceBundleSha256: observedDigest,
    }
  }
  const generation = await dependencies.service.getGeneration(
    report.identity.generationId,
  )
  assertGenerationMatches(generation, report)
  const currentBindings = await dependencies.freezeCurrentBindings()
  exactArrayMatch(
    report.identity.currentBindings,
    currentBindings,
    "current physical bindings",
  )

  if (parsedArguments.action === "record") {
    const evidence = { ...report.raw, audit: qualificationAudit }
    const qualification = await dependencies.service.recordQualification({
      generationId: report.identity.generationId,
      status: report.authorizationStatus,
      indexContractRevision: report.identity.indexContractRevision,
      rankingRevision: report.identity.rankingRevision,
      transcriptCollection: report.identity.transcriptCollection,
      contentEmbeddingContractId: report.identity.contentEmbeddingContractId,
      transcriptChunkingVersion: report.identity.transcriptChunkingVersion,
      transcriptProjectionRevision:
        report.identity.transcriptProjectionRevision,
      qrelsRevision: report.identity.qrelsRevision,
      currentBindings,
      evidence,
      qualificationAudit,
    })
    return {
      action: "record" as const,
      status: "recorded" as const,
      generationId: report.identity.generationId,
      qualificationId: qualification.id,
      authorizationStatus: report.authorizationStatus,
      reviewerIdentity: qualificationAudit.reviewerIdentity,
      operatorIdentity: qualificationAudit.operatorIdentity,
      evidenceBundleSha256: observedDigest,
      ...(qualificationAudit.evidenceBundleByteLength === undefined
        ? {}
        : {
            evidenceBundleByteLength:
              qualificationAudit.evidenceBundleByteLength,
          }),
    }
  }

  const pointer = await dependencies.service.getPointer("SERVING")
  if (pointer.version !== parsedArguments.expectedPointerVersion) {
    throw new QualificationOperatorError(
      `serving pointer version is ${pointer.version}, not expected pointer version ${parsedArguments.expectedPointerVersion}`,
    )
  }
  const pinned = await dependencies.service.pinServingGeneration({
    generationId: report.identity.generationId,
    indexContractRevision: report.identity.indexContractRevision,
    expectedPointerVersion: parsedArguments.expectedPointerVersion!,
    currentBindings,
    qrelsRevision: report.identity.qrelsRevision,
    rankingRevision: report.identity.rankingRevision,
    qualificationAudit,
    ...(report.authorizationStatus === "OPERATOR_ACCEPTED"
      ? { qualificationStatus: "OPERATOR_ACCEPTED" as const }
      : {}),
  })
  const readback = await dependencies.service.getPointer("SERVING")
  if (
    readback.generationId !== report.identity.generationId ||
    readback.version !== pinned.version
  ) {
    throw new QualificationOperatorError(
      "serving pointer readback does not match the pinned Candidate generation",
    )
  }
  return {
    action: "pin" as const,
    status: "pinned" as const,
    generationId: report.identity.generationId,
    pointerVersion: readback.version,
    authorizationStatus: report.authorizationStatus,
    reviewerIdentity: qualificationAudit.reviewerIdentity,
    operatorIdentity: qualificationAudit.operatorIdentity,
    evidenceBundleSha256: observedDigest,
    ...(qualificationAudit.evidenceBundleByteLength === undefined
      ? {}
      : {
          evidenceBundleByteLength: qualificationAudit.evidenceBundleByteLength,
        }),
  }
}

function requiredEnvironment(value: string | undefined, name: string): string {
  value = value?.trim()
  if (!value) throw new QualificationOperatorError(`${name} is required`)
  return value
}

async function main(argv: readonly string[] = process.argv.slice(2)) {
  const host = requiredEnvironment(env.TYPESENSE_HOST, "TYPESENSE_HOST")
  const apiKey = requiredEnvironment(
    env.TYPESENSE_OPERATOR_API_KEY,
    "TYPESENSE_OPERATOR_API_KEY",
  )
  const typesense = new TypesenseClient({ host, apiKey, timeoutMs: 10_000 })
  const service = new TypesenseWatchSearchCandidateGenerationService(
    prisma,
    typesense,
  )
  const result = await runWatchSearchCandidateQualificationOperator(argv, {
    readFile: readBoundedEvidenceFile,
    service,
    operatorIdentity: typesenseOperatorIdentity(apiKey),
    freezeCurrentBindings: async () =>
      watchSearchBindingMembers(
        await freezeCurrentWatchSearchProfile(typesense),
      ),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error) => {
      process.stderr.write(
        `[watch-search-candidate-qualification] ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      )
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
