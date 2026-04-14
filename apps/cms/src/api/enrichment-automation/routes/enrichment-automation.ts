export default {
  routes: [
    {
      method: "POST",
      path: "/enrichment-automation/:documentId/manual-dry-run-claim",
      handler: "enrichment-automation.manualDryRunClaim",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "POST",
      path: "/enrichment-automation/:documentId/manual-dry-run-release",
      handler: "enrichment-automation.manualDryRunRelease",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
