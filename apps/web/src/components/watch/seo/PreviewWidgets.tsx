import Image from "next/image"

import type { PreviewEvidence } from "./types"

export function PreviewWidgets({ data }: { data: PreviewEvidence }) {
  return (
    <div>
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        {(["social", "chat"] as const).map((kind) => (
          <section key={kind} data-preview-kind={kind} className="min-w-0">
            <h4 className="mb-3 text-base font-semibold text-stone-100">
              {kind === "social" ? "Social preview" : "Chat preview"}
            </h4>
            <div
              className={
                kind === "chat"
                  ? "overflow-hidden rounded-xl border-l-4 border-brand-red bg-stone-800"
                  : "overflow-hidden rounded-xl border border-stone-600 bg-stone-800"
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
                <div className="flex aspect-[1.91/1] items-center justify-center px-4 text-center text-sm text-stone-300">
                  Preview image unavailable
                </div>
              )}
              <div className="space-y-2 p-4">
                <p className="text-xs break-all text-stone-300">
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
        Based on current canonical page metadata. Each app may crop images,
        shorten text, or keep an older cached preview. This does not show what
        an AI assistant has indexed or said.
      </p>
    </div>
  )
}
