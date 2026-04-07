import Link from "next/link"
import { getOwnerProfile } from "@/lib/features"

export function OwnerAvatar({
  owner,
  size = "default",
  linked = true,
}: {
  owner: string
  size?: "default" | "small" | "large"
  linked?: boolean
}) {
  const profile = getOwnerProfile(owner)
  const dim =
    size === "small" ? "h-4 w-4" : size === "large" ? "h-8 w-8" : "h-5 w-5"

  const content = (
    <span className="inline-flex items-center gap-1.5">
      {profile ? (
        <img
          src={`${profile.avatar}&s=40`}
          alt={owner}
          className={`${dim} rounded-full bg-white`}
        />
      ) : (
        <span
          className={`${dim} inline-flex items-center justify-center rounded-full bg-stone-700 text-[9px] font-medium uppercase text-stone-400`}
        >
          {owner[0]}
        </span>
      )}
      <span className="capitalize">{owner}</span>
    </span>
  )

  if (linked) {
    return (
      <Link
        href={`/person/${owner}`}
        className="inline-flex items-center text-inherit hover:text-white hover:underline"
      >
        {content}
      </Link>
    )
  }

  return content
}
