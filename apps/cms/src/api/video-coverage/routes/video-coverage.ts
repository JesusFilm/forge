export default {
  routes: [
    {
      method: "GET",
      path: "/video-coverage",
      handler: "video-coverage.index",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
}
