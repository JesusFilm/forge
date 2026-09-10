import { print } from "@apollo/client/utilities"
import { adminGraphql } from "@forge/admin-graphql"
import {
  studioApplySchema,
  studioApproveSchema,
  studioAttemptSchema,
  studioCommandBaseSchema,
  studioCommandResultSchema,
  studioCompleteSchema,
  studioCreateSchema,
  studioListSchema,
  studioProjectSchema,
  studioProjectSummarySchema,
  studioRequestSchema,
  studioStartSchema,
  type StudioApply,
  type StudioApprove,
  type StudioComplete,
  type StudioCreate,
  type StudioRequest,
  type StudioStart,
  studioHistorySchema,
  studioRevisionSchema,
  studioApprovalSchema,
} from "@forge/studio-contracts"
import { z } from "zod"

// The transport supplies verified authentication, never a payload actor ID.
// Backend bearers retain service attribution and cannot approve human review.
export type StudioAdminTransport = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<unknown>
const resultFragment = adminGraphql(
  `fragment ShortsCommandFields on ShortsCommandResult { projectId revision outcome attemptId approvalId }`,
)
const create = adminGraphql(
  `mutation ShortsCreate($input: ShortsCreateInput!) { createShortsProject(input: $input) { ...ShortsCommandFields } }`,
  [resultFragment],
)
const apply = adminGraphql(
  `mutation ShortsApply($input: ShortsApplyInput!) { applyShortsOperations(input: $input) { ...ShortsCommandFields } }`,
  [resultFragment],
)
const request = adminGraphql(
  `mutation ShortsRequest($input: ShortsRequestInput!) { requestShortsAttempt(input: $input) { ...ShortsCommandFields } }`,
  [resultFragment],
)
const approve = adminGraphql(
  `mutation ShortsApprove($input: ShortsApproveInput!) { approveShortsProject(input: $input) { ...ShortsCommandFields } }`,
  [resultFragment],
)
const start = adminGraphql(
  `mutation ShortsStart($input: ShortsStartInput!) { startShortsAttempt(input: $input) { ...ShortsCommandFields } }`,
  [resultFragment],
)
const complete = adminGraphql(
  `mutation ShortsComplete($input: ShortsCompleteInput!) { completeShortsAttempt(input: $input) { ...ShortsCommandFields } }`,
  [resultFragment],
)
const unpublish = adminGraphql(
  `mutation ShortsUnpublish($input: ShortsRevisionCommandInput!) { unpublishShortsProject(input: $input) { ...ShortsCommandFields } }`,
  [resultFragment],
)
const read = adminGraphql(
  `query ShortsRead($projectId: ID!) { shortsProject(projectId: $projectId) { projectId sourceVideoDubId revision lifecycle firstPublishedAt document actor { kind id } } }`,
)
const list = adminGraphql(
  `query ShortsList($cursor: ID, $limit: Int) { shortsProjects(cursor: $cursor, limit: $limit) { projectId revision lifecycle } }`,
)
const attempt = adminGraphql(
  `query ShortsAttempt($projectId: ID!, $attemptId: ID!) { shortsAttempt(projectId: $projectId, attemptId: $attemptId) { id projectId baseRevision kind status inputHash instructions result jobReference actor { kind id } } }`,
)

const history = adminGraphql(
  `query ShortsHistory($projectId: ID!, $beforeRevision: Int, $limit: Int) { shortsHistory(projectId: $projectId, beforeRevision: $beforeRevision, limit: $limit) { revision document actor { kind id } } }`,
)
const attempts = adminGraphql(
  `query ShortsAttempts($projectId: ID!, $cursor: ID, $limit: Int) { shortsAttempts(projectId: $projectId, cursor: $cursor, limit: $limit) { id projectId baseRevision kind status inputHash instructions result jobReference actor { kind id } } }`,
)
const approvals = adminGraphql(
  `query ShortsApprovals($projectId: ID!, $cursor: ID, $limit: Int) { shortsApprovals(projectId: $projectId, cursor: $cursor, limit: $limit) { id projectId revision kind dependencyHash renderAttemptId actor { kind id } } }`,
)

export function createStudioAdminAdapter(transport: StudioAdminTransport) {
  async function command(
    query: Parameters<typeof print>[0],
    field: string,
    input: unknown,
  ) {
    const payload = z
      .record(z.string(), z.unknown())
      .parse(await transport(print(query), { input }))
    const value = z.record(z.string(), z.unknown()).parse(payload[field])
    return studioCommandResultSchema.parse({
      ...value,
      attemptId: value.attemptId ?? undefined,
      approvalId: value.approvalId ?? undefined,
    })
  }
  return {
    create: (input: StudioCreate) =>
      command(create, "createShortsProject", studioCreateSchema.parse(input)),
    apply: (input: StudioApply) =>
      command(apply, "applyShortsOperations", studioApplySchema.parse(input)),
    request: (input: StudioRequest) =>
      command(
        request,
        "requestShortsAttempt",
        studioRequestSchema.parse(input),
      ),
    approve: (input: StudioApprove) =>
      command(
        approve,
        "approveShortsProject",
        studioApproveSchema.parse(input),
      ),
    start: (input: StudioStart) =>
      command(start, "startShortsAttempt", studioStartSchema.parse(input)),
    complete: (input: StudioComplete) =>
      command(
        complete,
        "completeShortsAttempt",
        studioCompleteSchema.parse(input),
      ),
    unpublish: (input: z.infer<typeof studioCommandBaseSchema>) =>
      command(
        unpublish,
        "unpublishShortsProject",
        studioCommandBaseSchema.parse(input),
      ),
    async history(
      projectId: string,
      input: z.input<typeof studioHistorySchema> = {},
    ) {
      const data = z
        .object({ shortsHistory: z.array(studioRevisionSchema).max(20) })
        .parse(
          await transport(print(history), {
            projectId,
            ...studioHistorySchema.parse(input),
          }),
        )
      return data.shortsHistory
    },
    async attempts(
      projectId: string,
      input: z.input<typeof studioListSchema> = {},
    ) {
      const data = z
        .object({ shortsAttempts: z.array(studioAttemptSchema).max(100) })
        .parse(
          await transport(print(attempts), {
            projectId,
            ...studioListSchema.parse(input),
          }),
        )
      return data.shortsAttempts
    },
    async approvals(
      projectId: string,
      input: z.input<typeof studioListSchema> = {},
    ) {
      const data = z
        .object({ shortsApprovals: z.array(studioApprovalSchema).max(100) })
        .parse(
          await transport(print(approvals), {
            projectId,
            ...studioListSchema.parse(input),
          }),
        )
      return data.shortsApprovals
    },
    async read(projectId: string) {
      const data = z
        .object({ shortsProject: studioProjectSchema })
        .parse(await transport(print(read), { projectId }))
      return data.shortsProject
    },
    async list(input: z.input<typeof studioListSchema> = {}) {
      const data = z
        .object({
          shortsProjects: z.array(studioProjectSummarySchema).max(100),
        })
        .parse(await transport(print(list), studioListSchema.parse(input)))
      return data.shortsProjects
    },
    async readAttempt(projectId: string, attemptId: string) {
      const data = z
        .object({ shortsAttempt: studioAttemptSchema })
        .parse(await transport(print(attempt), { projectId, attemptId }))
      return data.shortsAttempt
    },
  }
}
