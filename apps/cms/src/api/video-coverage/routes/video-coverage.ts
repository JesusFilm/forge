export default {
  routes: [
    {
      method: "GET",
      path: "/video-coverage/automation-candidates",
      handler: "video-coverage.automationCandidates",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
    {
      method: "GET",
      path: "/video-coverage",
      handler: "video-coverage.index",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
