export default {
  routes: [
    {
      method: "GET",
      path: "/language-geo",
      handler: "language-geo.index",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
}
