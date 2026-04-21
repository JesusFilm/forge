import React from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
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
    <Card id="error-log">
      <CardHeader className="border-b border-border/70 pb-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
            Error log
          </h3>
          <Badge variant="danger" className="px-3.5 py-1.5 text-[13px]">
            {errors.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-left">
            <thead>
              <tr className="text-[0.8rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <th className="pb-4 pr-5">Time</th>
                <th className="pb-4 pr-5">Step</th>
                <th className="pb-4">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {errors.map((error, idx) => (
                <React.Fragment key={`${error.at}-${idx}`}>
                  <tr className="align-top">
                    <td className="py-4 pr-5 text-[0.95rem] leading-6 text-muted-foreground">
                      {formatDate(error.at)}
                    </td>
                    <td className="py-4 pr-5 text-[0.98rem] font-medium tracking-[-0.015em] text-foreground">
                      {formatStepName(error.step)}
                    </td>
                    <td className="py-4">
                      {error.code ? (
                        <code className="rounded-xl bg-secondary px-3 py-1.5 text-[0.82rem] text-foreground">
                          {error.code}
                        </code>
                      ) : (
                        "\u2013"
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="pb-5">
                      <p className="text-[1rem] leading-7 text-foreground">
                        {error.message}
                      </p>
                      <p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">
                        {error.operatorHint ?? "\u2013"}
                      </p>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
