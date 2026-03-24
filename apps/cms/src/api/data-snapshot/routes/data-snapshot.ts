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
    // Admin-authenticated routes (for admin panel useFetchClient)
    {
      method: "POST",
      path: "/data-snapshot/admin/trigger",
      handler: "data-snapshot.trigger",
      config: {
        policies: ["admin::isAuthenticatedAdmin"],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/admin/download",
      handler: "data-snapshot.download",
      config: {
        policies: ["admin::isAuthenticatedAdmin"],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/data-snapshot/admin/status",
      handler: "data-snapshot.status",
      config: {
        policies: ["admin::isAuthenticatedAdmin"],
        middlewares: [],
      },
    },
  ],
}
