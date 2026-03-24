export default {
  routes: [
    {
      method: "POST",
      path: "/data-snapshot/trigger",
      handler: "data-snapshot.trigger",
      config: {
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/download",
      handler: "data-snapshot.download",
      config: {
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/status",
      handler: "data-snapshot.status",
      config: {
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
  ],
}
