// WatchSetting — PUBLIC homepage configuration. Shape parity with Strapi's
// `apps/web/src/lib/content.ts:48-63` so consumers can swap data sources
// without changing the selection set. Field-level strips on inner
// ExperienceLocale come from `types/experience.ts`. The consumer fragment
// rewrite from `on Experience` to `on ExperienceLocale` is tracked under
// U5b/U6.

import { builder } from "@/graphql/builder"
import type { WatchSettingShape } from "@/services/watch-setting.service"

/**
 * @classification public-shape
 *
 * Service-mediated bridge to ExperienceLocale (abac-gated). The service
 * is the gate — both reads filter `status: "PUBLISHED"` + non-archived.
 * `classification.test.ts`'s walker only inspects `prismaObject` +
 * `t.relation`, so this objectRef shape is invisible by construction.
 */

const WatchSettingRef = builder.objectRef<WatchSettingShape>("WatchSetting")

WatchSettingRef.implement({
  description: "Per-locale homepage configuration for PUBLIC consumer apps.",
  fields: (t) => ({
    documentId: t.exposeID("documentId", {
      nullable: true,
      description:
        "Experience id this watchSetting derives from — homepageExperience.experienceId if set, else defaultTemplateExperience.experienceId. Not exclusively the homepage id.",
    }),
    homepageExperience: t.prismaField({
      type: "ExperienceLocale",
      nullable: true,
      description:
        "Published ExperienceLocale flagged isHomepage for the requested locale.",
      resolve: (_query, root) => root.homepageExperience,
    }),
    defaultTemplateExperience: t.prismaField({
      type: "ExperienceLocale",
      nullable: true,
      description:
        "Published ExperienceLocale of the isTemplate Experience for the requested locale.",
      resolve: (_query, root) => root.defaultTemplateExperience,
    }),
  }),
})

builder.queryFields((t) => ({
  watchSetting: t.field({
    type: WatchSettingRef,
    authScopes: { public: true },
    description:
      "Per-locale homepage configuration. Replaces Strapi's `watchSetting` (consumer-migration U2, 2026-05-11). Locale-fallback is STRICT NULL.",
    args: {
      locale: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.watchSetting.get({ locale: args.locale }),
  }),
}))
