import type { StrapiApp } from "@strapi/admin/strapi-admin"
import AuthLogo from "./extensions/jesus-film-logo-full.svg"
import MenuLogo from "./extensions/jesusfilm-sign.svg"
import "./styles/admin.css"

export default {
  config: {
    auth: {
      logo: AuthLogo,
    },
    locales: [],
    menu: {
      logo: MenuLogo,
    },
    translations: {
      en: {
        "Auth.form.welcome.subtitle": "Log in to the Jesus Film CMS",
        "Auth.form.welcome.title": "Welcome back!",
      },
    },
    theme: {
      light: {
        borderRadius: "12px",
        shadows: {
          focus:
            "inset 2px 0px 0px rgb(74, 67, 60), inset 0px 2px 0px rgb(74, 67, 60), inset -2px 0px 0px rgb(74, 67, 60), inset 0px -2px 0px rgb(74, 67, 60)",
          focusShadow: "0px 0px 0px 2px rgba(74, 67, 60, 0.18)",
          tableShadow: "none",
        },
        colors: {
          buttonPrimary500: "#EF3340",
          buttonPrimary600: "#EF3340",
          primary500: "#EF3340",
          primary600: "#EF3340",
          primary700: "#EF3340",
        },
      },
      dark: {
        borderRadius: "12px",
        shadows: {
          focus:
            "inset 2px 0px 0px rgb(255, 248, 242), inset 0px 2px 0px rgb(255, 248, 242), inset -2px 0px 0px rgb(255, 248, 242), inset 0px -2px 0px rgb(255, 248, 242)",
          focusShadow: "0px 0px 0px 2px rgba(255, 248, 242, 0.18)",
          tableShadow: "none",
        },
        colors: {
          alternative100: "#1D1A18",
          alternative200: "#322B27",
          alternative500: "#A86F52",
          alternative600: "#C78663",
          alternative700: "#E8B18F",
          buttonNeutral0: "#FFF8F2",
          buttonPrimary500: "#EF3340",
          buttonPrimary600: "#EF3340",
          neutral0: "#191917",
          neutral100: "#242422",
          neutral150: "#2A2622",
          neutral200: "#35302B",
          neutral300: "#4A433C",
          neutral400: "#6A6057",
          neutral500: "#908276",
          neutral600: "#B7A79A",
          neutral700: "#D8CABE",
          neutral800: "#F1E5DA",
          neutral900: "#FFF8F2",
          neutral1000: "#FFFDFC",
          primary100: "rgba(0, 0, 0, 0.28)",
          primary200: "rgba(0, 0, 0, 0.42)",
          primary500: "#EF3340",
          primary600: "#EF3340",
          primary700: "#EF3340",
          secondary100: "#221C18",
          secondary200: "#3A2C24",
          secondary500: "#9E7054",
          secondary600: "#BA8563",
          secondary700: "#D8AA87",
          success100: "#242422",
          success200: "#35302B",
          success500: "#7FB38F",
          success600: "#7FB38F",
          success700: "#BFD6C6",
          warning100: "#2B1E16",
          warning200: "#4A3120",
          warning500: "#C47B36",
          warning600: "#DA9047",
          warning700: "#E7B07A",
        },
      },
    },
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
