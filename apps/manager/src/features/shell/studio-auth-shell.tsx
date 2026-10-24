import Image from "next/image"
import { unstable_noStore as noStore } from "next/cache"
import type { CSSProperties, ReactNode } from "react"
import { StudioAuthBackground } from "@/features/shell/studio-auth-background"
import { getRandomStudioAuthBackgroundImage } from "@/features/shell/studio-auth-background-data"

export function StudioAuthShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode
  title: string
  subtitle: string
}) {
  noStore()

  const backgroundImage = getRandomStudioAuthBackgroundImage()

  return (
    <main
      className="design-system-eleven studio-auth-shell"
      style={
        {
          "--studio-auth-primary-color": backgroundImage.color,
        } as CSSProperties
      }
    >
      <StudioAuthBackground image={backgroundImage} />
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

        <div className="studio-auth-layout">
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

          <aside className="studio-auth-quote" aria-label="Scripture quote">
            <p className="studio-auth-quote-text">
              Each one heard them speaking in his own language…”
            </p>
            <p className="studio-auth-quote-citation">Acts 2:6–8</p>
          </aside>
        </div>
      </div>
    </main>
  )
}
