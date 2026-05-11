/**
 * Public homepage/template ExperienceLocale queries for consumer cutover.
 *
 * These are intentionally narrow: apps/web needs anonymous reads for the
 * active homepage and default template in a locale, but not a generic public
 * ExperienceLocale search surface.
 *
 * @classification public-shape
 */

import { builder } from "@/graphql/builder"

export function homepageExperienceLocaleWhere(locale: string) {
  return {
    locale,
    isHomepage: true,
    status: "PUBLISHED" as const,
    experience: { archivedAt: null },
  }
}

export function defaultTemplateExperienceLocaleWhere(locale: string) {
  return {
    locale,
    status: "PUBLISHED" as const,
    experience: {
      archivedAt: null,
      isTemplate: true,
    },
  }
}

export const publicExperienceLocaleOrderBy = [
  { updatedAt: "desc" as const },
  { id: "asc" as const },
]

builder.queryFields((t) => ({
  homepageExperienceLocale: t.prismaField({
    type: "ExperienceLocale",
    nullable: true,
    authScopes: { public: true },
    description:
      "Published homepage ExperienceLocale for a locale. Returns null when none exists.",
    args: {
      locale: t.arg.string({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.experienceLocale.findFirst({
        ...query,
        where: homepageExperienceLocaleWhere(args.locale),
        orderBy: publicExperienceLocaleOrderBy,
      }),
  }),
  defaultTemplateExperienceLocale: t.prismaField({
    type: "ExperienceLocale",
    nullable: true,
    authScopes: { public: true },
    description:
      "Published default template ExperienceLocale for a locale. Returns null when none exists.",
    args: {
      locale: t.arg.string({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.experienceLocale.findFirst({
        ...query,
        where: defaultTemplateExperienceLocaleWhere(args.locale),
        orderBy: publicExperienceLocaleOrderBy,
      }),
  }),
}))
