import type { StrapiApp } from "@strapi/admin/strapi-admin"

export default {
  config: {
    locales: [],
  },
  bootstrap(app: StrapiApp) {
    app.addSettingsLink("global", {
      id: "core-sync-status",
      intlLabel: {
        id: "core-sync-status.settings.label",
        defaultMessage: "Core Sync Status",
      },
      to: "core-sync-status",
      Component: () => import("./pages/SystemStatus"),
    })
  },
}
