import type { Metadata } from "next"

import "./styles.css"
import "./photo.css"
import "./preview.css"

export const metadata: Metadata = {
  title: "Watch TV beta feedback | Jesus Film Project",
  description: "Help improve Watch on Apple TV and Google TV.",
  robots: { index: false, follow: false },
}

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
