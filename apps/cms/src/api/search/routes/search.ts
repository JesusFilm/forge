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
  ],
}
