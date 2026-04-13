export default {
  routes: [
    {
      method: "GET",
      path: "/experience-list",
      handler: "experience-list.index",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::api-token-auth"],
      },
    },
  ],
}
