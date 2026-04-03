export default {
  routes: [
    {
      method: "GET",
      path: "/video-coverage",
      handler: "video-coverage.index",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
