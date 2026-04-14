export default {
  routes: [
    {
      method: "GET",
      path: "/enrichment-job/running-automation-keys",
      handler: "enrichment-job.runningAutomationKeys",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
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
