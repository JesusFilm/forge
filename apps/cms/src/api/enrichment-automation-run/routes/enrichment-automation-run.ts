export default {
  routes: [
    {
      method: "POST",
      path: "/enrichment-automation-run/:documentId/mark-failed-if-in-flight",
      handler: "enrichment-automation-run.markFailedIfInFlight",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
