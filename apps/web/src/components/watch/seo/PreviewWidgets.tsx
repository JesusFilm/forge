import Image from "next/image"

import type { PreviewEvidence } from "./types"

export function PreviewWidgets({ data }: { data: PreviewEvidence }) {
  return (
    <div>
      <div className="grid min-w-0 gap-8 lg:grid-cols-2">
        {(["social", "chat"] as const).map((kind) => (
          <section key={kind} data-preview-kind={kind} className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-base font-semibold text-white">
                {kind === "social" ? "Social preview" : "Chat preview"}
              </h4>
              <span className="text-[11px] tracking-wide text-stone-500 uppercase">
                Live metadata
              </span>
            </div>
            <div
              className={
                kind === "chat"
                  ? "ml-auto max-w-[92%] overflow-hidden rounded-2xl rounded-tr-sm border border-white/10 bg-[#222220]"
                  : "overflow-hidden rounded-xl border border-white/12 bg-[#20201e]"
              }
            >
              {data.imageUrl ? (
                <Image
                  src={data.imageUrl}
                  alt={data.imageAlt || "Canonical page preview"}
                  width={1200}
                  height={630}
                  sizes="(min-width: 768px) 40vw, 90vw"
                  unoptimized
                  loading="lazy"
                  className="aspect-[1.91/1] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[1.91/1] flex-col items-center justify-center bg-[#292521] px-6 text-center">
                  <span className="text-xs font-semibold tracking-[0.22em] text-red-200 uppercase">
                    Jesus Film Project
                  </span>
                  <span className="mt-2 max-w-sm text-xl font-semibold tracking-tight text-white">
                    {data.title || "Preview image unavailable"}
                  </span>
                </div>
              )}
              <div className="space-y-2 p-4">
                <p className="text-[11px] break-all text-stone-400">
                  {data.canonicalUrl || "Canonical URL unavailable"}
                </p>
                <p className="font-semibold text-stone-100">
                  {data.title || "Title unavailable"}
                </p>
                <p className="text-sm leading-relaxed text-stone-300">
                  {data.description || "Description unavailable"}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-stone-300">
        Based on available canonical metadata fields; unavailable fields are
        labelled above. Each app may crop images, shorten text, or keep an older
        cached preview. This does not show what an AI assistant has indexed or
        said.
      </p>
    </div>
  )
}
