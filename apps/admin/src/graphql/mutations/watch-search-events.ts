import type { WatchSearchEvent } from "@prisma/client"

import { builder } from "@/graphql/builder"

const WatchSearchEventTypeEnum = builder.enumType("WatchSearchEventType", {
  values: {
    RESULT_CLICKED: { value: "result_clicked" },
    RESULTS_VIEWED: { value: "results_viewed" },
    LOAD_MORE: { value: "load_more" },
  } as const,
})

const WatchSearchEventClientEnum = builder.enumType("WatchSearchEventClient", {
  values: {
    WEB: { value: "web" },
    MOBILE: { value: "mobile" },
    TV: { value: "tv" },
  } as const,
})

const WatchSearchEventResultTypeEnum = builder.enumType(
  "WatchSearchEventResultType",
  {
    values: {
      VIDEO: { value: "video" },
      EXPERIENCE: { value: "experience" },
    } as const,
  },
)

const WatchSearchEventRef = builder
  .objectRef<WatchSearchEvent>("WatchSearchEvent")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      requestId: t.exposeString("requestId"),
      eventType: t.exposeString("eventType"),
      client: t.exposeString("client"),
      resultId: t.exposeString("resultId", { nullable: true }),
      resultType: t.exposeString("resultType", { nullable: true }),
      position: t.exposeInt("position", { nullable: true }),
      occurredAt: t.string({
        resolve: (row) => row.occurredAt.toISOString(),
      }),
      createdAt: t.string({
        resolve: (row) => row.createdAt.toISOString(),
      }),
    }),
  })

builder.mutationFields((t) => ({
  recordWatchSearchEvent: t.field({
    type: WatchSearchEventRef,
    authScopes: { public: true },
    args: {
      requestId: t.arg.string({ required: true }),
      eventType: t.arg({ type: WatchSearchEventTypeEnum, required: true }),
      client: t.arg({ type: WatchSearchEventClientEnum, required: true }),
      resultId: t.arg.id({ required: false }),
      resultType: t.arg({
        type: WatchSearchEventResultTypeEnum,
        required: false,
      }),
      position: t.arg.int({ required: false }),
      visibleResultIds: t.arg.stringList({ required: false }),
      routeLanguageSlug: t.arg.string({ required: false }),
      searchLanguageSlug: t.arg.string({ required: false }),
      occurredAt: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.watchSearchEvent.create({
        requestId: args.requestId,
        eventType: args.eventType,
        client: args.client,
        resultId: args.resultId != null ? String(args.resultId) : null,
        resultType: args.resultType,
        position: args.position,
        visibleResultIds: args.visibleResultIds,
        routeLanguageSlug: args.routeLanguageSlug,
        searchLanguageSlug: args.searchLanguageSlug,
        occurredAt: args.occurredAt,
      }),
  }),
}))
