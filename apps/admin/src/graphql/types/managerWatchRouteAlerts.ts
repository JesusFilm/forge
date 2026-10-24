import { builder } from "@/graphql/builder"

type AlertPage = Awaited<
  ReturnType<
    import("@/services/watch-route-alert.service").WatchRouteAlertService["listManagerAlerts"]
  >
>
type LatestRun = NonNullable<AlertPage["latestRun"]>
type Lane = LatestRun["lanes"][number]
type Summary = AlertPage["summary"]
type Item = AlertPage["items"][number]

const ManagerWatchRouteAlertLaneRef = builder
  .objectRef<Lane>("ManagerWatchRouteAlertLane")
  .implement({
    fields: (t) => ({
      source: t.exposeString("source", { nullable: false }),
      status: t.exposeString("status", { nullable: false }),
      countKind: t.exposeString("countKind", { nullable: false }),
      rowCount: t.exposeInt("rowCount", { nullable: false }),
      windowStart: t.exposeString("windowStart", { nullable: false }),
      windowEnd: t.exposeString("windowEnd", { nullable: false }),
      caveats: t.exposeStringList("caveats", { nullable: false }),
    }),
  })

const ManagerWatchRouteAlertRunRef = builder
  .objectRef<LatestRun>("ManagerWatchRouteAlertRun")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id", { nullable: false }),
      propertyId: t.exposeString("propertyId", { nullable: false }),
      mode: t.exposeString("mode", { nullable: false }),
      status: t.exposeString("status", { nullable: false }),
      startedAt: t.exposeString("startedAt", { nullable: false }),
      completedAt: t.exposeString("completedAt", { nullable: true }),
      lanes: t.field({
        type: [ManagerWatchRouteAlertLaneRef],
        nullable: false,
        resolve: (row) => row.lanes,
      }),
      validationCaveats: t.exposeStringList("validationCaveats", {
        nullable: false,
      }),
    }),
  })

const ManagerWatchRouteAlertSummaryRef = builder
  .objectRef<Summary>("ManagerWatchRouteAlertSummary")
  .implement({
    fields: (t) => ({
      open: t.exposeInt("open", { nullable: false }),
      critical: t.exposeInt("critical", { nullable: false }),
      supportedRouteFailures: t.exposeInt("supportedRouteFailures", {
        nullable: false,
      }),
      plausibleMissingRoutes: t.exposeInt("plausibleMissingRoutes", {
        nullable: false,
      }),
      recovered: t.exposeInt("recovered", { nullable: false }),
    }),
  })

const ManagerWatchRouteAlertItemRef = builder
  .objectRef<Item>("ManagerWatchRouteAlertItem")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id", { nullable: false }),
      propertyId: t.exposeString("propertyId", { nullable: false }),
      origin: t.exposeString("origin", { nullable: false }),
      path: t.exposeString("path", { nullable: false }),
      lifecycle: t.exposeString("lifecycle", { nullable: false }),
      verdict: t.exposeString("verdict", { nullable: false }),
      severity: t.exposeString("severity", { nullable: false }),
      count: t.exposeInt("count", { nullable: false }),
      countKind: t.exposeString("countKind", { nullable: false }),
      activeUsers: t.exposeInt("activeUsers", { nullable: false }),
      occurrenceCount: t.exposeInt("occurrenceCount", { nullable: false }),
      firstSeenAt: t.exposeString("firstSeenAt", { nullable: false }),
      lastSeenAt: t.exposeString("lastSeenAt", { nullable: false }),
      lastProbedAt: t.exposeString("lastProbedAt", { nullable: true }),
      httpStatus: t.exposeInt("httpStatus", { nullable: true }),
      manifestVersion: t.exposeString("manifestVersion", { nullable: false }),
      sources: t.exposeStringList("sources", { nullable: false }),
    }),
  })

const ManagerWatchRouteAlertsPageRef = builder
  .objectRef<AlertPage>("ManagerWatchRouteAlertsPage")
  .implement({
    fields: (t) => ({
      generatedAt: t.exposeString("generatedAt", { nullable: false }),
      monitorState: t.exposeString("monitorState", { nullable: false }),
      recoverySuppressed: t.exposeBoolean("recoverySuppressed", {
        nullable: false,
      }),
      lastSuccessfulAt: t.exposeString("lastSuccessfulAt", { nullable: true }),
      latestRun: t.field({
        type: ManagerWatchRouteAlertRunRef,
        nullable: true,
        resolve: (row) => row.latestRun,
      }),
      propertyRuns: t.field({
        type: [ManagerWatchRouteAlertRunRef],
        nullable: false,
        resolve: (row) => row.propertyRuns,
      }),
      propertyRunsTruncated: t.exposeBoolean("propertyRunsTruncated", {
        nullable: false,
      }),
      summary: t.field({
        type: ManagerWatchRouteAlertSummaryRef,
        nullable: false,
        resolve: (row) => row.summary,
      }),
      items: t.field({
        type: [ManagerWatchRouteAlertItemRef],
        nullable: false,
        resolve: (row) => row.items,
      }),
      totalCount: t.exposeInt("totalCount", { nullable: false }),
      showing: t.exposeInt("showing", { nullable: false }),
      hasNextPage: t.exposeBoolean("hasNextPage", { nullable: false }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

builder.queryField("managerWatchRouteAlerts", (t) =>
  t.field({
    type: ManagerWatchRouteAlertsPageRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-watch-route-alerts" },
    args: {
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.watchRouteAlert.listManagerAlerts({
        user: ctx.user,
        limit: args.limit ?? 25,
        after: args.after,
      }),
  }),
)
