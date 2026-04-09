export default {
  routes: [
    {
      method: "POST",
      path: "/embedding/index",
      handler: "embedding.index",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/embedding/stats",
      handler: "embedding.stats",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
