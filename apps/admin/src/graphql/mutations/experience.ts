// Experience mutations — create, updateLocale, publishLocale, archive.
//
// Every mutation delegates to ExperienceService which owns Zod validation
// and ABAC checks. Resolvers are thin wiring.

import { builder } from "@/graphql/builder"

builder.mutationFields((t) => ({
  createExperience: t.prismaField({
    type: "Experience",
    authScopes: { hasPermission: "write:experiences" },
    description:
      "Create a new Experience with an initial locale. Caller becomes owner.",
    args: {
      locale: t.arg.string({ required: true }),
      slug: t.arg.string({ required: true }),
      title: t.arg.string({ required: false }),
      isTemplate: t.arg.boolean({ required: false }),
      blocks: t.arg({ type: "JSON", required: false }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.experience.create({
        input: {
          locale: args.locale,
          slug: args.slug,
          title: args.title ?? undefined,
          isTemplate: args.isTemplate ?? false,
          blocks: args.blocks ?? [],
        },
        user: ctx.user,
      }),
  }),

  updateExperienceLocale: t.prismaField({
    type: "ExperienceLocale",
    authScopes: { hasPermission: "write:experiences" },
    description: "Update an ExperienceLocale (slug, title, blocks, etc.).",
    args: {
      id: t.arg.id({ required: true }),
      slug: t.arg.string({ required: false }),
      title: t.arg.string({ required: false }),
      metaDescription: t.arg.string({ required: false }),
      ogTitle: t.arg.string({ required: false }),
      ogDescription: t.arg.string({ required: false }),
      ogImageUrl: t.arg.string({ required: false }),
      isHomepage: t.arg.boolean({ required: false }),
      isTemplate: t.arg.boolean({ required: false }),
      pathSegment: t.arg.string({ required: false }),
      blocks: t.arg({ type: "JSON", required: false }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.experience.updateLocale({
        input: {
          id: String(args.id),
          ...(args.slug != null ? { slug: args.slug } : {}),
          ...(args.title != null ? { title: args.title } : {}),
          ...(args.metaDescription != null
            ? { metaDescription: args.metaDescription }
            : {}),
          ...(args.ogTitle != null ? { ogTitle: args.ogTitle } : {}),
          ...(args.ogDescription != null
            ? { ogDescription: args.ogDescription }
            : {}),
          ...(args.ogImageUrl !== undefined
            ? { ogImageUrl: args.ogImageUrl }
            : {}),
          ...(args.isHomepage != null ? { isHomepage: args.isHomepage } : {}),
          ...(args.isTemplate != null ? { isTemplate: args.isTemplate } : {}),
          ...(args.pathSegment !== undefined
            ? { pathSegment: args.pathSegment }
            : {}),
          ...(args.blocks != null ? { blocks: args.blocks } : {}),
        },
        user: ctx.user,
      }),
  }),

  publishExperienceLocale: t.prismaField({
    type: "ExperienceLocale",
    authScopes: { hasPermission: "publish:experiences" },
    description:
      "Publish an ExperienceLocale (flip status to PUBLISHED). Owner or ADMIN.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.experience.publishLocale({
        input: { id: String(args.id) },
        user: ctx.user,
      }),
  }),

  archiveExperience: t.prismaField({
    type: "Experience",
    authScopes: { hasPermission: "archive:experiences" },
    description: "Archive an Experience. Owner or ADMIN.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.experience.archive({
        input: { id: String(args.id) },
        user: ctx.user,
      }),
  }),

  triggerExperienceEmbedding: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:experiences" },
    description:
      "Generate and persist a semantic embedding for an ExperienceLocale. Owner or ADMIN.",
    args: {
      localeId: t.arg.id({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.experience.triggerEmbedding({
        localeId: String(args.localeId),
        user: ctx.user,
      }),
  }),
}))
