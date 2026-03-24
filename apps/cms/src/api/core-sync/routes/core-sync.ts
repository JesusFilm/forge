export default {
  routes: [
    {
      method: "POST",
      path: "/core-sync/trigger",
      handler: "core-sync.trigger",
      config: {
        policies: [],
        middlewares: ["global::admin-auth"],
      },
    },
    {
      method: "GET",
      path: "/core-sync/status",
      handler: "core-sync.status",
      config: {
        policies: [],
        middlewares: ["global::admin-auth"],
      },
    },
  ],
}
