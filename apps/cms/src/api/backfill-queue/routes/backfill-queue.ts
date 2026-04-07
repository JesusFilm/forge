export default {
  routes: [
    {
      method: "GET",
      path: "/backfill-queue",
      handler: "backfill-queue.queue",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
