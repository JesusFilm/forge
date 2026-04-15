export default {
  routes: [
    {
      method: "GET",
      path: "/search",
      handler: "search.search",
      config: {
        auth: false,
        policies: [],
        // Each request triggers an OpenRouter embedding API call. The
        // rate limit caps per-IP cost exposure beyond Cloudflare WAF.
        middlewares: [
          // max/windowMs default from SEARCH_RATE_LIMIT (lib/rate-limit-bucket.ts)
          // Keeping them there keeps REST + GraphQL limits in sync.
          {
            name: "global::rate-limit",
            config: { key: "search" },
          },
        ],
      },
    },
    {
      // Synthetic health probe for OpenRouter query-embedding reachability.
      // Hits the real OpenRouter API with a fixed probe string so external
      // monitors (Railway healthcheck, uptime services, curl) can detect
      // the feat-097 failure mode without tailing logs. Added in the
      // hardening PR for feat-097 / JesusFilm/forge#778.
      method: "GET",
      path: "/search/health",
      handler: "search.health",
      config: {
        auth: false,
        policies: [],
        middlewares: [
          // Dedicated bucket — probe traffic must not starve the user
          // search quota, and vice versa. Same 30/min default applies.
          {
            name: "global::rate-limit",
            config: { key: "search-health" },
          },
        ],
      },
    },
  ],
}
