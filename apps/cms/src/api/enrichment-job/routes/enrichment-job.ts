export default {
  routes: [
    {
      method: "POST",
      path: "/enrichment-job/internal-create",
      handler: "enrichment-job.internalCreate",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
