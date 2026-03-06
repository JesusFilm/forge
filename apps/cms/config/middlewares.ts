import type { Core } from "@strapi/strapi"

const cdnUrl = process.env.CDN_URL

const securityConfig: Core.Config.Middlewares[number] = cdnUrl
  ? {
      name: "strapi::security",
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            "connect-src": ["'self'", "https:"],
            "img-src": [
              "'self'",
              "data:",
              "blob:",
              "market-assets.strapi.io",
              cdnUrl,
            ],
            "media-src": [
              "'self'",
              "data:",
              "blob:",
              "market-assets.strapi.io",
              cdnUrl,
            ],
            upgradeInsecureRequests: null,
          },
        },
      },
    }
  : "strapi::security"

const config: Core.Config.Middlewares = [
  "strapi::logger",
  "strapi::errors",
  securityConfig,
  "strapi::cors",
  "strapi::poweredBy",
  "strapi::query",
  "strapi::body",
  "strapi::session",
  "strapi::favicon",
  "strapi::compression",
  "strapi::public",
]

export default config
