import { redirect } from "next/navigation"

export default function DashboardPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed routes doesn't resolve /dashboard/coverage
  redirect("/dashboard/coverage" as any)
}
