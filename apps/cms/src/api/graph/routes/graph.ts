export default {
  routes: [
    {
      method: "GET",
      path: "/graph/hierarchy",
      handler: "graph.hierarchy",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/graph/scene-similarity",
      handler: "graph.sceneSimilarity",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/graph/video-similarity",
      handler: "graph.videoSimilarity",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/graph/tags",
      handler: "graph.tags",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
