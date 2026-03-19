export default {
  routes: [
    {
      method: "POST",
      path: "/gateway-sync/trigger",
      handler: "gateway-sync.trigger",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/gateway-sync/status",
      handler: "gateway-sync.status",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
