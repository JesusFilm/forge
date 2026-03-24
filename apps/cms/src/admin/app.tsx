import type { StrapiApp } from "@strapi/admin/strapi-admin"

export default {
  config: {
    locales: [],
  },
  bootstrap(app: StrapiApp) {
    app.addSettingsLink("global", {
      id: "system-status",
      intlLabel: {
        id: "system-status.settings.label",
        defaultMessage: "System Status",
      },
      to: "system-status",
      Component: () => import("./pages/SystemStatus"),
    })
  },
}
