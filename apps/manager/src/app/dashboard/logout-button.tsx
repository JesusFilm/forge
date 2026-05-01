"use client"

import { LogOut } from "lucide-react"
import { useRouter } from "next/navigation"

export function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.45rem",
        padding: "0.5rem 0.75rem",
        background: "transparent",
        border: "1px solid #d1d5db",
        borderRadius: 6,
        color: "#6b7280",
        fontSize: "0.8rem",
        cursor: "pointer",
      }}
    >
      <LogOut
        aria-hidden="true"
        style={{ width: 14, height: 14, flexShrink: 0 }}
      />
      Sign out
    </button>
  )
}
