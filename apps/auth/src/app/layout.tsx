import type { ReactNode } from "react"

import "./globals.css"

export const metadata = {
  title: "Jesus Film Auth",
  description: "Jesus Film single sign-on",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
