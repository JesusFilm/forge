export default {
  routes: [
    {
      method: "POST",
      path: "/blurhash-backfill/trigger",
      handler: "blurhash-backfill.trigger",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/blurhash-backfill/status",
      handler: "blurhash-backfill.status",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "POST",
      path: "/blurhash-backfill/cancel",
      handler: "blurhash-backfill.cancel",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
