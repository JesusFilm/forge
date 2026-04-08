export default {
  routes: [
    {
      method: "POST",
      path: "/scene-embedding/index",
      handler: "scene-embedding.index",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/scene-embedding/stats",
      handler: "scene-embedding.stats",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/scene-embedding/processed-video-ids",
      handler: "scene-embedding.processedVideoIds",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/scene-embedding/recommendations",
      handler: "scene-embedding.recommendations",
      config: {
        // API token required for internal pipeline consumers. The same data
        // is also available via the public sceneRecommendations GraphQL query
        // for frontend clients. See src/graphql/recommendations.ts.
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
