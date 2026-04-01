export default {
  routes: [
    {
      method: "POST",
      path: "/data-snapshot/trigger",
      handler: "data-snapshot.trigger",
      config: {
        auth: false,
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/download",
      handler: "data-snapshot.download",
      config: {
        auth: false,
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/status",
      handler: "data-snapshot.status",
      config: {
        auth: false,
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
    // Admin-authenticated routes (for admin panel useFetchClient)
    {
      method: "POST",
      path: "/data-snapshot/admin/trigger",
      handler: "data-snapshot.trigger",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::admin-auth"],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/admin/download",
      handler: "data-snapshot.download",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::admin-auth"],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/admin/status",
      handler: "data-snapshot.status",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::admin-auth"],
      },
    },
  ],
}
