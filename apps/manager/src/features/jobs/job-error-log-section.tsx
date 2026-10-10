import React from "react"
import { formatStepName } from "@/lib/workflow-steps"
import type { JobError } from "@/types/job"

type JobErrorLogSectionProps = {
  errors: JobError[]
}

function formatDate(iso?: string): string {
  if (!iso) return "\u2013"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "\u2013"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

export function JobErrorLogSection({ errors }: JobErrorLogSectionProps) {
  if (errors.length === 0) {
    return null
  }

  return (
    <section
      className="collection-card jobs-card jobs-error-card"
      id="error-log"
    >
      <div className="jobs-card-header jobs-error-header">
        <h3 className="jobs-section-title">Error Log</h3>
        <span className="jobs-error-count">{errors.length}</span>
      </div>
      <div className="jobs-table-wrap">
        <table className="table jobs-table jobs-error-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Step</th>
              <th>Code</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((error, idx) => (
              <React.Fragment key={`${error.at}-${idx}`}>
                <tr className="jobs-error-primary-row">
                  <td>{formatDate(error.at)}</td>
                  <td>{formatStepName(error.step)}</td>
                  <td>
                    {error.code ? (
                      <code className="jobs-error-code">{error.code}</code>
                    ) : (
                      "\u2013"
                    )}
                  </td>
                </tr>
                <tr className="jobs-error-secondary-row">
                  <td colSpan={3}>
                    <p className="jobs-error-message">{error.message}</p>
                    <p className="jobs-error-hint">
                      {error.operatorHint ?? "\u2013"}
                    </p>
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
