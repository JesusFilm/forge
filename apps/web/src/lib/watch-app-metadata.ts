import type { Metadata } from "next"

export const WATCH_APP_METADATA = {
  applicationName: "Jesus Film Project",
  manifest: "/watch/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/watch/favicon.ico",
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
      {
        url: "/watch/images/favicon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/watch/images/favicon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcut: "/watch/favicon.ico",
    apple: [
      {
        url: "/watch/images/favicon-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  other: {
    "msapplication-TileImage": "/watch/images/favicon-192.png",
    "apple-mobile-web-app-status-bar-style": "black",
  },
} satisfies Metadata
