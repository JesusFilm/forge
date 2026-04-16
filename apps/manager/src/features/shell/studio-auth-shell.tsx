import Image from "next/image"
import type { ReactNode } from "react"

export function StudioAuthShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <main className="design-system-eleven studio-auth-shell">
      <div className="studio-auth-shell-inner">
        <div className="studio-auth-brand">
          <div className="design-system-shell-logo">
            <Image
              alt=""
              aria-hidden="true"
              height={18}
              src="/jesusfilm-sign.svg"
              width={25}
            />
            <span className="design-system-shell-wordmark">Studio</span>
            <span className="design-system-shell-badge">Alpha</span>
          </div>
        </div>

        <section
          className="studio-auth-card"
          aria-labelledby="studio-auth-title"
        >
          <div className="studio-auth-copy">
            <span className="design-system-eyebrow">Studio access</span>
            <h1 id="studio-auth-title">{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  )
}
