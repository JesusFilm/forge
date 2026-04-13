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
          {
            name: "global::rate-limit",
            config: { max: 30, windowMs: 60_000, key: "search" },
          },
        ],
      },
    },
  ],
}
