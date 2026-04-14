// Experience search query — pgvector semantic search via the Search
// Hydration Pattern. Returns ExperienceLocale rows ordered by cosine
// similarity to the input vector.

import { builder } from "@/graphql/builder"

builder.queryFields((t) => ({
  searchExperiences: t.prismaField({
    type: ["ExperienceLocale"],
    authScopes: { public: true },
    description:
      "Semantic search over Experience locales. Pass a 1536-dimension embedding vector. " +
      "PUBLIC sees published only; EDITOR/ADMIN see all statuses.",
    args: {
      vector: t.arg({ type: "JSON", required: true }),
      locale: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false, defaultValue: 10 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.experienceSearch.search({
        vector: args.vector,
        locale: args.locale ?? undefined,
        limit: Math.min(args.limit ?? 10, 50),
        user: ctx.user,
        query,
      }),
  }),
}))
