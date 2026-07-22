import type { ComponentPropsWithoutRef, ElementType } from "react"

import { cn } from "@/lib/utils"

type ThumbnailCaptionInset = "compact" | "default"
type ThumbnailTitleSize =
  | "compact"
  | "compact-sm"
  | "compact-md"
  | "regular"
  | "regular-sm"
  | "prominent"
  | "large"
  | "display"
type ThumbnailEyebrowSize = "compact" | "compact-sm" | "hero" | "regular"
type ThumbnailEyebrowElement = "div" | "p" | "span"
type ThumbnailTitleElement = "h2" | "h3" | "span"

type PolymorphicProps<Element extends ElementType, OwnProps> = OwnProps & {
  as?: Element
} & Omit<ComponentPropsWithoutRef<Element>, keyof OwnProps | "as">

const CAPTION_CLASSES = {
  compact:
    "pointer-events-none absolute inset-0 flex flex-col justify-end gap-1 px-3 pt-8 pb-3 sm:px-4 sm:pt-10 sm:pb-4",
  default:
    "pointer-events-none absolute inset-0 flex flex-col justify-end gap-1 px-4 pt-10 pb-4",
} satisfies Record<ThumbnailCaptionInset, string>

const TITLE_BASE_CLASS =
  "text-left leading-tight font-medium text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]"

function titleClasses(sizeClass: string): Record<2 | 3, string> {
  return {
    2: `line-clamp-2 ${TITLE_BASE_CLASS} ${sizeClass}`,
    3: `line-clamp-3 ${TITLE_BASE_CLASS} ${sizeClass}`,
  }
}

const TITLE_CLASSES = {
  compact: titleClasses("text-sm"),
  "compact-sm": titleClasses("text-sm sm:text-base"),
  "compact-md": titleClasses("text-sm md:text-base"),
  regular: titleClasses("text-base"),
  "regular-sm": titleClasses("text-base sm:text-xl"),
  prominent: titleClasses("text-lg md:text-xl"),
  large: titleClasses("text-xl"),
  display: titleClasses("text-2xl md:text-3xl"),
} satisfies Record<ThumbnailTitleSize, Record<2 | 3, string>>

const EYEBROW_BASE_CLASS =
  "block w-full truncate leading-5 font-medium tracking-wider text-stone-300/80 uppercase [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]"

const EYEBROW_CLASSES = {
  compact: `${EYEBROW_BASE_CLASS} text-[10px]`,
  "compact-sm": `${EYEBROW_BASE_CLASS} text-[10px] sm:text-xs`,
  hero: `${EYEBROW_BASE_CLASS} text-[11px]`,
  regular: `${EYEBROW_BASE_CLASS} text-xs`,
} satisfies Record<ThumbnailEyebrowSize, string>

const DESCRIPTION_CLASS =
  "line-clamp-2 text-xs leading-relaxed font-normal text-stone-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]"

function withOptionalClassName(baseClassName: string, className?: string) {
  return className ? cn(baseClassName, className) : baseClassName
}

type VideoThumbnailCaptionProps = ComponentPropsWithoutRef<"div"> & {
  inset?: ThumbnailCaptionInset
}

export function VideoThumbnailCaption({
  className,
  inset = "default",
  ...props
}: VideoThumbnailCaptionProps) {
  return (
    <div
      data-slot="video-thumbnail-caption"
      className={withOptionalClassName(CAPTION_CLASSES[inset], className)}
      {...props}
    />
  )
}

type VideoThumbnailEyebrowProps<
  Element extends ThumbnailEyebrowElement = "span",
> = PolymorphicProps<Element, { size?: ThumbnailEyebrowSize }>

export function VideoThumbnailEyebrow<
  Element extends ThumbnailEyebrowElement = "span",
>({
  as,
  children,
  className,
  size = "regular",
  ...props
}: VideoThumbnailEyebrowProps<Element>) {
  const Component = as ?? "span"
  return (
    <Component
      data-slot="video-thumbnail-eyebrow"
      className={withOptionalClassName(EYEBROW_CLASSES[size], className)}
      {...props}
    >
      {children}
    </Component>
  )
}

type VideoThumbnailTitleProps<Element extends ThumbnailTitleElement = "h3"> =
  PolymorphicProps<Element, { lines?: 2 | 3; size?: ThumbnailTitleSize }>

export function VideoThumbnailTitle<
  Element extends ThumbnailTitleElement = "h3",
>({
  as,
  children,
  className,
  lines = 2,
  size = "regular",
  ...props
}: VideoThumbnailTitleProps<Element>) {
  const Component = as ?? "h3"
  return (
    <Component
      data-slot="video-thumbnail-title"
      className={withOptionalClassName(TITLE_CLASSES[size][lines], className)}
      {...props}
    >
      {children}
    </Component>
  )
}

export function VideoThumbnailDescription({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      data-slot="video-thumbnail-description"
      className={withOptionalClassName(DESCRIPTION_CLASS, className)}
      {...props}
    >
      {children}
    </p>
  )
}
