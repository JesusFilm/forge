import { print } from "@apollo/client/utilities"
import { adminGraphql } from "@forge/admin-graphql"
import { z } from "zod"
import {
  automationDraftSchema,
  automationDryRunReportSchema,
  type EnrichmentAutomation,
  type EnrichmentAutomationRun,
} from "@forge/automation-contracts"

const createRunInputSchema = z.object({
  automationDocumentId: z.string().min(1),
  leaseToken: z.string().uuid(),
  runMode: z.enum(["live", "dry_run"]),
  scheduledFor: z.string().datetime(),
  idempotencyKey: z.string().min(1).max(240).optional(),
})

const runSchema = z.object({
  documentId: z.string(),
  automationDocumentId: z.string().optional(),
  idempotencyKey: z.string().nullish(),
  status: z.enum([
    "claimed",
    "running",
    "success",
    "partial",
    "failed",
    "no_op",
  ]),
  runMode: z.enum(["live", "dry_run"]).default("live"),
  scheduledFor: z.string(),
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish(),
  eligibleCount: z.number().int().nonnegative().default(0),
  enqueuedCount: z.number().int().nonnegative().default(0),
  skippedDuplicateCount: z.number().int().nonnegative().default(0),
  errorCount: z.number().int().nonnegative().default(0),
  jobDocumentIds: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  summary: z.string().nullish(),
  report: z.unknown().transform((value) => {
    const parsed = automationDryRunReportSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  }),
})
const automationSchema = automationDraftSchema.extend({
  documentId: z.string(),
  status: z.enum(["active", "paused"]),
  scheduleSummary: z.string().nullish(),
  timezone: z.string(),
  nextRunAt: z.string().nullish(),
  lastRunAt: z.string().nullish(),
  lastRunStatus: z.enum(["success", "partial", "failed", "no_op"]).nullish(),
  leaseToken: z.string().nullish(),
  leaseExpiresAt: z.string().nullish(),
  runs: z.array(runSchema).default([]),
})
const claimSchema = z
  .object({
    documentId: z.string(),
    leaseToken: z.string().uuid(),
    leaseExpiresAt: z.string(),
  })
  .nullable()
const candidateSchema = z.object({
  eligibleCount: z.number().int().nonnegative(),
  skippedDuplicateCount: z.number().int().nonnegative(),
  candidates: z.array(
    z.object({
      documentId: z.string(),
      coreId: z.string(),
      outputOwner: z.enum(["missing", "ai", "human"]),
    }),
  ),
})
type Requester = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<Record<string, unknown>>
const list = adminGraphql(`query ManagerAutomations { managerAutomations }`)
const get = adminGraphql(
  `query ManagerAutomation($id:ID!) { managerAutomation(id:$id) }`,
)
const getRun = adminGraphql(
  `query ManagerAutomationRun($id:ID!) { managerAutomationRun(id:$id) }`,
)
const findRun = adminGraphql(
  `query ManagerAutomationRunByKey($automationId:ID!,$key:String!) { managerAutomationRunByKey(automationId:$automationId,key:$key) }`,
)
const inFlight = adminGraphql(
  `query ManagerAutomationInFlight($id:ID!) { managerAutomationHasInFlight(id:$id) }`,
)
const languages = adminGraphql(
  `query ManagerAutomationLanguages { managerAutomationLanguages }`,
)
const candidates = adminGraphql(
  `query ManagerAutomationCandidates($input:JSON!) { managerAutomationCandidates(input:$input) }`,
)
const create = adminGraphql(
  `mutation CreateManagerAutomation($input:JSON!) { createManagerAutomation(input:$input) }`,
)
const status = adminGraphql(
  `mutation UpdateManagerAutomationStatus($id:ID!,$status:String!) { updateManagerAutomationStatus(id:$id,status:$status) }`,
)
const claim = adminGraphql(
  `mutation ClaimManagerAutomationRun($id:ID!) { claimManagerAutomationRun(id:$id) }`,
)
const release = adminGraphql(
  `mutation ReleaseManagerAutomationRun($id:ID!,$leaseToken:String!) { releaseManagerAutomationRun(id:$id,leaseToken:$leaseToken) }`,
)
const createRun = adminGraphql(
  `mutation CreateManagerAutomationRun($input:JSON!) { createManagerAutomationRun(input:$input) }`,
)
const complete = adminGraphql(
  `mutation CompleteManagerAutomationRun($id:ID!,$leaseToken:String!,$result:JSON!) { completeManagerAutomationRun(id:$id,leaseToken:$leaseToken,result:$result) }`,
)
const fail = adminGraphql(
  `mutation FailManagerAutomationRun($id:ID!,$leaseToken:String!,$error:String!) { failManagerAutomationRun(id:$id,leaseToken:$leaseToken,error:$error) }`,
)

const beginDispatch = adminGraphql(
  `mutation BeginManagerAutomationDispatch($id:ID!,$leaseToken:String!) { beginManagerAutomationDispatch(id:$id,leaseToken:$leaseToken) }`,
)

export function createAdminAutomationAdapter(request: Requester) {
  return {
    async beginDispatch(id: string, leaseToken: string) {
      return z
        .boolean()
        .parse(
          (await request(print(beginDispatch), { id, leaseToken }))
            .beginManagerAutomationDispatch,
        )
    },
    async list(): Promise<EnrichmentAutomation[]> {
      return z
        .array(automationSchema)
        .parse(
          (await request(print(list))).managerAutomations,
        ) as EnrichmentAutomation[]
    },
    async get(id: string): Promise<EnrichmentAutomation | null> {
      return automationSchema
        .nullable()
        .parse(
          (await request(print(get), { id })).managerAutomation,
        ) as EnrichmentAutomation | null
    },
    async getRun(id: string): Promise<EnrichmentAutomationRun | null> {
      return runSchema
        .nullable()
        .parse(
          (await request(print(getRun), { id })).managerAutomationRun,
        ) as EnrichmentAutomationRun | null
    },
    async findRun(
      automationId: string,
      key: string,
    ): Promise<EnrichmentAutomationRun | null> {
      return runSchema
        .nullable()
        .parse(
          (await request(print(findRun), { automationId, key }))
            .managerAutomationRunByKey,
        ) as EnrichmentAutomationRun | null
    },
    async hasInFlight(id: string) {
      return z
        .boolean()
        .parse(
          (await request(print(inFlight), { id })).managerAutomationHasInFlight,
        )
    },
    async languages() {
      return z
        .array(z.object({ coreId: z.string(), name: z.string() }))
        .parse((await request(print(languages))).managerAutomationLanguages)
    },
    async candidates(input: unknown) {
      return candidateSchema.parse(
        (await request(print(candidates), { input }))
          .managerAutomationCandidates,
      )
    },
    async create(input: unknown): Promise<EnrichmentAutomation> {
      return automationSchema.parse(
        (await request(print(create), { input })).createManagerAutomation,
      ) as EnrichmentAutomation
    },
    async updateStatus(
      id: string,
      nextStatus: "active" | "paused",
    ): Promise<EnrichmentAutomation> {
      return automationSchema.parse(
        (await request(print(status), { id, status: nextStatus }))
          .updateManagerAutomationStatus,
      ) as EnrichmentAutomation
    },
    async claim(id: string) {
      return claimSchema.parse(
        (await request(print(claim), { id })).claimManagerAutomationRun,
      )
    },
    async release(id: string, leaseToken: string) {
      return z
        .boolean()
        .parse(
          (await request(print(release), { id, leaseToken }))
            .releaseManagerAutomationRun,
        )
    },
    async createRun(input: unknown): Promise<EnrichmentAutomationRun> {
      return runSchema.parse(
        (
          await request(print(createRun), {
            input: createRunInputSchema.parse(input),
          })
        ).createManagerAutomationRun,
      ) as EnrichmentAutomationRun
    },
    async complete(
      id: string,
      leaseToken: string,
      result: unknown,
    ): Promise<EnrichmentAutomationRun> {
      return runSchema.parse(
        (await request(print(complete), { id, leaseToken, result }))
          .completeManagerAutomationRun,
      ) as EnrichmentAutomationRun
    },
    async fail(id: string, leaseToken: string, error: string) {
      return z
        .boolean()
        .parse(
          (await request(print(fail), { id, leaseToken, error }))
            .failManagerAutomationRun,
        )
    },
  }
}
