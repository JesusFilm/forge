export default {
  routes: [
    // Secret-auth routes (for CI/agents via x-snapshot-secret header)
    {
      method: "POST",
      path: "/seed-easter/trigger",
      handler: "seed-easter.trigger",
      config: {
        auth: false,
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
    {
      method: "GET",
      path: "/seed-easter/status",
      handler: "seed-easter.status",
      config: {
        auth: false,
        policies: [],
        middlewares: ["api::data-snapshot.secret-auth"],
      },
    },
    // Admin-authenticated routes (for Strapi admin panel useFetchClient)
    {
      method: "POST",
      path: "/seed-easter/admin/trigger",
      handler: "seed-easter.trigger",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::admin-auth"],
      },
    },
    {
      method: "GET",
      path: "/seed-easter/admin/status",
      handler: "seed-easter.status",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::admin-auth"],
      },
    },
  ],
}
