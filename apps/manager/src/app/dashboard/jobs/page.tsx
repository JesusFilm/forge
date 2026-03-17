import type { Metadata } from "next"
import Link from "next/link"
import { listJobs } from "@/lib/state"
import type { JobStatus } from "@/lib/state"

export const metadata: Metadata = {
  title: "Jobs — VideoForge Manager",
}

const statusColors: Record<JobStatus, string> = {
  pending: "#f59e0b",
  processing: "#3b82f6",
  completed: "#10b981",
  failed: "#ef4444",
}

export default async function JobsPage() {
  const jobs = await listJobs()

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Jobs</h1>
      </div>

      {jobs.length === 0 ? (
        <p style={{ color: "#6b7280" }}>
          No jobs yet. Create one via POST /api/jobs.
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.875rem",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "2px solid #e5e7eb",
                textAlign: "left",
              }}
            >
              <th style={{ padding: "0.75rem 0.5rem" }}>ID</th>
              <th style={{ padding: "0.75rem 0.5rem" }}>Asset</th>
              <th style={{ padding: "0.75rem 0.5rem" }}>Status</th>
              <th style={{ padding: "0.75rem 0.5rem" }}>Step</th>
              <th style={{ padding: "0.75rem 0.5rem" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  <Link
                    href={`/dashboard/jobs/${job.id}`}
                    style={{ color: "#3b82f6", textDecoration: "none" }}
                  >
                    {job.id.slice(0, 8)}...
                  </Link>
                </td>
                <td
                  style={{
                    padding: "0.75rem 0.5rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {job.assetId.slice(0, 12)}...
                </td>
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.125rem 0.5rem",
                      borderRadius: 9999,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "#fff",
                      background: statusColors[job.status],
                    }}
                  >
                    {job.status}
                  </span>
                </td>
                <td style={{ padding: "0.75rem 0.5rem", color: "#6b7280" }}>
                  {job.currentStep ?? "—"}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", color: "#6b7280" }}>
                  {new Date(job.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
