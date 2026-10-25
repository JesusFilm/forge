import "video.js/dist/video-js.css"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { LogOut } from "lucide-react"

import { requireReviewerAuth } from "@/lib/require-auth"

export const metadata: Metadata = {
  title: "Subtitle review — Studio",
  description: "Language-qualified subtitle review workspace",
}

export default async function SubtitleReviewLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const reviewer = await requireReviewerAuth()
  return (
    <div className="subtitle-review-shell">
      <header className="subtitle-review-shell-header">
        <Link href="/subtitle-review" className="subtitle-review-brand">
          <Image
            src="/jesusfilm-sign.svg"
            alt="Jesus Film Project"
            width={40}
            height={40}
          />
          <span>
            <strong>Subtitle review</strong>
            <small>Limited contributor workspace</small>
          </span>
        </Link>
        <div className="subtitle-review-account">
          <span>
            <strong>{reviewer.name ?? "Language reviewer"}</strong>
            <small>{reviewer.email}</small>
          </span>
          <a href="/api/auth/logout" className="subtitle-review-signout">
            <LogOut size={16} aria-hidden="true" /> Sign out
          </a>
        </div>
      </header>
      <div className="subtitle-review-shell-content">{children}</div>
    </div>
  )
}
