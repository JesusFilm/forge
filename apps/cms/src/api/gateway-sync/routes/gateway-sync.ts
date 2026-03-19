export default {
  routes: [
    {
      method: "POST",
      path: "/gateway-sync/trigger",
      handler: "gateway-sync.trigger",
      config: {
        policies: ["admin::isAuthenticatedAdmin"],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/gateway-sync/status",
      handler: "gateway-sync.status",
      config: {
        policies: ["admin::isAuthenticatedAdmin"],
        middlewares: [],
      },
    },
  ],
}
