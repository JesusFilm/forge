import type { Metadata } from "next"
import { listJobs, ALL_STEPS } from "@/lib/state"

export const metadata: Metadata = {
  title: "Coverage — VideoForge Manager",
}

export default async function CoveragePage() {
  const jobs = await listJobs()
  const completedJobs = jobs.filter((j) => j.status === "completed")

  return (
    <div>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: "1.5rem",
        }}
      >
        Coverage
      </h1>

      <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
        Enrichment coverage across {jobs.length} total jobs (
        {completedJobs.length} completed).
      </p>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.875rem",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "0.75rem 0.5rem" }}>Step</th>
            <th style={{ padding: "0.75rem 0.5rem" }}>Completed</th>
            <th style={{ padding: "0.75rem 0.5rem" }}>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {ALL_STEPS.map((step) => {
            const count = completedJobs.filter((j) =>
              j.completedSteps.includes(step),
            ).length
            const pct =
              completedJobs.length > 0
                ? Math.round((count / completedJobs.length) * 100)
                : 0
            return (
              <tr key={step} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "0.75rem 0.5rem", fontWeight: 500 }}>
                  {step}
                </td>
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  {count} / {completedJobs.length}
                </td>
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <div
                      style={{
                        width: 120,
                        height: 8,
                        borderRadius: 4,
                        background: "#e5e7eb",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: "#10b981",
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                      {pct}%
                    </span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
