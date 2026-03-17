import type { Metadata } from "next"
import Link from "next/link"
import { listJobs } from "@/lib/state"

export const metadata: Metadata = {
  title: "Overview — VideoForge Manager",
}

export default async function DashboardOverview() {
  const jobs = await listJobs()

  const pending = jobs.filter((j) => j.status === "pending").length
  const processing = jobs.filter((j) => j.status === "processing").length
  const completed = jobs.filter((j) => j.status === "completed").length
  const failed = jobs.filter((j) => j.status === "failed").length

  return (
    <div>
      <h1
        style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1.5rem" }}
      >
        Dashboard
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <StatCard label="Pending" value={pending} />
        <StatCard label="Processing" value={processing} />
        <StatCard label="Completed" value={completed} />
        <StatCard label="Failed" value={failed} />
      </div>

      <div style={{ display: "flex", gap: "1rem" }}>
        <Link
          href="/dashboard/jobs"
          style={{
            padding: "0.5rem 1rem",
            background: "#111827",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          View All Jobs
        </Link>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: "1.25rem",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          color: "#6b7280",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "2rem", fontWeight: 700, marginTop: "0.25rem" }}>
        {value}
      </div>
    </div>
  )
}
