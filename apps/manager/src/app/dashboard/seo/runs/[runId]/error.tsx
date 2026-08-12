"use client"

import Link from "next/link"
import { AlertTriangle, RefreshCw } from "lucide-react"

export default function SeoRunError({ reset }: { reset: () => void }) {
  return (
    <div className="studio-page studio-page--seo" aria-live="assertive">
      <div className="seo-run-alert" role="alert">
        <AlertTriangle aria-hidden="true" size={20} />
        <div>
          <strong>SEO run could not be loaded</strong>
          <p>
            The Admin audit ledger may be temporarily unavailable. No action was
            taken.
          </p>
          <div className="seo-action-row">
            <button
              className="seo-primary-button"
              type="button"
              onClick={reset}
            >
              <RefreshCw aria-hidden="true" size={16} /> Retry
            </button>
            <Link
              className="seo-secondary-button"
              href="/dashboard/seo?view=runs"
            >
              Return to run log
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
