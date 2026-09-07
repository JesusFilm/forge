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
  `fragment StudioCommandFields on StudioCommandResult { projectId revision outcome attemptId approvalId }`,
)
const create = adminGraphql(
  `mutation StudioCreate($input: StudioCreateInput!) { createStudioProject(input: $input) { ...StudioCommandFields } }`,
  [resultFragment],
)
const apply = adminGraphql(
  `mutation StudioApply($input: StudioApplyInput!) { applyStudioOperations(input: $input) { ...StudioCommandFields } }`,
  [resultFragment],
)
const request = adminGraphql(
  `mutation StudioRequest($input: StudioRequestInput!) { requestStudioAttempt(input: $input) { ...StudioCommandFields } }`,
  [resultFragment],
)
const approve = adminGraphql(
  `mutation StudioApprove($input: StudioApproveInput!) { approveStudioProject(input: $input) { ...StudioCommandFields } }`,
  [resultFragment],
)
const start = adminGraphql(
  `mutation StudioStart($input: StudioStartInput!) { startStudioAttempt(input: $input) { ...StudioCommandFields } }`,
  [resultFragment],
)
const complete = adminGraphql(
  `mutation StudioComplete($input: StudioCompleteInput!) { completeStudioAttempt(input: $input) { ...StudioCommandFields } }`,
  [resultFragment],
)
const unpublish = adminGraphql(
  `mutation StudioUnpublish($input: StudioRevisionCommandInput!) { unpublishStudioProject(input: $input) { ...StudioCommandFields } }`,
  [resultFragment],
)
const read = adminGraphql(
  `query StudioRead($projectId: ID!) { studioProject(projectId: $projectId) { projectId revision lifecycle firstPublishedAt document actor { kind id } } }`,
)
const list = adminGraphql(
  `query StudioList($cursor: ID, $limit: Int) { studioProjects(cursor: $cursor, limit: $limit) { projectId revision lifecycle } }`,
)
const attempt = adminGraphql(
  `query StudioAttempt($projectId: ID!, $attemptId: ID!) { studioAttempt(projectId: $projectId, attemptId: $attemptId) { id projectId baseRevision kind status inputHash instructions result jobReference actor { kind id } } }`,
)

const history = adminGraphql(
  `query StudioHistory($projectId: ID!, $beforeRevision: Int, $limit: Int) { studioHistory(projectId: $projectId, beforeRevision: $beforeRevision, limit: $limit) { revision document actor { kind id } } }`,
)
const attempts = adminGraphql(
  `query StudioAttempts($projectId: ID!, $cursor: ID, $limit: Int) { studioAttempts(projectId: $projectId, cursor: $cursor, limit: $limit) { id projectId baseRevision kind status inputHash instructions result jobReference actor { kind id } } }`,
)
const approvals = adminGraphql(
  `query StudioApprovals($projectId: ID!, $cursor: ID, $limit: Int) { studioApprovals(projectId: $projectId, cursor: $cursor, limit: $limit) { id projectId revision kind dependencyHash renderAttemptId actor { kind id } } }`,
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
      command(create, "createStudioProject", studioCreateSchema.parse(input)),
    apply: (input: StudioApply) =>
      command(apply, "applyStudioOperations", studioApplySchema.parse(input)),
    request: (input: StudioRequest) =>
      command(
        request,
        "requestStudioAttempt",
        studioRequestSchema.parse(input),
      ),
    approve: (input: StudioApprove) =>
      command(
        approve,
        "approveStudioProject",
        studioApproveSchema.parse(input),
      ),
    start: (input: StudioStart) =>
      command(start, "startStudioAttempt", studioStartSchema.parse(input)),
    complete: (input: StudioComplete) =>
      command(
        complete,
        "completeStudioAttempt",
        studioCompleteSchema.parse(input),
      ),
    unpublish: (input: z.infer<typeof studioCommandBaseSchema>) =>
      command(
        unpublish,
        "unpublishStudioProject",
        studioCommandBaseSchema.parse(input),
      ),
    async history(
      projectId: string,
      input: z.input<typeof studioHistorySchema> = {},
    ) {
      const data = z
        .object({ studioHistory: z.array(studioRevisionSchema).max(20) })
        .parse(
          await transport(print(history), {
            projectId,
            ...studioHistorySchema.parse(input),
          }),
        )
      return data.studioHistory
    },
    async attempts(
      projectId: string,
      input: z.input<typeof studioListSchema> = {},
    ) {
      const data = z
        .object({ studioAttempts: z.array(studioAttemptSchema).max(100) })
        .parse(
          await transport(print(attempts), {
            projectId,
            ...studioListSchema.parse(input),
          }),
        )
      return data.studioAttempts
    },
    async approvals(
      projectId: string,
      input: z.input<typeof studioListSchema> = {},
    ) {
      const data = z
        .object({ studioApprovals: z.array(studioApprovalSchema).max(100) })
        .parse(
          await transport(print(approvals), {
            projectId,
            ...studioListSchema.parse(input),
          }),
        )
      return data.studioApprovals
    },
    async read(projectId: string) {
      const data = z
        .object({ studioProject: studioProjectSchema })
        .parse(await transport(print(read), { projectId }))
      return data.studioProject
    },
    async list(input: z.input<typeof studioListSchema> = {}) {
      const data = z
        .object({
          studioProjects: z.array(studioProjectSummarySchema).max(100),
        })
        .parse(await transport(print(list), studioListSchema.parse(input)))
      return data.studioProjects
    },
    async readAttempt(projectId: string, attemptId: string) {
      const data = z
        .object({ studioAttempt: studioAttemptSchema })
        .parse(await transport(print(attempt), { projectId, attemptId }))
      return data.studioAttempt
    },
  }
}
