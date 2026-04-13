import type { ReactNode } from "react"

export const metadata = {
  title: "Forge Admin",
  description: "JesusFilm Forge admin app",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
