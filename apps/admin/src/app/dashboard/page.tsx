import { requireSession } from "@/auth/session"

export default async function DashboardPage() {
  await requireSession()
  return (
    <main>
      <h1>Dashboard</h1>
      <p>Placeholder. Authenticated-state UI ships in Unit 12.</p>
    </main>
  )
}
