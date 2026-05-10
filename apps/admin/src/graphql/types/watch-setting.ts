// WatchSetting — homepage configuration consumed by apps/web (and later
// apps/mobile, apps/tv) for the per-locale homepage page and the
// default-template page.
//
// Shape matches the existing Strapi query at
// `apps/web/src/lib/content.ts:48-63` so the consumer can swap data
// sources without changing its query selection set. The consumer-side
// `WatchExperience` fragment is `on Experience` against Strapi today;
// against admin it must rewrite to `on ExperienceLocale` because admin
// keeps slug/title/blocks/etc on the per-locale row. That fragment
// rewrite is tracked under U5b/U6 and is NOT part of Unit 2.
//
// Auth contract: `authScopes: { public: true }`. Anonymous consumers
// read this resolver. Internal/editorial fields traveling through the
// inner `ExperienceLocale` are stripped by U2's field-level authScopes
// on the `Experience` and `ExperienceLocale` types.

import { builder } from "@/graphql/builder"
import type { WatchSettingShape } from "@/services/watch-setting.service"

/**
 * @classification public-shape
 *
 * Service-mediated bridge: `homepageExperience` and
 * `defaultTemplateExperience` return `ExperienceLocale` (abac-gated) but
 * the bridge is safe because the service-layer (`WatchSettingService`)
 * gates by `status: "PUBLISHED"` and `archivedAt: null` for anonymous
 * callers. `classification.test.ts`'s walker only inspects
 * `builder.prismaObject` + `t.relation` patterns, so this objectRef +
 * `t.prismaField` shape is invisible to it by construction — the
 * service is the gate, not the type. See consumer-migration U2 plan
 * §System-Wide Impact for the service-mediated bridge discipline.
 */

const WatchSettingRef = builder.objectRef<WatchSettingShape>("WatchSetting")

WatchSettingRef.implement({
  description:
    "Homepage configuration for a given locale. PUBLIC consumer apps " +
    "(web, mobile, tv) read this to resolve the homepage Experience and " +
    "the default-template Experience for the requested locale.",
  fields: (t) => ({
    documentId: t.exposeID("documentId", {
      nullable: true,
      description:
        "Stable cross-locale identifier (admin Experience cuid). Null when " +
        "neither homepage nor template exists for the requested locale.",
    }),
    homepageExperience: t.prismaField({
      type: "ExperienceLocale",
      nullable: true,
      description:
        "The published ExperienceLocale flagged isHomepage for the " +
        "requested locale. Null if no homepage Experience has a " +
        "PUBLISHED locale row for that locale.",
      resolve: (_query, root) => root.homepageExperience,
    }),
    defaultTemplateExperience: t.prismaField({
      type: "ExperienceLocale",
      nullable: true,
      description:
        "The published ExperienceLocale of the Experience flagged " +
        "isTemplate, for the requested locale. Null when no template " +
        "Experience has a PUBLISHED locale row for that locale.",
      resolve: (_query, root) => root.defaultTemplateExperience,
    }),
  }),
})

builder.queryFields((t) => ({
  watchSetting: t.field({
    type: WatchSettingRef,
    authScopes: { public: true },
    description:
      "Per-locale homepage configuration. Replaces Strapi's `watchSetting` " +
      "for consumer migration (U2 — 2026-05-11). Locale-fallback is " +
      "STRICT NULL — if no homepage Experience has a PUBLISHED " +
      "ExperienceLocale row for the requested locale, the field is null.",
    args: {
      locale: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.watchSetting.get({ locale: args.locale }),
  }),
}))
