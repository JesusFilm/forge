import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/watch",
    name: "Jesus Film Project",
    short_name: "Jesus Film",
    description:
      "Watch free Christian films, Bible stories, and videos from Jesus Film Project.",
    start_url: "/watch",
    scope: "/watch/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "/watch/images/favicon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/watch/images/favicon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  }
}
