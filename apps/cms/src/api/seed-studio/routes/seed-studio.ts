export default {
  routes: [
    {
      method: "POST",
      path: "/seed-studio/search-videos",
      handler: "seed-studio.searchVideos",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/seed-studio/publish-experience",
      handler: "seed-studio.publishExperience",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/seed-studio/video-catalog-stats",
      handler: "seed-studio.videoCatalogStats",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
}
