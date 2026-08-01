import type { SeoLessonStatus } from "@prisma/client"
import { builder } from "@/graphql/builder"
import { verifySeoApprovalAssertion } from "@/auth/seo-approval-assertion"
import { SeoAssertionInvalidError } from "@/auth/seo-assertion-keyring"
import type {
  ManagerSeoDecisionRecord,
  ManagerSeoProposalRecord,
} from "@/services/seo-experiment.service"

type Workspace = Awaited<
  ReturnType<
    import("@/services/seo-experiment.service").SeoExperimentService["listWorkspace"]
  >
>

type Experiment = Workspace["experiments"][number]
type Evaluation = Experiment["evaluations"][number]
type Lesson = Workspace["lessons"][number]
type TicketReconciliation = Workspace["ticketReconciliations"][number]

const ManagerSeoDecisionRef = builder
  .objectRef<ManagerSeoDecisionRecord>("ManagerSeoDecisionResult")
  .implement({
    fields: (t) => ({
      status: t.exposeString("status"),
      proposalId: t.exposeID("proposalId"),
      version: t.exposeInt("version"),
      decisionId: t.exposeID("decisionId", { nullable: true }),
      draftRevisionId: t.exposeID("draftRevisionId", { nullable: true }),
      editorPath: t.exposeString("editorPath", { nullable: true }),
      ticketOutboxId: t.exposeID("ticketOutboxId", { nullable: true }),
      message: t.exposeString("message"),
    }),
  })

const ManagerSeoProposalDecisionRef = builder
  .objectRef<
    NonNullable<ManagerSeoProposalRecord["decision"]>
  >("ManagerSeoProposalDecision")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      action: t.exposeString("action"),
      actorId: t.exposeString("actorId"),
      overlapAcknowledged: t.exposeBoolean("overlapAcknowledged"),
      overlapCount: t.exposeInt("overlapCount"),
      reason: t.exposeString("reason", { nullable: true }),
      decidedAt: t.exposeString("decidedAt"),
    }),
  })

const ManagerSeoProposalMaterializationRef = builder
  .objectRef<
    NonNullable<ManagerSeoProposalRecord["materialization"]>
  >("ManagerSeoProposalMaterialization")
  .implement({
    fields: (t) => ({
      status: t.exposeString("status"),
      draftRevisionId: t.exposeID("draftRevisionId", { nullable: true }),
      editorPath: t.exposeString("editorPath", { nullable: true }),
      ticketOutboxId: t.exposeID("ticketOutboxId", { nullable: true }),
    }),
  })

const ManagerSeoProposalRef = builder
  .objectRef<ManagerSeoProposalRecord>("ManagerSeoProposal")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      version: t.exposeInt("version"),
      payloadDigest: t.exposeString("payloadDigest"),
      status: t.exposeString("status"),
      lane: t.exposeString("lane"),
      targetType: t.exposeString("targetType"),
      targetId: t.exposeID("targetId", { nullable: true }),
      canonicalUrl: t.exposeString("canonicalUrl"),
      locale: t.exposeString("locale"),
      intent: t.exposeString("intent"),
      expectedOutcome: t.exposeString("expectedOutcome"),
      risk: t.exposeString("risk"),
      verificationPlan: t.exposeString("verificationPlan"),
      rollbackPlan: t.exposeString("rollbackPlan"),
      editorialDiff: t.field({
        type: "JSON",
        nullable: true,
        resolve: (row) => row.editorialDiff,
      }),
      engineeringBrief: t.field({
        type: "JSON",
        nullable: true,
        resolve: (row) => row.engineeringBrief,
      }),
      evidence: t.field({ type: "JSON", resolve: (row) => row.evidence }),
      caveats: t.field({ type: ["String"], resolve: (row) => row.caveats }),
      overlapCount: t.exposeInt("overlapCount"),
      expiresAt: t.exposeString("expiresAt"),
      createdAt: t.exposeString("createdAt"),
      decision: t.field({
        type: ManagerSeoProposalDecisionRef,
        nullable: true,
        resolve: (row) => row.decision,
      }),
      materialization: t.field({
        type: ManagerSeoProposalMaterializationRef,
        nullable: true,
        resolve: (row) => row.materialization,
      }),
    }),
  })

const ManagerSeoEvaluationRef = builder
  .objectRef<Evaluation>("ManagerSeoEvaluation")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      kind: t.exposeString("kind"),
      outcome: t.exposeString("outcome"),
      metrics: t.field({ type: "JSON", resolve: (row) => row.metrics }),
      evidenceDigest: t.exposeString("evidenceDigest"),
      confounders: t.field({ type: "JSON", resolve: (row) => row.confounders }),
      observedAt: t.exposeString("observedAt"),
    }),
  })

const ManagerSeoExperimentRef = builder
  .objectRef<Experiment>("ManagerSeoExperiment")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      proposalId: t.exposeID("proposalId"),
      proposalVersion: t.exposeInt("proposalVersion"),
      status: t.exposeString("status"),
      canonicalUrl: t.exposeString("canonicalUrl"),
      locale: t.exposeString("locale"),
      lane: t.exposeString("lane"),
      activatedAt: t.exposeString("activatedAt", { nullable: true }),
      observedActivationHash: t.exposeString("observedActivationHash", {
        nullable: true,
      }),
      measurementStartsAt: t.exposeString("measurementStartsAt", {
        nullable: true,
      }),
      interimDueAt: t.exposeString("interimDueAt", { nullable: true }),
      finalDueAt: t.exposeString("finalDueAt", { nullable: true }),
      confounders: t.field({ type: "JSON", resolve: (row) => row.confounders }),
      evaluations: t.field({
        type: [ManagerSeoEvaluationRef],
        resolve: (row) => row.evaluations,
      }),
    }),
  })

const ManagerSeoLessonRef = builder
  .objectRef<Lesson>("ManagerSeoLesson")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      experimentId: t.exposeID("experimentId"),
      proposalId: t.exposeID("proposalId"),
      proposalVersion: t.exposeInt("proposalVersion"),
      status: t.exposeString("status"),
      content: t.exposeString("content"),
      evidenceDigest: t.exposeString("evidenceDigest"),
      metrics: t.field({ type: "JSON", resolve: (row) => row.metrics }),
      confounders: t.field({ type: "JSON", resolve: (row) => row.confounders }),
      reviewedById: t.exposeString("reviewedById", { nullable: true }),
      reviewedAt: t.exposeString("reviewedAt", { nullable: true }),
      createdAt: t.exposeString("createdAt"),
    }),
  })

const ManagerSeoTicketReconciliationRef = builder
  .objectRef<TicketReconciliation>("ManagerSeoTicketReconciliation")
  .implement({
    fields: (t) => ({
      outboxId: t.exposeID("outboxId"),
      proposalId: t.exposeID("proposalId"),
      proposalVersion: t.exposeInt("proposalVersion"),
      status: t.exposeString("status"),
      payloadDigest: t.exposeString("payloadDigest"),
      marker: t.exposeString("marker"),
      attemptCount: t.exposeInt("attemptCount"),
      lastErrorCode: t.exposeString("lastErrorCode", { nullable: true }),
      remoteId: t.exposeString("remoteId", { nullable: true }),
      remoteUrl: t.exposeString("remoteUrl", { nullable: true }),
      attempts: t.field({ type: "JSON", resolve: (row) => row.attempts }),
      candidateTickets: t.field({
        type: "JSON",
        resolve: (row) => row.candidateTickets,
      }),
    }),
  })

const ManagerSeoWorkspaceRef = builder
  .objectRef<Workspace>("ManagerSeoWorkspace")
  .implement({
    fields: (t) => ({
      generatedAt: t.exposeString("generatedAt"),
      proposals: t.field({
        type: [ManagerSeoProposalRef],
        resolve: (row) => row.proposals,
      }),
      experiments: t.field({
        type: [ManagerSeoExperimentRef],
        resolve: (row) => row.experiments,
      }),
      lessons: t.field({
        type: [ManagerSeoLessonRef],
        resolve: (row) => row.lessons,
      }),
      ticketReconciliations: t.field({
        type: [ManagerSeoTicketReconciliationRef],
        resolve: (row) => row.ticketReconciliations,
      }),
    }),
  })

const ManagerSeoApproveInput = builder.inputType("ManagerSeoApproveInput", {
  fields: (t) => ({
    proposalId: t.id({ required: true }),
    version: t.int({ required: true }),
    payloadDigest: t.string({ required: true }),
    assertion: t.string({ required: true }),
    overlapAcknowledged: t.boolean({ required: false, defaultValue: false }),
  }),
})

const ManagerSeoRejectInput = builder.inputType("ManagerSeoRejectInput", {
  fields: (t) => ({
    proposalId: t.id({ required: true }),
    version: t.int({ required: true }),
    payloadDigest: t.string({ required: true }),
    assertion: t.string({ required: true }),
    reason: t.string({ required: false }),
  }),
})

const ManagerSeoLessonReviewInput = builder.inputType(
  "ManagerSeoLessonReviewInput",
  {
    fields: (t) => ({
      lessonId: t.id({ required: true }),
      status: t.string({ required: true }),
      assertion: t.string({ required: true }),
    }),
  },
)

const ManagerSeoTicketReconcileInput = builder.inputType(
  "ManagerSeoTicketReconcileInput",
  {
    fields: (t) => ({
      outboxId: t.id({ required: true }),
      action: t.string({ required: true }),
      remoteId: t.string({ required: false }),
      remoteUrl: t.string({ required: false }),
      assertion: t.string({ required: true }),
    }),
  },
)

function assertionMatchesInput(
  assertion: Awaited<ReturnType<typeof verifySeoApprovalAssertion>>,
  input: {
    proposalId: string | number
    version: number
    payloadDigest: string
  },
) {
  return (
    assertion.proposalId === String(input.proposalId) &&
    assertion.version === input.version &&
    assertion.payloadDigest === input.payloadDigest
  )
}

builder.queryFields((t) => ({
  managerSeoWorkspace: t.field({
    type: ManagerSeoWorkspaceRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { limit: t.arg.int({ required: false, defaultValue: 50 }) },
    resolve: (_root, args, ctx) =>
      ctx.services.seoExperiment.listWorkspace({
        user: ctx.user,
        limit: args.limit ?? 50,
      }),
  }),
  managerSeoProposal: t.field({
    type: ManagerSeoProposalRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.seoExperiment.getProposal({
        user: ctx.user,
        id: String(args.id),
      }),
  }),
}))

builder.mutationFields((t) => ({
  approveManagerSeoProposal: t.field({
    type: ManagerSeoDecisionRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { input: t.arg({ type: ManagerSeoApproveInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      if (!assertionMatchesInput(assertion, input)) {
        throw new SeoAssertionInvalidError()
      }
      return ctx.services.seoExperiment.decideProposal({
        user: ctx.user,
        assertion,
        expectedAction: "approve",
        overlapAcknowledged: input.overlapAcknowledged ?? false,
      })
    },
  }),
  rejectManagerSeoProposal: t.field({
    type: ManagerSeoDecisionRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { input: t.arg({ type: ManagerSeoRejectInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      if (!assertionMatchesInput(assertion, input)) {
        throw new SeoAssertionInvalidError()
      }
      return ctx.services.seoExperiment.decideProposal({
        user: ctx.user,
        assertion,
        expectedAction: "reject",
        reason: input.reason,
      })
    },
  }),
  reviewManagerSeoLesson: t.field({
    type: ManagerSeoLessonRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: {
      input: t.arg({ type: ManagerSeoLessonReviewInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      const statuses: ReadonlySet<string> = new Set([
        "ACTIVE",
        "SUPERSEDED",
        "RETIRED",
      ])
      if (!statuses.has(input.status)) throw new SeoAssertionInvalidError()
      return ctx.services.seoExperiment.reviewLesson({
        user: ctx.user,
        assertion,
        lessonId: String(input.lessonId),
        status: input.status as SeoLessonStatus,
      })
    },
  }),
  reconcileManagerSeoTicket: t.field({
    type: ManagerSeoTicketReconciliationRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: {
      input: t.arg({ type: ManagerSeoTicketReconcileInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      if (input.action !== "BIND_EXISTING" && input.action !== "MARK_FAILED") {
        throw new SeoAssertionInvalidError()
      }
      return ctx.services.seoExperiment.reconcileTicket({
        user: ctx.user,
        assertion,
        outboxId: String(input.outboxId),
        action: input.action,
        remoteId: input.remoteId,
        remoteUrl: input.remoteUrl,
      })
    },
  }),
}))
