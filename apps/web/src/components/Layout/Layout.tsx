import type { ReactNode } from "react"
import { Header } from "../Header"
import { Footer } from "../Footer"

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <div className="flex min-h-[calc(100vh-8rem)] flex-1 flex-col">
        {children}
      </div>
      <Footer />
    </>
  )
}
