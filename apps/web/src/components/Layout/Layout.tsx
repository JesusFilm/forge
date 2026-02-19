import type { ReactNode } from "react"
import { Footer } from "@/components/Footer"
import { Header } from "@/components/Header"

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 flex-col">{children}</main>
      <Footer />
    </div>
  )
}
