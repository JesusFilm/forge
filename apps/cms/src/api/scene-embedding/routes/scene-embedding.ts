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
  ],
}
